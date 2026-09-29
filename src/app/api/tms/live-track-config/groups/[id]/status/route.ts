import { createAdminClient } from "@/lib/supabase-admin";
import {
  authorizeLiveTrackConfig,
  liveTrackConfigError,
  liveTrackConfigJson,
} from "@/lib/tms-live-track-auth";

export const dynamic = "force-dynamic";

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
  const status = (body as { status?: unknown })?.status;
  if (status !== "Aktif" && status !== "Tidak Aktif") {
    return liveTrackConfigError("Status kelompok tidak valid.", 400);
  }

  const admin = createAdminClient();
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
  const { data, error } = await admin.rpc("tms_live_track_config_set_group_status", {
    p_group_id: id,
    p_status: status,
    p_actor_user: auth.context.userId,
  });

  if (error) {
    return liveTrackConfigError(error.message || "Gagal mengubah status kelompok.", 400);
  }
  return liveTrackConfigJson({ data });
}
