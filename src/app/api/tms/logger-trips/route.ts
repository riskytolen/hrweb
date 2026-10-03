import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { canAccessTmsData, type AccountType } from "@/lib/permissions";
import { authorizeTmsScope } from "@/lib/tms-tenant-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type VisitStateFilter = "ALL" | "ONGOING" | "COMPLETED" | "INCOMPLETE" | "PENDING";

const VISIT_STATES: readonly VisitStateFilter[] = ["ALL", "ONGOING", "COMPLETED", "INCOMPLETE", "PENDING"];

type SlaStateFilter = "ALL" | "ON_TIME" | "LATE" | "PENDING" | "UNSET";

const SLA_STATES: readonly SlaStateFilter[] = ["ALL", "ON_TIME", "LATE", "PENDING", "UNSET"];

function parsePermissions(permissions: unknown): string[] {
  if (Array.isArray(permissions)) return permissions.filter((p): p is string => typeof p === "string");
  if (typeof permissions === "string") {
    try {
      const parsed: unknown = JSON.parse(permissions);
      if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
    } catch {
      return [];
    }
  }
  return [];
}

function canAccessTms(permissions: string[], accountType: AccountType): boolean {
  return canAccessTmsData(permissions, accountType);
}

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function jakartaDaysAgo(days: number): string {
  const now = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+07:00`));
}

interface VisitRow {
  id: string;
  task_id: string;
  task_number: string | null;
  task_status: string | null;
  license_plate: string | null;
  driver_name: string | null;
  route_sequence: number;
  point_type: string | null;
  location_name: string | null;
  location_address: string | null;
  arrival_actual: string | null;
  departure_actual: string | null;
  last_synced_at: string | null;
  live_track_group_id: string | null;
  sla_profile_id: string | null;
  sla_kind: string | null;
  sla_target_at: string | null;
  sla_status: string | null;
  sla_delta_seconds: number | null;
}

interface TemperatureRow {
  task_id: string;
  route_sequence: number;
  temperatures: unknown;
}

function firstTemperature(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item === "number" && Number.isFinite(item)) return item;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sesi login telah berakhir. Silakan masuk kembali." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("status, account_type, roles(id, nama, level, permissions, status)")
    .eq("id", user.id)
    .single();

  const roleRelation = profile?.roles;
  const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;
  const accountType: AccountType = profile?.account_type === "external" ? "external" : "internal";

  if (
    !profile ||
    profile.status !== "Aktif" ||
    (profile.account_type !== "internal" && profile.account_type !== "external") ||
    !role ||
    role.status === "Tidak Aktif" ||
    !canAccessTms(parsePermissions(role.permissions), accountType)
  ) {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses ke menu TMS." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const params = request.nextUrl.searchParams;
  const dateFrom = params.get("dateFrom")?.trim() ?? "";
  const dateTo = params.get("dateTo")?.trim() ?? "";
  const search = params.get("search")?.trim() ?? "";
  const stateParam = (params.get("visitState")?.trim().toUpperCase() ?? "ALL") as VisitStateFilter;
  const visitState: VisitStateFilter = VISIT_STATES.includes(stateParam) ? stateParam : "ALL";
  const slaParam = (params.get("sla")?.trim().toUpperCase() ?? "ALL") as SlaStateFilter;
  const slaState: SlaStateFilter = SLA_STATES.includes(slaParam) ? slaParam : "ALL";
  const slaProfile = params.get("slaProfile")?.trim() ?? "";
  const pageRaw = Number(params.get("page") ?? "1");
  const limitRaw = Number(params.get("limit") ?? String(DEFAULT_LIMIT));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.trunc(pageRaw) : 1;
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  if ((dateFrom && !isValidDate(dateFrom)) || (dateTo && !isValidDate(dateTo))) {
    return NextResponse.json(
      { error: "Format tanggal tidak valid. Gunakan YYYY-MM-DD." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const fromDay = dateFrom || jakartaDaysAgo(6);
  const toDay = dateTo || jakartaToday();
  if (fromDay > toDay) {
    return NextResponse.json(
      { error: "Rentang tanggal tidak valid." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const fromIso = `${fromDay}T00:00:00+07:00`;
  const toIso = `${toDay}T23:59:59.999+07:00`;

  // Kunjungan yang bersinggungan dengan rentang tanggal: masuk/keluar di
  // dalamnya, masih berlangsung dan sudah masuk sebelum rentang berakhir,
  // atau belum punya waktu masuk/keluar tetapi terakhir disinkronkan pada
  // rentang tersebut.
  const overlap =
    `and(arrival_actual.gte.${fromIso},arrival_actual.lte.${toIso}),` +
    `and(departure_actual.gte.${fromIso},departure_actual.lte.${toIso}),` +
    `and(arrival_actual.lte.${toIso},departure_actual.is.null),` +
    `and(arrival_actual.is.null,departure_actual.is.null,last_synced_at.gte.${fromIso},last_synced_at.lte.${toIso})`;

  const applyFilters = <T>(query: T): T => {
    type Chain = {
      or: (expr: string) => Chain;
      ilike: (col: string, pattern: string) => Chain;
      not: (col: string, op: string, val: unknown) => Chain;
      is: (col: string, val: null) => Chain;
      eq: (col: string, val: unknown) => Chain;
    };
    let q = query as unknown as Chain;
    q = q.or(overlap);
    if (search) {
      const pattern = `%${search.replace(/[%_]/g, "")}%`;
      q = q.or(
        `license_plate.ilike.${pattern},driver_name.ilike.${pattern},` +
          `task_number.ilike.${pattern},location_name.ilike.${pattern},` +
          `location_address.ilike.${pattern}`,
      );
    }
    if (visitState === "ONGOING") {
      q = q.not("arrival_actual", "is", null).is("departure_actual", null);
    } else if (visitState === "COMPLETED") {
      q = q.not("arrival_actual", "is", null).not("departure_actual", "is", null);
    } else if (visitState === "INCOMPLETE") {
      q = q.is("arrival_actual", null).not("departure_actual", "is", null);
    } else if (visitState === "PENDING") {
      q = q.is("arrival_actual", null).is("departure_actual", null);
    }
    if (slaState !== "ALL") {
      q = q.eq("sla_status", slaState);
    }
    if (slaProfile) {
      q = q.eq("sla_profile_id", slaProfile);
    }
    return q as unknown as T;
  };

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const scope = await authorizeTmsScope({
    userId: user.id,
    accountType,
    permissions: parsePermissions(role.permissions),
    roleLevel: typeof role?.level === "number" ? role.level : 0,
    requestedClientRef: params.get("client"),
  });
  if (!scope.ok) return scope.response;
  const scopeIds = scope.scope.allowedClientIds;

  const VISIT_COLUMNS =
    "id, task_id, task_number, task_status, license_plate, driver_name, route_sequence, " +
    "point_type, location_name, location_address, arrival_actual, departure_actual, last_synced_at, " +
    "live_track_group_id, sla_profile_id, sla_kind, sla_target_at, sla_status, sla_delta_seconds";

  const dataQuery = applyFilters(
    scopeIds === "all"
      ? supabase
          .from("tms_trip_visit_logs")
          .select(VISIT_COLUMNS, { count: "exact" })
      : supabase
          .from("tms_trip_visit_logs")
          .select(VISIT_COLUMNS, { count: "exact" })
          .in("client_id", scopeIds),
  )
    .order("arrival_actual", { ascending: false, nullsFirst: false })
    .order("route_sequence", { ascending: true })
    .range(from, to);

  const { data: rows, error: rowsError, count } = await dataQuery;
  if (rowsError) {
    return NextResponse.json(
      { error: "Gagal memuat Logger Trips." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  const visits = (Array.isArray(rows) ? (rows as unknown as VisitRow[]) : []);

  // Label profil SLA + nama kelompok untuk baris yang sudah dievaluasi.
  const profileCodes = new Map<string, string>();
  const groupNames = new Map<string, string>();
  const profileIds = [...new Set(visits.map((v) => v.sla_profile_id).filter((id): id is string => !!id))];
  const groupIds = [...new Set(visits.map((v) => v.live_track_group_id).filter((id): id is string => !!id))];
  if (profileIds.length > 0) {
    const { data: profileRows } = await supabase
      .from("tms_sla_route_profiles")
      .select("id, code")
      .in("id", profileIds);
    for (const row of (Array.isArray(profileRows) ? profileRows : []) as { id: string; code: string }[]) {
      if (row?.id) profileCodes.set(row.id, row.code);
    }
  }
  if (groupIds.length > 0) {
    const { data: groupRows } = await supabase
      .from("tms_live_track_groups")
      .select("id, name")
      .in("id", groupIds);
    for (const row of (Array.isArray(groupRows) ? groupRows : []) as { id: string; name: string }[]) {
      if (row?.id) groupNames.set(row.id, row.name);
    }
  }

  // Suhu pendukung dari snapshot capture (jika ada).
  const temperatures = new Map<string, number>();
  if (visits.length > 0) {
    const taskIds = [...new Set(visits.map((v) => v.task_id))];
    const { data: tempRows } = await supabase
      .from("tms_route_point_temperatures")
      .select("task_id, route_sequence, temperatures")
      .in("task_id", taskIds);
    for (const row of (Array.isArray(tempRows) ? (tempRows as unknown as TemperatureRow[]) : [])) {
      const value = firstTemperature(row.temperatures);
      if (value !== null) temperatures.set(`${row.task_id}:${row.route_sequence}`, value);
    }
  }

  // KPI dihitung dari rentang tanggal yang sama (tanpa paging).
  const countsQuery = applyFilters(
    scopeIds === "all"
      ? supabase.from("tms_trip_visit_logs").select("arrival_actual, departure_actual, sla_status", { count: "exact" })
      : supabase
          .from("tms_trip_visit_logs")
          .select("arrival_actual, departure_actual, sla_status", { count: "exact" })
          .in("client_id", scopeIds),
  );
  const { data: countRows, count: total } = await countsQuery;
  const counts = { completed: 0, ongoing: 0, incomplete: 0, pending: 0 };
  const sla = { onTime: 0, late: 0, pending: 0, unset: 0, unevaluated: 0 };
  for (const row of (Array.isArray(countRows)
    ? (countRows as unknown as { arrival_actual: string | null; departure_actual: string | null; sla_status: string | null }[])
    : [])) {
    if (row.arrival_actual && row.departure_actual) counts.completed += 1;
    else if (row.arrival_actual) counts.ongoing += 1;
    else if (row.departure_actual) counts.incomplete += 1;
    else counts.pending += 1;
    if (row.sla_status === "ON_TIME") sla.onTime += 1;
    else if (row.sla_status === "LATE") sla.late += 1;
    else if (row.sla_status === "PENDING") sla.pending += 1;
    else if (row.sla_status === "UNSET") sla.unset += 1;
    else sla.unevaluated += 1;
  }

  let lastSyncedAt: string | null = null;
  for (const visit of visits) {
    if (visit.last_synced_at && (!lastSyncedAt || visit.last_synced_at > lastSyncedAt)) {
      lastSyncedAt = visit.last_synced_at;
    }
  }

  return NextResponse.json(
    {
      data: visits.map((visit) => ({
        id: visit.id,
        taskId: visit.task_id,
        taskNumber: visit.task_number,
        taskStatus: visit.task_status,
        unit: visit.license_plate,
        driver: visit.driver_name,
        routeSequence: visit.route_sequence,
        pointType: visit.point_type,
        store: visit.location_name,
        address: visit.location_address,
        enteredAt: visit.arrival_actual,
        exitedAt: visit.departure_actual,
        temperatureC: temperatures.get(`${visit.task_id}:${visit.route_sequence}`) ?? null,
        groupName: (visit.live_track_group_id && groupNames.get(visit.live_track_group_id)) || null,
        slaProfileCode: (visit.sla_profile_id && profileCodes.get(visit.sla_profile_id)) || null,
        slaKind: visit.sla_kind,
        slaTargetAt: visit.sla_target_at,
        slaStatus: visit.sla_status,
        slaDeltaSeconds: visit.sla_delta_seconds,
      })),
      meta: {
        total: total ?? count ?? visits.length,
        page,
        limit,
        counts,
        sla,
        lastSyncedAt,
        fetchedAt: new Date().toISOString(),
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}
