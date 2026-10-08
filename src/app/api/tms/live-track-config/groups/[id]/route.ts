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
  const { data: existing } = await admin
    .from("tms_live_track_groups")
    .select("client_id")
    .eq("id", id)
    .maybeSingle();
  const existingClientId =
    (existing as { client_id?: string | null } | null)?.client_id ?? null;
  // Kelompok milik client lain tidak boleh diubah.
  if (auth.context.allowedClientIds !== "all") {
    if (!existingClientId || !auth.context.allowedClientIds.includes(existingClientId)) {
      return liveTrackConfigError("Kelompok tidak ditemukan.", 404);
    }
  }
  // Client pemilik ikut ke RPC; kepemilikan grup yang sudah ada tidak
  // dipindahkan diam-diam (pindah unit antar client lewat dua kali simpan).
  const requestedClientId =
    typeof (input as { clientId?: unknown }).clientId === "string"
      ? ((input as { clientId?: unknown }).clientId as string)
      : null;
  let resolvedClientId: string | null = existingClientId;
  if (resolvedClientId == null) {
    if (auth.context.allowedClientIds === "all") {
      resolvedClientId = requestedClientId;
    } else if (auth.context.allowedClientIds.length === 1) {
      resolvedClientId = auth.context.allowedClientIds[0] ?? null;
    } else if (requestedClientId && auth.context.allowedClientIds.includes(requestedClientId)) {
      resolvedClientId = requestedClientId;
    }
  }
  // Rekonsiliasi mapping unit + data aktif berjalan di dalam RPC
  // (satu transaksi dengan penyimpanan kelompok).
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
    p_client_id: resolvedClientId,
  });

  if (error) {
    return liveTrackConfigError(error.message || "Gagal menyimpan kelompok.", 400);
  }
  return liveTrackConfigJson({ data });
}
