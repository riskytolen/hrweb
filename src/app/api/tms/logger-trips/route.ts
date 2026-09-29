import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { canAccessTmsData } from "@/lib/permissions";
import { authorizeTmsScope } from "@/lib/tms-tenant-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type VisitStateFilter = "ALL" | "ONGOING" | "COMPLETED" | "INCOMPLETE" | "PENDING";

const VISIT_STATES: readonly VisitStateFilter[] = ["ALL", "ONGOING", "COMPLETED", "INCOMPLETE", "PENDING"];

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

function canAccessTms(permissions: string[]): boolean {
  return canAccessTmsData(permissions);
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

  if (
    !profile ||
    profile.status !== "Aktif" ||
    profile.account_type !== "internal" ||
    !role ||
    role.status === "Tidak Aktif" ||
    !canAccessTms(parsePermissions(role.permissions))
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
  // dalamnya, atau masih berlangsung dan sudah masuk sebelum rentang berakhir.
  const overlap =
    `and(arrival_actual.gte.${fromIso},arrival_actual.lte.${toIso}),` +
    `and(departure_actual.gte.${fromIso},departure_actual.lte.${toIso}),` +
    `and(arrival_actual.lte.${toIso},departure_actual.is.null)`;

  const applyFilters = <T>(query: T): T => {
    type Chain = {
      or: (expr: string) => Chain;
      ilike: (col: string, pattern: string) => Chain;
      not: (col: string, op: string, val: unknown) => Chain;
      is: (col: string, val: null) => Chain;
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
    return q as unknown as T;
  };

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const scope = await authorizeTmsScope({
    userId: user.id,
    accountType: "internal",
    permissions: parsePermissions(role.permissions),
    roleLevel: typeof role?.level === "number" ? role.level : 0,
  });
  if (!scope.ok) return scope.response;
  const scopeIds = scope.scope.allowedClientIds;

  const dataQuery = applyFilters(
    scopeIds === "all"
      ? supabase
          .from("tms_trip_visit_logs")
          .select(
            "id, task_id, task_number, task_status, license_plate, driver_name, route_sequence, " +
              "point_type, location_name, location_address, arrival_actual, departure_actual, last_synced_at",
            { count: "exact" },
          )
      : supabase
          .from("tms_trip_visit_logs")
          .select(
            "id, task_id, task_number, task_status, license_plate, driver_name, route_sequence, " +
              "point_type, location_name, location_address, arrival_actual, departure_actual, last_synced_at",
            { count: "exact" },
          )
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
      ? supabase.from("tms_trip_visit_logs").select("arrival_actual, departure_actual", { count: "exact" })
      : supabase
          .from("tms_trip_visit_logs")
          .select("arrival_actual, departure_actual", { count: "exact" })
          .in("client_id", scopeIds),
  );
  const { data: countRows, count: total } = await countsQuery;
  const counts = { completed: 0, ongoing: 0, incomplete: 0, pending: 0 };
  for (const row of (Array.isArray(countRows)
    ? (countRows as unknown as { arrival_actual: string | null; departure_actual: string | null }[])
    : [])) {
    if (row.arrival_actual && row.departure_actual) counts.completed += 1;
    else if (row.arrival_actual) counts.ongoing += 1;
    else if (row.departure_actual) counts.incomplete += 1;
    else counts.pending += 1;
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
      })),
      meta: {
        total: total ?? count ?? visits.length,
        page,
        limit,
        counts,
        lastSyncedAt,
        fetchedAt: new Date().toISOString(),
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}
