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
export const TMS_EPOD_MAX_ITEMS = 20;
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

/** Satu barang yang diantar pada sebuah titik pengantaran. */
export interface EpodItem {
  name: string;
  quantity: number;
  unit: string | null;
}

export interface EpodSubmission {
  id: string;
  stopId: string;
  version: number;
  result: EpodDeliveryResult | null;
  recipientName: string | null;
  note: string | null;
  items: EpodItem[];
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

/**
 * Ambil nilai pertama yang ada dari beberapa kunci.
 *
 * Normalizer dipakai dua kali: di server untuk baris database (snake_case)
 * dan di client untuk payload API yang sudah dinormalkan (camelCase). Helper
 * ini membuat satu normalizer aman untuk kedua bentuk sehingga tidak ada
 * lagi normalisasi ganda yang saling mengosongkan.
 */
function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Normalisasi daftar barang dari payload submission. */
function normalizeEpodItems(value: unknown): EpodItem[] {
  if (!Array.isArray(value)) return [];
  const items: EpodItem[] = [];
  for (const entry of value) {
    const source = asRecord(entry);
    const name = toStr(pick(source, "name"), 200);
    const quantity = toNum(pick(source, "quantity", "qty"));
    if (!name || quantity === null || quantity <= 0) continue;
    items.push({ name, quantity, unit: toStr(pick(source, "unit"), 40) });
    if (items.length >= TMS_EPOD_MAX_ITEMS) break;
  }
  return items;
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
  const id = toStr(pick(source, "id"), 60);
  const taskId = toStr(pick(source, "task_id", "taskId"), 100);
  if (!id || !taskId) return null;
  const status = toStr(pick(source, "status"), 20) as EpodAssignmentStatus | null;
  return {
    id,
    taskId,
    taskNumber: toStr(pick(source, "task_number", "taskNumber"), 60),
    status: status && ASSIGNMENT_STATUSES.includes(status) ? status : "OPEN",
    taskStatusRaw: toStr(pick(source, "task_status_raw", "taskStatusRaw"), 40),
    vehicleId: toNum(pick(source, "vehicle_id", "vehicleId")),
    licensePlate: toStr(pick(source, "license_plate", "licensePlate"), 40),
    vendorDriverName: toStr(pick(source, "vendor_driver_name", "vendorDriverName"), 120),
    driverEmployeeId: toStr(pick(source, "driver_employee_id", "driverEmployeeId"), 60),
    helperEmployeeId: toStr(pick(source, "helper_employee_id", "helperEmployeeId"), 60),
    loadingStatus:
      toStr(pick(source, "loading_status", "loadingStatus"), 30) === "LOADING_COMPLETED"
        ? "LOADING_COMPLETED"
        : "PENDING_LOADING",
    loadingCompletedAt: toStr(pick(source, "loading_completed_at", "loadingCompletedAt"), 40),
    deliveryDoneCount: toInt(pick(source, "delivery_done_count", "deliveryDoneCount")),
    deliveryTotalCount: toInt(pick(source, "delivery_total_count", "deliveryTotalCount")),
    snapshotAt: toStr(pick(source, "snapshot_at", "snapshotAt"), 40) ?? new Date(0).toISOString(),
    frozenAt: toStr(pick(source, "frozen_at", "frozenAt"), 40),
    lastSyncedAt: toStr(pick(source, "last_synced_at", "lastSyncedAt"), 40),
  };
}

export function normalizeEpodStop(raw: unknown): EpodStop | null {
  const source = asRecord(raw);
  const id = toStr(pick(source, "id"), 60);
  const assignmentId = toStr(pick(source, "assignment_id", "assignmentId"), 60);
  if (!id || !assignmentId) return null;
  return {
    id,
    assignmentId,
    sequence: toInt(pick(source, "stop_sequence", "sequence")),
    stopType: toStr(pick(source, "stop_type", "stopType"), 20) === "LOADING" ? "LOADING" : "DELIVERY",
    vendorPointId: toStr(pick(source, "vendor_point_id", "vendorPointId"), 100),
    vendorAddressId: toStr(pick(source, "vendor_address_id", "vendorAddressId"), 100),
    pointName: toStr(pick(source, "point_name", "pointName"), 200),
    address: toStr(pick(source, "address"), 300),
    latitude: toNum(pick(source, "latitude")),
    longitude: toNum(pick(source, "longitude")),
    arrivalActual: toStr(pick(source, "arrival_actual", "arrivalActual"), 40),
    departureActual: toStr(pick(source, "departure_actual", "departureActual"), 40),
    visitStatusRaw: toStr(pick(source, "visit_status_raw", "visitStatusRaw"), 40),
  };
}

export function normalizeEpodSubmission(raw: unknown): EpodSubmission | null {
  const source = asRecord(raw);
  const id = toStr(pick(source, "id"), 60);
  const stopId = toStr(pick(source, "stop_id", "stopId"), 60);
  if (!id || !stopId) return null;
  const result = toStr(pick(source, "result"), 20);
  const actorType = toStr(pick(source, "actor_type", "actorType"), 20);
  const sourceType = toStr(pick(source, "source"), 20);
  return {
    id,
    stopId,
    version: toInt(pick(source, "version"), 1),
    result: result === "DELIVERED" || result === "PARTIAL" || result === "REJECTED" ? result : null,
    recipientName: toStr(pick(source, "recipient_name", "recipientName"), 200),
    note: toStr(pick(source, "note"), 1000),
    items: normalizeEpodItems(pick(source, "items")),
    latitude: toNum(pick(source, "latitude")),
    longitude: toNum(pick(source, "longitude")),
    accuracyMeters: toNum(pick(source, "accuracy_meters", "accuracyMeters")),
    distanceMeters: toNum(pick(source, "distance_meters", "distanceMeters")),
    geofenceOk: toBool(pick(source, "geofence_ok", "geofenceOk")),
    outOfRadiusReason: toStr(pick(source, "out_of_radius_reason", "outOfRadiusReason"), 500),
    capturedAtDevice: toStr(pick(source, "captured_at_device", "capturedAtDevice"), 40),
    capturedAtServer: toStr(pick(source, "captured_at_server", "capturedAtServer"), 40) ?? new Date(0).toISOString(),
    actorType: actorType === "DRIVER" || actorType === "HELPER" ? actorType : "WEB_ADMIN",
    actorEmployeeId: toStr(pick(source, "actor_employee_id", "actorEmployeeId"), 60),
    source: sourceType === "MOBILE" ? "MOBILE" : "WEB",
    isCurrent: pick(source, "is_current", "isCurrent") !== false,
    evidencePurgedAt: toStr(pick(source, "evidence_purged_at", "evidencePurgedAt"), 40),
  };
}

export function normalizeEpodEvidence(raw: unknown): EpodEvidence | null {
  const source = asRecord(raw);
  const id = toStr(pick(source, "id"), 60);
  const submissionId = toStr(pick(source, "submission_id", "submissionId"), 60);
  const objectPath = toStr(pick(source, "object_path", "objectPath"), 500);
  if (!id || !submissionId || !objectPath) return null;
  return {
    id,
    submissionId,
    bucketId: toStr(pick(source, "bucket_id", "bucketId"), 100) ?? TMS_EPOD_BUCKET,
    objectPath,
    mimeType: toStr(pick(source, "mime_type", "mimeType"), 100),
    sizeBytes: toNum(pick(source, "size_bytes", "sizeBytes")),
    originalFilename: toStr(pick(source, "original_filename", "originalFilename"), 200),
    sortOrder: toInt(pick(source, "sort_order", "sortOrder")),
  };
}

/**
 * Item daftar e-POD: assignment ditambah nama driver/helper hasil join.
 * Bentuk ini adalah kontrak respons `GET /api/tms/epod`.
 */
export interface EpodAssignmentListItem extends EpodAssignment {
  driverName: string | null;
  helperName: string | null;
}

export function normalizeEpodAssignmentListItem(raw: unknown): EpodAssignmentListItem | null {
  const base = normalizeEpodAssignment(raw);
  if (!base) return null;
  const source = asRecord(raw);
  return {
    ...base,
    driverName: toStr(pick(source, "driver_name", "driverName"), 120),
    helperName: toStr(pick(source, "helper_name", "helperName"), 120),
  };
}

export function normalizeEpodAssignmentList(value: unknown): EpodAssignmentListItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeEpodAssignmentListItem)
    .filter((item): item is EpodAssignmentListItem => item !== null);
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

/** Nilai mentah baris barang dari form (kuantitas masih berupa teks). */
export interface EpodItemInput {
  name: string;
  quantity: string;
  unit: string;
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
  items: EpodItemInput[];
}

/** Baris yang benar-benar diisi pengguna (mengabaikan baris kosong). */
export function filledEpodItems(items: EpodItemInput[]): EpodItemInput[] {
  return items.filter((item) => item.name.trim() || item.quantity.trim() || item.unit.trim());
}

/** Ubah input form menjadi payload yang dikirim ke API. */
export function toEpodItemPayload(
  items: EpodItemInput[],
): { name: string; quantity: number; unit: string | null }[] {
  return filledEpodItems(items).map((item) => ({
    name: item.name.trim(),
    quantity: Number(item.quantity),
    unit: item.unit.trim() || null,
  }));
}

/** Validasi daftar barang: wajib minimal 1, nama terisi, kuantitas > 0. */
export function validateEpodItems(items: EpodItemInput[]): string | null {
  const filled = filledEpodItems(items);
  if (filled.length < 1) return "Minimal satu barang wajib diisi.";
  if (filled.length > TMS_EPOD_MAX_ITEMS) {
    return `Jumlah barang maksimal ${TMS_EPOD_MAX_ITEMS}.`;
  }
  for (const item of filled) {
    const name = item.name.trim();
    if (!name) return "Nama barang wajib diisi.";
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `Kuantitas barang "${name}" harus lebih dari 0.`;
    }
  }
  return null;
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
  const itemsError = validateEpodItems(input.items);
  if (itemsError) return itemsError;
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
