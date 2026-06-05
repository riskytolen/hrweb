/**
 * Konstanta status absensi.
 *
 * Dipakai oleh form input, tabel, kalender, ringkasan, filter pill, dan badge.
 * Status harus konsisten dengan enum `DbAttendanceRecord.status` di `lib/supabase.ts`.
 */

export type AttendanceStatus =
  | "Hadir"
  | "Terlambat"
  | "Izin"
  | "Sakit"
  | "Alpha"
  | "Libur"
  | "Cuti";

export interface StatusOption {
  value: AttendanceStatus;
  label: string;
  color: string;
}

/**
 * Daftar status yang ditampilkan sebagai filter pill & legend kalender.
 * Urutan = urutan tampilan di UI.
 */
export const STATUS_OPTIONS: readonly StatusOption[] = [
  { value: "Hadir", label: "Hadir", color: "#10b981" },
  { value: "Terlambat", label: "Terlambat", color: "#f59e0b" },
  { value: "Izin", label: "Izin", color: "#3b82f6" },
  { value: "Sakit", label: "Sakit", color: "#ef4444" },
  { value: "Alpha", label: "Alpha", color: "#6b7280" },
  { value: "Libur", label: "Libur", color: "#8b5cf6" },
  { value: "Cuti", label: "Cuti", color: "#8b5cf6" },
] as const;

/** Map value → option untuk lookup cepat (mis. `STATUS_BY_VALUE["Hadir"].color`). */
export const STATUS_BY_VALUE: Record<AttendanceStatus, StatusOption> = STATUS_OPTIONS.reduce(
  (acc, opt) => {
    acc[opt.value] = opt;
    return acc;
  },
  {} as Record<AttendanceStatus, StatusOption>
);

/** Status yang tidak memerlukan field jam masuk (ditampilkan sebagai "-"). */
export const NO_JAM_STATUSES: readonly AttendanceStatus[] = [
  "Izin",
  "Sakit",
  "Alpha",
  "Libur",
  "Cuti",
] as const;

/**
 * Status yang bisa dipilih manual di form input oleh admin web.
 *
 * NOTE: Izin, Sakit, Cuti seharusnya lewat pengajuan `leave_requests` (mobile/app),
 * bukan input manual oleh admin. Hanya Alpha yang bisa dipilih manual untuk koreksi
 * ketidakhadiran tanpa pengajuan.
 */
export const MANUAL_SPECIAL: readonly AttendanceStatus[] = ["Alpha"] as const;

/** Helper type-guard: status tertentu butuh jam_masuk atau tidak. */
export function needsJamMasuk(status: AttendanceStatus | string): boolean {
  return !NO_JAM_STATUSES.includes(status as AttendanceStatus);
}

/** Helper type-guard: status tertentu bisa dipilih manual di form. */
export function isManualSelectable(status: AttendanceStatus | string): boolean {
  return MANUAL_SPECIAL.includes(status as AttendanceStatus);
}
