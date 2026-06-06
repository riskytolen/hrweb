/**
 * Prorata calculation untuk gaji pokok.
 *
 * Logika v2 (konsisten dengan versi sebelumnya):
 * - Pegawai Tidak Aktif dengan tanggal_keluar NULL + ada catatan absen di periode
 *   → prorata = unique hari dgn catatan / total hari kalender periode
 * - Pegawai Tidak Aktif + 0 catatan → skip (tidak ada slip)
 * - Pegawai join < 3 bulan → eligible=false (point tetap dihitung, tapi belum digaji)
 *
 * Pure functions, no side effects, fully testable.
 */

import type { AttendanceRecord, EmployeeInput, PeriodRange } from "./types";

/** Hitung unique hari dengan catatan absen (semua status). */
export function countDaysWithAttendance(attendance: AttendanceRecord[]): number {
  const uniqueDates = new Set(attendance.map((a) => a.tanggal));
  return uniqueDates.size;
}

/** Hitung unique hari kerja (Hadir + Terlambat). */
export function countWorkingDays(attendance: AttendanceRecord[]): number {
  const dates = new Set(
    attendance
      .filter((a) => a.status === "Hadir" || a.status === "Terlambat")
      .map((a) => a.tanggal),
  );
  return dates.size;
}

/** Total hari kalender dalam periode. */
export function getTotalCalendarDays(period: PeriodRange): number {
  return period.totalHariKalender;
}

export interface ProrataResult {
  /** Apakah gapok di-prorata? */
  isProrated: boolean;
  /** Hari efektif yang dihitung (numerator). */
  hariEfektif: number;
  /** Total hari kalender periode (denominator). */
  hariKalender: number;
  /** Gapok prorata final. */
  gapokFinal: number;
  /** Alasan prorata (untuk tooltip). */
  reason: string | null;
}

/**
 * Hitung gapok prorata.
 *
 * Rules:
 * 1. Tidak Aktif + 0 catatan → return null (skip)
 * 2. Tidak Aktif + ada catatan → prorata per hari kalender
 * 3. Pegawai join dalam periode (belum 3 bulan) → masih full (eligible false di-handle di tempat lain)
 * 4. Default → full gapok
 */
export function calculateProratedGapok(
  employee: EmployeeInput,
  period: PeriodRange,
  attendance: AttendanceRecord[],
): ProrataResult | null {
  const gapokFull = employee.gajiPokok;
  const totalHari = period.totalHariKalender;
  const hariDenganCatatan = countDaysWithAttendance(attendance);
  const hariKerja = countWorkingDays(attendance);

  // Rule 1: Tidak Aktif + 0 catatan → skip
  if (employee.statusKaryawan === "Tidak Aktif" && hariDenganCatatan === 0) {
    return null;
  }

  // Rule 2: Tidak Aktif + ada catatan → prorata per hari kalender
  if (employee.statusKaryawan === "Tidak Aktif" && hariDenganCatatan > 0) {
    const ratio = Math.min(hariDenganCatatan / totalHari, 1.0);
    const gapokFinal = Math.round(gapokFull * ratio);
    return {
      isProrated: true,
      hariEfektif: hariDenganCatatan,
      hariKalender: totalHari,
      gapokFinal,
      reason: `Tidak Aktif · ${hariDenganCatatan}/${totalHari} hari kalender`,
    };
  }

  // Rule 3 & 4: Pegawai aktif / training / cuti → full
  // (Belum handle "baru masuk dalam periode" — eligible check dilakukan di caller)
  return {
    isProrated: false,
    hariEfektif: hariKerja,
    hariKalender: totalHari,
    gapokFinal: gapokFull,
    reason: null,
  };
}
