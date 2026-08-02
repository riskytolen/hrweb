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
