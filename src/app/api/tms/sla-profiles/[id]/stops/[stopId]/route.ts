import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeSlaConfig, slaConfigError, slaConfigJson } from "@/lib/tms-sla-auth";
import { normalizeSlaStoreKey } from "@/lib/tms-sla";
import { renumberProfileStops } from "@/lib/tms-sla-stop-order";

export const dynamic = "force-dynamic";

function normalizeTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = match[3] ? Number(match[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

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
    .select("id, profile_id, route_order, store_name")
    .eq("id", stopId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (stopError || !stop) return null;
  return stop as { id: string; profile_id: string; route_order: number; store_name: string };
}

/** Ubah titik SLA (kelola). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> },
) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;
  const { id, stopId } = await params;
  if (!id || !stopId) return slaConfigError("ID tidak valid.", 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return slaConfigError("Body permintaan tidak valid.", 400);
  }

  const admin = createAdminClient();
  const stop = await loadStopInScope(admin, id, stopId, auth.context.allowedClientIds);
  if (!stop) return slaConfigError("Titik SLA tidak ditemukan atau di luar cakupan.", 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.storeName !== undefined) {
    const storeName = typeof body.storeName === "string" ? body.storeName.trim().slice(0, 200) : "";
    if (!storeName) return slaConfigError("Nama toko tidak boleh kosong.", 400);
    patch.store_name = storeName;
    patch.store_name_key = normalizeSlaStoreKey(storeName);
  }
  if (body.targetTime !== undefined) {
    const targetTime = normalizeTime(body.targetTime);
    if (!targetTime) return slaConfigError("Jam SLA tidak valid. Gunakan HH:MM.", 400);
    patch.target_time = targetTime;
  }
  if (body.targetDayOffset !== undefined) {
    if (typeof body.targetDayOffset !== "number" || !Number.isInteger(body.targetDayOffset) || body.targetDayOffset < 0) {
      return slaConfigError("Hari ke tidak valid.", 400);
    }
    patch.target_day_offset = body.targetDayOffset;
  }
  if (body.routeOrder !== undefined) {
    if (typeof body.routeOrder !== "number" || !Number.isInteger(body.routeOrder) || body.routeOrder < 1) {
      return slaConfigError("Urutan tidak valid.", 400);
    }
    if (body.routeOrder !== stop.route_order) {
      const { data: clash } = await admin
        .from("tms_sla_route_stops")
        .select("id")
        .eq("profile_id", id)
        .eq("route_order", body.routeOrder)
        .maybeSingle();
      if (clash) return slaConfigError(`Urutan ${body.routeOrder} sudah dipakai pada profil ini.`, 409);
    }
    patch.route_order = body.routeOrder;
  }

  const { error: updateError } = await admin.from("tms_sla_route_stops").update(patch).eq("id", stopId);
  if (updateError) {
    const conflict = /duplicate|unique/i.test(updateError.message);
    return slaConfigError(
      conflict ? "Urutan atau nama toko bentrok pada profil ini." : "Gagal memperbarui titik SLA.",
      conflict ? 409 : 502,
    );
  }
  return slaConfigJson({ data: { id: stopId } });
}

/** Hapus titik SLA beserta mapping-nya (kelola). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> },
) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;
  const { id, stopId } = await params;
  if (!id || !stopId) return slaConfigError("ID tidak valid.", 400);

  const admin = createAdminClient();
  const stop = await loadStopInScope(admin, id, stopId, auth.context.allowedClientIds);
  if (!stop) return slaConfigError("Titik SLA tidak ditemukan atau di luar cakupan.", 404);

  const { error: deleteError } = await admin.from("tms_sla_route_stops").delete().eq("id", stopId);
  if (deleteError) return slaConfigError("Gagal menghapus titik SLA.", 502);
  // Rapatkan nomor sisa titik agar tidak loncat (1,3,4,5 -> 1,2,3,4).
  try {
    const renumbered = await renumberProfileStops(admin, id);
    return slaConfigJson({ data: { id: stopId }, meta: { renumbered: renumbered.changed } });
  } catch {
    return slaConfigJson(
      { data: { id: stopId }, meta: { renumbered: false } },
      200,
    );
  }
}
