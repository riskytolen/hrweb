import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeSlaConfig, slaConfigError, slaConfigJson } from "@/lib/tms-sla-auth";

export const dynamic = "force-dynamic";

/** Lepas mapping address dari titik SLA (kelola). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; addressId: string }> },
) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;
  const { id, addressId } = await params;
  if (!id || !addressId) return slaConfigError("ID tidak valid.", 400);

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("tms_sla_route_profiles")
    .select("id, client_id")
    .eq("id", id)
    .maybeSingle();
  const profileRow = profile as { id: string; client_id: string } | null;
  if (profileError || !profileRow) {
    return slaConfigError("Profil SLA tidak ditemukan.", 404);
  }
  if (
    auth.context.allowedClientIds !== "all" &&
    !auth.context.allowedClientIds.includes(profileRow.client_id)
  ) {
    return slaConfigError("Profil di luar cakupan akses Anda.", 403);
  }

  const { data: mapping, error: mappingError } = await admin
    .from("tms_sla_route_stop_addresses")
    .select("id, route_stop_id")
    .eq("id", addressId)
    .maybeSingle();
  const mappingRow = mapping as { id: string; route_stop_id: string } | null;
  if (mappingError || !mappingRow) {
    return slaConfigError("Mapping address tidak ditemukan.", 404);
  }
  const { data: stop, error: stopError } = await admin
    .from("tms_sla_route_stops")
    .select("id, profile_id")
    .eq("id", mappingRow.route_stop_id)
    .maybeSingle();
  const stopRow = stop as { id: string; profile_id: string } | null;
  if (stopError || !stopRow || stopRow.profile_id !== id) {
    return slaConfigError("Mapping address tidak ditemukan pada profil ini.", 404);
  }

  const { error: deleteError } = await admin
    .from("tms_sla_route_stop_addresses")
    .delete()
    .eq("id", addressId);
  if (deleteError) return slaConfigError("Gagal melepas mapping address.", 502);
  return slaConfigJson({ data: { id: addressId } });
}
