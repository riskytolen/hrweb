/**
 * Penangkapan suhu titik rute Fleet Task Instant (pure, client-safe).
 *
 * API McEasy tidak menyediakan suhu historis per titik. Modul ini hanya
 * berisi helper pencocokan geofence, normalisasi snapshot, dan format
 * tampilan. Pengambilan upstream dan penyimpanan database dilakukan
 * server-side agar browser tidak pernah menerima secret.
 */

import { formatVehicleTemperatures } from "./tms-status";
import type { FleetTaskTimelinePoint } from "./fleet-task-track";

/** Radius default saat unit dianggap berada pada titik rute. */
export const TMS_POINT_CAPTURE_RADIUS_METERS = 150;

/** Batas task STARTED yang diproses dalam satu eksekusi capture. */
export const TMS_POINT_CAPTURE_MAX_STARTED_TASKS = 100;

/** Umur maksimum data GPS/suhu kendaraan agar snapshot dianggap valid. */
export const TMS_POINT_CAPTURE_VEHICLE_FRESHNESS_MS = 2 * 60 * 1000;

/** Retensi default snapshot suhu titik dalam bulan. */
export const TMS_POINT_TEMPERATURE_RETENTION_MONTHS = 12;

export interface TmsRoutePointTemperature {
  taskId: string;
  routeSequence: number;
  pointName: string | null;
  temperatures: (number | null)[];
  measuredAt: string;
  arrivalActual: string | null;
  distanceMeters: number;
  capturedAt: string;
}

export interface CapturableRoutePoint {
  sequence: number;
  name: string | null;
  latitude: number;
  longitude: number;
  arrivalActual: string | null;
  distanceMeters: number;
}

/**
 * Urutan stabil untuk titik rute. Upstream kadang tidak mengirim sequence,
 * sehingga fallback ke posisi array dipakai konsisten oleh capture dan UI.
 */
export function resolveRoutePointSequence(
  point: Pick<FleetTaskTimelinePoint, "sequence">,
  index: number,
): number {
  return point.sequence ?? index + 1;
}

export function hasValidPointTemperature(value: unknown): value is (number | null)[] {
  return (
    Array.isArray(value) &&
    value.some((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function toTemperatureArray(value: unknown): (number | null)[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) =>
    typeof item === "number" && Number.isFinite(item) ? item : null,
  );
}

function toNonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toIsoString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || Number.isNaN(Date.parse(trimmed))) return null;
  return trimmed;
}

export function normalizeCapturedSequence(row: unknown): { taskId: string; routeSequence: number } | null {
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const taskId = toNonEmptyString(source.task_id ?? source.taskId, 100);
  const routeSequence = toFiniteNumber(source.route_sequence ?? source.routeSequence);
  if (!taskId || routeSequence === null || !Number.isInteger(routeSequence)) return null;
  return { taskId, routeSequence };
}

export function normalizePointTemperature(row: unknown): TmsRoutePointTemperature | null {
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const taskId = toNonEmptyString(source.task_id ?? source.taskId, 100);
  const routeSequence = toFiniteNumber(source.route_sequence ?? source.routeSequence);
  const measuredAt = toIsoString(source.measured_at ?? source.measuredAt);
  const capturedAt = toIsoString(source.captured_at ?? source.capturedAt);
  const temperatures = toTemperatureArray(source.temperatures);
  const distanceMeters = toFiniteNumber(source.distance_meters ?? source.distanceMeters);

  if (!taskId || routeSequence === null || !Number.isInteger(routeSequence)) return null;
  if (!measuredAt || !capturedAt || distanceMeters === null || distanceMeters < 0) return null;
  if (!hasValidPointTemperature(temperatures)) return null;

  return {
    taskId,
    routeSequence,
    pointName: toNonEmptyString(source.point_name ?? source.pointName, 200),
    temperatures,
    measuredAt,
    arrivalActual: toIsoString(source.arrival_actual ?? source.arrivalActual),
    distanceMeters,
    capturedAt,
  };
}

export function normalizePointTemperatureList(value: unknown): TmsRoutePointTemperature[] {
  if (!Array.isArray(value)) return [];
  const result: TmsRoutePointTemperature[] = [];
  for (const row of value) {
    const normalized = normalizePointTemperature(row);
    if (normalized) result.push(normalized);
  }
  return result;
}

export function indexPointTemperaturesBySequence(
  snapshots: TmsRoutePointTemperature[],
): Map<number, TmsRoutePointTemperature> {
  const indexed = new Map<number, TmsRoutePointTemperature>();
  for (const snapshot of snapshots) {
    if (!indexed.has(snapshot.routeSequence)) {
      indexed.set(snapshot.routeSequence, snapshot);
    }
  }
  return indexed;
}

export function formatCapturedPointTemperature(
  snapshot: TmsRoutePointTemperature | undefined,
): string | null {
  if (!snapshot) return null;
  return formatVehicleTemperatures(snapshot.temperatures);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const startLatitude = toRadians(from.latitude);
  const endLatitude = toRadians(to.latitude);
  const chord =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(chord));
}

interface CapturableRoutePointOptions {
  radiusMeters?: number;
  excludeSequences?: ReadonlySet<number>;
}

/**
 * Pilih titik rute terdekat yang berada dalam radius dari posisi kendaraan.
 * Sequence yang sudah memiliki snapshot dapat dikecualikan agar capture
 * event-only tidak menulis ulang titik yang sama setiap menit.
 */
export function selectCapturableRoutePoint(
  points: FleetTaskTimelinePoint[],
  vehicle: { latitude: number | null; longitude: number | null },
  options: CapturableRoutePointOptions = {},
): CapturableRoutePoint | null {
  if (vehicle.latitude === null || vehicle.longitude === null) return null;
  const radiusMeters = options.radiusMeters ?? TMS_POINT_CAPTURE_RADIUS_METERS;
  let best: CapturableRoutePoint | null = null;

  points.forEach((point, index) => {
    const sequence = resolveRoutePointSequence(point, index);
    if (options.excludeSequences?.has(sequence)) return;
    if (point.latitude === null || point.longitude === null) return;
    const distanceMeters = haversineDistanceMeters(
      { latitude: vehicle.latitude as number, longitude: vehicle.longitude as number },
      { latitude: point.latitude, longitude: point.longitude },
    );
    if (distanceMeters > radiusMeters) return;
    if (!best || distanceMeters < best.distanceMeters) {
      best = {
        sequence,
        name: point.name,
        latitude: point.latitude,
        longitude: point.longitude,
        arrivalActual: point.arrivalActual ?? point.departureActual,
        distanceMeters,
      };
    }
  });

  return best;
}
