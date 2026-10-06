/**
 * Pure helpers + PDF exporters for Finance Pendapatan registers.
 *
 * Konvensi akuntansi yang dikunci:
 * - Filter Invoice memakai `invoice_date`.
 * - Filter Pembayaran memakai `payment_date`.
 * - Batas tanggal inklusif, string kosong berarti tanpa batas.
 * - KPI Invoice dihitung dari cohort invoice dalam periode, memakai SELURUH
 *   pembayaran milik invoice tersebut (tanpa memotong payment_date).
 * - KPI Pembayaran dihitung dari pembayaran yang payment_date-nya masuk periode.
 */

import { downscaleDataUrl } from "./pdf-logo";

export interface RevenueDateRange {
  from: string;
  to: string;
}

export interface InvoiceCohortItem {
  total_amount: number;
  paid?: number | null;
  status?: string | null;
}

export interface PaymentSummaryItem {
  amount: number;
  method?: string | null;
}

export interface InvoiceCohortSummary {
  count: number;
  totalInv: number;
  totalPaid: number;
  piutang: number;
  lunas: number;
  sebagian: number;
  belum: number;
}

export interface PaymentPeriodSummary {
  count: number;
  total: number;
  average: number;
  dominantMethod: string;
  byMethod: { method: string; count: number; total: number }[];
}

export interface RevenueCompanyInfo {
  company_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  npwp?: string | null;
  logo_url?: string | null;
}

export interface RevenueInvoicePdfInput {
  invoice_no: string;
  invoice_date: string;
  due_date?: string | null;
  clientName: string;
  description?: string | null;
  subtotal: number;
  ppn_percent: number | string;
  ppn_amount: number;
  total_amount: number;
  paid: number;
  remaining: number;
  status: string;
}

export interface RevenuePaymentPdfInput {
  payment_date: string;
  invoice_no: string;
  clientName: string;
  method: string;
  amount: number;
  notes?: string | null;
}

/** Cek tanggal YYYY-MM-DD masuk rentang inklusif. Batas kosong = tanpa batas. */
export function isDateInRange(date: string, from: string, to: string): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function filterInvoicesByDate<T extends { invoice_date: string }>(
  rows: T[],
  from: string,
  to: string,
): T[] {
  if (!from && !to) return rows;
  return rows.filter((r) => isDateInRange(r.invoice_date, from, to));
}

export function filterPaymentsByDate<T extends { payment_date: string }>(
  rows: T[],
  from: string,
  to: string,
): T[] {
  if (!from && !to) return rows;
  return rows.filter((r) => isDateInRange(r.payment_date, from, to));
}

function defaultFmtDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Label periode Indonesia untuk header laporan. */
export function formatPeriodLabel(
  from: string,
  to: string,
  fmt: (s: string) => string = defaultFmtDate,
): string {
  if (!from && !to) return "Semua periode";
  if (from && to) {
    if (from === to) return fmt(from);
    return `${fmt(from)} – ${fmt(to)}`;
  }
  if (from) return `Sejak ${fmt(from)}`;
  return `Sampai ${fmt(to)}`;
}

/** Ringkasan cohort invoice: terkumpul memakai seluruh pembayaran milik invoice terpilih. */
export function summarizeInvoiceCohort(invoices: InvoiceCohortItem[]): InvoiceCohortSummary {
  let totalInv = 0;
  let totalPaid = 0;
  let lunas = 0;
  let sebagian = 0;
  let belum = 0;
  for (const inv of invoices) {
    totalInv += inv.total_amount || 0;
    totalPaid += inv.paid ?? 0;
    if (inv.status === "Lunas") lunas += 1;
    else if (inv.status === "Sebagian") sebagian += 1;
    else belum += 1;
  }
  return {
    count: invoices.length,
    totalInv,
    totalPaid,
    piutang: totalInv - totalPaid,
    lunas,
    sebagian,
    belum,
  };
}

/** Ringkasan pembayaran dalam periode (berdasarkan payment_date). */
export function summarizePayments(payments: PaymentSummaryItem[]): PaymentPeriodSummary {
  const byMap = new Map<string, { count: number; total: number }>();
  let total = 0;
  for (const p of payments) {
    const m = (p.method || "—").trim() || "—";
    total += p.amount || 0;
    const cur = byMap.get(m) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += p.amount || 0;
    byMap.set(m, cur);
  }
  const byMethod = [...byMap.entries()]
    .map(([method, v]) => ({ method, count: v.count, total: v.total }))
    .sort((a, b) => b.total - a.total);
  return {
    count: payments.length,
    total,
    average: payments.length > 0 ? Math.round(total / payments.length) : 0,
    dominantMethod: byMethod.length > 0 ? byMethod[0].method : "—",
    byMethod,
  };
}

/** Nama file aman untuk export. */
export function buildRevenueFilename(
  kind: "invoice" | "pembayaran",
  from: string,
  to: string,
): string {
  const stamp = (s: string) => (s ? s : "semua");
  const base = kind === "invoice" ? "Laporan_Invoice" : "Laporan_Pembayaran";
  return `${base}_${stamp(from)}_${stamp(to)}.pdf`;
}

export function toInvoicePdfRow(inv: RevenueInvoicePdfInput, index: number): string[] {
  const desc = (inv.description || "").trim();
  const first = desc ? `${inv.invoice_no}\n${desc}` : inv.invoice_no;
  return [
    String(index + 1),
    first,
    inv.invoice_date,
    inv.due_date || "—",
    inv.clientName || "—",
    String(inv.subtotal),
    String(inv.ppn_percent),
    String(inv.ppn_amount),
    String(inv.total_amount),
    String(inv.paid),
    String(inv.remaining),
    inv.status,
  ];
}

export function toPaymentPdfRow(p: RevenuePaymentPdfInput, index: number): string[] {
  return [
    String(index + 1),
    p.payment_date,
    p.invoice_no,
    p.clientName || "—",
    p.method || "—",
    String(p.amount),
    (p.notes || "—").trim() || "—",
  ];
}

// ─── PDF rendering (client-side, dynamic import jspdf) ───

const BLUE: [number, number, number] = [37, 99, 235];
const NAVY: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];
const INK: [number, number, number] = [15, 23, 42];
const BORDER: [number, number, number] = [226, 232, 240];

function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function formatTanggalId(s: string): string {
  if (!s || s === "—") return "—";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

interface PdfDoc {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  setFont(font: string, style: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g?: number, b?: number): void;
  setFillColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g?: number, b?: number): void;
  setLineWidth(w: number): void;
  text(text: string | string[], x: number, y: number, opts?: { align?: string }): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rect(x: number, y: number, w: number, h: number, style: string): void;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style: string): void;
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void;
  addPage(): void;
  getNumberOfPages(): number;
  setPage(n: number): void;
  getTextWidth(text: string): number;
  splitTextToSize(text: string, width: number): string[];
  save(filename: string): void;
}

function drawReportHeader(
  pdf: PdfDoc,
  opts: {
    pageWidth: number;
    margin: number;
    company: RevenueCompanyInfo;
    logoDataUrl: string | null;
    title: string;
    subtitle: string;
    periodLabel: string;
    filterLine: string;
  },
): void {
  const { pageWidth, margin, company, logoDataUrl, title, subtitle, periodLabel, filterLine } = opts;
  const right = pageWidth - margin;
  let y = 12;

  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, "PNG", margin, 8, 26, 12);
    } catch {
      /* abaikan logo rusak */
    }
  }
  const textLeft = logoDataUrl ? margin + 30 : margin;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  pdf.text(company.company_name || "Perusahaan", textLeft, y + 1);
  y += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  const contact = [company.address, [company.phone, company.email].filter(Boolean).join(" • ")]
    .filter(Boolean)
    .join(" • ");
  if (contact) {
    const lines = pdf.splitTextToSize(contact, pageWidth - textLeft - 110);
    pdf.text(lines.slice(0, 2), textLeft, y);
    y += lines.slice(0, 2).length * 3.4;
  }
  if (company.npwp) {
    pdf.text(`NPWP: ${company.npwp}`, textLeft, y);
    y += 3.6;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  pdf.text(title, right, 13, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text(subtitle, right, 18, { align: "right" });
  pdf.text(`Periode: ${periodLabel}`, right, 22.5, { align: "right" });
  if (filterLine) {
    const wrapped = pdf.splitTextToSize(filterLine, 120);
    pdf.text(wrapped.slice(0, 2), right, 26.5, { align: "right" });
  }
  pdf.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, right, filterLine ? 33.5 : 29.5, {
    align: "right",
  });

  pdf.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
  pdf.setLineWidth(0.7);
  pdf.line(margin, 37, right, 37);
  pdf.setLineWidth(0.2);
}

function drawSummaryCards(
  pdf: PdfDoc,
  margin: number,
  pageWidth: number,
  y: number,
  cards: [string, string][],
): number {
  const gap = 3;
  const w = (pageWidth - margin * 2 - gap * (cards.length - 1)) / cards.length;
  cards.forEach(([label, value], i) => {
    const x = margin + i * (w + gap);
    const highlight = i === cards.length - 1;
    if (highlight) pdf.setFillColor(219, 234, 254);
    else pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    pdf.roundedRect(x, y, w, 14, 2, 2, "FD");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text(label, x + 3, y + 5);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(highlight ? BLUE[0] : INK[0], highlight ? BLUE[1] : INK[1], highlight ? BLUE[2] : INK[2]);
    const clipped = value.length > 30 ? `${value.slice(0, 29)}…` : value;
    pdf.text(clipped, x + 3, y + 10.5);
  });
  return y + 18;
}

function addReportFooter(pdf: PdfDoc, companyName: string, reportLabel: string): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    pdf.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(140);
    pdf.text(`${companyName} • ${reportLabel}`, 14, pageHeight - 6);
    pdf.text(`Halaman ${p} dari ${pages}`, pageWidth - 14, pageHeight - 6, { align: "right" });
  }
}

export async function exportRevenueInvoicesPdf(args: {
  rows: RevenueInvoicePdfInput[];
  from: string;
  to: string;
  statusFilter: string;
  search: string;
  company: RevenueCompanyInfo;
  summary: InvoiceCohortSummary;
}): Promise<string> {
  if (args.rows.length === 0) throw new Error("Tidak ada invoice pada filter aktif.");
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const periodLabel = formatPeriodLabel(args.from, args.to);
  const filterBits: string[] = [];
  if (args.statusFilter && args.statusFilter !== "Semua") filterBits.push(`Status: ${args.statusFilter}`);
  if (args.search.trim()) filterBits.push(`Cari: ${args.search.trim()}`);
  const filterLine = filterBits.join(" • ");

  const rawLogo = args.company.logo_url ? await loadImageDataUrl(args.company.logo_url) : null;
  // Downscale agar logo besar tidak menggembungkan PDF.
  const logoDataUrl = rawLogo ? ((await downscaleDataUrl(rawLogo)) ?? rawLogo) : null;
  drawReportHeader(doc, {
    pageWidth,
    margin,
    company: args.company,
    logoDataUrl,
    title: "REGISTER INVOICE",
    subtitle: "Finance • Pendapatan",
    periodLabel,
    filterLine,
  });

  let y = 42;
  y = drawSummaryCards(doc, margin, pageWidth, y, [
    ["Jumlah Invoice", `${args.summary.count} invoice`],
    ["Total Tagihan", formatRupiah(args.summary.totalInv)],
    ["Terkumpul", formatRupiah(args.summary.totalPaid)],
    ["Piutang", formatRupiah(args.summary.piutang)],
  ]);

  const body = args.rows.map((r, i) => [
    String(i + 1),
    (r.description || "").trim() ? `${r.invoice_no}\n${(r.description || "").trim()}` : r.invoice_no,
    formatTanggalId(r.invoice_date),
    r.due_date ? formatTanggalId(r.due_date) : "—",
    r.clientName || "—",
    formatRupiah(r.subtotal),
    String(r.ppn_percent),
    formatRupiah(r.ppn_amount),
    formatRupiah(r.total_amount),
    formatRupiah(r.paid),
    r.remaining > 0 ? formatRupiah(r.remaining) : "—",
    r.status,
  ]);
  body.push([
    "",
    "",
    "",
    "",
    `${args.rows.length} invoice`,
    "",
    "",
    "",
    formatRupiah(args.rows.reduce((s, r) => s + r.total_amount, 0)),
    formatRupiah(args.rows.reduce((s, r) => s + r.paid, 0)),
    formatRupiah(args.rows.reduce((s, r) => s + r.remaining, 0)),
    "TOTAL",
  ]);

  autoTable(doc as never, {
    startY: y,
    head: [
      ["No", "No. Invoice / Deskripsi", "Tanggal", "Jatuh Tempo", "Klien", "Subtotal", "PPN %", "PPN", "Total", "Dibayar", "Sisa", "Status"],
    ],
    body,
    theme: "grid",
    styles: {
      fontSize: 7,
      cellPadding: 1.6,
      lineColor: BORDER,
      lineWidth: 0.1,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: "center", cellWidth: 9 },
      1: { cellWidth: 40 },
      2: { halign: "center", cellWidth: 20 },
      3: { halign: "center", cellWidth: 20 },
      4: { cellWidth: 32 },
      5: { halign: "right", cellWidth: 24 },
      6: { halign: "center", cellWidth: 12 },
      7: { halign: "right", cellWidth: 24 },
      8: { halign: "right", cellWidth: 26 },
      9: { halign: "right", cellWidth: 24 },
      10: { halign: "right", cellWidth: 22 },
      11: { halign: "center", cellWidth: 16 },
    },
    margin: { left: margin, right: margin, bottom: 16 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.row.index === body.length - 1) {
        data.cell.styles.fillColor = [219, 234, 254];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  addReportFooter(doc, args.company.company_name || "Perusahaan", `Register Invoice • ${periodLabel}`);
  const filename = buildRevenueFilename("invoice", args.from, args.to);
  doc.save(filename);
  return filename;
}

export async function exportRevenuePaymentsPdf(args: {
  rows: RevenuePaymentPdfInput[];
  from: string;
  to: string;
  search: string;
  company: RevenueCompanyInfo;
  summary: PaymentPeriodSummary;
}): Promise<string> {
  if (args.rows.length === 0) throw new Error("Tidak ada pembayaran pada filter aktif.");
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const periodLabel = formatPeriodLabel(args.from, args.to);
  const filterLine = args.search.trim() ? `Cari: ${args.search.trim()}` : "";

  const rawLogo = args.company.logo_url ? await loadImageDataUrl(args.company.logo_url) : null;
  // Downscale agar logo besar tidak menggembungkan PDF.
  const logoDataUrl = rawLogo ? ((await downscaleDataUrl(rawLogo)) ?? rawLogo) : null;
  drawReportHeader(doc, {
    pageWidth,
    margin,
    company: args.company,
    logoDataUrl,
    title: "REGISTER PEMBAYARAN",
    subtitle: "Finance • Pendapatan",
    periodLabel,
    filterLine,
  });

  let y = 42;
  y = drawSummaryCards(doc, margin, pageWidth, y, [
    ["Transaksi", `${args.summary.count} pembayaran`],
    ["Total Diterima", formatRupiah(args.summary.total)],
    ["Rata-rata", formatRupiah(args.summary.average)],
    ["Metode Dominan", args.summary.dominantMethod],
  ]);

  const body = args.rows.map((r, i) => [
    String(i + 1),
    formatTanggalId(r.payment_date),
    r.invoice_no,
    r.clientName || "—",
    r.method || "—",
    formatRupiah(r.amount),
    (r.notes || "—").trim() || "—",
  ]);
  body.push(["", "", "", "", `${args.rows.length} transaksi`, formatRupiah(args.summary.total), "TOTAL"]);

  autoTable(doc as never, {
    startY: y,
    head: [["No", "Tanggal", "No. Invoice", "Klien", "Metode", "Nominal", "Catatan"]],
    body,
    theme: "grid",
    styles: {
      fontSize: 7.5,
      cellPadding: 1.8,
      lineColor: BORDER,
      lineWidth: 0.1,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      1: { halign: "center", cellWidth: 24 },
      2: { cellWidth: 34 },
      3: { cellWidth: 44 },
      4: { halign: "center", cellWidth: 28 },
      5: { halign: "right", cellWidth: 30 },
      6: { cellWidth: "auto" },
    },
    margin: { left: margin, right: margin, bottom: 16 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.row.index === body.length - 1) {
        data.cell.styles.fillColor = [219, 234, 254];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  addReportFooter(doc, args.company.company_name || "Perusahaan", `Register Pembayaran • ${periodLabel}`);
  const filename = buildRevenueFilename("pembayaran", args.from, args.to);
  doc.save(filename);
  return filename;
}
