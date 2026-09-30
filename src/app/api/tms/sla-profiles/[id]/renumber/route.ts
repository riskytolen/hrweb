import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeSlaConfig, slaConfigError, slaConfigJson } from "@/lib/tms-sla-auth";
import { renumberProfileStops } from "@/lib/tms-sla-stop-order";

export const dynamic = "force-dynamic";

/**
 * Rapatkan route_order titik profil menjadi 1..N (kelola).
 * Untuk profil yang nomornya sudah loncat akibat hapus titik manual
 * sebelum penomoran otomatis ada.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) return slaConfigError("ID profil tidak valid.", 400);

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("tms_sla_route_profiles")
    .select("id, client_id")
    .eq("id", id)
    .maybeSingle();
  const profileRow = profile as { id: string; client_id: string } | null;
  if (profileError || !profileRow) return slaConfigError("Profil SLA tidak ditemukan.", 404);
  if (auth.context.allowedClientIds !== "all" && !auth.context.allowedClientIds.includes(profileRow.client_id)) {
    return slaConfigError("Profil di luar cakupan akses Anda.", 403);
  }

  try {
    const renumbered = await renumberProfileStops(admin, id);
    return slaConfigJson({ data: { id, stops: renumbered.stops, changed: renumbered.changed } });
  } catch (err) {
    return slaConfigError(err instanceof Error ? err.message : "Gagal merapikan nomor titik.", 502);
  }
}
