/**
 * Performance scoring helpers.
 *
 * Single source of truth untuk skor pegawai. Dipakai di:
 * - /employees/performance (halaman Kinerja)
 * - /dashboard (card Pegawai Terbaik)
 *
 * ─── Rumus ───
 * Skor = Skor Kehadiran (max 70) + Skor Disiplin (max 30) + Bonus Ketepatan (max 5)
 *        clip 0–100.
 *
 * 1. Kehadiran (max 70):
 *      hadir          = COUNT(status IN ("Hadir","Terlambat"))
 *      total_efektif  = COUNT(status NOT IN ("Libur","Cuti","Izin","Sakit"))
 *      skor_kehadiran = (hadir / total_efektif) x 70
 *
 * 2. Disiplin (max 30):
 *      penalti =
 *          telat           x 3
 *        + manual_input    x 1
 *        + alpha           x 5
 *        + sp1             x 10
 *        + sp2             x 20
 *        + sp3             x 30
 *      skor_disiplin = max(0, 30 - penalti)
 *
 * 3. Ketepatan Waktu (max 5):
 *      bonus_absolute = 0-2 (berdasarkan avgEarliness individu)
 *      bonus_relative = 0-3 (berdasarkan perbandingan dengan median divisi)
 *      total = min(5, bonus_absolute + bonus_relative)
 *
 * Pegawai tanpa attendance (totalHariKerja = 0) -> skor 0.
 * Pegawai bergabung < 3 bulan -> eligible = false, skor 0.
 * totalHariEfektif = 0 (semua Libur/Cuti) -> skor 0.
 */

export interface AttendanceLite {
  employee_id: string;
  status: string;
  durasi_telat: number;
  is_manual: boolean;
  jam_masuk?: string;
  schedule_jam_masuk?: string;
  division_id?: number | null;
}

export interface SpDocLite {
  employee_id: string;
  kategori: string;
  tingkat_sp: "SP-1" | "SP-2" | "SP-3" | null;
  status: string;
  tanggal_terbit?: string;
}

export interface PerformanceBreakdown {
  totalHariKerja: number;
  totalHariEfektif: number;
  hadir: number;
  telat: number;
  totalMenitTelat: number;
  alpha: number;
  manual: number;
  manualLeave: number;
  izin: number;
  sakit: number;
  cuti: number;
  spCount: number;
  sp1: number;
  sp2: number;
  sp3: number;
  skorKehadiran: number;
  skorDisiplin: number;
  penaltiTotal: number;
  /** Bonus ketepatan waktu (0-5). */
  bonusKetepatan: number;
  /** Rata-rata menit lebih awal dari jadwal (negatif = terlambat). */
  avgEarliness: number | null;
  skorTotal: number;
  grade: "A" | "B" | "C" | "D" | "E" | "-";
  /** Apakah pegawai eligible untuk dinilai (bergabung >= 3 bulan). */
  eligible: boolean;
}

export const PENALTY = {
  TELAT_PER_KEJADIAN: 3,
  MANUAL_INPUT: 1,
  ALPHA_PER_HARI: 5,
  SP1: 10,
  SP2: 20,
  SP3: 30,
} as const;

export const SCORE_WEIGHT = {
  KEHADIRAN: 70,
  DISIPLIN: 30,
  KETEPATAN_MAX: 5,
  KETEPATAN_ABSOLUTE_MAX: 2,
  KETEPATAN_RELATIVE_MAX: 3,
} as const;

/** Minimum bulan bergabung untuk eligible dinilai. */
export const MIN_MONTHS_ELIGIBLE = 3;

export function getGrade(skor: number, eligible: boolean): PerformanceBreakdown["grade"] {
  if (!eligible) return "-";
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

/** Cek apakah pegawai sudah bergabung >= MIN_MONTHS_ELIGIBLE bulan relatif terhadap akhir periode. */
export function isEligible(tanggalBergabung: string | null, periodEnd: string): boolean {
  if (!tanggalBergabung) return false;
  const [ey, em, ed] = periodEnd.split("-").map(Number);
  const cutoff = new Date(ey, em - 1 - MIN_MONTHS_ELIGIBLE, ed);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return tanggalBergabung <= cutoffStr;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Hitung rata-rata earliness (menit lebih awal) untuk satu pegawai.
 * Positif = lebih awal, Negatif = terlambat. Null = tidak ada data.
 * Skip record manual, skip status tanpa jam masuk valid.
 */
export function computeAvgEarliness(empAtt: AttendanceLite[]): number | null {
  const validRecords = empAtt.filter(
    (a) =>
      !a.is_manual &&
      (a.status === "Hadir" || a.status === "Terlambat") &&
      a.jam_masuk &&
      a.schedule_jam_masuk &&
      a.jam_masuk !== "00:00" &&
      a.schedule_jam_masuk !== "00:00",
  );
  if (validRecords.length === 0) return null;
  const total = validRecords.reduce((sum, a) => {
    return sum + (timeToMinutes(a.schedule_jam_masuk!) - timeToMinutes(a.jam_masuk!));
  }, 0);
  return total / validRecords.length;
}

/**
 * Hitung median dari array angka.
 */
export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Hitung bonus ketepatan waktu (hybrid: absolute + relative).
 * @param avgEarliness rata-rata menit lebih awal pegawai
 * @param divisionMedian median earliness divisi pegawai
 */
export function computePunctualityBonus(avgEarliness: number | null, divisionMedian: number): number {
  if (avgEarliness === null) return 0;

  // Bonus absolute: konsisten datang awal (tidak tergantung rekan)
  let bonusAbsolute = 0;
  if (avgEarliness >= 10) bonusAbsolute = SCORE_WEIGHT.KETEPATAN_ABSOLUTE_MAX; // +2
  else if (avgEarliness >= 5) bonusAbsolute = 1;

  // Bonus relative: lebih awal dari median divisi
  const relativeEarly = avgEarliness - divisionMedian;
  let bonusRelative = 0;
  if (relativeEarly > 0) {
    bonusRelative = Math.min(SCORE_WEIGHT.KETEPATAN_RELATIVE_MAX, Math.floor(relativeEarly / 5));
  }

  return Math.min(SCORE_WEIGHT.KETEPATAN_MAX, bonusAbsolute + bonusRelative);
}

/**
 * Comparator best-first ranking.
 * Tie-breakers: skor -> hadir -> telat -> hari kerja -> avgEarliness -> nama.
 */
export function comparePerformanceBest<T extends {
  nama: string;
  skorTotal: number;
  hadir: number;
  telat: number;
  totalHariKerja: number;
  avgEarliness: number | null;
  eligible: boolean;
}>(a: T, b: T): number {
  // Eligible selalu di atas non-eligible
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (b.skorTotal !== a.skorTotal) return b.skorTotal - a.skorTotal;
  if (b.hadir !== a.hadir) return b.hadir - a.hadir;
  if (a.telat !== b.telat) return a.telat - b.telat;
  if (b.totalHariKerja !== a.totalHariKerja) return b.totalHariKerja - a.totalHariKerja;
  const aE = a.avgEarliness ?? -999;
  const bE = b.avgEarliness ?? -999;
  if (bE !== aE) return bE - aE;
  return a.nama.localeCompare(b.nama);
}

/** Worst-first comparator. */
export function comparePerformanceWorst<T extends {
  nama: string;
  skorTotal: number;
  hadir: number;
  telat: number;
  totalHariKerja: number;
  avgEarliness: number | null;
  eligible: boolean;
}>(a: T, b: T): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.skorTotal !== b.skorTotal) return a.skorTotal - b.skorTotal;
  if (a.hadir !== b.hadir) return a.hadir - b.hadir;
  if (b.telat !== a.telat) return b.telat - a.telat;
  if (b.totalHariKerja !== a.totalHariKerja) return b.totalHariKerja - a.totalHariKerja;
  const aE = a.avgEarliness ?? -999;
  const bE = b.avgEarliness ?? -999;
  if (aE !== bE) return aE - bE;
  return a.nama.localeCompare(b.nama);
}

/**
 * Hitung breakdown performance untuk satu pegawai.
 *
 * @param employeeId ID pegawai
 * @param attendance Semua attendance record di periode
 * @param spDocs SP aktif yang sudah difilter periode
 * @param tanggalBergabung Tanggal bergabung pegawai
 * @param periodEnd Akhir periode (untuk cek eligibility)
 * @param divisionMedian Median earliness divisi pegawai (0 jika tidak ada data)
 */
export function computePerformance(
  employeeId: string,
  attendance: AttendanceLite[],
  spDocs: SpDocLite[],
  tanggalBergabung: string | null,
  periodEnd: string,
  divisionMedian: number,
): PerformanceBreakdown {
  const eligible = isEligible(tanggalBergabung, periodEnd);
  const empAtt = attendance.filter((a) => a.employee_id === employeeId);
  const empSP = spDocs.filter((s) => s.employee_id === employeeId);

  const totalHariKerja = empAtt.length;
  // Hari efektif = exclude Libur, Cuti, Izin, Sakit.
  // Ketidakhadiran yang sah (cuti/izin/sakit) tidak menurunkan skor kehadiran —
  // pegawai tidak dihukum untuk hari yang memang tidak wajib hadir.
  const NON_EFEKTIF = ["Libur", "Cuti", "Izin", "Sakit"];
  const totalHariEfektif = empAtt.filter((a) => !NON_EFEKTIF.includes(a.status)).length;
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

  // Rata-rata earliness
  const avgEarliness = computeAvgEarliness(empAtt);

  if (!eligible || totalHariKerja === 0 || totalHariEfektif === 0) {
    return {
      totalHariKerja, totalHariEfektif, hadir, telat, totalMenitTelat, alpha,
      manual, manualLeave, izin, sakit, cuti, spCount, sp1, sp2, sp3,
      skorKehadiran: 0, skorDisiplin: 0, penaltiTotal: 0, bonusKetepatan: 0,
      avgEarliness, skorTotal: 0, grade: getGrade(0, eligible), eligible,
    };
  }

  // ── Komponen 1: Kehadiran (max 70) ──
  const skorKehadiran = (hadir / totalHariEfektif) * SCORE_WEIGHT.KEHADIRAN;

  // ── Komponen 2: Disiplin (max 30) ──
  const totalManual = manual + manualLeave;
  const penaltiTotal =
    telat * PENALTY.TELAT_PER_KEJADIAN +
    totalManual * PENALTY.MANUAL_INPUT +
    alpha * PENALTY.ALPHA_PER_HARI +
    sp1 * PENALTY.SP1 +
    sp2 * PENALTY.SP2 +
    sp3 * PENALTY.SP3;
  const skorDisiplin = Math.max(0, SCORE_WEIGHT.DISIPLIN - penaltiTotal);

  // ── Komponen 3: Bonus Ketepatan Waktu (max 5) ──
  const bonusKetepatan = computePunctualityBonus(avgEarliness, divisionMedian);

  // ── Skor total ──
  const skorTotal = Math.max(0, Math.min(100, Math.round(skorKehadiran + skorDisiplin + bonusKetepatan)));

  return {
    totalHariKerja, totalHariEfektif, hadir, telat, totalMenitTelat, alpha,
    manual, manualLeave, izin, sakit, cuti, spCount, sp1, sp2, sp3,
    skorKehadiran: Math.round(skorKehadiran * 10) / 10,
    skorDisiplin: Math.round(skorDisiplin * 10) / 10,
    penaltiTotal, bonusKetepatan, avgEarliness,
    skorTotal, grade: getGrade(skorTotal, eligible), eligible,
  };
}
