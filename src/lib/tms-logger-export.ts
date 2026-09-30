/**
 * Logger Trips: helper export Excel/PDF (pure dan client-safe).
 *
 * Baris export dibangun dari `TripLogRow` yang sama dengan tabel UI agar
 * isi file selalu konsisten dengan filter yang sedang aktif.
 */

import { formatSlaDelta, slaKindLabel, slaStatusLabel, type SlaKind, type SlaStatus } from "./tms-sla";

export interface LoggerTripExportRow {
  id: string;
  taskNumber: string | null;
  taskStatus: string | null;
  unit: string | null;
  driver: string | null;
  routeSequence: number;
  store: string | null;
  address: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  temperatureC: number | null;
  groupName: string | null;
  slaProfileCode: string | null;
  slaKind: SlaKind | string | null;
  slaTargetAt: string | null;
  slaStatus: SlaStatus | string | null;
  slaDeltaSeconds: number | null;
}

function asSlaStatus(value: SlaStatus | string | null): SlaStatus | null {
  return value === "ON_TIME" || value === "LATE" || value === "PENDING" || value === "UNSET"
    ? value
    : null;
}

function asSlaKind(value: SlaKind | string | null): SlaKind | null {
  return value === "DEPARTURE" || value === "ARRIVAL" ? value : null;
}

export const LOGGER_TRIP_EXPORT_EXCEL_HEADERS = [
  "No",
  "Unit",
  "Nomor FO",
  "Nama Toko",
  "Alamat",
  "Driver",
  "Masuk Toko",
  "Keluar Toko",
  "Durasi di Toko",
  "Status",
  "Suhu",
  "Status Task",
  "Kelompok",
  "Profil Rute",
  "Jenis SLA",
  "Target SLA",
  "Status SLA",
  "Selisih SLA",
] as const;

export const LOGGER_TRIP_EXPORT_PDF_HEADERS = [
  "No",
  "Unit",
  "Toko",
  "Driver",
  "Masuk",
  "Keluar",
  "Durasi",
  "Target",
  "Status SLA",
  "Suhu",
] as const;

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Label status kunjungan, konsisten dengan badge di tabel UI. */
export function loggerTripVisitStatusLabel(row: LoggerTripExportRow): string {
  if (row.enteredAt && row.exitedAt) {
    const arrival = parseTimestamp(row.enteredAt);
    const departure = parseTimestamp(row.exitedAt);
    return arrival !== null && departure !== null && departure >= arrival
      ? "Selesai"
      : "Waktu tak lengkap";
  }
  if (row.enteredAt) return "Di lokasi";
  if (row.exitedAt) return "Waktu tak lengkap";
  return "Belum dikunjungi";
}

/** Durasi detik; untuk kunjungan berjalan dihitung sampai `nowMs`. */
export function loggerTripDurationSeconds(row: LoggerTripExportRow, nowMs: number): number | null {
  if (row.enteredAt && row.exitedAt) {
    const arrival = parseTimestamp(row.enteredAt);
    const departure = parseTimestamp(row.exitedAt);
    if (arrival === null || departure === null || departure < arrival) return null;
    return Math.round((departure - arrival) / 1000);
  }
  if (row.enteredAt && !row.exitedAt) {
    const arrival = parseTimestamp(row.enteredAt);
    if (arrival === null || nowMs < arrival) return null;
    return Math.floor((nowMs - arrival) / 1000);
  }
  return null;
}

export function formatLoggerTripDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return "–";
  if (totalSeconds < 60) return `${totalSeconds} dtk`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} mnt`;
}

export function formatLoggerTripDateTime(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

export function formatLoggerTripDateTimeShort(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

export function formatLoggerTripTemp(tempC: number | null): string {
  if (tempC === null) return "–";
  return `${tempC.toFixed(1).replace(".", ",")}°C`;
}

/** Satu baris body Excel (18 kolom lengkap). */
export function toLoggerTripExcelRow(row: LoggerTripExportRow, index: number, nowMs: number): string[] {
  const slaStatus = asSlaStatus(row.slaStatus);
  const slaKind = asSlaKind(row.slaKind);
  return [
    String(index + 1),
    row.unit ?? "–",
    row.taskNumber ?? "–",
    row.store ?? `Titik ${row.routeSequence}`,
    row.address ?? "–",
    row.driver ?? "–",
    formatLoggerTripDateTime(row.enteredAt),
    row.exitedAt ? formatLoggerTripDateTime(row.exitedAt) : "Di lokasi",
    formatLoggerTripDuration(loggerTripDurationSeconds(row, nowMs)),
    loggerTripVisitStatusLabel(row),
    formatLoggerTripTemp(row.temperatureC),
    row.taskStatus ?? "–",
    row.groupName ?? "–",
    row.slaProfileCode ?? "–",
    slaKindLabel(slaKind),
    row.slaTargetAt ? formatLoggerTripDateTime(row.slaTargetAt) : "–",
    slaStatusLabel(slaStatus, slaKind),
    formatSlaDelta(row.slaDeltaSeconds),
  ];
}

/** Satu baris body PDF (10 kolom ringkas agar muat landscape A4). */
export function toLoggerTripPdfRow(row: LoggerTripExportRow, index: number, nowMs: number): string[] {
  const slaStatus = asSlaStatus(row.slaStatus);
  const slaKind = asSlaKind(row.slaKind);
  return [
    String(index + 1),
    row.unit ?? "–",
    row.store ?? `Titik ${row.routeSequence}`,
    row.driver ?? "–",
    formatLoggerTripDateTimeShort(row.enteredAt),
    row.exitedAt ? formatLoggerTripDateTimeShort(row.exitedAt) : "Di lokasi",
    formatLoggerTripDuration(loggerTripDurationSeconds(row, nowMs)),
    row.slaTargetAt ? formatLoggerTripDateTimeShort(row.slaTargetAt) : "–",
    slaStatusLabel(slaStatus, slaKind),
    formatLoggerTripTemp(row.temperatureC),
  ];
}

/* ─── Export per profil SLA ─── */

/** Satu baris datar untuk export mode profil (satu titik dalam satu perjalanan). */
export interface ProfileTripExportRow {
  serviceDate: string;
  taskNumber: string | null;
  unit: string | null;
  driver: string | null;
  routeOrder: number;
  storeName: string;
  slaKind: SlaKind | string | null;
  /** Jam jadwal profil ("HH:MM:SS") — ditampilkan "04.15". */
  scheduleTarget: string;
  slaTargetAt: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  slaStatus: SlaStatus | string | null;
  slaDeltaSeconds: number | null;
  temperatureC: number | null;
}

export const PROFILE_TRIP_EXPORT_EXCEL_HEADERS = [
  "No",
  "Tanggal",
  "Nomor FO",
  "Unit",
  "Driver",
  "Urutan",
  "Titik",
  "Jenis SLA",
  "Target Jadwal",
  "Target Aktual",
  "Masuk",
  "Keluar",
  "Status SLA",
  "Selisih SLA",
  "Suhu",
] as const;

export const PROFILE_TRIP_EXPORT_PDF_HEADERS = [
  "No",
  "Titik",
  "Target",
  "Masuk",
  "Keluar",
  "Status SLA",
  "Selisih",
  "Suhu",
] as const;

/** "04:15:00" -> "04.15"; nilai tak dikenal dikembalikan apa adanya. */
export function formatProfileScheduleTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return value;
  return `${match[1].padStart(2, "0")}.${match[2]}`;
}

function profileVisitLabel(row: ProfileTripExportRow): string {
  if (row.enteredAt && row.exitedAt) return "Selesai";
  if (row.enteredAt) return "Di lokasi";
  if (row.exitedAt) return "Waktu tak lengkap";
  return "Belum dikunjungi";
}

/** Satu baris body Excel profil (15 kolom). */
export function toProfileTripExcelRow(row: ProfileTripExportRow, index: number): string[] {
  const slaStatus = asSlaStatus(row.slaStatus);
  const slaKind = asSlaKind(row.slaKind);
  return [
    String(index + 1),
    row.serviceDate,
    row.taskNumber ?? "–",
    row.unit ?? "–",
    row.driver ?? "–",
    String(row.routeOrder),
    row.storeName,
    slaKindLabel(slaKind),
    formatProfileScheduleTime(row.scheduleTarget),
    row.slaTargetAt ? formatLoggerTripDateTime(row.slaTargetAt) : "–",
    row.enteredAt ? formatLoggerTripDateTime(row.enteredAt) : "–",
    row.exitedAt ? formatLoggerTripDateTime(row.exitedAt) : profileVisitLabel(row),
    slaStatusLabel(slaStatus, slaKind),
    formatSlaDelta(row.slaDeltaSeconds),
    formatLoggerTripTemp(row.temperatureC),
  ];
}

/** Satu baris body PDF profil (8 kolom ringkas). */
export function toProfileTripPdfRow(row: ProfileTripExportRow, index: number): string[] {
  const slaStatus = asSlaStatus(row.slaStatus);
  const slaKind = asSlaKind(row.slaKind);
  return [
    String(index + 1),
    row.storeName,
    formatProfileScheduleTime(row.scheduleTarget),
    row.enteredAt ? formatLoggerTripDateTimeShort(row.enteredAt) : "–",
    row.exitedAt ? formatLoggerTripDateTimeShort(row.exitedAt) : profileVisitLabel(row),
    slaStatusLabel(slaStatus, slaKind),
    formatSlaDelta(row.slaDeltaSeconds),
    formatLoggerTripTemp(row.temperatureC),
  ];
}

/** Stamp nama file `YYYYMMDD-HHmm` dalam zona Asia/Jakarta. */
export function loggerTripExportFileStamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}`;
}
