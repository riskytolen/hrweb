/**
 * Performance scoring helpers — Sistem Point.
 *
 * Single source of truth. Dipakai di:
 * - /employees/performance (halaman Kinerja)
 * - /dashboard (card Pegawai Terbaik)
 *
 * ─── Rumus ───
 * Total Point = SUM(point ranking harian) − SUM(penalti harian) − penalti SP
 *
 * Point harian (berdasarkan ranking waktu absen per divisi per hari):
 *   Rank 1 (paling awal) = 20, Rank 2 = 18, Rank 3 = 16,
 *   Rank 4 = 14, Rank 5 = 12, Rank 6+ = 10.
 *
 * Penalti:
 *   Terlambat       = −3 per kejadian
 *   Alpha           = −5 per hari
 *   Manual input    = −1 per kejadian (semua jenis: hadir/telat/izin/sakit/cuti)
 *   SP-1/SP-2/SP-3  = −10/−20/−30 per periode
 *
 * Status yang tidak dihitung (0 point, 0 penalti):
 *   Izin, Sakit, Cuti, Libur — kecuali manual input tetap kena −1.
 *
 * Eligibility: pegawai harus bergabung >= 3 bulan sebelum akhir periode.
 *
 * Grade: persentil ranking (A top 10%, B top 30%, C top 60%, D top 80%, E bottom 20%).
 */

// ─── Interfaces ───

export interface AttendanceLite {
  employee_id: string;
  tanggal: string;
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

export interface PerformanceResult {
  /** Total point akumulasi. */
  totalPoint: number;
  /** Total point yang didapat dari ranking harian (sebelum penalti). */
  pointHarian: number;
  /** Total penalti yang dipotong. */
  totalPenalti: number;
  /** Jumlah hari hadir (Hadir + Terlambat). */
  hadir: number;
  telat: number;
  alpha: number;
  /** Manual input (semua jenis). */
  manualCount: number;
  spCount: number;
  sp1: number;
  sp2: number;
  sp3: number;
  penaltiTelat: number;
  penaltiAlpha: number;
  penaltiManual: number;
  penaltiSP: number;
  grade: "A" | "B" | "C" | "D" | "E" | "-";
  eligible: boolean;
}

// ─── Constants ───

export const RANK_POINTS = [20, 18, 16, 14, 12, 10] as const;

export const PENALTY = {
  TELAT: 3,
  ALPHA: 5,
  MANUAL: 1,
  SP1: 10,
  SP2: 20,
  SP3: 30,
} as const;

export const MIN_MONTHS_ELIGIBLE = 3;

// ─── Helpers ───

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
 * Hitung ranking waktu absen per divisi per hari.
 * Return: Map<"empId|tanggal", pointHarian>
 *
 * Untuk setiap (divisi, tanggal), urutkan pegawai berdasarkan jam_masuk (ascending).
 * Rank 1 = 20 point, rank 2 = 18, ... rank 6+ = 10.
 * Hanya status Hadir/Terlambat yang di-ranking. Lainnya skip.
 */
export function computeDailyRankPoints(attendance: AttendanceLite[]): Map<string, number> {
  // Kelompokkan per (divisi, tanggal)
  const groups = new Map<string, { empId: string; tanggal: string; jamMasukMin: number }[]>();

  for (const a of attendance) {
    if (a.status !== "Hadir" && a.status !== "Terlambat") continue;
    if (!a.jam_masuk || a.jam_masuk === "00:00") continue;
    const divId = a.division_id ?? 0;
    const key = `${divId}|${a.tanggal}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      empId: a.employee_id,
      tanggal: a.tanggal,
      jamMasukMin: timeToMinutes(a.jam_masuk),
    });
  }

  const result = new Map<string, number>();

  for (const members of groups.values()) {
    // Urutkan berdasarkan jam masuk (paling awal duluan)
    members.sort((a, b) => a.jamMasukMin - b.jamMasukMin);

    let currentRank = 0;
    let prevJam = -1;
    for (let i = 0; i < members.length; i++) {
      // Jika jam sama dengan sebelumnya, rank sama
      if (members[i].jamMasukMin !== prevJam) {
        currentRank = i;
        prevJam = members[i].jamMasukMin;
      }
      const pointIdx = Math.min(currentRank, RANK_POINTS.length - 1);
      const point = RANK_POINTS[pointIdx];
      result.set(`${members[i].empId}|${members[i].tanggal}`, point);
    }
  }

  return result;
}

/**
 * Hitung performance untuk satu pegawai.
 *
 * @param dailyRankPoints Map dari computeDailyRankPoints (shared, hitung sekali)
 */
export function computePerformance(
  employeeId: string,
  attendance: AttendanceLite[],
  spDocs: SpDocLite[],
  tanggalBergabung: string | null,
  periodEnd: string,
  dailyRankPoints: Map<string, number>,
): PerformanceResult {
  const eligible = isEligible(tanggalBergabung, periodEnd);
  const empAtt = attendance.filter((a) => a.employee_id === employeeId);
  const empSP = spDocs.filter((s) => s.employee_id === employeeId);

  // Hitung statistik
  const hadir = empAtt.filter((a) => a.status === "Hadir" || a.status === "Terlambat").length;
  const telat = empAtt.filter((a) => a.status === "Terlambat").length;
  const alpha = empAtt.filter((a) => a.status === "Alpha").length;
  const manualCount = empAtt.filter((a) => a.is_manual).length;

  const sp1 = empSP.filter((s) => s.tingkat_sp === "SP-1").length;
  const sp2 = empSP.filter((s) => s.tingkat_sp === "SP-2").length;
  const sp3 = empSP.filter((s) => s.tingkat_sp === "SP-3").length;
  const spCount = sp1 + sp2 + sp3;

  if (!eligible) {
    return {
      totalPoint: 0, pointHarian: 0, totalPenalti: 0,
      hadir, telat, alpha, manualCount, spCount, sp1, sp2, sp3,
      penaltiTelat: 0, penaltiAlpha: 0, penaltiManual: 0, penaltiSP: 0,
      grade: "-", eligible,
    };
  }

  // Point dari ranking harian
  let pointHarian = 0;
  for (const a of empAtt) {
    const key = `${employeeId}|${a.tanggal}`;
    const dayPoint = dailyRankPoints.get(key);
    if (dayPoint !== undefined) pointHarian += dayPoint;
  }

  // Penalti
  const penaltiTelat = telat * PENALTY.TELAT;
  const penaltiAlpha = alpha * PENALTY.ALPHA;
  const penaltiManual = manualCount * PENALTY.MANUAL;
  const penaltiSP = sp1 * PENALTY.SP1 + sp2 * PENALTY.SP2 + sp3 * PENALTY.SP3;
  const totalPenalti = penaltiTelat + penaltiAlpha + penaltiManual + penaltiSP;

  // Total point (bisa negatif kalau banyak penalti, tapi floor ke 0)
  const totalPoint = Math.max(0, pointHarian - totalPenalti);

  return {
    totalPoint, pointHarian, totalPenalti,
    hadir, telat, alpha, manualCount, spCount, sp1, sp2, sp3,
    penaltiTelat, penaltiAlpha, penaltiManual, penaltiSP,
    grade: "-", // grade di-assign setelah semua pegawai dihitung (persentil)
    eligible,
  };
}

/**
 * Assign grade berdasarkan persentil ranking.
 * Harus dipanggil SETELAH semua pegawai dihitung, dengan array yang sudah sorted desc.
 *
 * Top 10% = A, Top 30% = B, Top 60% = C, Top 80% = D, Bottom 20% = E.
 */
export function assignGrades<T extends { eligible: boolean; grade: string }>(
  rows: T[],
  getPoint: (r: T) => number,
): void {
  const eligible = rows.filter((r) => r.eligible);
  if (eligible.length === 0) return;

  // Sort descending by point
  const sorted = [...eligible].sort((a, b) => getPoint(b) - getPoint(a));
  const total = sorted.length;

  for (let i = 0; i < total; i++) {
    const percentile = (i + 1) / total;
    let grade: string;
    if (percentile <= 0.1) grade = "A";
    else if (percentile <= 0.3) grade = "B";
    else if (percentile <= 0.6) grade = "C";
    else if (percentile <= 0.8) grade = "D";
    else grade = "E";
    (sorted[i] as any).grade = grade;
  }
}

/**
 * Comparator best-first: total point desc, lalu nama asc.
 */
export function comparePerformanceBest<T extends {
  nama: string;
  totalPoint: number;
  eligible: boolean;
}>(a: T, b: T): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (b.totalPoint !== a.totalPoint) return b.totalPoint - a.totalPoint;
  return a.nama.localeCompare(b.nama);
}

/** Worst-first comparator. */
export function comparePerformanceWorst<T extends {
  nama: string;
  totalPoint: number;
  eligible: boolean;
}>(a: T, b: T): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.totalPoint !== b.totalPoint) return a.totalPoint - b.totalPoint;
  return a.nama.localeCompare(b.nama);
}
