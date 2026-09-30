import type { createAdminClient } from "./supabase-admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Offset sementara saat pergeseran nomor agar tidak menabrak unique
// (profile_id, route_order) di tengah jalan.
const RENUMBER_PARK_OFFSET = 1_000_000;

export interface RenumberedStop {
  id: string;
  routeOrder: number;
}

/**
 * Rapatkan route_order sisa titik profil menjadi 1..N sesuai urutan lama.
 * Hanya baris yang loncat yang ditulis ulang (dua fase: parkir jauh dulu,
 * lalu set ke nomor final) sehingga constraint unik tidak dilanggar.
 */
export async function renumberProfileStops(
  admin: AdminClient,
  profileId: string,
): Promise<{ stops: RenumberedStop[]; changed: boolean }> {
  const { data, error } = await admin
    .from("tms_sla_route_stops")
    .select("id, route_order")
    .eq("profile_id", profileId)
    .order("route_order", { ascending: true });
  if (error) throw new Error(`Gagal memuat titik SLA: ${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as unknown as {
    id: string;
    route_order: number;
  }[];
  const targets: RenumberedStop[] = rows.map((row, index) => ({
    id: row.id,
    routeOrder: index + 1,
  }));
  const dirty = targets.filter((target, index) => rows[index]?.route_order !== target.routeOrder);
  if (dirty.length === 0) return { stops: targets, changed: false };

  const stamp = new Date().toISOString();
  for (let i = 0; i < dirty.length; i += 1) {
    const { error: parkError } = await admin
      .from("tms_sla_route_stops")
      .update({ route_order: RENUMBER_PARK_OFFSET + i, updated_at: stamp })
      .eq("id", dirty[i].id);
    if (parkError) throw new Error(`Gagal merapikan nomor titik: ${parkError.message}`);
  }
  for (const target of dirty) {
    const { error: setError } = await admin
      .from("tms_sla_route_stops")
      .update({ route_order: target.routeOrder, updated_at: stamp })
      .eq("id", target.id);
    if (setError) throw new Error(`Gagal merapikan nomor titik: ${setError.message}`);
  }
  return { stops: targets, changed: true };
}
