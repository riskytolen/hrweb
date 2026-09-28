/**
 * Logger Trips: normalisasi kunjungan toko dari timeline Fleet Task Instant.
 *
 * Modul ini pure dan client-safe. Fokus utamanya adalah waktu masuk dan
 * waktu keluar toko yang berasal dari `timeline_route[].arrival_time.actual`
 * dan `timeline_route[].departure_time.actual` milik McEasy. Semua titik
 * rute ikut dicatat, termasuk titik loading/gudang.
 */

import {
  normalizeFleetTaskInstantItem,
  type FleetTaskInstantItem,
  type FleetTaskTimelinePoint,
} from "./fleet-task-track";
import { resolveRoutePointSequence } from "./tms-point-temperature";

/** Status kunjungan berdasarkan kelengkapan waktu masuk/keluar. */
export type TmsTripVisitState = "ONGOING" | "COMPLETED" | "INCOMPLETE" | "PENDING";

export interface TmsTripVisit {
  id: string;
  taskId: string;
  taskNumber: string | null;
  taskStatus: string | null;
  vehicleId: number | null;
  unit: string | null;
  driverName: string | null;
  routeSequence: number;
  pointId: string | null;
  addressId: string | null;
  pointType: string | null;
  locationName: string | null;
  locationAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  visitStatusName: string | null;
  arrivalActual: string | null;
  departureActual: string | null;
  /** Durasi dalam detik; null bila belum dapat dihitung. */
  durationSeconds: number | null;
  visitState: TmsTripVisitState;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Tentukan status kunjungan:
 * - ONGOING: sudah masuk, belum keluar.
 * - COMPLETED: masuk dan keluar lengkap dan berurutan.
 * - INCOMPLETE: hanya keluar, atau urutan waktu tidak valid.
 * - PENDING: keduanya belum tersedia.
 */
export function resolveTripVisitState(
  arrivalActual: string | null,
  departureActual: string | null,
): TmsTripVisitState {
  const arrivalMs = parseTimestamp(arrivalActual);
  const departureMs = parseTimestamp(departureActual);
  if (arrivalMs === null && departureMs === null) return "PENDING";
  if (arrivalMs !== null && departureMs === null) return "ONGOING";
  if (arrivalMs !== null && departureMs !== null) {
    return departureMs >= arrivalMs ? "COMPLETED" : "INCOMPLETE";
  }
  return "INCOMPLETE";
}

/** Hitung durasi detik; null untuk data tidak lengkap atau tidak valid. */
export function computeTripVisitDurationSeconds(
  arrivalActual: string | null,
  departureActual: string | null,
): number | null {
  const arrivalMs = parseTimestamp(arrivalActual);
  const departureMs = parseTimestamp(departureActual);
  if (arrivalMs === null || departureMs === null) return null;
  const diff = Math.round((departureMs - arrivalMs) / 1000);
  return diff >= 0 ? diff : null;
}

/** Ubah satu timeline point menjadi baris kunjungan siap simpan. */
export function toTripVisit(
  task: FleetTaskInstantItem,
  point: FleetTaskTimelinePoint,
  index: number,
): TmsTripVisit | null {
  const routeSequence = resolveRoutePointSequence(point, index);
  if (!Number.isInteger(routeSequence) || routeSequence < 1) return null;
  const visitState = resolveTripVisitState(point.arrivalActual, point.departureActual);
  return {
    id: `${task.id}:${routeSequence}`,
    taskId: task.id,
    taskNumber: task.number,
    taskStatus: task.statusRaw,
    vehicleId: task.vehicleId,
    unit: task.licensePlate,
    driverName: task.driverName,
    routeSequence,
    pointId: point.pointId,
    addressId: point.addressId,
    pointType: point.pointType,
    locationName: point.name,
    locationAddress: point.address,
    latitude: point.latitude,
    longitude: point.longitude,
    visitStatusName: point.visitStatusName,
    arrivalActual: point.arrivalActual,
    departureActual: point.departureActual,
    durationSeconds: computeTripVisitDurationSeconds(point.arrivalActual, point.departureActual),
    visitState,
  };
}

/**
 * Flatten seluruh timeline satu task menjadi baris kunjungan.
 * Titik tanpa nama maupun koordinat tetap dicatat selama sequence valid,
 * karena waktu masuk/keluar tetap bermakna untuk audit.
 */
export function normalizeTaskTripVisits(task: FleetTaskInstantItem): TmsTripVisit[] {
  const visits: TmsTripVisit[] = [];
  task.timeline.forEach((point, index) => {
    const visit = toTripVisit(task, point, index);
    if (visit) visits.push(visit);
  });
  return visits;
}

/** Normalisasi satu row task mentah upstream menjadi baris kunjungan. */
export function normalizeRawTaskTripVisits(raw: unknown): TmsTripVisit[] {
  const task = normalizeFleetTaskInstantItem(raw);
  if (!task) return [];
  return normalizeTaskTripVisits(task);
}

/** Label Indonesia untuk status kunjungan. */
export function tripVisitStateLabel(state: TmsTripVisitState): string {
  switch (state) {
    case "ONGOING":
      return "Sedang di lokasi";
    case "COMPLETED":
      return "Selesai";
    case "INCOMPLETE":
      return "Waktu tidak lengkap";
    case "PENDING":
      return "Belum dikunjungi";
  }
}

/** Format durasi detik menjadi label Indonesia. */
export function formatTripVisitDuration(totalSeconds: number | null, nowMs = Date.now()): string {
  if (totalSeconds === null) return "–";
  const clamped = Math.max(0, Math.trunc(totalSeconds));
  void nowMs;
  if (clamped < 60) return `${clamped} dtk`;
  const minutes = Math.floor(clamped / 60);
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} mnt`;
}

/** Hitung durasi berjalan untuk kunjungan yang masih berlangsung. */
export function ongoingTripVisitDurationSeconds(arrivalActual: string | null, nowMs = Date.now()): number | null {
  const arrivalMs = parseTimestamp(arrivalActual);
  if (arrivalMs === null || nowMs < arrivalMs) return null;
  return Math.floor((nowMs - arrivalMs) / 1000);
}
