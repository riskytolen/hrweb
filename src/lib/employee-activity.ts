import type { NonActivePeriod } from "@/lib/supabase";

/**
 * Kontrak tunggal aktivitas pegawai.
 *
 * - `tanggal_bergabung` = hari pertama aktif (inklusif, dihitung).
 * - `tanggal_keluar` = hari pertama TIDAK aktif (eksklusif, tidak dihitung).
 *   Dinamai "Tanggal Mulai Tidak Aktif" di UI.
 * - `non_active_periods` = rentang historis inklusif [from, to] dari siklus
 *   nonaktif/rehire sebelumnya. Periode nonaktif berjalan TIDAK disimpan di
 *   sini, melainkan di `tanggal_keluar`.
 */

export type EmployeeActivity = {
  tanggal_bergabung: string | null | undefined;
  tanggal_keluar: string | null | undefined;
  non_active_periods?: NonActivePeriod[] | null | undefined;
  status?: string | null | undefined;
};

export const GAPOK_PRORATA_DIVISOR = 30;

export function isValidDateStr(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isInNonActivePeriod(
  date: string,
  periods: NonActivePeriod[] | null | undefined,
): boolean {
  if (!periods || periods.length === 0) return false;
  for (const p of periods) {
    if (!p?.from || !p?.to) continue;
    if (date >= p.from && date <= p.to) return true;
  }
  return false;
}

/** True jika pegawai aktif pada tanggal YYYY-MM-DD tertentu. */
export function isEmployeeActiveOnDate(date: string, emp: EmployeeActivity): boolean {
  if (!isValidDateStr(date)) return false;
  // Pegawai Tanpa tanggal keluar tetapi status Tidak Aktif dianggap tidak aktif
  // di semua tanggal (data belum lengkap, harus dilengkapi tanggalnya).
  if (emp.status === "Tidak Aktif" && !emp.tanggal_keluar) return false;
  if (emp.tanggal_bergabung && date < emp.tanggal_bergabung) return false;
  if (emp.tanggal_keluar && date >= emp.tanggal_keluar) return false;
  if (isInNonActivePeriod(date, emp.non_active_periods)) return false;
  return true;
}

/** Daftar tanggal YYYY-MM-DD inklusif dari start s/d end (UTC math, aman timezone). */
export function listDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  if (!isValidDateStr(start) || !isValidDateStr(end) || end < start) return dates;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
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

export function countDaysInRange(start: string, end: string): number {
  return listDatesInRange(start, end).length;
}

/** True jika pegawai punya minimal 1 hari aktif dalam rentang. */
export function hasActiveDayInPeriod(
  emp: EmployeeActivity,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (!periodStart || !periodEnd || periodEnd < periodStart) return false;
  // Fast path tanpa enumerasi untuk kasus umum.
  if (emp.tanggal_bergabung && emp.tanggal_bergabung > periodEnd) return false;
  if (emp.tanggal_keluar && emp.tanggal_keluar <= periodStart) return false;
  if (emp.status === "Tidak Aktif" && !emp.tanggal_keluar) {
    // Tanpa tanggal keluar, keaktifan tidak dapat ditentukan dari tanggal.
    // Caller (payroll) memperlakukannya sebagai butuh perbaikan data;
    // helper lain menganggapnya tidak aktif agar tidak ter-generate otomatis.
    return false;
  }
  // Jika tidak ada riwayat nonaktif, fast path di atas sudah cukup.
  if (!emp.non_active_periods || emp.non_active_periods.length === 0) return true;
  return listDatesInRange(periodStart, periodEnd).some((d) => isEmployeeActiveOnDate(d, emp));
}

/** Jumlah hari kalender aktif pegawai dalam rentang inklusif. */
export function countActiveDaysInPeriod(
  emp: EmployeeActivity,
  periodStart: string,
  periodEnd: string,
): number {
  let count = 0;
  for (const d of listDatesInRange(periodStart, periodEnd)) {
    if (isEmployeeActiveOnDate(d, emp)) count += 1;
  }
  return count;
}

export type GapokProrataResult = {
  /** Nominal bulanan penuh yang menjadi dasar (gapok master / efektif periode). */
  monthly: number;
  /** Hari kalender aktif dalam periode. */
  activeDays: number;
  /** Total hari kalender dalam periode. */
  totalDays: number;
  /** Pembagi prorata (selalu 30). */
  divisor: number;
  /** Nominal gapok untuk periode ini (hasil prorata / penuh). */
  amount: number;
  /** True jika prorata diterapkan (aktif sebagian periode). */
  isProrata: boolean;
};

/**
 * Aturan prorata yang disepakati:
 * - Aktif sepanjang periode (activeDays >= totalDays) => gapok penuh,
 *   berlaku juga untuk periode 28/29/31 hari.
 * - Aktif sebagian => round(monthly / 30 * min(activeDays, 30)).
 * - Tidak ada hari aktif => 0.
 */
export function computeGapokProrata(
  monthlyGapok: number,
  activeDays: number,
  totalDays: number,
  divisor: number = GAPOK_PRORATA_DIVISOR,
): GapokProrataResult {
  const monthly = Math.max(0, Math.trunc(Number(monthlyGapok) || 0));
  const total = Math.max(0, Math.trunc(Number(totalDays) || 0));
  const active = Math.max(0, Math.trunc(Number(activeDays) || 0));
  if (total <= 0 || active <= 0 || monthly <= 0) {
    return { monthly, activeDays: active, totalDays: total, divisor, amount: 0, isProrata: total > 0 && active < total };
  }
  if (active >= total) {
    return { monthly, activeDays: active, totalDays: total, divisor, amount: monthly, isProrata: false };
  }
  const cappedDays = Math.min(active, divisor);
  const amount = Math.round((monthly / divisor) * cappedDays);
  return {
    monthly,
    activeDays: active,
    totalDays: total,
    divisor,
    amount: Math.min(amount, monthly),
    isProrata: true,
  };
}

/** Rincian prorata untuk disimpan di kolom audit (bukan `catatan` manual). */
export function formatGapokProrataDetail(result: GapokProrataResult): string {
  if (!result.isProrata) return `Penuh ${result.activeDays}/${result.totalDays} hari`;
  return `Prorata: ${result.monthly} / ${result.divisor} × ${Math.min(result.activeDays, result.divisor)} hari`;
}

/**
 * Bentuk periode nonaktif saat rehire.
 * `exitDate` = tanggal mulai tidak aktif (inklusif).
 * `rejoinDate` = tanggal aktif kembali (inklusif, dihitung aktif).
 * Hasil: [exitDate, rejoinDate - 1 hari], inklusif kedua sisi.
 */
export function buildNonActivePeriod(exitDate: string, rejoinDate: string): NonActivePeriod | null {
  if (!isValidDateStr(exitDate) || !isValidDateStr(rejoinDate)) return null;
  const prev = addDaysLocal(rejoinDate, -1);
  if (exitDate > prev) return null;
  return { from: exitDate, to: prev };
}

/** Geser tanggal YYYY-MM-DD sebanyak `days` hari (local calendar, aman DST). */
export function addDaysLocal(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
