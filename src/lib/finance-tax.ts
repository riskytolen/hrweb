/**
 * Helper untuk fitur Pajak Finance.
 * PPN 1,1% default = pembulatan(dasar_pajak * 1.1 / 100)
 * Sejak invoice punya skema pajak + PPh, laporan memakai nilai TERSIMPAN
 * per invoice (tax_base_amount, ppn_amount, pph_amount); hitung ulang dari
 * subtotal hanya sebagai fallback untuk baris lama.
 * Omzet = SUM subtotal (total biaya), Pengeluaran = SUM amount
 */

export const PPN_11_RATE = 1.1;

export function computePpn11(subtotal: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  return Math.round((subtotal * PPN_11_RATE) / 100);
}

export function formatRupiah(value?: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

export function formatTanggal(date?: string | null): string {
  if (!date) return "-";
  return new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export function monthLabelId(monthIndex: number): string {
  return new Date(2000, monthIndex, 1).toLocaleDateString("id-ID", { month: "long" });
}

export interface InvoiceTaxRow {
  id: number;
  invoice_no: string;
  invoice_date: string;
  subtotal: number;
  clientLabel: string;
}

export interface ClientPpnSummary {
  clientLabel: string;
  invoiceCount: number;
  totalTagihan: number;
  totalPpn: number;
  totalPph: number;
}

export function summarizeClientPpn(
  rows: { clientLabel: string; subtotal: number; ppn_amount?: number | null; pph_amount?: number | null }[],
): ClientPpnSummary[] {
  const map = new Map<string, { invoiceCount: number; totalTagihan: number; totalPpn: number; totalPph: number }>();
  for (const r of rows) {
    const key = r.clientLabel || "Tanpa Client";
    const cur = map.get(key) || { invoiceCount: 0, totalTagihan: 0, totalPpn: 0, totalPph: 0 };
    cur.invoiceCount += 1;
    cur.totalTagihan += r.subtotal || 0;
    // Nilai tersimpan diutamakan; fallback hitung dari subtotal untuk baris lama.
    cur.totalPpn += r.ppn_amount ?? computePpn11(r.subtotal);
    cur.totalPph += r.pph_amount ?? 0;
    map.set(key, cur);
  }
  const result: ClientPpnSummary[] = [];
  for (const [clientLabel, v] of map.entries()) {
    result.push({
      clientLabel,
      invoiceCount: v.invoiceCount,
      totalTagihan: v.totalTagihan,
      totalPpn: v.totalPpn,
      totalPph: v.totalPph,
    });
  }
  // Urutkan terbesar total PPN
  result.sort((a, b) => b.totalPpn - a.totalPpn);
  return result;
}

export interface MonthlyPajak {
  month: number; // 1-12
  invoiceCount: number;
  omzet: number;
  expenseCount: number;
  pengeluaran: number;
  hasil: number;
}

export function buildMonthlyPajak(
  invoices: { invoice_date: string; subtotal: number }[],
  expenses: { expense_date: string; amount: number }[],
  year: number
): MonthlyPajak[] {
  const months: MonthlyPajak[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    invoiceCount: 0,
    omzet: 0,
    expenseCount: 0,
    pengeluaran: 0,
    hasil: 0,
  }));
  for (const inv of invoices) {
    if (!inv.invoice_date.startsWith(String(year))) continue;
    const m = Number(inv.invoice_date.slice(5, 7));
    if (m < 1 || m > 12) continue;
    const idx = m - 1;
    months[idx].invoiceCount += 1;
    months[idx].omzet += inv.subtotal || 0;
  }
  for (const exp of expenses) {
    if (!exp.expense_date.startsWith(String(year))) continue;
    const m = Number(exp.expense_date.slice(5, 7));
    if (m < 1 || m > 12) continue;
    const idx = m - 1;
    months[idx].expenseCount += 1;
    months[idx].pengeluaran += exp.amount || 0;
  }
  for (const m of months) m.hasil = m.omzet - m.pengeluaran;
  return months;
}
