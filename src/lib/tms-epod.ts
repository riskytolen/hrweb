/**
 * Helper e-POD bersama (client-safe).
 *
 * Berisi konstanta, tipe, normalizer baris database, dan aturan validasi
 * yang dipakai bersama oleh UI web, Route Handler, dan worker sinkronisasi.
 * Tidak ada import server di sini agar aman dipakai komponen client.
 */

import { resolveRoutePointSequence } from "./tms-point-temperature";
import type { FleetTaskTimelinePoint } from "./fleet-task-track";

export const TMS_EPOD_BUCKET = "tms-epod-evidence";
export const TMS_EPOD_MIN_PHOTOS = 1;
export const TMS_EPOD_MAX_PHOTOS = 5;
export const TMS_EPOD_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const TMS_EPOD_COMPRESS_KB = 1024;
export const TMS_EPOD_GEOFENCE_METERS = 500;
/** Retensi bukti e-POD dalam bulan. */
export const TMS_EPOD_RETENTION_MONTHS = 3;
export const TMS_EPOD_ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;

export type EpodStopType = "LOADING" | "DELIVERY";
export type EpodAssignmentStatus = "OPEN" | "CLAIMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type EpodLoadingStatus = "PENDING_LOADING" | "LOADING_COMPLETED";
export type EpodDeliveryResult = "DELIVERED" | "PARTIAL" | "REJECTED";
export type EpodActorType = "WEB_ADMIN" | "DRIVER" | "HELPER";
export type EpodSource = "WEB" | "MOBILE";
export type EpodRosterRole = "DRIVER" | "HELPER";

export interface EpodAssignment {
  id: string;
  taskId: string;
  taskNumber: string | null;
  status: EpodAssignmentStatus;
  taskStatusRaw: string | null;
  vehicleId: number | null;
  licensePlate: string | null;
  vendorDriverName: string | null;
  driverEmployeeId: string | null;
  helperEmployeeId: string | null;
  loadingStatus: EpodLoadingStatus;
  loadingCompletedAt: string | null;
  deliveryDoneCount: number;
  deliveryTotalCount: number;
  snapshotAt: string;
  frozenAt: string | null;
  lastSyncedAt: string | null;
}

export interface EpodStop {
  id: string;
  assignmentId: string;
  sequence: number;
  stopType: EpodStopType;
  vendorPointId: string | null;
  vendorAddressId: string | null;
  pointName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  arrivalActual: string | null;
  departureActual: string | null;
  visitStatusRaw: string | null;
}

export interface EpodSubmission {
  id: string;
  stopId: string;
  version: number;
  result: EpodDeliveryResult | null;
  recipientName: string | null;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  geofenceOk: boolean | null;
  outOfRadiusReason: string | null;
  capturedAtDevice: string | null;
  capturedAtServer: string;
  actorType: EpodActorType;
  actorEmployeeId: string | null;
  source: EpodSource;
  isCurrent: boolean;
  evidencePurgedAt: string | null;
}

export interface EpodEvidence {
  id: string;
  submissionId: string;
  bucketId: string;
  objectPath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  originalFilename: string | null;
  sortOrder: number;
}

// ─── Normalizer baris database ───

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toStr(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function toInt(value: unknown, fallback = 0): number {
  const num = toNum(value);
  return num === null ? fallback : Math.trunc(num);
}

function toBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

const ASSIGNMENT_STATUSES: readonly EpodAssignmentStatus[] = [
  "OPEN",
  "CLAIMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

export function normalizeEpodAssignment(raw: unknown): EpodAssignment | null {
  const source = asRecord(raw);
  const id = toStr(source.id, 60);
  const taskId = toStr(source.task_id, 100);
  if (!id || !taskId) return null;
  const status = toStr(source.status, 20) as EpodAssignmentStatus | null;
  return {
    id,
    taskId,
    taskNumber: toStr(source.task_number, 60),
    status: status && ASSIGNMENT_STATUSES.includes(status) ? status : "OPEN",
    taskStatusRaw: toStr(source.task_status_raw, 40),
    vehicleId: toNum(source.vehicle_id),
    licensePlate: toStr(source.license_plate, 40),
    vendorDriverName: toStr(source.vendor_driver_name, 120),
    driverEmployeeId: toStr(source.driver_employee_id, 60),
    helperEmployeeId: toStr(source.helper_employee_id, 60),
    loadingStatus: toStr(source.loading_status, 30) === "LOADING_COMPLETED" ? "LOADING_COMPLETED" : "PENDING_LOADING",
    loadingCompletedAt: toStr(source.loading_completed_at, 40),
    deliveryDoneCount: toInt(source.delivery_done_count),
    deliveryTotalCount: toInt(source.delivery_total_count),
    snapshotAt: toStr(source.snapshot_at, 40) ?? new Date(0).toISOString(),
    frozenAt: toStr(source.frozen_at, 40),
    lastSyncedAt: toStr(source.last_synced_at, 40),
  };
}

export function normalizeEpodStop(raw: unknown): EpodStop | null {
  const source = asRecord(raw);
  const id = toStr(source.id, 60);
  const assignmentId = toStr(source.assignment_id, 60);
  if (!id || !assignmentId) return null;
  return {
    id,
    assignmentId,
    sequence: toInt(source.stop_sequence),
    stopType: toStr(source.stop_type, 20) === "LOADING" ? "LOADING" : "DELIVERY",
    vendorPointId: toStr(source.vendor_point_id, 100),
    vendorAddressId: toStr(source.vendor_address_id, 100),
    pointName: toStr(source.point_name, 200),
    address: toStr(source.address, 300),
    latitude: toNum(source.latitude),
    longitude: toNum(source.longitude),
    arrivalActual: toStr(source.arrival_actual, 40),
    departureActual: toStr(source.departure_actual, 40),
    visitStatusRaw: toStr(source.visit_status_raw, 40),
  };
}

export function normalizeEpodSubmission(raw: unknown): EpodSubmission | null {
  const source = asRecord(raw);
  const id = toStr(source.id, 60);
  const stopId = toStr(source.stop_id, 60);
  if (!id || !stopId) return null;
  const result = toStr(source.result, 20);
  const actorType = toStr(source.actor_type, 20);
  const sourceType = toStr(source.source, 20);
  return {
    id,
    stopId,
    version: toInt(source.version, 1),
    result: result === "DELIVERED" || result === "PARTIAL" || result === "REJECTED" ? result : null,
    recipientName: toStr(source.recipient_name, 200),
    note: toStr(source.note, 1000),
    latitude: toNum(source.latitude),
    longitude: toNum(source.longitude),
    accuracyMeters: toNum(source.accuracy_meters),
    distanceMeters: toNum(source.distance_meters),
    geofenceOk: toBool(source.geofence_ok),
    outOfRadiusReason: toStr(source.out_of_radius_reason, 500),
    capturedAtDevice: toStr(source.captured_at_device, 40),
    capturedAtServer: toStr(source.captured_at_server, 40) ?? new Date(0).toISOString(),
    actorType:
      actorType === "DRIVER" || actorType === "HELPER" ? actorType : "WEB_ADMIN",
    actorEmployeeId: toStr(source.actor_employee_id, 60),
    source: sourceType === "MOBILE" ? "MOBILE" : "WEB",
    isCurrent: source.is_current !== false,
    evidencePurgedAt: toStr(source.evidence_purged_at, 40),
  };
}

export function normalizeEpodEvidence(raw: unknown): EpodEvidence | null {
  const source = asRecord(raw);
  const id = toStr(source.id, 60);
  const submissionId = toStr(source.submission_id, 60);
  const objectPath = toStr(source.object_path, 500);
  if (!id || !submissionId || !objectPath) return null;
  return {
    id,
    submissionId,
    bucketId: toStr(source.bucket_id, 100) ?? TMS_EPOD_BUCKET,
    objectPath,
    mimeType: toStr(source.mime_type, 100),
    sizeBytes: toNum(source.size_bytes),
    originalFilename: toStr(source.original_filename, 200),
    sortOrder: toInt(source.sort_order),
  };
}

export function normalizeEpodAssignmentList(value: unknown): EpodAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeEpodAssignment).filter((item): item is EpodAssignment => item !== null);
}

// ─── Aturan bisnis ───

/**
 * Titik pertama FO adalah titik loading. Bila vendor mengirim `point_type`
 * START, titik itulah yang dipakai; jika tidak, titik dengan sequence
 * terkecil.
 */
export function resolveLoadingStopSequence(points: FleetTaskTimelinePoint[]): number | null {
  if (points.length === 0) return null;
  const startIndex = points.findIndex((point) => (point.pointType ?? "").toUpperCase() === "START");
  const index = startIndex >= 0 ? startIndex : 0;
  return resolveRoutePointSequence(points[index], index);
}

/** Jarak Haversine dalam meter. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.asin(Math.sqrt(a));
}

export interface EpodSubmissionInput {
  stopType: EpodStopType;
  result: EpodDeliveryResult | null;
  recipientName: string;
  note: string;
  photoCount: number;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  outOfRadiusReason: string;
}

/** Validasi bersama client & server. Mengembalikan pesan error atau null. */
export function validateEpodSubmission(input: EpodSubmissionInput): string | null {
  if (input.photoCount < TMS_EPOD_MIN_PHOTOS || input.photoCount > TMS_EPOD_MAX_PHOTOS) {
    return `Jumlah foto harus ${TMS_EPOD_MIN_PHOTOS} sampai ${TMS_EPOD_MAX_PHOTOS}.`;
  }
  if (input.latitude === null || input.longitude === null) {
    return "Lokasi GPS wajib diisi. Aktifkan izin lokasi pada browser.";
  }
  if (input.stopType === "LOADING") {
    if (input.result !== null) return "Titik loading tidak memakai hasil pengiriman.";
    return null;
  }
  if (input.result === null) return "Hasil pengiriman wajib dipilih.";
  if (input.result !== "REJECTED" && !input.recipientName.trim()) {
    return "Nama penerima wajib diisi.";
  }
  if (input.result !== "DELIVERED" && !input.note.trim()) {
    return input.result === "PARTIAL"
      ? "Catatan wajib diisi untuk pengiriman parsial."
      : "Alasan wajib diisi untuk pengiriman yang ditolak.";
  }
  if (
    input.distanceMeters !== null &&
    input.distanceMeters > TMS_EPOD_GEOFENCE_METERS &&
    !input.outOfRadiusReason.trim()
  ) {
    return `Alasan wajib diisi karena lokasi lebih dari ${TMS_EPOD_GEOFENCE_METERS} meter dari titik.`;
  }
  return null;
}

// ─── Tampilan ───

export const EPOD_ASSIGNMENT_STATUS_LABEL: Record<EpodAssignmentStatus, string> = {
  OPEN: "Belum diklaim",
  CLAIMED: "Sudah diklaim",
  IN_PROGRESS: "Berjalan",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

export const EPOD_RESULT_LABEL: Record<EpodDeliveryResult, string> = {
  DELIVERED: "Terkirim",
  PARTIAL: "Parsial",
  REJECTED: "Ditolak",
};

export function formatDistance(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) return "–";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
