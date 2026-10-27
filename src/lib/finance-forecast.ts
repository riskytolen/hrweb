/**
 * Helper murni untuk fitur Finance → Forecast Finance.
 *
 * Semantik yang dikunci:
 * - Satu lembar per bulan; minggu 1–4 = tanggal 1–7, 8–14, 15–21, 22–akhir bulan.
 * - Saldo minggu = saldo awal + pemasukan − nominal pengeluaran − admin.
 * - Saldo awal minggu berikutnya = saldo akhir minggu sebelumnya.
 * - "Sisa" per pengeluaran = nominal rencana − pembayaran.
 * - Saldo awal boleh manual atau dari saldo akhir bulan sebelumnya
 *   (Forecast/kas aktual); nilai tersimpan tidak ditimpa otomatis.
 * - Forecast adalah rencana; tidak menyentuh transaksi aktual Finance.
 */

export type ForecastWeekNo = 1 | 2 | 3 | 4;

export interface ForecastWeek {
  weekNo: ForecastWeekNo;
  /** Tanggal Senin/awal blok minggu (YYYY-MM-DD). */
  start: string;
  /** Tanggal akhir blok minggu inklusif (YYYY-MM-DD). */
  end: string;
  /** Label ringkas, mis. "1–7 Agu 2026". */
  rangeLabel: string;
}

export const FORECAST_MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;

const FORECAST_MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
] as const;

export const FORECAST_WEEK_NO = [1, 2, 3, 4] as const;

// ─── Sumber saldo awal ───

export const FORECAST_OPENING_SOURCES = [
  "manual",
  "previous_forecast",
] as const;

export type ForecastOpeningSource = (typeof FORECAST_OPENING_SOURCES)[number];

export const FORECAST_OPENING_SOURCE_LABELS: Record<ForecastOpeningSource, string> = {
  manual: "Input manual",
  previous_forecast: "Forecast bulan sebelumnya",
};

/** Nilai lama/kosong dianggap manual agar data sebelum fitur ini tetap kompatibel. */
export function normalizeForecastOpeningSource(
  value: string | null | undefined,
): ForecastOpeningSource {
  return FORECAST_OPENING_SOURCES.includes(value as ForecastOpeningSource)
    ? (value as ForecastOpeningSource)
    : "manual";
}

export interface ForecastOpeningSourceValue {
  available: boolean;
  value: number | null;
}

export interface ForecastOpeningDefault {
  source: ForecastOpeningSource;
  value: number;
}

/**
 * Sumber awal untuk bulan yang belum pernah disimpan:
 * pakai saldo akhir Forecast sebelumnya; jika tidak tersedia, manual 0.
 * Nilai negatif (defisit) tidak dapat dipakai karena saldo awal minimum 0.
 */
export function chooseDefaultForecastOpening(args: {
  forecast: ForecastOpeningSourceValue;
}): ForecastOpeningDefault {
  if (
    args.forecast.available &&
    args.forecast.value != null &&
    args.forecast.value >= 0
  ) {
    return { source: "previous_forecast", value: args.forecast.value };
  }
  return { source: "manual", value: 0 };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parsePeriodKey(periodKey: string): { year: number; monthIndex: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) throw new Error(`Periode forecast tidak valid: ${periodKey}`);
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error(`Periode forecast tidak valid: ${periodKey}`);
  return { year, monthIndex };
}

/** "2026-08" → "2026-08-01". */
export function forecastMonthStart(periodKey: string): string {
  parsePeriodKey(periodKey);
  return `${periodKey}-01`;
}

/** Tanggal YYYY-MM-DD → period key bulan (YYYY-MM). */
export function forecastPeriodKeyFromDate(date: string): string {
  return date.slice(0, 7);
}

/** Geser period key beberapa bulan (delta negatif = mundur). */
export function shiftForecastPeriodKey(periodKey: string, delta: number): string {
  const { year, monthIndex } = parsePeriodKey(periodKey);
  const d = new Date(year, monthIndex + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** "2026-08" → "Agustus 2026". */
export function forecastMonthLabel(periodKey: string): string {
  const { year, monthIndex } = parsePeriodKey(periodKey);
  return `${FORECAST_MONTH_NAMES[monthIndex]} ${year}`;
}

/** Jumlah hari dalam bulan pada period key. */
export function daysInForecastMonth(periodKey: string): number {
  const { year, monthIndex } = parsePeriodKey(periodKey);
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Empat blok minggu standar untuk bulan pada period key. */
export function buildForecastWeeks(periodKey: string): ForecastWeek[] {
  const { year, monthIndex } = parsePeriodKey(periodKey);
  const lastDay = daysInForecastMonth(periodKey);
  const boundaries: { start: number; end: number }[] = [
    { start: 1, end: 7 },
    { start: 8, end: 14 },
    { start: 15, end: 21 },
    { start: 22, end: lastDay },
  ];
  return boundaries.map((b, i) => {
    const start = `${periodKey}-${pad2(b.start)}`;
    const end = `${periodKey}-${pad2(b.end)}`;
    return {
      weekNo: (i + 1) as ForecastWeekNo,
      start,
      end,
      rangeLabel: `${b.start}–${b.end} ${FORECAST_MONTH_SHORT[monthIndex]} ${year}`,
    };
  });
}

/** Nomor minggu (1–4) untuk sebuah tanggal; null bila bukan tanggal valid di bulan itu. */
export function weekNoForDate(date: string, weeks: ForecastWeek[]): ForecastWeekNo | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const found = weeks.find((w) => date >= w.start && date <= w.end);
  return found ? found.weekNo : null;
}

/** Masukkan tanggal ke rentang minggu; tanggal kosong/invalid → awal minggu. */
export function clampDateToWeek(date: string | null | undefined, week: ForecastWeek): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return week.start;
  if (date < week.start) return week.start;
  if (date > week.end) return week.end;
  return date;
}

/**
 * Pindahkan tanggal dari bulan sumber ke bulan tujuan dengan tanggal yang
 * sama. Tanggal 29–31 pada bulan tujuan yang lebih pendek dipotong ke hari
 * terakhir bulan tersebut.
 */
export function mapForecastDateToMonth(date: string, periodKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${periodKey}-01`;
  const day = Number(date.slice(8, 10));
  if (!Number.isFinite(day) || day < 1) return `${periodKey}-01`;
  return `${periodKey}-${pad2(Math.min(day, daysInForecastMonth(periodKey)))}`;
}

/** Kunci pembanding cepat untuk mendeteksi baris salinan yang sudah ada. */
export function forecastCopyFingerprint(
  plannedDate: string,
  description: string,
  amount: number,
): string {
  const normalizedDescription = description.trim().replace(/\s+/g, " ").toUpperCase();
  return `${plannedDate}|${normalizedDescription}|${toRupiah(amount)}`;
}

/** Ambil baris milik satu minggu, urutan input dipertahankan. */
export function rowsForWeek<T extends { week_no: number }>(rows: T[], weekNo: number): T[] {
  return rows.filter((r) => r.week_no === weekNo);
}

/** Nama file export forecast. */
export function buildForecastFilename(kind: "pdf" | "xlsx", periodKey: string): string {
  return `Forecast_Finance_${periodKey}.${kind}`;
}

// ─── Perhitungan ───

export interface ForecastIncomeLike {
  week_no: number;
  amount: number;
}

export interface ForecastExpenseLike {
  week_no: number;
  amount: number;
  payment: number;
  admin: number;
}

export interface ForecastWeekSummary {
  weekNo: ForecastWeekNo;
  opening: number;
  income: number;
  available: number;
  nominalOut: number;
  payment: number;
  sisa: number;
  admin: number;
  closing: number;
  incomeCount: number;
  expenseCount: number;
}

export interface ForecastSummary {
  weeks: ForecastWeekSummary[];
  openingBalance: number;
  totalIncome: number;
  totalAvailable: number;
  totalNominalOut: number;
  totalPayment: number;
  totalSisa: number;
  totalAdmin: number;
  /** Saldo akhir minggu terakhir. */
  closingBalance: number;
  /** Perubahan bersih kas bulan ini (pemasukan − pengeluaran − admin). */
  netChange: number;
}

function toRupiah(n: number | null | undefined): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * Hitung rekap mingguan + bulanan.
 * Saldo boleh minus bila pengeluaran melebihi dana (defisit forecast).
 */
export function computeForecast(
  openingBalance: number,
  incomes: ForecastIncomeLike[],
  expenses: ForecastExpenseLike[],
): ForecastSummary {
  const opening = toRupiah(openingBalance);
  let running = opening;
  const weeks: ForecastWeekSummary[] = [];
  let totalIncome = 0;
  let totalNominalOut = 0;
  let totalPayment = 0;
  let totalAdmin = 0;

  for (const weekNo of FORECAST_WEEK_NO) {
    const weekIncomes = incomes.filter((r) => r.week_no === weekNo);
    const weekExpenses = expenses.filter((r) => r.week_no === weekNo);
    const income = weekIncomes.reduce((s, r) => s + toRupiah(r.amount), 0);
    const nominalOut = weekExpenses.reduce((s, r) => s + toRupiah(r.amount), 0);
    const payment = weekExpenses.reduce((s, r) => s + toRupiah(r.payment), 0);
    const admin = weekExpenses.reduce((s, r) => s + toRupiah(r.admin), 0);
    const scheduledOut = Math.max(0, nominalOut - payment);
    const available = running + income;
    const closing = available - nominalOut - admin;

    weeks.push({
      weekNo,
      opening: running,
      income,
      available,
      nominalOut,
      payment,
      sisa: scheduledOut,
      admin,
      closing,
      incomeCount: weekIncomes.length,
      expenseCount: weekExpenses.length,
    });

    totalIncome += income;
    totalNominalOut += nominalOut;
    totalPayment += payment;
    totalAdmin += admin;
    running = closing;
  }

  return {
    weeks,
    openingBalance: opening,
    totalIncome,
    totalAvailable: opening + totalIncome,
    totalNominalOut,
    totalPayment,
    totalSisa: Math.max(0, totalNominalOut - totalPayment),
    totalAdmin,
    closingBalance: running,
    netChange: totalIncome - totalNominalOut - totalAdmin,
  };
}

export interface SavedForecastMonthLike {
  opening_balance: number;
  incomes: ForecastIncomeLike[];
  expenses: ForecastExpenseLike[];
}

/** Saldo akhir Forecast bulan yang sudah tersimpan (dipakai sebagai sumber bulan berikutnya). */
export function savedForecastClosing(month: SavedForecastMonthLike): number {
  return computeForecast(month.opening_balance, month.incomes, month.expenses).closingBalance;
}

// ─── Kategori pengeluaran ───

/**
 * Daftar kategori rekap pengeluaran, mengikuti susunan laporan PDF
 * "Data Keluar Masuk Keuangan". Disimpan sebagai teks per baris agar
 * laporan bulanan tidak menebak kategori dari keterangan.
 */
export const FORECAST_EXPENSE_CATEGORIES = [
  "BBM & E-MONEY",
  "MAINTENANCE & PURCHASE",
  "BPJS KESEHATAN",
  "PPN KELUARAN",
  "BPJS KETENAGAKERJAAN",
  "GAJI KARYAWAN",
  "MC EASY TMS",
  "MC EASY APLIKASI",
  "MC EASY LAINNYA",
  "SEWA MOBIL",
  "PENGELUARAN LAINNYA",
  "BOP KIKI",
  "TABUNGAN PERUSAHAAN",
  "ANGSURAN",
] as const;

export type ForecastExpenseCategory = string;

export const DEFAULT_FORECAST_EXPENSE_CATEGORY = "PENGELUARAN LAINNYA";

/** Kategori valid (case-insensitive); nilai kosong/asing → PENGELUARAN LAINNYA. */
export function normalizeForecastExpenseCategory(
  value: string | null | undefined,
  categories: readonly string[] = FORECAST_EXPENSE_CATEGORIES,
): ForecastExpenseCategory {
  const normalized = (value ?? "").trim().toUpperCase();
  const allowed = new Set(categories.map((category) => category.trim().toUpperCase()));
  return allowed.has(normalized) ? normalized : DEFAULT_FORECAST_EXPENSE_CATEGORY;
}

export interface ForecastExpenseCategoryTotal {
  category: ForecastExpenseCategory;
  amount: number;
}

/**
 * Total nominal pengeluaran per kategori. Daftar kategori mengikuti master
 * dinamis (termasuk yang bernilai 0) dan tetap menyertakan kategori default.
 */
export function computeForecastExpenseCategoryTotals(
  expenses: { category?: string | null; amount: number }[],
  categories: readonly string[] = FORECAST_EXPENSE_CATEGORIES,
): ForecastExpenseCategoryTotal[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const value of [...categories, DEFAULT_FORECAST_EXPENSE_CATEGORY]) {
    const category = value.trim().toUpperCase();
    if (!category || seen.has(category)) continue;
    seen.add(category);
    ordered.push(category);
  }

  const totals = new Map<string, number>(ordered.map((category) => [category, 0]));
  for (const row of expenses) {
    const category = normalizeForecastExpenseCategory(row.category, ordered);
    totals.set(category, (totals.get(category) ?? 0) + toRupiah(row.amount));
  }
  return ordered.map((category) => ({
    category,
    amount: totals.get(category) ?? 0,
  }));
}

/**
 * Ganti nama kategori di dalam snapshot draft Forecast tanpa menyentuh
 * perubahan lain. Dipakai saat master kategori di-rename agar status
 * "belum disimpan" tidak berubah hanya karena rename.
 */
export function renameForecastSnapshotCategory(
  snapshot: string,
  previousName: string,
  nextName: string,
): string {
  if (!snapshot || !previousName || previousName === nextName) return snapshot;
  try {
    const parsed = JSON.parse(snapshot) as {
      expenses?: ({ category?: string } | null)[];
    };
    if (!Array.isArray(parsed.expenses)) return snapshot;
    const previous = previousName.trim().toUpperCase();
    let changed = false;
    parsed.expenses = parsed.expenses.map((expense) => {
      if (
        !expense ||
        typeof expense.category !== "string" ||
        expense.category.trim().toUpperCase() !== previous
      ) {
        return expense;
      }
      changed = true;
      return { ...expense, category: nextName };
    });
    return changed ? JSON.stringify(parsed) : snapshot;
  } catch {
    return snapshot;
  }
}

// ─── Validasi draft ───

export interface ForecastIncomeDraft extends ForecastIncomeLike {
  description: string;
  planned_date: string;
  invoice_id?: number | null;
}

export interface ForecastExpenseDraft extends ForecastExpenseLike {
  description: string;
  planned_date: string;
  category?: string | null;
}

export interface ForecastDraftInput {
  periodKey: string;
  openingBalance: number;
  incomes: ForecastIncomeDraft[];
  expenses: ForecastExpenseDraft[];
}

/**
 * Validasi seluruh draft sebelum disimpan. Mengembalikan daftar pesan error
 * (kosong = valid). Pesan memakai nomor baris agar mudah ditelusuri.
 */
export function validateForecastDraft(input: ForecastDraftInput): string[] {
  const errors: string[] = [];
  if (toRupiah(input.openingBalance) < 0) {
    errors.push("Saldo awal bulan tidak boleh negatif.");
  }

  const weeks = buildForecastWeeks(input.periodKey);
  const weekByNo = new Map(weeks.map((w) => [w.weekNo, w]));

  input.incomes.forEach((row, i) => {
    const label = `Pemasukan baris ${i + 1}`;
    if (!row.description.trim()) errors.push(`${label}: keterangan wajib diisi.`);
    if (toRupiah(row.amount) <= 0) errors.push(`${label}: nominal harus lebih dari 0.`);
    const week = weekByNo.get(row.week_no as ForecastWeekNo);
    if (!week) {
      errors.push(`${label}: minggu tidak valid.`);
    } else if (row.planned_date < week.start || row.planned_date > week.end) {
      errors.push(`${label}: tanggal harus di dalam rentang minggu ${week.weekNo}.`);
    }
  });

  input.expenses.forEach((row, i) => {
    const label = `Pengeluaran baris ${i + 1}`;
    if (!row.description.trim()) errors.push(`${label}: keterangan wajib diisi.`);
    if (toRupiah(row.amount) <= 0) errors.push(`${label}: nominal harus lebih dari 0.`);
    if (toRupiah(row.payment) < 0) errors.push(`${label}: pembayaran tidak boleh negatif.`);
    if (toRupiah(row.admin) < 0) errors.push(`${label}: admin tidak boleh negatif.`);
    if (toRupiah(row.payment) > toRupiah(row.amount)) {
      errors.push(`${label}: pembayaran tidak boleh melebihi nominal.`);
    }
    const week = weekByNo.get(row.week_no as ForecastWeekNo);
    if (!week) {
      errors.push(`${label}: minggu tidak valid.`);
    } else if (row.planned_date < week.start || row.planned_date > week.end) {
      errors.push(`${label}: tanggal harus di dalam rentang minggu ${week.weekNo}.`);
    }
  });

  const seenInvoices = new Set<number>();
  input.incomes.forEach((row) => {
    if (row.invoice_id == null) return;
    if (seenInvoices.has(row.invoice_id)) {
      if (!errors.some((e) => e.includes("Invoice yang sama"))) {
        errors.push("Invoice yang sama dipakai lebih dari sekali dalam satu bulan.");
      }
    }
    seenInvoices.add(row.invoice_id);
  });

  return errors;
}
