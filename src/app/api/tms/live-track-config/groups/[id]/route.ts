import { createAdminClient } from "@/lib/supabase-admin";
import {
  authorizeLiveTrackConfig,
  liveTrackConfigError,
  liveTrackConfigJson,
} from "@/lib/tms-live-track-auth";
import type { LiveTrackGroupInput } from "@/lib/tms-live-track-config";

export const dynamic = "force-dynamic";

function toRpcMembers(members: LiveTrackGroupInput["members"]): Record<string, unknown>[] {
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

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeLiveTrackConfig(true);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) return liveTrackConfigError("ID kelompok tidak valid.", 400);

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

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("tms_live_track_config_save_group", {
    p_group: {
      id,
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
  return liveTrackConfigJson({ data });
}
