import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeSlaConfig, slaConfigError, slaConfigJson } from "@/lib/tms-sla-auth";

export const dynamic = "force-dynamic";

async function loadStopInScope(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  stopId: string,
  allowedClientIds: "all" | string[],
) {
  const { data: profile, error: profileError } = await admin
    .from("tms_sla_route_profiles")
    .select("id, client_id")
    .eq("id", profileId)
    .maybeSingle();
  const profileRow = profile as { id: string; client_id: string } | null;
  if (profileError || !profileRow) return null;
  if (allowedClientIds !== "all" && !allowedClientIds.includes(profileRow.client_id)) return null;
  const { data: stop, error: stopError } = await admin
    .from("tms_sla_route_stops")
    .select("id, store_name")
    .eq("id", stopId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (stopError || !stop) return null;
  return stop as { id: string; store_name: string };
}

/** Petakan address_id McEasy ke titik SLA (kelola). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> },
) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;
  const { id, stopId } = await params;
  if (!id || !stopId) return slaConfigError("ID tidak valid.", 400);

  let body: { vendorAddressId?: unknown; storeNameSnapshot?: unknown; isPrimary?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return slaConfigError("Body permintaan tidak valid.", 400);
  }
  const vendorAddressId =
    typeof body.vendorAddressId === "string" ? body.vendorAddressId.trim() : "";
  if (!vendorAddressId) return slaConfigError("Address ID McEasy wajib diisi.", 400);

  const admin = createAdminClient();
  const stop = await loadStopInScope(admin, id, stopId, auth.context.allowedClientIds);
  if (!stop) return slaConfigError("Titik SLA tidak ditemukan atau di luar cakupan.", 404);

  const { data: existing } = await admin
    .from("tms_sla_route_stop_addresses")
    .select("id")
    .eq("route_stop_id", stopId);
  const isFirst = !Array.isArray(existing) || existing.length === 0;

  const { data: created, error: insertError } = await admin
    .from("tms_sla_route_stop_addresses")
    .upsert(
      {
        route_stop_id: stopId,
        vendor_address_id: vendorAddressId,
        store_name_snapshot:
          typeof body.storeNameSnapshot === "string" && body.storeNameSnapshot.trim()
            ? body.storeNameSnapshot.trim().slice(0, 200)
            : stop.store_name,
        is_primary: body.isPrimary === undefined ? isFirst : body.isPrimary === true,
      },
      { onConflict: "route_stop_id,vendor_address_id" },
    )
    .select("id")
    .single();
  if (insertError) return slaConfigError("Gagal memetakan address.", 502);
  const row = created as { id: string } | null;
  return slaConfigJson({ data: { id: row?.id ?? null } }, 201);
}
