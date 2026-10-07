import { createAdminClient } from "@/lib/supabase-admin";
import { stampGroupMembersClient } from "@/lib/tms-group-client";
import {
  authorizeLiveTrackConfig,
  liveTrackConfigError,
  liveTrackConfigJson,
} from "@/lib/tms-live-track-auth";
import type {
  LiveTrackGroup,
  LiveTrackGroupInput,
  LiveTrackGroupMember,
} from "@/lib/tms-live-track-config";

export const dynamic = "force-dynamic";

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  status: string;
  default_window_start: string;
  default_window_end: string;
  timezone: string;
  effective_from: string | null;
  effective_until: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  group_id: string;
  use_group_schedule: boolean;
  override_window_start: string | null;
  override_window_end: string | null;
  enabled: boolean;
  sort_order: number;
  vehicle: {
    mceasy_vehicle_id: number;
    license_plate: string;
    vendor_groups: unknown;
  } | null;
}

function toMember(row: MemberRow): LiveTrackGroupMember {
  const vendorGroups = Array.isArray(row.vehicle?.vendor_groups)
    ? (row.vehicle?.vendor_groups as unknown[]).filter((g): g is string => typeof g === "string")
    : [];
  return {
    mceasyVehicleId: row.vehicle?.mceasy_vehicle_id ?? 0,
    licensePlate: row.vehicle?.license_plate ?? "–",
    vendorGroups,
    useGroupSchedule: row.use_group_schedule,
    overrideWindowStart: row.override_window_start ? row.override_window_start.slice(0, 5) : null,
    overrideWindowEnd: row.override_window_end ? row.override_window_end.slice(0, 5) : null,
    enabled: row.enabled,
    sortOrder: row.sort_order,
  };
}

export async function GET() {
  const auth = await authorizeLiveTrackConfig(false);
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  let groupsQuery = admin
    .from("tms_live_track_groups")
    .select(
      "id, name, description, color, sort_order, status, default_window_start, " +
        "default_window_end, timezone, effective_from, effective_until, created_at, updated_at",
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (auth.context.allowedClientIds !== "all") {
    groupsQuery = groupsQuery.in("client_id", auth.context.allowedClientIds);
  }
  const { data: groups, error: groupsError } = await groupsQuery;
  if (groupsError) {
    return liveTrackConfigError("Gagal memuat kelompok Live Track.", 502);
  }

  const groupRows = (Array.isArray(groups) ? (groups as unknown as GroupRow[]) : []);
  const groupIds = groupRows.map((g) => g.id);

  let memberRows: MemberRow[] = [];
  if (groupIds.length > 0) {
    const { data: members, error: membersError } = await admin
      .from("tms_live_track_group_vehicles")
      .select(
        "group_id, use_group_schedule, override_window_start, override_window_end, " +
          "enabled, sort_order, vehicle:tms_live_track_vehicles(mceasy_vehicle_id, license_plate, vendor_groups)",
      )
      .in("group_id", groupIds)
      .order("sort_order", { ascending: true });
    if (membersError) {
      return liveTrackConfigError("Gagal memuat anggota kelompok.", 502);
    }
    memberRows = (Array.isArray(members) ? members : []) as unknown as MemberRow[];
  }

  const byGroup = new Map<string, LiveTrackGroupMember[]>();
  for (const row of memberRows) {
    const list = byGroup.get(row.group_id) ?? [];
    list.push(toMember(row));
    byGroup.set(row.group_id, list);
  }

  const data: LiveTrackGroup[] = groupRows.map((group) => {
    const members = byGroup.get(group.id) ?? [];
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      color: group.color,
      sortOrder: group.sort_order,
      status: group.status,
      defaultWindowStart: group.default_window_start.slice(0, 5),
      defaultWindowEnd: group.default_window_end.slice(0, 5),
      timezone: group.timezone,
      effectiveFrom: group.effective_from,
      effectiveUntil: group.effective_until,
      memberCount: members.length,
      activeMemberCount: members.filter((m) => m.enabled).length,
      members,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
    };
  });

  return liveTrackConfigJson({
    data,
    meta: { total: data.length, canManage: auth.context.canManage, fetchedAt: new Date().toISOString() },
  });
}

function toRpcMembers(members: LiveTrackGroupMember[]): Record<string, unknown>[] {
  return members.map((m) => ({
    mceasy_vehicle_id: m.mceasyVehicleId,
    license_plate: m.licensePlate,
    vendor_groups: m.vendorGroups,
    use_group_schedule: m.useGroupSchedule,
    override_window_start: m.overrideWindowStart,
    override_window_end: m.overrideWindowEnd,
    enabled: m.enabled,
  }));
}

export async function POST(request: Request) {
  const auth = await authorizeLiveTrackConfig(true);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return liveTrackConfigError("Body permintaan tidak valid.", 400);
  }
  const input = body as LiveTrackGroupInput;
  if (!input || typeof input !== "object" || !input.name?.trim() || !Array.isArray(input.members)) {
    return liveTrackConfigError("Nama kelompok dan daftar unit wajib diisi.", 400);
  }

  // Tentukan client sebelum menyimpan: single-scope otomatis, all-scope
  // lewat body (opsional), multi-scope wajib memilih salah satu miliknya.
  const requestedClientId =
    typeof (input as { clientId?: unknown }).clientId === "string"
      ? ((input as { clientId?: unknown }).clientId as string)
      : null;
  let clientToStamp: string | null = null;
  if (auth.context.allowedClientIds === "all") {
    clientToStamp = requestedClientId;
  } else if (auth.context.allowedClientIds.length === 1) {
    clientToStamp = auth.context.allowedClientIds[0] ?? null;
  } else if (requestedClientId && auth.context.allowedClientIds.includes(requestedClientId)) {
    clientToStamp = requestedClientId;
  } else {
    return liveTrackConfigError("Pilih client untuk kelompok baru.", 400);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("tms_live_track_config_save_group", {
    p_group: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      color: input.color,
      sort_order: input.sortOrder ?? 0,
      status: input.status ?? "Aktif",
      default_window_start: input.defaultWindowStart,
      default_window_end: input.defaultWindowEnd,
      timezone: "Asia/Jakarta",
      effective_from: input.effectiveFrom || null,
      effective_until: input.effectiveUntil || null,
    },
    p_members: toRpcMembers(input.members),
    p_actor_user: auth.context.userId,
  });

  if (error) {
    return liveTrackConfigError(error.message || "Gagal menyimpan kelompok.", 400);
  }

  const savedGroupId =
    data && typeof data === "object" && !Array.isArray(data)
      ? ((data as { group_id?: unknown }).group_id ?? null)
      : null;
  if (typeof savedGroupId === "string" && savedGroupId && clientToStamp) {
    const stampError = await stampGroupClient(admin, savedGroupId, clientToStamp, input.members);
    if (stampError) {
      return liveTrackConfigError(stampError, 502);
    }
  }
  return liveTrackConfigJson({ data }, 201);
}

/**
 * Cap client_id pada grup + unit anggotanya (hanya yang masih null agar
 * tidak menimpa mapping client lain) serta daftarkan mapping kanonik unit
 * agar snapshot dan e-POD ikut terpetakan pada sync berikutnya.
 */
async function stampGroupClient(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  clientId: string,
  members: LiveTrackGroupMember[],
): Promise<string | null> {
  const { error: groupError } = await admin
    .from("tms_live_track_groups")
    .update({ client_id: clientId, updated_at: new Date().toISOString() })
    .eq("id", groupId);
  if (groupError) return `Gagal menandai client kelompok: ${groupError.message}`;

  return stampGroupMembersClient(admin, groupId, clientId, members);
}
