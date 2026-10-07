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

export interface CashOnHandSummary {
  received: number;
  expenses: number;
  profit: number;
  margin: number;
}

/** Laba berbasis kas: pembayaran benar-benar masuk dikurangi pengeluaran periode. */
export function summarizeCashOnHand(
  payments: { payment_date: string; amount: number }[],
  expenses: { expense_date: string; amount: number }[],
  periodStart: string,
  periodEnd: string,
): CashOnHandSummary {
  const received = payments
    .filter((p) => p.payment_date >= periodStart && p.payment_date <= periodEnd)
    .reduce((s, p) => s + (p.amount || 0), 0);
  const periodExpenses = expenses
    .filter((e) => e.expense_date >= periodStart && e.expense_date <= periodEnd)
    .reduce((s, e) => s + (e.amount || 0), 0);
  const profit = received - periodExpenses;
  return {
    received,
    expenses: periodExpenses,
    profit,
    margin: received > 0 ? (profit / received) * 100 : 0,
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
  /** Total pembayaran dalam periode untuk invoice periode tersebut. */
  totalPaid: number;
  /** Sisa piutang periode (invoice periode dikurangi pembayaran periode). */
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
 * - Pembayaran dihitung bila periodStart <= payment_date <= periodEnd.
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
  const paidByInvoice = new Map<number, number>();
  for (const p of payments) {
    if (!p.payment_date || p.payment_date < periodStart || p.payment_date > periodEnd) continue;
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
