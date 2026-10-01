import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { canAccessTmsData, type AccountType } from "@/lib/permissions";
import { authorizeTmsScope } from "@/lib/tms-tenant-auth";
import { computeSlaDeltaSeconds, computeSlaTargetAt, evaluateSlaStatus } from "@/lib/tms-sla";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_RUNS = 60;

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

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+07:00`));
}

interface ProfileRow {
  id: string;
  code: string;
  name: string;
  client_id: string;
  group_id: string;
  departure_target_time: string | null;
  departure_day_offset: number | null;
  status: string;
}

interface StopRow {
  id: string;
  route_order: number;
  store_name: string;
  target_time: string;
  target_day_offset: number | null;
}

interface AssignmentRow {
  task_id: string;
  service_date: string;
  match_score: number | null;
}

interface VisitRow {
  id: string;
  task_id: string;
  task_number: string | null;
  task_status: string | null;
  license_plate: string | null;
  driver_name: string | null;
  route_sequence: number;
  location_name: string | null;
  address_id: string | null;
  arrival_actual: string | null;
  departure_actual: string | null;
  last_synced_at: string | null;
  sla_route_stop_id: string | null;
  sla_kind: string | null;
  sla_target_at: string | null;
  sla_status: string | null;
  sla_delta_seconds: number | null;
}

function errorJson(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

/**
 * Logger per profil rute SLA: satu profil (mis. VAN 1) ditampilkan sebagai
 * rangkaian titik berurutan sesuai `route_order`, dikelompokkan per
 * perjalanan (FO + tanggal layanan). Titik yang belum dikunjungi tetap
 * tampil; profil tanpa FO menampilkan rute resmi dengan runs kosong.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return errorJson("Sesi login telah berakhir. Silakan masuk kembali.", 401);
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
    !canAccessTmsData(parsePermissions(role.permissions), accountType)
  ) {
    return errorJson("Anda tidak memiliki akses ke menu TMS.", 403);
  }

  const params = request.nextUrl.searchParams;
  const profileId = params.get("profileId")?.trim() ?? "";
  const dateFrom = params.get("dateFrom")?.trim() || jakartaToday();
  const dateTo = params.get("dateTo")?.trim() || dateFrom;
  const search = params.get("search")?.trim().toLowerCase() ?? "";

  if (!profileId) {
    return errorJson("Parameter profileId wajib diisi.", 400);
  }
  if (!isValidDate(dateFrom) || !isValidDate(dateTo) || dateFrom > dateTo) {
    return errorJson("Rentang tanggal tidak valid. Gunakan format YYYY-MM-DD.", 400);
  }

  const scope = await authorizeTmsScope({
    userId: user.id,
    accountType,
    permissions: parsePermissions(role.permissions),
    roleLevel: typeof role?.level === "number" ? role.level : 0,
    requestedClientRef: params.get("client"),
  });
  if (!scope.ok) return scope.response;
  const scopeIds = scope.scope.allowedClientIds;

  // Data operasional dibaca via admin client: tabel SLA di-REVOKE dari
  // role authenticated (hanya service_role yang punya SELECT), sedangkan
  // pembatasan antar-client tetap ditegakkan manual via client scope di bawah.
  const admin = createAdminClient();

  const { data: profileRow, error: profileError } = await admin
    .from("tms_sla_route_profiles")
    .select("id, code, name, client_id, group_id, departure_target_time, departure_day_offset, status")
    .eq("id", profileId)
    .maybeSingle();
  if (profileError) {
    return errorJson("Gagal memuat profil SLA.", 502);
  }
  const slaProfile = (profileRow ?? null) as unknown as ProfileRow | null;
  if (!slaProfile) {
    return errorJson("Profil SLA tidak ditemukan.", 404);
  }
  if (scopeIds !== "all" && !scopeIds.includes(slaProfile.client_id)) {
    return errorJson("Profil SLA di luar cakupan akses Anda.", 403);
  }

  const { data: groupRow } = await admin
    .from("tms_live_track_groups")
    .select("id, name")
    .eq("id", slaProfile.group_id)
    .maybeSingle();
  const groupName = ((groupRow ?? null) as unknown as { name?: string } | null)?.name ?? null;

  const { data: stopRows, error: stopsError } = await admin
    .from("tms_sla_route_stops")
    .select("id, route_order, store_name, target_time, target_day_offset")
    .eq("profile_id", profileId)
    .order("route_order", { ascending: true });
  if (stopsError) {
    return errorJson("Gagal memuat rute profil SLA.", 502);
  }
  const stops = (Array.isArray(stopRows) ? stopRows : []) as unknown as StopRow[];
  const stopById = new Map(stops.map((s) => [s.id, s]));

  // Mapping address McEasy -> titik SLA (primari diutamakan). Dipakai untuk
  // menempel kunjungan ke titik yang benar tanpa mengandalkan nomor urut,
  // karena sequence 1 McEasy adalah gudang sedangkan order 1 profil adalah
  // toko pertama.
  const stopByAddress = new Map<string, { stop: StopRow; primary: boolean }>();
  if (stops.length > 0) {
    const { data: addressRows } = await admin
      .from("tms_sla_route_stop_addresses")
      .select("route_stop_id, vendor_address_id, is_primary")
      .in(
        "route_stop_id",
        stops.map((s) => s.id),
      );
    for (const row of (Array.isArray(addressRows) ? addressRows : []) as unknown as {
      route_stop_id: string;
      vendor_address_id: string;
      is_primary: boolean | null;
    }[]) {
      const stop = row?.route_stop_id ? stopById.get(row.route_stop_id) : undefined;
      if (!stop || !row.vendor_address_id) continue;
      const primary = row.is_primary === true;
      const existing = stopByAddress.get(row.vendor_address_id);
      if (!existing || (primary && !existing.primary)) {
        stopByAddress.set(row.vendor_address_id, { stop, primary });
      }
    }
  }

  const { data: assignmentRows, error: assignmentError } = await admin
    .from("tms_sla_task_assignments")
    .select("task_id, service_date, match_score")
    .eq("profile_id", profileId)
    .gte("service_date", dateFrom)
    .lte("service_date", dateTo)
    .order("service_date", { ascending: false })
    .limit(MAX_RUNS + 1);
  if (assignmentError) {
    return errorJson("Gagal memuat perjalanan profil SLA.", 502);
  }
  const allAssignments = (Array.isArray(assignmentRows) ? assignmentRows : []) as unknown as AssignmentRow[];
  const totalRuns = allAssignments.length;
  const assignments = allAssignments.slice(0, MAX_RUNS);
  const taskIds = [...new Set(assignments.map((a) => a.task_id))];

  const visitsByTask = new Map<string, VisitRow[]>();
  const temperatures = new Map<string, number>();
  let lastSyncedAt: string | null = null;
  if (taskIds.length > 0) {
    const { data: visitRows } = await admin
      .from("tms_trip_visit_logs")
      .select(
        "id, task_id, task_number, task_status, license_plate, driver_name, route_sequence, " +
          "location_name, address_id, arrival_actual, departure_actual, last_synced_at, " +
          "sla_route_stop_id, sla_kind, sla_target_at, sla_status, sla_delta_seconds",
      )
      .in("task_id", taskIds);
    for (const row of (Array.isArray(visitRows) ? visitRows : []) as unknown as VisitRow[]) {
      if (!row || !row.task_id) continue;
      const list = visitsByTask.get(row.task_id) ?? [];
      list.push(row);
      visitsByTask.set(row.task_id, list);
      if (row.last_synced_at && (!lastSyncedAt || row.last_synced_at > lastSyncedAt)) {
        lastSyncedAt = row.last_synced_at;
      }
    }
    const { data: tempRows } = await admin
      .from("tms_route_point_temperatures")
      .select("task_id, route_sequence, temperatures")
      .in("task_id", taskIds);
    for (const row of (Array.isArray(tempRows) ? tempRows : []) as unknown as {
      task_id: string;
      route_sequence: number;
      temperatures: unknown;
    }[]) {
      if (Array.isArray(row.temperatures)) {
        for (const item of row.temperatures) {
          if (typeof item === "number" && Number.isFinite(item)) {
            temperatures.set(`${row.task_id}:${row.route_sequence}`, item);
            break;
          }
        }
      }
    }
  }

  const toVisitJson = (visit: VisitRow) => ({
    id: visit.id,
    routeSequence: visit.route_sequence,
    store: visit.location_name,
    enteredAt: visit.arrival_actual,
    exitedAt: visit.departure_actual,
    slaKind: visit.sla_kind,
    slaTargetAt: visit.sla_target_at,
    slaStatus: visit.sla_status,
    slaDeltaSeconds: visit.sla_delta_seconds,
    temperatureC: temperatures.get(`${visit.task_id}:${visit.route_sequence}`) ?? null,
  });

  const toArrivalVisitJson = (visit: VisitRow, stop: StopRow, serviceDate: string) => {
    const target =
      visit.sla_target_at ??
      computeSlaTargetAt(
        serviceDate,
        stop.target_time,
        typeof stop.target_day_offset === "number" ? stop.target_day_offset : 0,
      );
    const actual = visit.arrival_actual;
    return {
      id: visit.id,
      routeSequence: visit.route_sequence,
      store: visit.location_name,
      enteredAt: visit.arrival_actual,
      exitedAt: visit.departure_actual,
      slaKind: visit.sla_kind ?? "ARRIVAL",
      slaTargetAt: target,
      slaStatus: visit.sla_status ?? evaluateSlaStatus(target, actual),
      slaDeltaSeconds: visit.sla_delta_seconds ?? computeSlaDeltaSeconds(target, actual),
      temperatureC: temperatures.get(`${visit.task_id}:${visit.route_sequence}`) ?? null,
    };
  };

  const runs: Record<string, unknown>[] = [];
  for (const assignment of assignments) {
    const visits = (visitsByTask.get(assignment.task_id) ?? []).sort(
      (a, b) => a.route_sequence - b.route_sequence,
    );
    const first = visits[0] ?? null;
    const taskNumber = first?.task_number ?? null;
    const unit = first?.license_plate ?? null;
    const driver = first?.driver_name ?? null;
    if (search) {
      const haystack = `${taskNumber ?? ""} ${unit ?? ""} ${driver ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }

    // Sequence 1 McEasy selalu gudang (keberangkatan): tampil sebagai baris
    // tersendiri dan TIDAK ditempel ke titik profil (yang semuanya toko).
    // Kunjungan toko ditempel via sla_route_stop_id (otoritatif dari
    // evaluasi), lalu via address_id. Tidak ada fallback nomor-urut karena
    // urutan McEasy dan urutan profil memang berbeda sistem.
    const usedVisitIds = new Set<string>();
    let departure: {
      store: string | null;
      enteredAt: string | null;
      exitedAt: string | null;
      slaTargetAt: string | null;
      slaStatus: string | null;
      slaDeltaSeconds: number | null;
      temperatureC: number | null;
    } | null = null;
    const departureTarget =
      slaProfile.departure_target_time && assignment.service_date
        ? computeSlaTargetAt(
            assignment.service_date,
            slaProfile.departure_target_time,
            typeof slaProfile.departure_day_offset === "number" ? slaProfile.departure_day_offset : 0,
          )
        : null;
    for (const visit of visits) {
      if (visit.route_sequence !== 1) continue;
      usedVisitIds.add(visit.id);
      if (departure) continue;
      const target = visit.sla_target_at ?? departureTarget;
      const actual = visit.departure_actual;
      departure = {
        store: visit.location_name,
        enteredAt: visit.arrival_actual,
        exitedAt: actual,
        slaTargetAt: target,
        slaStatus: visit.sla_status ?? evaluateSlaStatus(target, actual),
        slaDeltaSeconds: visit.sla_delta_seconds ?? computeSlaDeltaSeconds(target, actual),
        temperatureC: temperatures.get(`${visit.task_id}:${visit.route_sequence}`) ?? null,
      };
    }
    const stopVisits: Record<string, ReturnType<typeof toVisitJson> | null> = {};
    for (const stop of stops) stopVisits[stop.id] = null;
    for (const visit of visits) {
      if (usedVisitIds.has(visit.id)) continue;
      const direct = visit.sla_route_stop_id ? stopById.get(visit.sla_route_stop_id) : undefined;
      if (direct && !stopVisits[direct.id]) {
        stopVisits[direct.id] = toArrivalVisitJson(visit, direct, assignment.service_date);
        usedVisitIds.add(visit.id);
      }
    }
    for (const visit of visits) {
      if (usedVisitIds.has(visit.id)) continue;
      const mapped = visit.address_id ? stopByAddress.get(visit.address_id) : undefined;
      if (mapped && !stopVisits[mapped.stop.id]) {
        stopVisits[mapped.stop.id] = toArrivalVisitJson(visit, mapped.stop, assignment.service_date);
        usedVisitIds.add(visit.id);
      }
    }
    const extras = visits.filter((v) => !usedVisitIds.has(v.id)).map(toVisitJson);

    let onTime = 0;
    let late = 0;
    let pending = 0;
    let unset = 0;
    let visitedStops = 0;
    for (const stop of stops) {
      const visit = stopVisits[stop.id];
      if (visit?.enteredAt || visit?.exitedAt) visitedStops += 1;
      if (visit?.slaStatus === "ON_TIME") onTime += 1;
      else if (visit?.slaStatus === "LATE") late += 1;
      else if (visit?.slaStatus === "PENDING") pending += 1;
      else unset += 1;
    }
    const denom = onTime + late;

    runs.push({
      taskId: assignment.task_id,
      taskNumber,
      taskStatus: first?.task_status ?? null,
      serviceDate: assignment.service_date,
      unit,
      driver,
      matchScore: assignment.match_score,
      departure,
      summary: {
        totalStops: stops.length,
        visitedStops,
        onTime,
        late,
        pending,
        unset,
        compliance: denom > 0 ? onTime / denom : null,
      },
      stopVisits,
      extras,
    });
  }

  runs.sort((a, b) => {
    const dateCmp = String((b as { serviceDate: string }).serviceDate).localeCompare(
      String((a as { serviceDate: string }).serviceDate),
    );
    if (dateCmp !== 0) return dateCmp;
    return String((a as { taskNumber: string | null }).taskNumber ?? "").localeCompare(
      String((b as { taskNumber: string | null }).taskNumber ?? ""),
      "id",
    );
  });

  return NextResponse.json(
    {
      data: {
        profile: {
          id: slaProfile.id,
          code: slaProfile.code,
          name: slaProfile.name,
          groupName,
          status: slaProfile.status,
          departureTargetTime: slaProfile.departure_target_time
            ? slaProfile.departure_target_time.slice(0, 5)
            : null,
          departureDayOffset: slaProfile.departure_day_offset ?? 0,
        },
        stops: stops.map((stop) => ({
          id: stop.id,
          routeOrder: stop.route_order,
          storeName: stop.store_name,
          targetTime: stop.target_time,
          dayOffset: stop.target_day_offset ?? 0,
          // Semua titik profil adalah toko (kedatangan); keberangkatan
          // gudang tampil sebagai baris tersendiri per perjalanan.
          kind: "ARRIVAL",
        })),
        runs,
      },
      meta: {
        totalRuns,
        truncated: totalRuns > runs.length,
        dateFrom,
        dateTo,
        lastSyncedAt,
        fetchedAt: new Date().toISOString(),
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}
