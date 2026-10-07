import "server-only";

import { createAdminClient } from "./supabase-admin";
import { normalizeTenantPlateKey } from "./tms-tenant-auth";
import type { LiveTrackGroupMember } from "./tms-live-track-config";

type Admin = ReturnType<typeof createAdminClient>;

/** Sumber mapping kanonik yang dibuat otomatis saat menyimpan kelompok Live Track. */
export const GROUP_SAVE_ASSIGNMENT_SOURCE = "live_track_group_save";

/**
 * Cap client_id pada unit anggota + membership grup (hanya yang masih null agar
 * tidak menimpa mapping client lain) dan daftarkan mapping kanonik
 * `tms_client_vehicle_assignments` untuk anggota aktif yang belum terdaftar.
 *
 * Idempotent dan aman dipanggil setiap kali kelompok disimpan (buat maupun ubah).
 */
export async function stampGroupMembersClient(
  admin: Admin,
  groupId: string,
  clientId: string,
  members: LiveTrackGroupMember[],
): Promise<string | null> {
  const mceasyIds = [
    ...new Set(
      members
        .map((m) => m.mceasyVehicleId)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0),
    ),
  ];
  if (mceasyIds.length > 0) {
    const { error: vehicleError } = await admin
      .from("tms_live_track_vehicles")
      .update({ client_id: clientId, updated_at: new Date().toISOString() })
      .is("client_id", null)
      .in("mceasy_vehicle_id", mceasyIds);
    if (vehicleError) return `Gagal menandai client unit: ${vehicleError.message}`;

    const { error: memberError } = await admin
      .from("tms_live_track_group_vehicles")
      .update({ client_id: clientId })
      .eq("group_id", groupId)
      .is("client_id", null);
    if (memberError) return `Gagal menandai client anggota: ${memberError.message}`;
  }

  // Hanya anggota aktif yang didaftarkan ke mapping kanonik.
  const seen = new Set<number>();
  const enabled = members.filter((m) => {
    if (!m.enabled) return false;
    if (typeof m.mceasyVehicleId !== "number" || !Number.isFinite(m.mceasyVehicleId) || m.mceasyVehicleId <= 0) {
      return false;
    }
    if (!normalizeTenantPlateKey(m.licensePlate)) return false;
    if (seen.has(m.mceasyVehicleId)) return false;
    seen.add(m.mceasyVehicleId);
    return true;
  });
  if (enabled.length === 0) return null;

  const plateKeys = [...new Set(enabled.map((m) => normalizeTenantPlateKey(m.licensePlate)))];
  const takenIds = new Set<number>();
  const takenKeys = new Set<string>();
  try {
    const [{ data: byIds }, { data: byKeys }] = await Promise.all([
      admin
        .from("tms_client_vehicle_assignments")
        .select("mceasy_vehicle_id,license_plate_key")
        .eq("status", "active")
        .in("mceasy_vehicle_id", enabled.map((m) => m.mceasyVehicleId)),
      admin
        .from("tms_client_vehicle_assignments")
        .select("mceasy_vehicle_id,license_plate_key")
        .eq("status", "active")
        .in("license_plate_key", plateKeys),
    ]);
    for (
      const row of [
        ...((Array.isArray(byIds) ? byIds : []) as { mceasy_vehicle_id: number; license_plate_key: string }[]),
        ...((Array.isArray(byKeys) ? byKeys : []) as { mceasy_vehicle_id: number; license_plate_key: string }[]),
      ]
    ) {
      if (typeof row.mceasy_vehicle_id === "number") takenIds.add(row.mceasy_vehicle_id);
      const key = normalizeTenantPlateKey(row.license_plate_key);
      if (key) takenKeys.add(key);
    }
  } catch {
    return "Gagal memeriksa mapping unit client.";
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = enabled
    .filter((m) => !takenIds.has(m.mceasyVehicleId) && !takenKeys.has(normalizeTenantPlateKey(m.licensePlate)))
    .map((m) => ({
      client_id: clientId,
      mceasy_vehicle_id: m.mceasyVehicleId,
      license_plate: m.licensePlate,
      license_plate_key: normalizeTenantPlateKey(m.licensePlate),
      effective_from: today,
      effective_until: null,
      status: "active",
      source: GROUP_SAVE_ASSIGNMENT_SOURCE,
    }));
  if (rows.length === 0) return null;

  const { error: insertError } = await admin.from("tms_client_vehicle_assignments").insert(rows);
  if (insertError) return `Gagal mendaftarkan mapping unit client: ${insertError.message}`;
  return null;
}
