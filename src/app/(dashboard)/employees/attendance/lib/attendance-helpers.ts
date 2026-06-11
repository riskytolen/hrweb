import { MIN_DATE, SUMMARY_CUT_OFF_DAY } from "./attendance-constants";
import type { NonActivePeriod } from "@/lib/supabase";

export type PenaltyLite = {
  division_id: number;
  denda_per_menit: number;
  batas_menit: number;
  denda_maksimum: number;
  denda_alpha: number;
};

export type LatenessResult = { status: "Hadir" | "Terlambat"; durasi: number };

export type SummaryPeriod = { start: string; end: string; label: string };

export type EmployeeActivityLite = {
  status: string;
  tanggal_bergabung: string | null;
  tanggal_keluar: string | null;
  non_active_periods?: NonActivePeriod[] | null;
};

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
 * Check whether `date` (YYYY-MM-DD) falls within ANY of the supplied historical
 * non-active periods (inclusive on both bounds). Used by auto-gen to skip generating
 * attendance records for dates when the employee was not active.
 */
export function isInNonActivePeriod(
  date: string,
  periods: NonActivePeriod[] | null | undefined,
): boolean {
  if (!periods || periods.length === 0) return false;
  for (const p of periods) {
    if (date >= p.from && date <= p.to) return true;
  }
  return false;
}

export function isEmployeeActiveOnDate(date: string, employee: EmployeeActivityLite): boolean {
  if (employee.status === "Tidak Aktif" && !employee.tanggal_keluar) return false;
  if (employee.tanggal_bergabung && date < employee.tanggal_bergabung) return false;
  if (employee.tanggal_keluar && date >= employee.tanggal_keluar) return false;
  if (isInNonActivePeriod(date, employee.non_active_periods)) return false;
  return true;
}

export function isEmployeeActiveInPeriod(period: { start: string; end: string }, employee: EmployeeActivityLite): boolean {
  if (!period.start || !period.end) return false;
  return getDateRange(period.start, period.end).some((date) => isEmployeeActiveOnDate(date, employee));
}
