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
  // Kelompok milik client lain tidak boleh diubah.
  if (auth.context.allowedClientIds !== "all") {
    const { data: existing } = await admin
      .from("tms_live_track_groups")
      .select("client_id")
      .eq("id", id)
      .maybeSingle();
    const existingClientId =
      (existing as { client_id?: string | null } | null)?.client_id ?? null;
    if (!existingClientId || !auth.context.allowedClientIds.includes(existingClientId)) {
      return liveTrackConfigError("Kelompok tidak ditemukan.", 404);
    }
  }
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
  // Cap client bila kelompok belum punya (grup lama pra-tenant).
  const { data: saved } = await admin
    .from("tms_live_track_groups")
    .select("client_id")
    .eq("id", id)
    .maybeSingle();
  if ((saved as { client_id?: string | null } | null)?.client_id == null) {
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
    }
    if (clientToStamp) {
      await admin
        .from("tms_live_track_groups")
        .update({ client_id: clientToStamp, updated_at: new Date().toISOString() })
        .eq("id", id);
    }
  }
  return liveTrackConfigJson({ data });
}
