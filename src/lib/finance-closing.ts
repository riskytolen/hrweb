/**
 * Helper closing bulanan Finance (tutup buku).
 *
 * Aturan yang dikunci (sama dengan migration
 * `20261013000000_finance_monthly_closing.sql`):
 * - Pendapatan = SUM(finance_invoices.total_amount) berdasar invoice_date.
 * - Pengeluaran mengurangi kas pada expense_date (termasuk Kredit).
 * - Laba On Hand = pembayaran berdasar payment_date − pengeluaran periode.
 * - Saldo awal = max(0, saldo akhir bulan sebelumnya); defisit dicatat
 *   sebagai reset pembukaan, bukan pendapatan/laba.
 * - Piutang akhir = invoice s.d. akhir periode − pembayaran s.d. akhir
 *   periode, dihitung per invoice dan tidak negatif per baris.
 * - Snapshot bersifat immutable dan dibaca untuk bulan closed.
 */

export const FINANCE_CLOSE_VERSION = "finance-close-v1";
export const FINANCE_BOOKS_START_MONTH = "2026-09-01";
export const FINANCE_TIMEZONE = "Asia/Jakarta";

export type MonthCloseState = "open" | "closed" | "reopened";

export interface ClosingInvoiceInput {
  id: number;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number;
  subtotal?: number | null;
  ppn_amount?: number | null;
  pph_amount?: number | null;
  clientName?: string | null;
}

export interface ClosingPaymentInput {
  invoice_id: number;
  payment_date: string;
  amount: number;
}

export interface ClosingExpenseInput {
  expense_date: string;
  amount: number;
}

export interface ClosingAdjustmentInput {
  adjustment_date: string;
  type: "Masuk" | "Keluar";
  amount: number;
}

export interface ClosingReceivableItem {
  invoice_id: number;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  clientName: string;
  total: number;
  paid: number;
  remaining: number;
  status: "Lunas" | "Sebagian" | "Belum Lunas";
  overdueDays: number;
}

export interface ClosingTotals {
  period_start: string;
  period_end: string;
  opening_prev_balance: number | null;
  deficit_reset: number;
  opening_cash_balance: number;
  revenue_total: number;
  revenue_subtotal: number;
  ppn_amount: number;
  pph_amount: number;
  expense_total: number;
  net_profit: number;
  cash_in: number;
  cash_on_hand_profit: number;
  adjustment_in: number;
  adjustment_out: number;
  ending_cash_balance: number;
  opening_receivable: number;
  new_invoices_total: number;
  period_payments_total: number;
  closing_receivable: number;
  invoice_count: number;
  payment_count: number;
  expense_count: number;
  adjustment_count: number;
  receivables: ClosingReceivableItem[];
}

export interface DbFinanceMonthEvent {
  id: number;
  period_start: string;
  period_end: string;
  event_seq: number;
  event_type: "close" | "reopen";
  calculation_version: string;
  opening_prev_balance: number | null;
  deficit_reset: number | null;
  opening_cash_balance: number | null;
  cash_in: number | null;
  cash_out_expenses: number | null;
  adjustment_in: number | null;
  adjustment_out: number | null;
  ending_cash_balance: number | null;
  revenue_total: number | null;
  revenue_subtotal: number | null;
  ppn_amount: number | null;
  pph_amount: number | null;
  expense_total: number | null;
  net_profit: number | null;
  cash_on_hand_profit: number | null;
  opening_receivable: number | null;
  new_invoices_total: number | null;
  period_payments_total: number | null;
  closing_receivable: number | null;
  invoice_count: number | null;
  payment_count: number | null;
  expense_count: number | null;
  adjustment_count: number | null;
  snapshot_data: Record<string, unknown> | null;
  source_hash: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  reason: string | null;
  created_at: string;
}

export interface DbFinanceMonthStatus {
  period_start: string;
  period_end: string;
  latest_event_id: number;
  latest_seq: number;
  state: "close" | "reopen";
  calculation_version: string | null;
  opening_cash_balance: number | null;
  cash_in: number | null;
  cash_out_expenses: number | null;
  adjustment_in: number | null;
  adjustment_out: number | null;
  ending_cash_balance: number | null;
  revenue_total: number | null;
  expense_total: number | null;
  net_profit: number | null;
  cash_on_hand_profit: number | null;
  opening_receivable: number | null;
  closing_receivable: number | null;
  invoice_count: number | null;
  payment_count: number | null;
  expense_count: number | null;
  adjustment_count: number | null;
  source_hash: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  reason: string | null;
  created_at: string;
}

/** "2026-09-15" -> "2026-09-01" */
export function monthStartOf(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

/** "2026-09-01" -> "2026-09-30" (memakai kalender lokal). */
export function monthEndOf(periodStart: string): string {
  const [y, m] = periodStart.slice(0, 7).split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${periodStart.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** "2026-09-01" -> "2026-10-01" */
export function nextMonthStart(periodStart: string): string {
  const [y, m] = periodStart.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** "2026-10-01" -> "2026-09-01" */
export function prevMonthStart(periodStart: string): string {
  const [y, m] = periodStart.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** True bila period_start adalah tanggal 1 awal bulan yang valid. */
export function isValidPeriodStart(periodStart: string): boolean {
  if (!/^\d{4}-\d{2}-01$/.test(periodStart)) return false;
  return monthStartOf(periodStart) === periodStart;
}

/**
 * Bulan boleh ditutup bila hari ini (YYYY-MM-DD) sudah melewati akhir bulan.
 * Perbandingan string aman karena format YYYY-MM-DD.
 */
export function isMonthEnded(periodStart: string, today: string): boolean {
  return today > monthEndOf(periodStart);
}

/** "2026-09-01" -> "2026-09" */
export function periodKey(periodStart: string): string {
  return periodStart.slice(0, 7);
}

export function receivableStatus(total: number, paid: number): ClosingReceivableItem["status"] {
  if (paid >= total && total > 0) return "Lunas";
  if (paid > 0) return "Sebagian";
  return "Belum Lunas";
}

export function overdueDaysAsOf(dueDate: string | null, referenceDate: string): number {
  if (!dueDate) return 0;
  const ref = new Date(`${referenceDate}T00:00:00`).getTime();
  const due = new Date(`${dueDate}T00:00:00`).getTime();
  if (Number.isNaN(ref) || Number.isNaN(due)) return 0;
  return Math.max(0, Math.floor((ref - due) / 86400000));
}

/**
 * Hitung preview closing murni dari data live. Rumus identik dengan RPC
 * `close_finance_month` agar preview September/Oktober dapat direkonsiliasi.
 */
export function computeClosingPreview(args: {
  periodStart: string;
  invoices: ClosingInvoiceInput[];
  payments: ClosingPaymentInput[];
  expenses: ClosingExpenseInput[];
  adjustments: ClosingAdjustmentInput[];
  /** Saldo akhir closing bulan sebelumnya; null untuk bulan pertama. */
  openingPrevBalance: number | null;
  /** Saldo dasar pengaturan; dipakai hanya untuk bulan pertama. */
  initialCashBalance: number;
}): ClosingTotals {
  const periodStart = monthStartOf(args.periodStart);
  const periodEnd = monthEndOf(periodStart);

  const periodInvoices = args.invoices.filter(
    (i) => i.invoice_date >= periodStart && i.invoice_date <= periodEnd,
  );
  const periodPayments = args.payments.filter(
    (p) => p.payment_date >= periodStart && p.payment_date <= periodEnd,
  );
  const periodExpenses = args.expenses.filter(
    (e) => e.expense_date >= periodStart && e.expense_date <= periodEnd,
  );
  const periodAdjustments = args.adjustments.filter(
    (a) => a.adjustment_date >= periodStart && a.adjustment_date <= periodEnd,
  );

  const revenue_total = periodInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);
  const revenue_subtotal = periodInvoices.reduce((s, i) => s + (i.subtotal ?? i.total_amount ?? 0), 0);
  const ppn_amount = periodInvoices.reduce((s, i) => s + (i.ppn_amount ?? 0), 0);
  const pph_amount = periodInvoices.reduce((s, i) => s + (i.pph_amount ?? 0), 0);
  const expense_total = periodExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const cash_in = periodPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const adjustment_in = periodAdjustments
    .filter((a) => a.type === "Masuk")
    .reduce((s, a) => s + (a.amount || 0), 0);
  const adjustment_out = periodAdjustments
    .filter((a) => a.type === "Keluar")
    .reduce((s, a) => s + (a.amount || 0), 0);

  const isFirstMonth = args.openingPrevBalance === null || args.openingPrevBalance === undefined;
  const opening_prev_balance = isFirstMonth ? null : args.openingPrevBalance;
  const deficit_reset = !isFirstMonth && (opening_prev_balance ?? 0) < 0 ? -(opening_prev_balance ?? 0) : 0;
  const opening_cash_balance = isFirstMonth
    ? args.initialCashBalance || 0
    : Math.max(0, opening_prev_balance ?? 0);

  const net_profit = revenue_total - expense_total;
  const cash_on_hand_profit = cash_in - expense_total;
  const ending_cash_balance =
    opening_cash_balance + cash_in + adjustment_in - expense_total - adjustment_out;

  // Piutang per invoice: invoice s.d. akhir periode, bayar s.d. akhir periode.
  const paidThroughEnd = new Map<number, number>();
  for (const p of args.payments) {
    if (p.payment_date > periodEnd) continue;
    paidThroughEnd.set(p.invoice_id, (paidThroughEnd.get(p.invoice_id) ?? 0) + (p.amount || 0));
  }
  const paidBeforeStart = new Map<number, number>();
  for (const p of args.payments) {
    if (p.payment_date >= periodStart) continue;
    paidBeforeStart.set(p.invoice_id, (paidBeforeStart.get(p.invoice_id) ?? 0) + (p.amount || 0));
  }

  let opening_receivable = 0;
  let closing_receivable = 0;
  const receivables: ClosingReceivableItem[] = [];
  for (const inv of args.invoices) {
    if (inv.invoice_date > periodEnd) continue;
    const total = inv.total_amount || 0;
    const paidEnd = paidThroughEnd.get(inv.id) ?? 0;
    const remainingEnd = Math.max(0, total - paidEnd);
    closing_receivable += remainingEnd;
    if (inv.invoice_date < periodStart) {
      const paidStart = paidBeforeStart.get(inv.id) ?? 0;
      opening_receivable += Math.max(0, total - paidStart);
    }
    if (remainingEnd > 0) {
      receivables.push({
        invoice_id: inv.id,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        clientName: inv.clientName || "—",
        total,
        paid: paidEnd,
        remaining: remainingEnd,
        status: receivableStatus(total, paidEnd),
        overdueDays: overdueDaysAsOf(inv.due_date, periodEnd),
      });
    }
  }
  receivables.sort((a, b) => b.overdueDays - a.overdueDays || b.remaining - a.remaining);

  return {
    period_start: periodStart,
    period_end: periodEnd,
    opening_prev_balance,
    deficit_reset,
    opening_cash_balance,
    revenue_total,
    revenue_subtotal,
    ppn_amount,
    pph_amount,
    expense_total,
    net_profit,
    cash_in,
    cash_on_hand_profit,
    adjustment_in,
    adjustment_out,
    ending_cash_balance,
    opening_receivable,
    new_invoices_total: revenue_total,
    period_payments_total: cash_in,
    closing_receivable,
    invoice_count: periodInvoices.length,
    payment_count: periodPayments.length,
    expense_count: periodExpenses.length,
    adjustment_count: periodAdjustments.length,
    receivables,
  };
}

/** Status tampilan suatu bulan dari daftar status DB. */
export function monthCloseState(
  periodStart: string,
  statuses: Pick<DbFinanceMonthStatus, "period_start" | "state">[],
): MonthCloseState {
  const row = statuses.find((s) => s.period_start === monthStartOf(periodStart));
  if (!row) return "open";
  return row.state === "close" ? "closed" : "reopened";
}

/** Ambil event close aktif (terbaru) untuk suatu bulan. */
export function latestCloseEvent(
  periodStart: string,
  events: DbFinanceMonthEvent[],
): DbFinanceMonthEvent | null {
  const key = monthStartOf(periodStart);
  const rows = events
    .filter((e) => e.period_start === key && e.event_type === "close")
    .sort((a, b) => b.event_seq - a.event_seq);
  return rows[0] ?? null;
}

const DB_ERROR_MESSAGES: [RegExp, string][] = [
  [/FINANCE_PERIOD_CLOSED:(\S+)/, "Periode $1 sudah ditutup. Transaksi bertanggal periode tersebut dikunci."],
  [/FINANCE_BEFORE_BOOKS_START:(\S+)/, "Tanggal $1 sebelum bulan awal pembukuan (Sep 2026)."],
  [/FINANCE_PAYMENT_OVERPAID/, "Pembayaran melebihi sisa tagihan invoice."],
  [/FINANCE_PAYMENT_AMOUNT/, "Nominal pembayaran harus lebih dari nol."],
  [/FINANCE_PAYMENT_BEFORE_INVOICE/, "Tanggal pembayaran tidak boleh sebelum tanggal invoice."],
  [/FINANCE_SETTINGS_LOCKED/, "Saldo awal / bulan awal pembukuan terkunci setelah closing pertama."],
  [/FINANCE_SEQUENCE/, "Urutan closing tidak valid. Closing harus berurutan tanpa melewati bulan."],
  [/FINANCE_PERIOD_NOT_ENDED/, "Bulan berjalan belum berakhir sehingga belum dapat ditutup."],
  [/FINANCE_REOPEN_LATEST_ONLY/, "Hanya bulan closed paling akhir yang boleh dibuka kembali."],
  [/FINANCE_NOT_CLOSED/, "Bulan tersebut tidak dalam status closed."],
  [/FINANCE_REASON_REQUIRED/, "Alasan reopen wajib diisi."],
  [/FINANCE_FORBIDDEN/, "Akses ditolak. Periksa hak Finance / Super Admin."],
  [/FINANCE_CLOSE_IMMUTABLE/, "Snapshot closing tidak dapat diubah atau dihapus."],
];

/** Terjemahkan error Postgres/RPC menjadi pesan Indonesia yang stabil. */
export function parseFinanceDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  for (const [re, template] of DB_ERROR_MESSAGES) {
    const m = msg.match(re);
    if (m) {
      return template.replace("$1", m[1] ?? "");
    }
  }
  return msg || "Operasi finance gagal.";
}

export interface SupabaseRpcClient {
  rpc(
    fn: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args?: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ data: any; error: { message: string } | null }>;
  from(
    table: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any;
}

/** Ambil status seluruh bulan (terbaru per periode). */
export async function fetchMonthStatuses(
  supabase: SupabaseRpcClient,
): Promise<DbFinanceMonthStatus[]> {
  const res = await supabase.from("finance_month_status").select("*").order("period_start", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as DbFinanceMonthStatus[];
}

/** Ambil histori event closing (append-only). */
export async function fetchMonthEvents(
  supabase: SupabaseRpcClient,
): Promise<DbFinanceMonthEvent[]> {
  const res = await supabase
    .from("finance_month_events")
    .select("*")
    .order("period_start", { ascending: true })
    .order("event_seq", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as DbFinanceMonthEvent[];
}

export async function closeMonthRpc(
  supabase: SupabaseRpcClient,
  periodStart: string,
): Promise<DbFinanceMonthEvent> {
  const { data, error } = await supabase.rpc("close_finance_month", {
    p_period_start: monthStartOf(periodStart),
  });
  if (error) throw new Error(error.message);
  return data as DbFinanceMonthEvent;
}

export async function reopenMonthRpc(
  supabase: SupabaseRpcClient,
  periodStart: string,
  reason: string,
): Promise<DbFinanceMonthEvent> {
  const { data, error } = await supabase.rpc("reopen_finance_month", {
    p_period_start: monthStartOf(periodStart),
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as DbFinanceMonthEvent;
}
