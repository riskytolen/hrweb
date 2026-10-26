/**
 * Shared helpers for the Finance module.
 */

export type InvoiceStatus = "Lunas" | "Sebagian" | "Belum Lunas";

export interface InvoiceWithPaid {
  total_amount: number;
}

/** Total pembayaran yang sudah masuk untuk invoice. */
export function totalPaid(payments: { amount: number }[]): number {
  return payments.reduce((sum, p) => sum + (p.amount || 0), 0);
}

/** Status invoice dihitung dari total pembayaran (tidak disimpan di DB). */
export function invoiceStatus(total: number, paid: number): InvoiceStatus {
  if (paid >= total && total > 0) return "Lunas";
  if (paid > 0) return "Sebagian";
  return "Belum Lunas";
}

export function statusColor(status: InvoiceStatus): string {
  switch (status) {
    case "Lunas":
      return "bg-success-light text-success";
    case "Sebagian":
      return "bg-warning-light text-warning";
    default:
      return "bg-danger-light text-danger";
  }
}

/** Generate nomor invoice: INV-YYYYMM-XXX */
export function generateInvoiceNo(dateStr: string, lastNumber: number): string {
  const yyyymm = dateStr.slice(0, 7).replace("-", "");
  const seq = String(lastNumber + 1).padStart(3, "0");
  return `INV-${yyyymm}-${seq}`;
}

/** Hitung PPN dari subtotal dan persen. */
export function computePpn(subtotal: number, ppnPercent: number): number {
  return Math.round((subtotal * ppnPercent) / 100);
}

/** Skema perhitungan pajak invoice. */
export type InvoiceTaxScheme = "trip_only" | "all_components";

export const INVOICE_TAX_SCHEMES: { value: InvoiceTaxScheme; label: string; hint: string }[] = [
  {
    value: "trip_only",
    label: "Biaya Perjalanan Saja",
    hint: "PPN & PPh dihitung dari Biaya Perjalanan",
  },
  {
    value: "all_components",
    label: "Seluruh Komponen Biaya",
    hint: "PPN & PPh dihitung dari Perjalanan + Toll + Parkir + Biaya Lain",
  },
];

export function invoiceTaxSchemeLabel(scheme: string | null | undefined): string {
  return (
    INVOICE_TAX_SCHEMES.find((s) => s.value === scheme)?.label ?? INVOICE_TAX_SCHEMES[0].label
  );
}

/** Default tarif pajak invoice baru. */
export const DEFAULT_PPN_PERCENT = 1.1;
export const DEFAULT_PPH_PERCENT = 2;

export interface InvoiceCostInput {
  trip_amount?: number | null;
  toll_amount?: number | null;
  parking_amount?: number | null;
  other_amount?: number | null;
  tax_scheme?: InvoiceTaxScheme | string | null;
  ppn_percent?: number | null;
  pph_percent?: number | null;
}

export interface InvoiceTotals {
  trip_amount: number;
  toll_amount: number;
  parking_amount: number;
  other_amount: number;
  /** Total biaya sebelum pajak (= subtotal, dipertahankan untuk kompatibilitas laporan). */
  base_amount: number;
  tax_scheme: InvoiceTaxScheme;
  tax_base_amount: number;
  ppn_percent: number;
  ppn_amount: number;
  pph_percent: number;
  pph_amount: number;
  /** Total tagihan = total biaya + PPN − PPh. */
  total_amount: number;
}

function toNonNegative(n: number | null | undefined): number {
  if (!Number.isFinite(n as number)) return 0;
  return Math.max(0, Math.round(n as number));
}

/**
 * Satu-satunya sumber rumus total invoice — dipakai form, save, dan export
 * agar konsisten dengan trigger DB `finance_invoice_recalc_totals()`.
 *
 * - Total Biaya = Perjalanan + Toll + Parkir + Biaya Lain
 * - Dasar Pajak = Perjalanan saja (trip_only) atau Total Biaya (all_components)
 * - PPN 1,1% menambah tagihan, PPh 2% mengurangi tagihan
 * - Total Tagihan = Total Biaya + PPN − PPh
 */
export function calculateInvoiceTotals(input: InvoiceCostInput): InvoiceTotals {
  const trip_amount = toNonNegative(input.trip_amount);
  const toll_amount = toNonNegative(input.toll_amount);
  const parking_amount = toNonNegative(input.parking_amount);
  const other_amount = toNonNegative(input.other_amount);
  const tax_scheme: InvoiceTaxScheme =
    input.tax_scheme === "all_components" ? "all_components" : "trip_only";
  const ppn_percent = Number(input.ppn_percent) || 0;
  const pph_percent = Number(input.pph_percent) || 0;

  const base_amount = trip_amount + toll_amount + parking_amount + other_amount;
  const tax_base_amount = tax_scheme === "all_components" ? base_amount : trip_amount;
  const ppn_amount = tax_base_amount > 0 && ppn_percent > 0 ? computePpn(tax_base_amount, ppn_percent) : 0;
  const pph_amount = tax_base_amount > 0 && pph_percent > 0 ? computePpn(tax_base_amount, pph_percent) : 0;

  return {
    trip_amount,
    toll_amount,
    parking_amount,
    other_amount,
    base_amount,
    tax_scheme,
    tax_base_amount,
    ppn_percent,
    ppn_amount,
    pph_percent,
    pph_amount,
    total_amount: base_amount + ppn_amount - pph_amount,
  };
}

export const PAYMENT_METHODS = ["Tunai", "Transfer Bank", "Giro", "Kartu Kredit", "Kartu Debit"];

export const EXPENSE_METHODS = ["Tunai", "Transfer Bank", "Kartu Kredit", "Kartu Debit", "Kredit"];

/** Format bulan singkat id-ID: "Feb 2026" */
export function monthLabel(year: number, monthIndex: number): string {
  const dt = new Date(year, monthIndex, 1);
  return dt.toLocaleDateString("id-ID", { month: "short", year: "numeric" });
}

export interface CashFlowEntry {
  tanggal: string;
  type: "payment" | "expense" | "adjustment";
  label: string;
  detail: string;
  method: string | null;
  masuk: number;
  keluar: number;
  balance: number;
  /** Id row asal (untuk adjustment), dipakai untuk aksi edit/hapus. */
  id?: number;
}

/**
 * Bangun daftar arus kas dari saldo awal + semua transaksi,
 * diurutkan berdasarkan tanggal (stabil: payment → adjustment → expense).
 */
export function buildCashFlow(
  initialBalance: number,
  payments: { payment_date: string; amount: number; method: string | null; invoice_no: string; client_name: string | null }[],
  expenses: { expense_date: string; amount: number; method: string | null; description: string; category_name: string | null }[],
  adjustments: { id: number; adjustment_date: string; type: "Masuk" | "Keluar"; amount: number; description: string }[]
): CashFlowEntry[] {
  const entries: CashFlowEntry[] = [];

  payments.forEach((p) => {
    entries.push({
      tanggal: p.payment_date,
      type: "payment",
      label: p.invoice_no,
      detail: p.client_name || "Klien",
      method: p.method,
      masuk: p.amount,
      keluar: 0,
      balance: 0,
    });
  });

  expenses.forEach((e) => {
    entries.push({
      tanggal: e.expense_date,
      type: "expense",
      label: e.description,
      detail: e.category_name || "Pengeluaran",
      method: e.method,
      masuk: 0,
      keluar: e.amount,
      balance: 0,
    });
  });

  adjustments.forEach((a) => {
    entries.push({
      tanggal: a.adjustment_date,
      type: "adjustment",
      label: a.description,
      detail: `Penyesuaian ${a.type.toLowerCase()}`,
      method: null,
      masuk: a.type === "Masuk" ? a.amount : 0,
      keluar: a.type === "Keluar" ? a.amount : 0,
      balance: 0,
      id: a.id,
    });
  });

  entries.sort((a, b) => {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? -1 : 1;
    const rank = { payment: 0, adjustment: 1, expense: 2 } as const;
    return rank[a.type] - rank[b.type];
  });

  let balance = initialBalance;
  entries.forEach((e) => {
    balance += e.masuk - e.keluar;
    e.balance = balance;
  });

  return entries;
}

export function fmtDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Jumlah hari jatuh tempo terlewati (0 jika belum/belum ada due_date). */
export function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diff = Math.floor((today.getTime() - due.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

/** Tanggal awal periode Laba Rugi (bulanan/tahunan) dalam format YYYY-MM-DD. */
export function periodStartDate(viewYear: number, viewMonth: number | null): string {
  if (viewMonth === null) return `${viewYear}-01-01`;
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
}

/** Tanggal akhir periode Laba Rugi (bulanan/tahunan) dalam format YYYY-MM-DD. */
export function periodEndDate(viewYear: number, viewMonth: number | null): string {
  if (viewMonth === null) return `${viewYear}-12-31`;
  const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
  return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Tanggal referensi keterlambatan: hari ini untuk periode berjalan,
 * akhir periode untuk periode lampau.
 */
export function receivableReferenceDate(today: string, periodEnd: string): string {
  return today < periodEnd ? today : periodEnd;
}

export interface CashPeriodTotals {
  /** Saldo kas awal periode = saldo dasar + seluruh mutasi sebelum periode. */
  openingBalance: number;
  /** Pembayaran invoice yang masuk pada periode (semua invoice, berdasar payment_date). */
  received: number;
  /** Pengeluaran kas pada periode. */
  expenses: number;
  adjustmentIn: number;
  adjustmentOut: number;
  /** Kas bersih periode = penerimaan + penyesuaian masuk − pengeluaran − penyesuaian keluar. */
  netCash: number;
  /** Saldo kas akhir periode = saldo awal + kas bersih. */
  endingBalance: number;
  incomeCount: number;
  expenseCount: number;
}

/**
 * Rekap kas murni per periode (basis kas):
 * - Penerimaan memakai payment_date, termasuk pelunasan invoice bulan sebelumnya.
 * - Pengeluaran memakai expense_date.
 * - Saldo awal membawa saldo dasar dan seluruh mutasi sebelum periodStart.
 * Piutang TIDAK dihitung sebagai kas; lihat summarizeReceivables.
 */
export function summarizeCashPeriod(args: {
  initialBalance: number;
  payments: { payment_date: string; amount: number }[];
  expenses: { expense_date: string; amount: number }[];
  adjustments: { adjustment_date: string; type: "Masuk" | "Keluar"; amount: number }[];
  periodStart: string;
  periodEnd: string;
}): CashPeriodTotals {
  const initial = Math.round(args.initialBalance) || 0;
  let openingBalance = initial;
  for (const p of args.payments) {
    if (p.payment_date < args.periodStart) openingBalance += p.amount || 0;
  }
  for (const e of args.expenses) {
    if (e.expense_date < args.periodStart) openingBalance -= e.amount || 0;
  }
  for (const a of args.adjustments) {
    if (a.adjustment_date < args.periodStart) {
      openingBalance += a.type === "Masuk" ? a.amount || 0 : -(a.amount || 0);
    }
  }

  const periodPayments = args.payments.filter(
    (p) => p.payment_date >= args.periodStart && p.payment_date <= args.periodEnd,
  );
  const periodExpenses = args.expenses.filter(
    (e) => e.expense_date >= args.periodStart && e.expense_date <= args.periodEnd,
  );
  const periodAdjustments = args.adjustments.filter(
    (a) => a.adjustment_date >= args.periodStart && a.adjustment_date <= args.periodEnd,
  );

  const received = periodPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const expenses = periodExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const adjustmentIn = periodAdjustments
    .filter((a) => a.type === "Masuk")
    .reduce((s, a) => s + (a.amount || 0), 0);
  const adjustmentOut = periodAdjustments
    .filter((a) => a.type === "Keluar")
    .reduce((s, a) => s + (a.amount || 0), 0);
  const netCash = received + adjustmentIn - expenses - adjustmentOut;

  return {
    openingBalance,
    received,
    expenses,
    adjustmentIn,
    adjustmentOut,
    netCash,
    endingBalance: openingBalance + netCash,
    incomeCount: periodPayments.length,
    expenseCount: periodExpenses.length,
  };
}

export interface ClosedCashSnapshotInput {
  opening_cash_balance: number | null;
  cash_in: number | null;
  cash_out_expenses: number | null;
  adjustment_in: number | null;
  adjustment_out: number | null;
  ending_cash_balance: number | null;
}

/** Ambil angka kas dari snapshot Tutup Buku (immutable) untuk bulan yang sudah closing. */
export function cashPeriodFromClosingSnapshot(snapshot: ClosedCashSnapshotInput): CashPeriodTotals {
  const openingBalance = Number(snapshot.opening_cash_balance) || 0;
  const received = Number(snapshot.cash_in) || 0;
  const expenses = Number(snapshot.cash_out_expenses) || 0;
  const adjustmentIn = Number(snapshot.adjustment_in) || 0;
  const adjustmentOut = Number(snapshot.adjustment_out) || 0;
  const netCash = received + adjustmentIn - expenses - adjustmentOut;
  return {
    openingBalance,
    received,
    expenses,
    adjustmentIn,
    adjustmentOut,
    netCash,
    endingBalance: Number(snapshot.ending_cash_balance) || openingBalance + netCash,
    incomeCount: 0,
    expenseCount: 0,
  };
}

export interface ReceivableInvoiceInput {
  id: number;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number;
  clientName?: string | null;
}

export interface ReceivablePaymentInput {
  invoice_id: number;
  payment_date: string;
  amount: number;
}

export type ReceivableBucket =
  | "Belum jatuh tempo"
  | "Terlambat 1–30 hari"
  | "Terlambat 31–60 hari"
  | "Terlambat 61–90 hari"
  | "Terlambat > 90 hari";

export interface ReceivableItem {
  id: number;
  invoice_no: string;
  clientName: string;
  invoice_date: string;
  due_date: string | null;
  total: number;
  paid: number;
  remaining: number;
  overdueDays: number;
  bucket: ReceivableBucket;
}

export interface ReceivableSummary {
  /** Total nilai invoice yang terbit dalam periode. */
  totalInvoiced: number;
  /** Total seluruh pembayaran milik invoice periode tersebut. */
  totalPaid: number;
  /** Sisa piutang periode (invoice periode dikurangi pembayaran milik invoice periode). */
  totalReceivable: number;
  /** Jumlah invoice yang masih memiliki sisa > 0. */
  unpaidCount: number;
  /** Jumlah invoice belum lunas yang sudah lewat jatuh tempo per tanggal referensi. */
  overdueCount: number;
  /** Nilai piutang yang sudah lewat jatuh tempo per tanggal referensi. */
  overdueAmount: number;
  /** Invoice belum lunas, diurutkan yang paling terlambat dulu. */
  items: ReceivableItem[];
}

/** Kelompok umur piutang berdasarkan hari keterlambatan. */
export function receivableBucket(overdueDays: number, hasDueDate: boolean): ReceivableBucket {
  if (!hasDueDate || overdueDays <= 0) return "Belum jatuh tempo";
  if (overdueDays <= 30) return "Terlambat 1–30 hari";
  if (overdueDays <= 60) return "Terlambat 31–60 hari";
  if (overdueDays <= 90) return "Terlambat 61–90 hari";
  return "Terlambat > 90 hari";
}

/** Hari keterlambatan terhadap tanggal referensi YYYY-MM-DD (murni, mudah diuji). */
export function receivableOverdueDays(dueDate: string | null, referenceDate: string): number {
  if (!dueDate) return 0;
  const ref = new Date(referenceDate + "T00:00:00").getTime();
  const due = new Date(dueDate + "T00:00:00").getTime();
  if (Number.isNaN(ref) || Number.isNaN(due)) return 0;
  const diff = Math.floor((ref - due) / 86400000);
  return diff > 0 ? diff : 0;
}

/**
 * Ringkas piutang murni per periode terpilih (tanpa membawa saldo bulan sebelumnya).
 * - Invoice dihitung bila periodStart <= invoice_date <= periodEnd.
 * - Pembayaran dihitung dari seluruh pembayaran milik invoice periode tersebut,
 *   agar konsisten dengan ringkasan Pendapatan.
 * - Keterlambatan dihitung terhadap referenceDate (akhir periode untuk periode
 *   lampau, hari ini untuk periode berjalan).
 */
export function summarizeReceivables(
  invoices: ReceivableInvoiceInput[],
  payments: ReceivablePaymentInput[],
  periodStart: string,
  periodEnd: string,
  referenceDate: string,
): ReceivableSummary {
  const periodInvoiceIds = new Set(
    invoices
      .filter((inv) => inv.invoice_date && inv.invoice_date >= periodStart && inv.invoice_date <= periodEnd)
      .map((inv) => inv.id)
  );
  const paidByInvoice = new Map<number, number>();
  for (const p of payments) {
    if (!periodInvoiceIds.has(p.invoice_id)) continue;
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + (p.amount || 0));
  }

  let totalInvoiced = 0;
  let totalPaid = 0;
  const items: ReceivableItem[] = [];

  for (const inv of invoices) {
    if (!inv.invoice_date || inv.invoice_date < periodStart || inv.invoice_date > periodEnd) continue;
    const total = inv.total_amount || 0;
    const paid = paidByInvoice.get(inv.id) ?? 0;
    const remaining = total - paid;
    totalInvoiced += total;
    totalPaid += Math.min(paid, total);
    if (remaining > 0) {
      const overdueDays = receivableOverdueDays(inv.due_date, referenceDate);
      items.push({
        id: inv.id,
        invoice_no: inv.invoice_no,
        clientName: inv.clientName || "—",
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        total,
        paid,
        remaining,
        overdueDays,
        bucket: receivableBucket(overdueDays, !!inv.due_date),
      });
    }
  }

  items.sort((a, b) => b.overdueDays - a.overdueDays || b.remaining - a.remaining);

  const overdueItems = items.filter((i) => i.overdueDays > 0);
  return {
    totalInvoiced,
    totalPaid,
    totalReceivable: totalInvoiced - totalPaid,
    unpaidCount: items.length,
    overdueCount: overdueItems.length,
    overdueAmount: overdueItems.reduce((s, i) => s + i.remaining, 0),
    items,
  };
}

export interface PriorReceivableSummary {
  /** Piutang dari invoice sebelum periode, posisi awal periode. */
  opening: number;
  /** Pembayaran selama periode untuk invoice sebelum periode. */
  paid: number;
  /** Sisa piutang invoice sebelum periode pada akhir periode. */
  remaining: number;
  /** Jumlah invoice lama yang belum lunas. */
  count: number;
}

/**
 * Piutang dari invoice bulan/tahun sebelumnya (di luar periode terpilih):
 * - `opening` = sisa invoice lama tepat sebelum periodStart.
 * - `paid` = pembayaran pada periode ini yang melunasi invoice lama.
 * - `remaining` = sisa invoice lama pada akhir periode.
 * Pembayaran ini sudah termasuk kas masuk periode; bukan pendapatan baru.
 */
export function summarizePriorReceivables(
  invoices: ReceivableInvoiceInput[],
  payments: ReceivablePaymentInput[],
  periodStart: string,
  periodEnd: string,
): PriorReceivableSummary {
  const priorInvoices = invoices.filter((inv) => inv.invoice_date && inv.invoice_date < periodStart);
  const priorIds = new Set(priorInvoices.map((inv) => inv.id));
  const paidBefore = new Map<number, number>();
  const paidInPeriod = new Map<number, number>();

  for (const p of payments) {
    if (!priorIds.has(p.invoice_id)) continue;
    if (p.payment_date < periodStart) {
      paidBefore.set(p.invoice_id, (paidBefore.get(p.invoice_id) ?? 0) + (p.amount || 0));
    } else if (p.payment_date <= periodEnd) {
      paidInPeriod.set(p.invoice_id, (paidInPeriod.get(p.invoice_id) ?? 0) + (p.amount || 0));
    }
  }

  let opening = 0;
  let paid = 0;
  let remaining = 0;
  let count = 0;

  for (const inv of priorInvoices) {
    const total = inv.total_amount || 0;
    const before = paidBefore.get(inv.id) ?? 0;
    const during = paidInPeriod.get(inv.id) ?? 0;
    const openingForInvoice = Math.max(0, total - before);
    const remainingForInvoice = Math.max(0, total - before - during);
    opening += openingForInvoice;
    paid += Math.min(during, openingForInvoice);
    remaining += remainingForInvoice;
    if (remainingForInvoice > 0) count += 1;
  }

  return { opening, paid, remaining, count };
}

export interface PriorReceivableSnapshotRow {
  invoice_date: string;
  remaining: number;
}

/**
 * Versi immutable untuk periode yang sudah Tutup Buku:
 * `receivables_as_of_end` hanya memuat invoice yang masih bersisa saat closing,
 * sehingga sisa invoice lama = penjumlahan baris sebelum periodStart.
 */
export function summarizePriorReceivablesFromSnapshot(
  openingReceivable: number,
  rows: PriorReceivableSnapshotRow[],
  periodStart: string,
): PriorReceivableSummary {
  const priorRows = rows.filter(
    (r) => r.invoice_date && r.invoice_date < periodStart && (Number(r.remaining) || 0) > 0,
  );
  const remaining = priorRows.reduce((s, r) => s + (Number(r.remaining) || 0), 0);
  const opening = Math.max(0, Number(openingReceivable) || 0);
  return {
    opening,
    paid: Math.max(0, opening - remaining),
    remaining,
    count: priorRows.length,
  };
}

export interface OutstandingReceivableSummary {
  /** Total sisa seluruh invoice yang sudah terbit sampai tanggal acuan. */
  total: number;
  /** Jumlah invoice yang masih memiliki sisa > 0. */
  count: number;
}

/**
 * Total piutang keseluruhan per tanggal acuan (termasuk invoice bulan sebelumnya).
 * Pembayaran setelah tanggal acuan tidak mengurangi piutang.
 */
export function summarizeOutstandingReceivables(
  invoices: { id: number; invoice_date: string; total_amount: number }[],
  payments: { invoice_id: number; payment_date: string; amount: number }[],
  asOf: string,
): OutstandingReceivableSummary {
  const paidByInvoice = new Map<number, number>();
  for (const p of payments) {
    if (p.payment_date > asOf) continue;
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + (p.amount || 0));
  }

  let total = 0;
  let count = 0;
  for (const inv of invoices) {
    if (!inv.invoice_date || inv.invoice_date > asOf) continue;
    const remaining = Math.max(0, (inv.total_amount || 0) - (paidByInvoice.get(inv.id) ?? 0));
    total += remaining;
    if (remaining > 0) count += 1;
  }

  return { total, count };
}

export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const content = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
