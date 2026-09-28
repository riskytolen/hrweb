/**
 * Tipe data Pengaturan Live Track (client-safe).
 *
 * Kelompok operasional customer (mis. CP Suka) berisi unit McEasy dengan
 * jadwal tampil harian yang diwarisi dari kelompok atau dioverride per unit.
 */

export interface LiveTrackVehicleOption {
  mceasyVehicleId: number;
  licensePlate: string;
  status: string | null;
  lastSeenAt: string | null;
  vendorGroups: string[];
  catalogStale: boolean;
  memberOf: { groupId: string; groupName: string }[];
}

export interface LiveTrackGroupMember {
  mceasyVehicleId: number;
  licensePlate: string;
  vendorGroups: string[];
  useGroupSchedule: boolean;
  overrideWindowStart: string | null;
  overrideWindowEnd: string | null;
  enabled: boolean;
  sortOrder: number;
}

export interface LiveTrackGroup {
  id: string;
  name: string;
  description: string | null;
  color: string;
  sortOrder: number;
  status: string;
  defaultWindowStart: string;
  defaultWindowEnd: string;
  timezone: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  memberCount: number;
  activeMemberCount: number;
  members: LiveTrackGroupMember[];
  createdAt: string;
  updatedAt: string;
}

export interface LiveTrackGroupInput {
  id?: string;
  name: string;
  description?: string;
  color: string;
  sortOrder?: number;
  status?: string;
  defaultWindowStart: string;
  defaultWindowEnd: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  members: LiveTrackGroupMember[];
}

/** Ringkas jam operasional untuk label UI ("06.00–18.00"). */
export function summarizeLiveTrackWindow(start: string, end: string): string {
  const short = (value: string): string => value.slice(0, 5).replace(":", ".");
  return `${short(start)}–${short(end)}`;
}
