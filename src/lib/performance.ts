/**
 * Performance scoring helpers.
 *
 * Single source of truth untuk skor pegawai. Dipakai di:
 * - /employees/performance (halaman Kinerja)
 * - /dashboard (card Pegawai Terbaik)
 *
 * Skor 100 di awal, dikurangi penalti berdasarkan attendance & legal documents (SP).
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
  totalHariKerja: number;
  hadir: number;
  telat: number;
  totalMenitTelat: number;
  alpha: number;
  manual: number;
  izin: number;
  sakit: number;
  cuti: number;
  spCount: number;
  sp1: number;
  sp2: number;
  sp3: number;
  skorTotal: number;
  grade: "A" | "B" | "C" | "D" | "E";
}

export const PENALTY = {
  ALPHA_PER_HARI: 5,
  TELAT_PER_KEJADIAN: 1,
  TELAT_PER_30_MENIT: 1,
  MANUAL_PER_KEJADIAN: 2,
  SP1: 10,
  SP2: 20,
  SP3: 40,
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
  const hadir = empAtt.filter((a) => a.status === "Hadir" || a.status === "Terlambat").length;
  const telat = empAtt.filter((a) => a.status === "Terlambat").length;
  const totalMenitTelat = empAtt
    .filter((a) => a.status === "Terlambat")
    .reduce((s, a) => s + (a.durasi_telat || 0), 0);
  const alpha = empAtt.filter((a) => a.status === "Alpha").length;
  const manual = empAtt.filter(
    (a) => a.is_manual && (a.status === "Hadir" || a.status === "Terlambat"),
  ).length;
  const izin = empAtt.filter((a) => a.status === "Izin").length;
  const sakit = empAtt.filter((a) => a.status === "Sakit").length;
  const cuti = empAtt.filter((a) => a.status === "Cuti").length;

  const sp1 = empSP.filter((s) => s.tingkat_sp === "SP-1").length;
  const sp2 = empSP.filter((s) => s.tingkat_sp === "SP-2").length;
  const sp3 = empSP.filter((s) => s.tingkat_sp === "SP-3").length;
  const spCount = sp1 + sp2 + sp3;

  const penaltyAlpha = alpha * PENALTY.ALPHA_PER_HARI;
  const penaltyTelat =
    telat * PENALTY.TELAT_PER_KEJADIAN +
    Math.floor(totalMenitTelat / 30) * PENALTY.TELAT_PER_30_MENIT;
  const penaltyManual = manual * PENALTY.MANUAL_PER_KEJADIAN;
  const penaltySP = sp1 * PENALTY.SP1 + sp2 * PENALTY.SP2 + sp3 * PENALTY.SP3;

  let skor = 100 - penaltyAlpha - penaltyTelat - penaltyManual - penaltySP;
  skor = Math.max(0, Math.min(100, skor));

  return {
    totalHariKerja,
    hadir,
    telat,
    totalMenitTelat,
    alpha,
    manual,
    izin,
    sakit,
    cuti,
    spCount,
    sp1,
    sp2,
    sp3,
    skorTotal: skor,
    grade: getGrade(skor),
  };
}
