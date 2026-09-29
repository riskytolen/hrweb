import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { canAccessTmsData } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_ROWS = 500;

/** Status yang dianggap riwayat: tetap tampil di luar jam operasional. */
const TERMINAL_STATUSES = ["ENDED"];
const HISTORY_DEFAULT_DAYS = 7;
const HISTORY_DEFAULT_PAGE_SIZE = 50;
const HISTORY_MAX_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
/** WIB = UTC+7. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

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

interface OccurrenceRow {
  task_id: string;
  group_id: string;
  group_vehicle_id: string;
  window_started_at: string;
  visible_until: string;
  terminal_at: string | null;
  first_visible_at: string;
  group: {
    id: string;
    name: string;
    color: string;
    status: string;
    default_window_start: string;
    default_window_end: string;
  } | null;
  snapshot: {
    task_id: string;
    task_number: string | null;
    vehicle_id: number | null;
    license_plate: string | null;
    driver_name: string | null;
    status_raw: string | null;
    expected_started_on: string | null;
    actual_started_on: string | null;
    actual_arrival_on: string | null;
    terminal_at: string | null;
    timeline: unknown;
    planned_routes: unknown;
    actual_routes: unknown;
    track_id: string | null;
    frozen_at: string | null;
    last_synced_at: string;
  } | null;
}

interface HistorySnapshotRow {
  task_id: string;
  terminal_at: string | null;
  actual_arrival_on: string | null;
}

/** Tanggal kalender WIB (YYYY-MM-DD) untuk sebuah timestamp. */
function wibDateString(atMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atMs));
}

/** Awal hari WIB dalam ms UTC. Null bila format tanggal tidak valid. */
function wibDayStartUtcMs(dateStr: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  const startUtcMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - WIB_OFFSET_MS;
  return Number.isNaN(startUtcMs) ? null : startUtcMs;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function errorJson(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function shortClock(value: string): string {
  return value.slice(0, 5).replace(":", ".");
}

function toTaskEntry(row: OccurrenceRow): Record<string, unknown> | null {
  if (!row.snapshot) return null;
  return {
    id: row.snapshot.task_id,
    number: row.snapshot.task_number,
    statusRaw: row.snapshot.status_raw,
    vehicleId: row.snapshot.vehicle_id,
    licensePlate: row.snapshot.license_plate,
    driverName: row.snapshot.driver_name,
    expectedStartedOn: row.snapshot.expected_started_on,
    actualStartedOn: row.snapshot.actual_started_on,
    actualArrivalOn: row.snapshot.actual_arrival_on,
    terminalAt: row.snapshot.terminal_at ?? row.terminal_at,
    timeline: Array.isArray(row.snapshot.timeline) ? row.snapshot.timeline : [],
    plannedRoutes: Array.isArray(row.snapshot.planned_routes) ? row.snapshot.planned_routes : [],
    actualRoutes: Array.isArray(row.snapshot.actual_routes) ? row.snapshot.actual_routes : [],
    trackId: row.snapshot.track_id,
    frozen: row.snapshot.frozen_at !== null,
    windowStartedAt: row.window_started_at,
    visibleUntil: row.visible_until,
  };
}

const OCCURRENCE_SELECT =
  "task_id, group_id, group_vehicle_id, window_started_at, visible_until, terminal_at, first_visible_at, " +
  "group:tms_live_track_groups(id, name, color, status, default_window_start, default_window_end), " +
  "snapshot:tms_live_track_task_snapshots(task_id, task_number, vehicle_id, license_plate, driver_name, " +
  "status_raw, expected_started_on, actual_started_on, actual_arrival_on, terminal_at, timeline, " +
  "planned_routes, actual_routes, track_id, frozen_at, last_synced_at)";

/**
 * Board Live Track berkelompok.
 * - mode=active (default): hanya FO STARTED dengan window aktif
 *   (window_started_at <= now < visible_until). Unit tanpa kelompok tidak
 *   masuk response.
 * - mode=history: hanya FO ENDED tanpa filter window (lihat getHistoryBoard).
 */
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
  const search = params.get("search")?.trim() ?? "";
  const mode = params.get("mode") === "history" ? "history" : "active";
  const nowIso = new Date().toISOString();
  const admin = createAdminClient();

  if (mode === "history") {
    return getHistoryBoard(admin, params, search);
  }

  let query = admin
    .from("tms_live_track_task_occurrences")
    .select(OCCURRENCE_SELECT)
    // Tab Aktif hanya untuk FO yang sedang berjalan.
    .eq("snapshot.status_raw", "STARTED")
    .lte("window_started_at", nowIso)
    .gt("visible_until", nowIso)
    .order("window_started_at", { ascending: false })
    .limit(MAX_ROWS);

  if (search) {
    const pattern = `%${search.replace(/[%_]/g, "")}%`;
    query = query.or(
      `snapshot.task_number.ilike.${pattern},snapshot.license_plate.ilike.${pattern},snapshot.driver_name.ilike.${pattern}`,
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Gagal memuat board Live Track." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  const rows = (Array.isArray(data) ? data : []) as unknown as OccurrenceRow[];

  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      color: string;
      status: string;
      windowLabel: string;
      tasks: Record<string, unknown>[];
    }
  >();

  let lastSyncedAt: string | null = null;

  for (const row of rows) {
    if (!row.group || row.group.status !== "Aktif" || !row.snapshot) continue;
    if ((row.snapshot.status_raw ?? "").toUpperCase() !== "STARTED") continue;
    const entry = groups.get(row.group.id) ?? {
      id: row.group.id,
      name: row.group.name,
      color: row.group.color,
      status: row.group.status,
      windowLabel: `${shortClock(row.group.default_window_start)}–${shortClock(row.group.default_window_end)} WIB`,
      tasks: [],
    };
    const taskEntry = toTaskEntry(row);
    if (!taskEntry) continue;
    entry.tasks.push(taskEntry);
    groups.set(row.group.id, entry);
    if (!lastSyncedAt || row.snapshot.last_synced_at > lastSyncedAt) {
      lastSyncedAt = row.snapshot.last_synced_at;
    }
  }

  const data2 = [...groups.values()].map((group) => ({
    ...group,
    tasks: group.tasks.sort((a, b) =>
      String((a as { number: string | null }).number ?? "").localeCompare(
        String((b as { number: string | null }).number ?? ""),
        "id",
      ),
    ),
  }));

  return NextResponse.json(
    {
      data: data2,
      meta: {
        mode: "active",
        groupCount: data2.length,
        taskCount: rows.length,
        lastSyncedAt,
        fetchedAt: new Date().toISOString(),
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}

/**
 * Board Riwayat: FO ENDED tanpa filter window operasional sehingga tetap
 * tampil di luar jam. Kelompok nonaktif tetap disertakan agar riwayat tidak
 * hilang saat konfigurasi berubah. Diurutkan dan difilter berdasarkan waktu
 * terminal (fallback waktu tiba aktual) dalam tanggal WIB.
 */
async function getHistoryBoard(
  admin: ReturnType<typeof createAdminClient>,
  params: URLSearchParams,
  search: string,
): Promise<NextResponse> {
  const nowMs = Date.now();
  const defaultTo = wibDateString(nowMs);
  const defaultFrom = wibDateString(nowMs - (HISTORY_DEFAULT_DAYS - 1) * DAY_MS);
  const fromInput = params.get("from")?.trim() || defaultFrom;
  const toInput = params.get("to")?.trim() || defaultTo;
  const startMs = wibDayStartUtcMs(fromInput);
  const endMs = wibDayStartUtcMs(toInput);
  if (startMs === null || endMs === null || endMs < startMs) {
    return errorJson("Rentang tanggal riwayat tidak valid. Gunakan format YYYY-MM-DD.", 400);
  }
  const page = clampInt(Number(params.get("page")), 1, 10000, 1);
  const pageSize = clampInt(Number(params.get("limit")), 1, HISTORY_MAX_PAGE_SIZE, HISTORY_DEFAULT_PAGE_SIZE);
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs + DAY_MS).toISOString();

  let snapQuery = admin
    .from("tms_live_track_task_snapshots")
    .select("task_id, terminal_at, actual_arrival_on", { count: "exact" })
    .in("status_raw", TERMINAL_STATUSES)
    .or(
      `and(terminal_at.gte.${startIso},terminal_at.lt.${endIso}),` +
        `and(terminal_at.is.null,actual_arrival_on.gte.${startIso},actual_arrival_on.lt.${endIso})`,
    )
    .order("terminal_at", { ascending: false, nullsFirst: false })
    .order("actual_arrival_on", { ascending: false, nullsFirst: false });

  if (search) {
    const pattern = `%${search.replace(/[%_,()]/g, "")}%`;
    snapQuery = snapQuery.or(
      `task_number.ilike.${pattern},license_plate.ilike.${pattern},driver_name.ilike.${pattern}`,
    );
  }

  const {
    data: snapData,
    error: snapError,
    count,
  } = await snapQuery.range((page - 1) * pageSize, page * pageSize - 1);
  if (snapError) {
    return errorJson("Gagal memuat riwayat Live Track.", 502);
  }
  const snapshots = (Array.isArray(snapData) ? snapData : []) as unknown as HistorySnapshotRow[];
  const total = typeof count === "number" ? count : snapshots.length;

  const empty = (extraMeta: Record<string, unknown> = {}) =>
    NextResponse.json(
      {
        data: [],
        meta: {
          mode: "history",
          groupCount: 0,
          taskCount: 0,
          total,
          page,
          pageSize,
          from: fromInput,
          to: toInput,
          lastSyncedAt: null,
          fetchedAt: new Date().toISOString(),
          ...extraMeta,
        },
      },
      { headers: NO_STORE_HEADERS },
    );

  if (snapshots.length === 0) return empty();

  const { data: occData, error: occError } = await admin
    .from("tms_live_track_task_occurrences")
    .select(OCCURRENCE_SELECT)
    .in(
      "task_id",
      snapshots.map((row) => row.task_id),
    );
  if (occError) {
    return errorJson("Gagal memuat riwayat Live Track.", 502);
  }
  const occRows = (Array.isArray(occData) ? occData : []) as unknown as OccurrenceRow[];

  // Satu occurrence terbaru per (task, kelompok) agar FO tidak tampil ganda.
  const occByTask = new Map<string, OccurrenceRow[]>();
  for (const row of occRows) {
    if (!row.group || !row.snapshot) continue;
    if ((row.snapshot.status_raw ?? "").toUpperCase() !== "ENDED") continue;
    const list = occByTask.get(row.task_id) ?? [];
    list.push(row);
    occByTask.set(row.task_id, list);
  }

  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      color: string;
      status: string;
      windowLabel: string;
      tasks: Record<string, unknown>[];
    }
  >();

  let taskCount = 0;
  let lastSyncedAt: string | null = null;
  for (const snapshot of snapshots) {
    const occurrences = (occByTask.get(snapshot.task_id) ?? []).sort((a, b) =>
      b.window_started_at.localeCompare(a.window_started_at),
    );
    const seenGroups = new Set<string>();
    for (const row of occurrences) {
      if (!row.group || seenGroups.has(row.group.id)) continue;
      seenGroups.add(row.group.id);
      const entry = groups.get(row.group.id) ?? {
        id: row.group.id,
        name: row.group.name,
        color: row.group.color,
        status: row.group.status,
        windowLabel: `${shortClock(row.group.default_window_start)}–${shortClock(row.group.default_window_end)} WIB`,
        tasks: [],
      };
      const taskEntry = toTaskEntry(row);
      if (!taskEntry) continue;
      entry.tasks.push(taskEntry);
      groups.set(row.group.id, entry);
      taskCount += 1;
      if (
        row.snapshot &&
        (!lastSyncedAt || row.snapshot.last_synced_at > lastSyncedAt)
      ) {
        lastSyncedAt = row.snapshot.last_synced_at;
      }
    }
  }

  const data2 = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "id"))
    .map((group) => ({
      ...group,
      tasks: group.tasks.sort((a, b) =>
        String(
          (b as { terminalAt: string | null }).terminalAt ??
            (b as { actualArrivalOn: string | null }).actualArrivalOn ??
            "",
        ).localeCompare(
          String(
            (a as { terminalAt: string | null }).terminalAt ??
              (a as { actualArrivalOn: string | null }).actualArrivalOn ??
              "",
          ),
        ),
      ),
    }));

  return NextResponse.json(
    {
      data: data2,
      meta: {
        mode: "history",
        groupCount: data2.length,
        taskCount,
        total,
        page,
        pageSize,
        from: fromInput,
        to: toInput,
        lastSyncedAt,
        fetchedAt: new Date().toISOString(),
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}
