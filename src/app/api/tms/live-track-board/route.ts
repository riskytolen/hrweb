import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_ROWS = 500;

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
  if (permissions.includes("all")) return true;
  return permissions.some((p) => p === "tms" || p === "tms.view" || p === "tms.input");
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

/**
 * Board Live Track berkelompok: hanya occurrence dengan window aktif
 * (window_started_at <= now < visible_until). Unit tanpa kelompok tidak
 * masuk response. FO selesai tetap tampil sampai window berakhir.
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
  const nowIso = new Date().toISOString();

  const admin = createAdminClient();
  let query = admin
    .from("tms_live_track_task_occurrences")
    .select(
      "task_id, group_id, group_vehicle_id, window_started_at, visible_until, terminal_at, first_visible_at, " +
        "group:tms_live_track_groups(id, name, color, status, default_window_start, default_window_end), " +
        "snapshot:tms_live_track_task_snapshots(task_id, task_number, vehicle_id, license_plate, driver_name, " +
        "status_raw, expected_started_on, actual_started_on, actual_arrival_on, terminal_at, timeline, " +
        "planned_routes, actual_routes, track_id, frozen_at, last_synced_at)",
    )
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
      windowLabel: string;
      tasks: Record<string, unknown>[];
    }
  >();

  const short = (value: string): string => value.slice(0, 5).replace(":", ".");
  let lastSyncedAt: string | null = null;

  for (const row of rows) {
    if (!row.group || row.group.status !== "Aktif" || !row.snapshot) continue;
    const entry = groups.get(row.group.id) ?? {
      id: row.group.id,
      name: row.group.name,
      color: row.group.color,
      windowLabel: `${short(row.group.default_window_start)}–${short(row.group.default_window_end)} WIB`,
      tasks: [],
    };
    entry.tasks.push({
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
    });
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
        groupCount: data2.length,
        taskCount: rows.length,
        lastSyncedAt,
        fetchedAt: new Date().toISOString(),
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}
