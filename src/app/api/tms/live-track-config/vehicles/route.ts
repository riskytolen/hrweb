import { createAdminClient } from "@/lib/supabase-admin";
import { fetchMcEasyVehicleStatuses, McEasyError } from "@/lib/mceasy-server";
import {
  authorizeLiveTrackConfig,
  liveTrackConfigJson,
} from "@/lib/tms-live-track-auth";
import type { LiveTrackVehicleOption } from "@/lib/tms-live-track-config";

export const dynamic = "force-dynamic";

interface CatalogRow {
  id: string;
  mceasy_vehicle_id: number;
  license_plate: string;
  vendor_groups: unknown;
  last_seen_at: string | null;
  last_synced_at: string;
  status: string;
}

interface MembershipRow {
  vehicle_id: string;
  group: { id: string; name: string } | null;
}

/**
 * Daftar unit untuk selector konfigurasi: gabungan respons live McEasy
 * (sumber utama) dan katalog lokal (agar pilihan lama tetap terlihat saat
 * vendor gagal atau unit sementara hilang dari respons).
 */
export async function GET() {
  const auth = await authorizeLiveTrackConfig(false);
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();
  const { data: catalog } = await admin
    .from("tms_live_track_vehicles")
    .select("id, mceasy_vehicle_id, license_plate, vendor_groups, last_seen_at, last_synced_at, status");
  const catalogRows = (Array.isArray(catalog) ? catalog : []) as unknown as CatalogRow[];

  const { data: memberships } = await admin
    .from("tms_live_track_group_vehicles")
    .select("vehicle_id, group:tms_live_track_groups(id, name)");
  const memberOf = new Map<string, { groupId: string; groupName: string }[]>();
  for (const row of (Array.isArray(memberships) ? memberships : []) as unknown as MembershipRow[]) {
    if (!row.group) continue;
    const list = memberOf.get(row.vehicle_id) ?? [];
    list.push({ groupId: row.group.id, groupName: row.group.name });
    memberOf.set(row.vehicle_id, list);
  }

  let live: Awaited<ReturnType<typeof fetchMcEasyVehicleStatuses>> = [];
  let liveError: string | null = null;
  try {
    live = await fetchMcEasyVehicleStatuses({ withAddress: false });
  } catch (error) {
    liveError = error instanceof McEasyError ? error.message : "Gagal memuat data unit McEasy.";
  }

  const catalogByMceasy = new Map<number, CatalogRow>();
  for (const row of catalogRows) catalogByMceasy.set(row.mceasy_vehicle_id, row);

  const options: LiveTrackVehicleOption[] = [];
  const seen = new Set<number>();

  for (const vehicle of live) {
    seen.add(vehicle.vehicleId);
    const catalogRow = catalogByMceasy.get(vehicle.vehicleId);
    options.push({
      mceasyVehicleId: vehicle.vehicleId,
      licensePlate: vehicle.licensePlate,
      status: vehicle.status,
      lastSeenAt: vehicle.lastReceive ?? vehicle.lastPacket,
      vendorGroups: vehicle.vehicleGroups,
      catalogStale: false,
      memberOf: catalogRow ? (memberOf.get(catalogRow.id) ?? []) : [],
    });
  }

  // Unit katalog yang tidak ada di respons live tetap ditampilkan (stale).
  for (const row of catalogRows) {
    if (seen.has(row.mceasy_vehicle_id)) continue;
    const vendorGroups = Array.isArray(row.vendor_groups)
      ? (row.vendor_groups as unknown[]).filter((g): g is string => typeof g === "string")
      : [];
    options.push({
      mceasyVehicleId: row.mceasy_vehicle_id,
      licensePlate: row.license_plate,
      status: row.status === "active" ? "stale" : row.status,
      lastSeenAt: row.last_seen_at,
      vendorGroups,
      catalogStale: true,
      memberOf: memberOf.get(row.id) ?? [],
    });
  }

  options.sort((a, b) => a.licensePlate.localeCompare(b.licensePlate, "id"));

  return liveTrackConfigJson({
    data: options,
    meta: {
      total: options.length,
      liveError,
      canManage: auth.context.canManage,
      fetchedAt: new Date().toISOString(),
    },
  });
}
