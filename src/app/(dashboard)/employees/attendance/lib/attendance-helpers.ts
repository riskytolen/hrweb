import { MIN_DATE, MONTH_SHORT_ID, SUMMARY_CUT_OFF_DAY } from "./attendance-constants";
import type { NonActivePeriod } from "@/lib/supabase";

export type PenaltyLite = {
  division_id: number;
  denda_per_menit: number;
  batas_menit: number;
  denda_maksimum: number;
  denda_alpha: number;
};

export type LatenessResult = { status: "Hadir" | "Terlambat"; durasi: number };

export type OffDayLite = {
  employee_id: string;
  day_of_week: number;
  effective_from?: string | null;
  effective_to?: string | null;
};

/**
 * Apakah satu baris jadwal mingguan berlaku pada tanggal tertentu.
 * - effective_from NULL dianggap sejak MIN_DATE (jadwal lama sebelum migrasi).
 * - effective_to NULL berarti masih aktif.
 * - Batas inklusif di kedua sisi.
 */
export function isOffDayActiveOnDate(
  row: OffDayLite,
  dateStr: string,
): boolean {
  const from = row.effective_from ?? MIN_DATE;
  if (dateStr < from) return false;
  if (row.effective_to && dateStr > row.effective_to) return false;
  return true;
}

/**
 * Apakah pegawai libur mingguan pada tanggal tertentu (memakai histori efektif).
 * `dayOfWeek`: 0 (Minggu) – 6 (Sabtu), konsisten dengan `getUTCDay()`.
 */
export function isWeeklyOffDay(
  offDays: OffDayLite[],
  employeeId: string,
  dayOfWeek: number,
  dateStr: string,
): boolean {
  return offDays.some(
    (od) =>
      od.employee_id === employeeId &&
      od.day_of_week === dayOfWeek &&
      isOffDayActiveOnDate(od, dateStr),
  );
}

export type AutoAttendanceLite = {
  status: string;
  catatan: string | null;
  is_manual: boolean;
};

/**
 * Apakah record otomatis boleh dipulihkan menjadi Libur saat tanggal tersebut
 * ternyata hari libur (jadwal efektif). Tidak pernah true untuk:
 * - record manual, Hadir/Terlambat, atau Libur yang sudah benar.
 * - Izin/Sakit/Cuti yang dibuat dari approval (catatan "Jenis: alasan"),
 *   hanya yang auto-generated ("...otomatis...") yang boleh dipulihkan.
 */
export function isAutoRestorableToLibur(rec: AutoAttendanceLite): boolean {
  if (rec.is_manual) return false;
  if (rec.status === "Hadir" || rec.status === "Terlambat" || rec.status === "Libur") return false;
  const note = rec.catatan || "";
  if (rec.status === "Alpha") return note.startsWith("Alpha otomatis");
  if (rec.status === "Izin" || rec.status === "Sakit" || rec.status === "Cuti") {
    return note.includes("otomatis");
  }
  return false;
}

/** Baris jadwal aktif pada tanggal referensi (untuk modal/tampilan). */
export function isOffDayRowActive(
  row: OffDayLite,
  refDate: string,
): boolean {
  if (row.effective_to) return row.effective_to >= refDate && (row.effective_from ?? MIN_DATE) <= refDate;
  return (row.effective_from ?? MIN_DATE) <= refDate;
}

export type SummaryPeriod = { start: string; end: string; label: string };

export type EmployeeActivityLite = {
  status: string;
  tanggal_bergabung: string | null;
  tanggal_keluar: string | null;
  non_active_periods?: NonActivePeriod[] | null;
};

export function isBackOfficeDivision(name: string | null | undefined): boolean {
  return (name || "").trim().toLowerCase() === "back office";
}

/**
 * True bila record absen manual ikut dihitung pada analisa.
 * Sama seperti Report Manual: divisi Back Office tidak masuk hitungan.
 */
export function isCountableManualRecord(
  isManual: boolean,
  divisionNama: string | null | undefined,
): boolean {
  return isManual && !isBackOfficeDivision(divisionNama);
}

export interface DominantDivisionInput {
  division_id: number;
  tanggal: string;
  nama: string | null;
  color: string | null;
}

export interface DominantDivisionLabel {
  id: number;
  nama: string | null;
  color: string | null;
}

/**
 * Pilih divisi sebagai **label identitas** pegawai pada analisa perorangan:
 * divisi dengan record absen terbanyak pada periode; jika seri diputuskan
 * lewat tanggal absen terbaru; masih seri lewat division_id terkecil.
 * Label ini murni identitas — angka absensi tetap gabungan semua divisi.
 */
export function pickDominantDivisionLabel(
  records: DominantDivisionInput[],
): DominantDivisionLabel | null {
  type DivStat = { count: number; last: string; nama: string | null; color: string | null };
  const byDiv = new Map<number, DivStat>();
  for (const r of records) {
    const stat = byDiv.get(r.division_id) ?? { count: 0, last: "", nama: null, color: null };
    stat.count++;
    if (r.tanggal > stat.last) stat.last = r.tanggal;
    if (stat.nama === null && r.nama) stat.nama = r.nama;
    if (stat.color === null && r.color) stat.color = r.color;
    byDiv.set(r.division_id, stat);
  }
  const entries = Array.from(byDiv.entries());
  if (entries.length === 0) return null;
  entries.sort(([, a], [, b]) => {
    if (b.count !== a.count) return b.count - a.count;
    // Tanggal terbaru menang (string YYYY-MM-DD aman dibandingkan urut).
    if (b.last !== a.last) return b.last < a.last ? -1 : 1;
    return 0; // diakhiri perbandingan id pada loop penentu
  });
  let winner = entries[0];
  for (const entry of entries) {
    const [idA, sA] = winner;
    const [idB, sB] = entry;
    if (sB.count === sA.count && sB.last === sA.last && idB < idA) winner = entry;
  }
  const [id, label] = winner;
  return { id, nama: label.nama, color: label.color };
}

/** "2026-09-24T08:15" → "08:15" (menit sejak tengah malam); null jika tidak valid. */
export function timeToMinutesOrNull(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 47 || min > 59) return null;
  return h * 60 + min;
}

/** Menit sejak tengah malam → "HH:MM". */
export function minutesToHHMM(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60) % 48;
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Rata-rata jam masuk pegawai pada divisi tertentu — hanya record Hadir/Terlambat
 * dengan jam masuk valid yang dihitung (record tanpa jam dikonfirmasi pemilik).
 * Dipakai sebagai penentu seri pada peringkat perorangan: semua pegawai dibandingkan
 * dalam divisi yang sama agar jadwal jam masuknya setara.
 */
export function computeAvgJamMasuk(
  records: { division_id: number; status: string; jam_masuk: string | null }[],
  divisionId: number,
): string | null {
  let sum = 0;
  let count = 0;
  for (const r of records) {
    if (r.division_id !== divisionId) continue;
    if (r.status !== "Hadir" && r.status !== "Terlambat") continue;
    const mins = timeToMinutesOrNull(r.jam_masuk);
    if (mins === null) continue;
    sum += mins;
    count++;
  }
  if (count === 0) return null;
  return minutesToHHMM(sum / count);
}

/** Pembanding rata-rata jam masuk: paling awal menang; yang tanpa jam (null) di belakang; seri → nama A-Z. */
export function compareJamMasukThenNama(
  a: { avgJam: string | null; nama: string },
  b: { avgJam: string | null; nama: string },
): number {
  const jamA = timeToMinutesOrNull(a.avgJam);
  const jamB = timeToMinutesOrNull(b.avgJam);
  if (jamA !== jamB) {
    // Pegawai dengan rata-rata jam lebih awal menang; yang tak punya jam (null) di belakang.
    if (jamA === null) return 1;
    if (jamB === null) return -1;
    return jamA - jamB;
  }
  return a.nama.localeCompare(b.nama);
}

/** Komparator aturan peringkat: kehadiran tertinggi → manual tersedikit → rata-rata jam masuk paling awal → nama A-Z. */
export function compareRankingEntries(
  a: { hadirEfektifPct: number; manual: number; avgJam: string | null; nama: string },
  b: { hadirEfektifPct: number; manual: number; avgJam: string | null; nama: string },
): number {
  if (b.hadirEfektifPct !== a.hadirEfektifPct) return b.hadirEfektifPct - a.hadirEfektifPct;
  if (a.manual !== b.manual) return a.manual - b.manual;
  return compareJamMasukThenNama(a, b);
}

/**
 * Get local date string YYYY-MM-DD (timezone safe — pakai local time, bukan UTC).
 * Penting untuk konsistensi antara client timezone dan server-side date filter.
 */
export function localDateStr(d?: Date): string {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Add/subtract days from YYYY-MM-DD string. Clamped ke MIN_DATE.
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const result = localDateStr(dt);
  if (result < MIN_DATE) return MIN_DATE;
  return result;
}

/** Parse "HH:MM" atau "HH:MM:SS" jadi total menit dari tengah malam. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Format total menit (0-1439+) jadi "HH:MM". Wrap-around untuk overnight (>1440). */
export function minutesToTime(total: number): string {
  const safe = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Tentukan status kehadiran & durasi keterlambatan.
 * Toleransi: jika telat <= toleransi, tetap "Hadir". Jika lewat, "Terlambat" dengan durasi = telat - toleransi.
 */
export function computeLateness(
  jamMasuk: string,
  scheduleJamMasuk: string,
  toleransi: number,
): LatenessResult {
  const actual = timeToMinutes(jamMasuk);
  const scheduled = timeToMinutes(scheduleJamMasuk);
  const diff = actual - scheduled;
  if (diff <= toleransi) return { status: "Hadir", durasi: 0 };
  return { status: "Terlambat", durasi: diff - toleransi };
}

/**
 * Hitung denda telat. Jika telat <= batas, gunakan `denda_per_menit * durasi`.
 * Jika telat > batas, flat `denda_maksimum`. Return 0 untuk durasi <= 0.
 */
export function computeDenda(
  durasiTelat: number,
  penalty: PenaltyLite | undefined,
  defaults: { perMenit: number; batas: number; maksimum: number },
): number {
  if (durasiTelat <= 0) return 0;
  const dendaPerMenit = penalty?.denda_per_menit ?? defaults.perMenit;
  const batasMenit = penalty?.batas_menit ?? defaults.batas;
  const dendaMaksimum = penalty?.denda_maksimum ?? defaults.maksimum;
  if (durasiTelat > batasMenit) return dendaMaksimum;
  return durasiTelat * dendaPerMenit;
}

/** Hitung denda alpha. Pakai penalty.denda_alpha atau default. */
export function computeDendaAlpha(
  penalty: PenaltyLite | undefined,
  defaultDendaAlpha: number,
): number {
  return penalty?.denda_alpha ?? defaultDendaAlpha;
}

/**
 * Batas telat = jam_masuk_jadwal + toleransi_menit (HH:MM). NULL kalau jadwal kosong.
 * Input toleransi bisa null/undefined (dianggap 0).
 */
export function getDeadlineTime(
  scheduleJamMasuk: string | null | undefined,
  toleransi: number | null | undefined,
): string | null {
  if (!scheduleJamMasuk) return null;
  const base = timeToMinutes(scheduleJamMasuk.slice(0, 5));
  return minutesToTime(base + (toleransi ?? 0));
}

/**
 * Hitung range tanggal untuk periode summary payroll (cutoff SUMMARY_CUT_OFF_DAY).
 * Mis. cut_off=8 → periode 1: tgl 8 bulan ini s/d tgl 7 bulan depan.
 */
export function getSummaryPeriodRange(periodKey: string): SummaryPeriod {
  const [year, month] = periodKey.split("-").map(Number);
  const startDate = new Date(year, month - 1, SUMMARY_CUT_OFF_DAY);
  const endDate = new Date(year, month, SUMMARY_CUT_OFF_DAY - 1);
  const start = localDateStr(startDate);
  const end = localDateStr(endDate);
  const label = `${SUMMARY_CUT_OFF_DAY} ${startDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })} – ${SUMMARY_CUT_OFF_DAY - 1} ${endDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
  return { start, end, label };
}

/**
 * Tentukan period key (YYYY-MM) untuk summary berdasarkan tanggal.
 * Jika tanggal.day < cutoff, kembali ke bulan sebelumnya. Else bulan ini.
 *
 * Mis. cutoff=8, tanggal 5 Juni 2026 → "2026-05" (periode 8 Mei – 7 Juni)
 * Mis. cutoff=8, tanggal 10 Juni 2026 → "2026-06" (periode 8 Juni – 7 Juli)
 */
export function getSummaryCurrentPeriodKey(date: Date = new Date()): string {
  if (date.getDate() < SUMMARY_CUT_OFF_DAY) {
    const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Hitung range tanggal untuk periode kalender (cutoff 8-7, 1 bulan).
 * Mirip `getSummaryPeriodRange` tapi tanpa label panjang.
 */
export function getCalPeriod(key: string): SummaryPeriod {
  const [y, m] = key.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-08`;
  const endDt = new Date(y, m, 7);
  const end = localDateStr(endDt);
  const startLabel = new Date(y, m - 1, 8).toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  });
  const endLabel = endDt.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const label = `8 ${startLabel} – 7 ${endLabel}`;
  return { start, end, label };
}

/**
 * Generate array of YYYY-MM-DD strings dari start s/d end (inclusive).
 * Jika end null, kembalikan array berisi start saja (single-day holiday).
 * Pakai UTC math untuk konsistensi cross-timezone.
 */
export function getDateRange(start: string, end: string | null): string[] {
  const dates: string[] = [];
  const endDate = end || start;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  for (let ms = startMs; ms <= endMs; ms += 86400000) {
    const dt = new Date(ms);
    dates.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return dates;
}

/**
 * Resolve employee IDs yang terpengaruh oleh public holiday `h` dari list `employees`.
 * - "semua" → return semua IDs
 * - "pegawai" → return hanya IDs di h.pegawai_ids
 * - "divisi" → belum diimplementasi di sini, return [] (caller handle separately)
 */
export function getAffectedEmployeeIds(
  h: { berlaku_untuk: string; pegawai_ids: string[] | null },
  employees: { id: string }[],
): string[] {
  if (h.berlaku_untuk === "semua") return employees.map((e) => e.id);
  if (h.berlaku_untuk === "pegawai") return h.pegawai_ids || [];
  return [];
}

/**
 * Single source of truth untuk aktivitas pegawai ada di `@/lib/employee-activity`.
 * Fungsi di bawah ini dipertahankan sebagai wrapper kompatibilitas agar tidak
 * ada modul yang divergen: `tanggal_keluar` = hari pertama TIDAK aktif.
 */
export { isInNonActivePeriod } from "@/lib/employee-activity";

import {
  hasActiveDayInPeriod as hasActiveDayInPeriodCentral,
  isEmployeeActiveOnDate as isEmployeeActiveOnDateCentral,
} from "@/lib/employee-activity";

export function isEmployeeActiveOnDate(date: string, employee: EmployeeActivityLite): boolean {
  return isEmployeeActiveOnDateCentral(date, employee);
}

export function isEmployeeActiveInPeriod(period: { start: string; end: string }, employee: EmployeeActivityLite): boolean {
  if (!period.start || !period.end) return false;
  return hasActiveDayInPeriodCentral(employee, period.start, period.end);
}

// ─── Challenge Mingguan (divisi CP Suka) ─────────────────────────────
// Ranking mingguan dengan aturan gugur di Analisa → Perorangan.
// Semua fungsi murni — record absensi di-fetch oleh hook analisa.

/** Alasan ketidakhadiran pada hari wajib challenge. */
export type ChallengeDayReason = "Izin" | "Sakit" | "Cuti" | "Alpha" | "Tanpa absen";

/** Klasifikasi satu hari peserta challenge. */
export type ChallengeDayResult = {
  tanggal: string;
  /** Libur terjadwal → hari netral, tidak masuk hitungan wajib. */
  libur: boolean;
  /** Record Hadir/Terlambat ada pada hari ini. */
  hadir: boolean;
  /** Status kehadiran hari ini ("Hadir"/"Terlambat"); null bila tidak hadir. */
  statusMasuk: "Hadir" | "Terlambat" | null;
  /** Alasan tidak hadir; null bila hadir atau hari libur. */
  alasan: ChallengeDayReason | null;
};

/** Rekap jumlah hari per status pada satu minggu (kolom detail challenge). */
export type ChallengeStatusCounts = {
  hadir: number;
  terlambat: number;
  izin: number;
  sakit: number;
  cuti: number;
  alpha: number;
  libur: number;
};

/** Baris peserta Challenge Mingguan CP Suka pada Analisa → Perorangan. */
export type ChallengeEmployeeResult = {
  employee_id: string;
  nama: string;
  divisionNama: string;
  divisionColor: string;
  /** Hari wajib yang dihadiri (mis. 6). */
  hadirWajib: number;
  /** Total hari wajib minggu ini — libur terjadwal & hari mendatang dikecualikan. */
  totalWajib: number;
  /** Jumlah absen manual pegawai pada minggu ini. */
  manual: number;
  /** Rata-rata jam masuk di divisi CP Suka; null bila tak ada record berjam. */
  avgJamMasuk: string | null;
  /** True bila lolos aturan (full hadir & manual ≤ CHALLENGE_MAX_MANUAL). */
  lolos: boolean;
  /** Daftar alasan gugur (kosong bila lolos). */
  alasanGugur: string[];
  /** Peringkat hanya untuk peserta lolos; gugur bernilai null. */
  rank: number | null;
  /** Rekap jumlah hari per status minggu ini (kolom detail di tabel). */
  statusCounts: ChallengeStatusCounts;
  /** Klasifikasi per hari Senin–Minggu (terpotong hari ini pada minggu berjalan). */
  days: ChallengeDayResult[];
};

/** Satu minggu challenge pada periode analisa. */
export type ChallengeWeek = {
  /** Senin minggu (YYYY-MM-DD). */
  weekStart: string;
  /** Minggu minggu (YYYY-MM-DD). */
  weekEnd: string;
  /** Label pendek, mis. "1 – 7 Sep 2026". */
  label: string;
  /** Minggu memuat hari ini — status masih sementara. */
  isRunning: boolean;
  /** Semua hari masih mendatang — belum dinilai. */
  isFuture: boolean;
  /** Peserta: lolos berurutan (rank 1..n) lalu gugur di paling bawah. */
  items: ChallengeEmployeeResult[];
};

export type ChallengeRecordInput = {
  employee_id: string;
  division_id: number | null;
  status: string;
  tanggal: string;
  is_manual: boolean;
  jam_masuk: string | null;
  divisionNama: string | null;
  divisionColor: string | null;
};

/** Batas absen manual peserta challenge: 1 masih lolos, lebih dari 1 gugur. */
export const CHALLENGE_MAX_MANUAL = 1;

/** Divisi peserta challenge. Sama pola dengan isBackOfficeDivision (perbandingan nama). */
export function isCpSukaDivision(nama: string | null | undefined): boolean {
  return (nama || "").trim().toLowerCase() === "cp suka";
}

/** Tanggal hari ini (YYYY-MM-DD) menurut zona waktu Asia/Jakarta. */
export function getJakartaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Tambah/hapus hari pada YYYY-MM-DD dengan aritmetika UTC (tanpa clamp MIN_DATE). */
function addDaysUtc(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Senin pada minggu yang memuat dateStr (getUTCDay 0 Minggu – 6 Sabtu). */
export function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysUtc(dateStr, -((dow + 6) % 7));
}

/** Semua minggu Senin–Minggu yang memotong rentang [start..end]. */
export function listPeriodWeeks(start: string, end: string): { weekStart: string; weekEnd: string }[] {
  const out: { weekStart: string; weekEnd: string }[] = [];
  if (!start || !end || start > end) return out;
  let monday = mondayOfWeek(start);
  while (monday <= end) {
    out.push({ weekStart: monday, weekEnd: addDaysUtc(monday, 6) });
    monday = addDaysUtc(monday, 7);
  }
  return out;
}

/** "5 Sep" (tanpa tahun) untuk pesan alasan gugur. */
function idShortDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTH_SHORT_ID[m - 1]}`;
}

/** Label minggu pendek: "1 – 7 Sep 2026" atau lintas bulan "29 Sep – 5 Okt 2026". */
export function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const [sy, sm, sd] = weekStart.split("-").map(Number);
  const [ey, em, ed] = weekEnd.split("-").map(Number);
  if (sy !== ey || sm !== em) return `${sd} ${MONTH_SHORT_ID[sm - 1]} – ${ed} ${MONTH_SHORT_ID[em - 1]} ${ey}`;
  return `${sd} – ${ed} ${MONTH_SHORT_ID[sm - 1]} ${sy}`;
}

/** Komparator peserta lolos: manual tersedikit → jam masuk paling awal → nama A-Z. */
export function compareChallengeLolos(
  a: { manual: number; avgJam: string | null; nama: string },
  b: { manual: number; avgJam: string | null; nama: string },
): number {
  if (a.manual !== b.manual) return a.manual - b.manual;
  return compareJamMasukThenNama(a, b);
}

/**
 * Hitung Challenge Mingguan CP Suka untuk satu minggu Senin–Minggu (murni).
 *
 * Aturan:
 * - Peserta = pegawai yang divisi dominannya pada minggu ini adalah CP Suka.
 *   Record otomatis tanpa divisi (Libur/Alpha) tidak ikut menentukan dominan.
 * - Hari wajib = hari minggu yang sudah lewat (≤ todayStr) minus hari Libur —
 *   libur terjadwal bersifat netral. Hari mendatang belum dinilai.
 * - Gugur bila pada salah satu hari wajib pegawai tidak hadir
 *   (Izin/Sakit/Cuti/Alpha/tanpa absen), ATAU absen manual > CHALLENGE_MAX_MANUAL.
 * - Peringkat lolos: manual tersedikit → rata-rata jam masuk paling awal
 *   (record Hadir/Terlambat di divisi CP Suka) → nama A-Z. Gugur rank null.
 */
export function computeWeeklyChallenge(
  records: ChallengeRecordInput[],
  weekStart: string,
  todayStr: string,
  empNames?: Map<string, string>,
): ChallengeWeek {
  const weekEnd = addDaysUtc(weekStart, 6);
  const isRunning = weekStart <= todayStr && todayStr <= weekEnd;
  const isFuture = weekStart > todayStr;
  const week: ChallengeWeek = {
    weekStart,
    weekEnd,
    label: formatWeekLabel(weekStart, weekEnd),
    isRunning,
    isFuture,
    items: [],
  };
  // Minggu belum dimulai — tidak ada yang bisa dinilai.
  if (isFuture) return week;

  // Horizon: minggu dipotong hari ini — hari mendatang belum dinilai.
  const last = todayStr < weekEnd ? todayStr : weekEnd;
  const horizon: string[] = [];
  for (let cur = weekStart; cur <= last; cur = addDaysUtc(cur, 1)) horizon.push(cur);

  // Kelompokkan record minggu ini per pegawai per tanggal.
  const allByEmp = new Map<string, ChallengeRecordInput[]>();
  const byDateByEmp = new Map<string, Map<string, ChallengeRecordInput[]>>();
  for (const r of records) {
    if (r.tanggal < weekStart || r.tanggal > weekEnd) continue;
    let byDate = byDateByEmp.get(r.employee_id);
    if (!byDate) {
      byDate = new Map();
      byDateByEmp.set(r.employee_id, byDate);
      allByEmp.set(r.employee_id, []);
    }
    const dayList = byDate.get(r.tanggal);
    if (dayList) dayList.push(r);
    else byDate.set(r.tanggal, [r]);
    allByEmp.get(r.employee_id)!.push(r);
  }

  const drafts: ChallengeEmployeeResult[] = [];
  for (const [eid, byDate] of byDateByEmp) {
    const all = allByEmp.get(eid) ?? [];

    // Divisi dominan hanya dari record yang punya divisi (auto Libur/Alpha tanpa divisi).
    const dominant = pickDominantDivisionLabel(
      all.flatMap((r) =>
        r.divisionNama
          ? [{ division_id: r.division_id as number, tanggal: r.tanggal, nama: r.divisionNama, color: r.divisionColor }]
          : [],
      ),
    );
    if (!dominant || !isCpSukaDivision(dominant.nama)) continue;

    const manual = all.filter((r) => r.is_manual).length;
    const avgJamMasuk = computeAvgJamMasuk(
      all.map((r) => ({ division_id: r.division_id as number, status: r.status, jam_masuk: r.jam_masuk })),
      dominant.id,
    );

    const days: ChallengeDayResult[] = horizon.map((tanggal) => {
      const dayRecs = byDate.get(tanggal) ?? [];
      const presenceDay = dayRecs.find((r) => r.status === "Hadir" || r.status === "Terlambat");
      if (presenceDay) {
        return { tanggal, libur: false, hadir: true, statusMasuk: presenceDay.status as "Hadir" | "Terlambat", alasan: null };
      }
      const absent = dayRecs.find(
        (r) => r.status !== "Hadir" && r.status !== "Terlambat" && r.status !== "Libur",
      );
      if (absent) return { tanggal, libur: false, hadir: false, statusMasuk: null, alasan: absent.status as ChallengeDayReason };
      if (dayRecs.some((r) => r.status === "Libur")) {
        return { tanggal, libur: true, hadir: false, statusMasuk: null, alasan: null };
      }
      return { tanggal, libur: false, hadir: false, statusMasuk: null, alasan: "Tanpa absen" };
    });
    const wajib = days.filter((d) => !d.libur);
    const hadirWajib = wajib.filter((d) => d.hadir).length;

    // Rekap jumlah hari per status (kolom detail): hadir, terlambat, izin, dll.
    const statusCounts: ChallengeStatusCounts = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, cuti: 0, alpha: 0, libur: 0 };
    for (const d of days) {
      if (d.libur) statusCounts.libur++;
      else if (d.hadir && d.statusMasuk === "Terlambat") statusCounts.terlambat++;
      else if (d.hadir) statusCounts.hadir++;
      else if (d.alasan === "Izin") statusCounts.izin++;
      else if (d.alasan === "Sakit") statusCounts.sakit++;
      else if (d.alasan === "Cuti") statusCounts.cuti++;
      else if (d.alasan === "Alpha") statusCounts.alpha++;
    }

    const alasanGugur: string[] = [];
    for (const d of wajib) {
      if (!d.hadir && d.alasan) alasanGugur.push(`${d.alasan} pada ${idShortDay(d.tanggal)}`);
    }
    if (manual > CHALLENGE_MAX_MANUAL) {
      alasanGugur.push(`${manual} absen manual (maks ${CHALLENGE_MAX_MANUAL})`);
    }

    drafts.push({
      employee_id: eid,
      nama: empNames?.get(eid) || eid,
      divisionNama: dominant.nama || "Cp Suka",
      divisionColor: dominant.color || "#6b7280",
      hadirWajib,
      totalWajib: wajib.length,
      manual,
      avgJamMasuk,
      lolos: alasanGugur.length === 0,
      alasanGugur,
      rank: null,
      statusCounts,
      days,
    });
  }

  const lolos = drafts
    .filter((d) => d.lolos)
    .sort((a, b) =>
      compareChallengeLolos(
        { manual: a.manual, avgJam: a.avgJamMasuk, nama: a.nama },
        { manual: b.manual, avgJam: b.avgJamMasuk, nama: b.nama },
      ),
    );
  lolos.forEach((d, i) => { d.rank = i + 1; });
  const gugur = drafts.filter((d) => !d.lolos).sort((a, b) => a.nama.localeCompare(b.nama));
  week.items = [...lolos, ...gugur];
  return week;
}
