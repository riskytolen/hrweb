/**
 * Performance scoring helpers.
 *
 * Single source of truth untuk skor pegawai. Dipakai di:
 * - /employees/performance (halaman Kinerja)
 * - /dashboard (card Pegawai Terbaik)
 *
 * ─── Rumus ───
 * Skor = Skor Kehadiran (max 70) + Skor Disiplin (max 30), clip 0–100.
 *
 * 1. Kehadiran (max 70):
 *      hadir          = COUNT(status IN ("Hadir","Terlambat"))
 *      total_efektif  = COUNT(status ≠ "Libur")
 *      skor_kehadiran = (hadir / total_efektif) × 70
 *
 * 2. Disiplin (max 30):
 *      penalti =
 *          telat                    × 1
 *        + floor(menit_telat / 30)  × 1
 *        + manual_hadir_telat       × 3
 *        + manual_izin_sakit_cuti   × 2
 *        + alpha                    × 5
 *        + sp1                      × 10
 *        + sp2                      × 20
 *        + sp3                      × 30
 *      skor_disiplin = max(0, 30 − penalti)
 *
 * Pegawai tanpa attendance sama sekali (totalHariKerja = 0) → skor 0
 * supaya tidak muncul sebagai top performer di dashboard.
 */

export interface AttendanceLite {
  employee_id: string;
  status: string; // "Hadir" | "Terlambat" | "Alpha" | "Izin" | "Sakit" | "Cuti" | "Libur"
  durasi_telat: number;
  is_manual: boolean;
}

export interface SpDocLite {
  employee_id: string;
  kategori: string; // "PKWT" | "SP" | "PERNYATAAN"
  tingkat_sp: "SP-1" | "SP-2" | "SP-3" | null;
  status: string;
}

export interface PerformanceBreakdown {
  /** Total semua attendance termasuk Libur (untuk display "X hari periode"). */
  totalHariKerja: number;
  /** Total hari efektif = exclude Libur. Dipakai sebagai denominator kehadiran. */
  totalHariEfektif: number;
  hadir: number;
  telat: number;
  totalMenitTelat: number;
  alpha: number;
  /** Manual input untuk status Hadir/Terlambat (potensi nutupi alpha/telat). */
  manual: number;
  /** Manual input untuk status Izin/Sakit/Cuti (alasan tidak terverifikasi sistem). */
  manualLeave: number;
  izin: number;
  sakit: number;
  cuti: number;
  spCount: number;
  sp1: number;
  sp2: number;
  sp3: number;
  /** Komponen kehadiran (max 70). */
  skorKehadiran: number;
  /** Komponen disiplin (max 30). */
  skorDisiplin: number;
  /** Total penalti yg dipotong dari komponen disiplin (untuk display detail). */
  penaltiTotal: number;
  /** Skor akhir (kehadiran + disiplin), clip 0–100, bulat. */
  skorTotal: number;
  grade: "A" | "B" | "C" | "D" | "E";
}

export const PENALTY = {
  /** Per kejadian terlambat. */
  TELAT_PER_KEJADIAN: 1,
  /** Per 30 menit kumulatif telat. */
  TELAT_PER_30_MENIT: 1,
  /** Manual input untuk status Hadir / Terlambat. */
  MANUAL_HADIR: 3,
  /** Manual input untuk status Izin / Sakit / Cuti. */
  MANUAL_LEAVE: 2,
  ALPHA_PER_HARI: 5,
  SP1: 10,
  SP2: 20,
  SP3: 30,
} as const;

/** Bobot komponen skor. */
export const SCORE_WEIGHT = {
  KEHADIRAN: 70,
  DISIPLIN: 30,
} as const;

export function getGrade(skor: number): PerformanceBreakdown["grade"] {
  if (skor >= 90) return "A";
  if (skor >= 80) return "B";
  if (skor >= 70) return "C";
  if (skor >= 60) return "D";
  return "E";
}

export function getGradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#10b981";
    case "B": return "#3b82f6";
    case "C": return "#f59e0b";
    case "D": return "#f97316";
    case "E": return "#ef4444";
    default: return "#6b7280";
  }
}

/** Hitung breakdown performance untuk satu pegawai. */
export function computePerformance(
  employeeId: string,
  attendance: AttendanceLite[],
  spDocs: SpDocLite[],
): PerformanceBreakdown {
  const empAtt = attendance.filter((a) => a.employee_id === employeeId);
  const empSP = spDocs.filter((s) => s.employee_id === employeeId);

  const totalHariKerja = empAtt.length;
  // Hari efektif = semua hari yg seharusnya kerja, tidak termasuk Libur.
  const totalHariEfektif = empAtt.filter((a) => a.status !== "Libur").length;
  const hadir = empAtt.filter((a) => a.status === "Hadir" || a.status === "Terlambat").length;
  const telat = empAtt.filter((a) => a.status === "Terlambat").length;
  const totalMenitTelat = empAtt
    .filter((a) => a.status === "Terlambat")
    .reduce((s, a) => s + (a.durasi_telat || 0), 0);
  const alpha = empAtt.filter((a) => a.status === "Alpha").length;
  const manual = empAtt.filter(
    (a) => a.is_manual && (a.status === "Hadir" || a.status === "Terlambat"),
  ).length;
  const manualLeave = empAtt.filter(
    (a) => a.is_manual && (a.status === "Izin" || a.status === "Sakit" || a.status === "Cuti"),
  ).length;
  const izin = empAtt.filter((a) => a.status === "Izin").length;
  const sakit = empAtt.filter((a) => a.status === "Sakit").length;
  const cuti = empAtt.filter((a) => a.status === "Cuti").length;

  const sp1 = empSP.filter((s) => s.tingkat_sp === "SP-1").length;
  const sp2 = empSP.filter((s) => s.tingkat_sp === "SP-2").length;
  const sp3 = empSP.filter((s) => s.tingkat_sp === "SP-3").length;
  const spCount = sp1 + sp2 + sp3;

  // ── Komponen 1: Kehadiran (max 70) ──
  let skorKehadiran = 0;
  if (totalHariEfektif > 0) {
    skorKehadiran = (hadir / totalHariEfektif) * SCORE_WEIGHT.KEHADIRAN;
  }

  // ── Komponen 2: Disiplin (max 30) ──
  const penaltiTotal =
    telat * PENALTY.TELAT_PER_KEJADIAN +
    Math.floor(totalMenitTelat / 30) * PENALTY.TELAT_PER_30_MENIT +
    manual * PENALTY.MANUAL_HADIR +
    manualLeave * PENALTY.MANUAL_LEAVE +
    alpha * PENALTY.ALPHA_PER_HARI +
    sp1 * PENALTY.SP1 +
    sp2 * PENALTY.SP2 +
    sp3 * PENALTY.SP3;
  const skorDisiplin = Math.max(0, SCORE_WEIGHT.DISIPLIN - penaltiTotal);

  // ── Skor total ──
  // Pegawai tanpa data attendance sama sekali → 0 (mencegah skor palsu)
  const skorTotal =
    totalHariKerja === 0
      ? 0
      : Math.max(0, Math.min(100, Math.round(skorKehadiran + skorDisiplin)));

  return {
    totalHariKerja,
    totalHariEfektif,
    hadir,
    telat,
    totalMenitTelat,
    alpha,
    manual,
    manualLeave,
    izin,
    sakit,
    cuti,
    spCount,
    sp1,
    sp2,
    sp3,
    skorKehadiran: Math.round(skorKehadiran * 10) / 10,
    skorDisiplin: Math.round(skorDisiplin * 10) / 10,
    penaltiTotal,
    skorTotal,
    grade: getGrade(skorTotal),
  };
}
