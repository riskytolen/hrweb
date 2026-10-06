/**
 * Helper periode + PDF untuk Finance Arus Kas (Buku Kas).
 *
 * Semantik akuntansi yang dikunci:
 * - Tanggal kas aktual: payment_date, expense_date, adjustment_date.
 * - Batas tanggal inklusif, string kosong berarti tanpa batas.
 * - Saldo Awal Periode = saldo dasar + seluruh mutasi bertanggal SEBELUM `from`.
 * - Transaksi tepat pada `from` masuk periode, bukan saldo awal.
 * - Saldo Akhir = saldo awal periode + kas masuk periode − kas keluar periode.
 * - Search dan filter Masuk/Keluar hanya filter tampilan; tidak mengubah
 *   saldo awal, total periode, maupun saldo akhir.
 */

import { downscaleDataUrl } from "./pdf-logo";

export type CashEntryType = "payment" | "expense" | "adjustment";

export interface CashPaymentInput {
  id?: number | null;
  payment_date: string;
  amount: number;
  method?: string | null;
  invoice_no: string;
  client_name?: string | null;
}

export interface CashExpenseInput {
  id?: number | null;
  expense_date: string;
  amount: number;
  method?: string | null;
  description: string;
  category_name?: string | null;
}

export interface CashAdjustmentInput {
  id: number;
  adjustment_date: string;
  type: "Masuk" | "Keluar";
  amount: number;
  description: string;
}

export interface CashPeriodEntry {
  key: string;
  tanggal: string;
  type: CashEntryType;
  label: string;
  detail: string;
  method: string | null;
  masuk: number;
  keluar: number;
  balance: number;
  id?: number | null;
}

export interface CashPeriodSummary {
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  net: number;
  endingBalance: number;
  count: number;
  countIn: number;
  countOut: number;
}

export interface CashCompanyInfo {
  company_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  npwp?: string | null;
  logo_url?: string | null;
}

/** Cek tanggal YYYY-MM-DD masuk periode inklusif. Batas kosong = tanpa batas. */
export function isCashDateInRange(date: string, from: string, to: string): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** True jika transaksi terjadi strictly sebelum periode (masuk saldo awal). */
export function isBeforeCashPeriod(date: string, from: string): boolean {
  if (!from) return false;
  return date < from;
}

function defaultFmtDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Label periode Indonesia untuk header laporan. */
export function formatCashPeriodLabel(
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

/** Nama file export dengan periode. */
export function buildCashFlowFilename(kind: "pdf" | "csv", from: string, to: string): string {
  const stamp = (s: string) => (s ? s : "semua");
  return `Arus_Kas_${stamp(from)}_${stamp(to)}.${kind}`;
}

const TYPE_RANK: Record<CashEntryType, number> = { payment: 0, adjustment: 1, expense: 2 };

/**
 * Hitung saldo awal periode, mutasi periode dengan saldo berjalan, dan ringkasan.
 * Tidak memutasi array input.
 */
export function computeCashFlowPeriod(
  initialBalance: number,
  payments: CashPaymentInput[],
  expenses: CashExpenseInput[],
  adjustments: CashAdjustmentInput[],
  from: string,
  to: string,
): { openingBalance: number; entries: CashPeriodEntry[]; summary: CashPeriodSummary } {
  let openingBalance = initialBalance || 0;

  if (from) {
    for (const p of payments) {
      if (isBeforeCashPeriod(p.payment_date, from)) openingBalance += p.amount || 0;
    }
    for (const e of expenses) {
      if (isBeforeCashPeriod(e.expense_date, from)) openingBalance -= e.amount || 0;
    }
    for (const a of adjustments) {
      if (isBeforeCashPeriod(a.adjustment_date, from)) {
        openingBalance += a.type === "Masuk" ? a.amount || 0 : -(a.amount || 0);
      }
    }
  }

  const raw: CashPeriodEntry[] = [];
  for (const p of payments) {
    if (!isCashDateInRange(p.payment_date, from, to)) continue;
    raw.push({
      key: `payment-${p.id ?? `${p.payment_date}-${p.invoice_no}-${p.amount}`}`,
      tanggal: p.payment_date,
      type: "payment",
      label: p.invoice_no,
      detail: p.client_name || "Klien",
      method: p.method ?? null,
      masuk: p.amount || 0,
      keluar: 0,
      balance: 0,
      id: p.id ?? null,
    });
  }
  for (const a of adjustments) {
    if (!isCashDateInRange(a.adjustment_date, from, to)) continue;
    raw.push({
      key: `adjustment-${a.id}`,
      tanggal: a.adjustment_date,
      type: "adjustment",
      label: a.description,
      detail: `Penyesuaian ${a.type.toLowerCase()}`,
      method: null,
      masuk: a.type === "Masuk" ? a.amount || 0 : 0,
      keluar: a.type === "Keluar" ? a.amount || 0 : 0,
      balance: 0,
      id: a.id,
    });
  }
  for (const e of expenses) {
    if (!isCashDateInRange(e.expense_date, from, to)) continue;
    raw.push({
      key: `expense-${e.id ?? `${e.expense_date}-${e.description}-${e.amount}`}`,
      tanggal: e.expense_date,
      type: "expense",
      label: e.description,
      detail: e.category_name || "Pengeluaran",
      method: e.method ?? null,
      masuk: 0,
      keluar: e.amount || 0,
      balance: 0,
      id: e.id ?? null,
    });
  }

  raw.sort((a, b) => {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? -1 : 1;
    if (TYPE_RANK[a.type] !== TYPE_RANK[b.type]) return TYPE_RANK[a.type] - TYPE_RANK[b.type];
    const aId = a.id ?? Number.MAX_SAFE_INTEGER;
    const bId = b.id ?? Number.MAX_SAFE_INTEGER;
    if (aId !== bId) return aId - bId;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });

  let running = openingBalance;
  let totalIn = 0;
  let totalOut = 0;
  let countIn = 0;
  let countOut = 0;
  for (const e of raw) {
    running += e.masuk - e.keluar;
    e.balance = running;
    totalIn += e.masuk;
    totalOut += e.keluar;
    if (e.masuk > 0) countIn += 1;
    if (e.keluar > 0) countOut += 1;
  }

  const net = totalIn - totalOut;
  return {
    openingBalance,
    entries: raw,
    summary: {
      openingBalance,
      totalIn,
      totalOut,
      net,
      endingBalance: openingBalance + net,
      count: raw.length,
      countIn,
      countOut,
    },
  };
}

/** Baris tabel mentah (string) untuk pengujian dan export. */
export function toCashFlowTableRow(entry: CashPeriodEntry, index: number): string[] {
  return [
    String(index + 1),
    entry.tanggal,
    entry.type,
    entry.label,
    entry.detail,
    entry.method || "",
    String(entry.masuk),
    String(entry.keluar),
    String(entry.balance),
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

function cashTypeLabel(t: CashEntryType): string {
  if (t === "payment") return "Pembayaran";
  if (t === "expense") return "Pengeluaran";
  return "Penyesuaian";
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
    company: CashCompanyInfo;
    logoDataUrl: string | null;
    periodLabel: string;
  },
): void {
  const { pageWidth, margin, company, logoDataUrl, periodLabel } = opts;
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
  pdf.text("BUKU KAS", right, 13, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text("Finance • Arus Kas", right, 18, { align: "right" });
  pdf.text(`Periode: ${periodLabel}`, right, 22.5, { align: "right" });
  pdf.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, right, 27, { align: "right" });

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

export async function exportCashFlowPdf(args: {
  entries: CashPeriodEntry[];
  summary: CashPeriodSummary;
  from: string;
  to: string;
  company: CashCompanyInfo;
}): Promise<string> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const periodLabel = formatCashPeriodLabel(args.from, args.to);

  const rawLogo = args.company.logo_url ? await loadImageDataUrl(args.company.logo_url) : null;
  // Downscale agar logo besar tidak menggembungkan PDF.
  const logoDataUrl = rawLogo ? ((await downscaleDataUrl(rawLogo)) ?? rawLogo) : null;
  drawReportHeader(doc, { pageWidth, margin, company: args.company, logoDataUrl, periodLabel });

  let y = 42;
  y = drawSummaryCards(doc, margin, pageWidth, y, [
    ["Saldo Awal", formatRupiah(args.summary.openingBalance)],
    ["Kas Masuk", formatRupiah(args.summary.totalIn)],
    ["Kas Keluar", formatRupiah(args.summary.totalOut)],
    ["Saldo Akhir", formatRupiah(args.summary.endingBalance)],
  ]);

  const body = args.entries.map((e, i) => [
    String(i + 1),
    formatTanggalId(e.tanggal),
    cashTypeLabel(e.type),
    `${e.label}\n${e.detail}`,
    e.method || "—",
    e.masuk > 0 ? formatRupiah(e.masuk) : "—",
    e.keluar > 0 ? formatRupiah(e.keluar) : "—",
    formatRupiah(e.balance),
  ]);
  body.push([
    "",
    "",
    "",
    `${args.entries.length} mutasi`,
    "TOTAL",
    formatRupiah(args.summary.totalIn),
    formatRupiah(args.summary.totalOut),
    formatRupiah(args.summary.endingBalance),
  ]);

  autoTable(doc as never, {
    startY: y,
    head: [["No", "Tanggal", "Jenis", "Keterangan / Detail", "Metode", "Masuk", "Keluar", "Saldo"]],
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
      1: { halign: "center", cellWidth: 22 },
      2: { halign: "center", cellWidth: 24 },
      3: { cellWidth: "auto" },
      4: { halign: "center", cellWidth: 26 },
      5: { halign: "right", cellWidth: 28 },
      6: { halign: "right", cellWidth: 28 },
      7: { halign: "right", cellWidth: 30 },
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

  addReportFooter(doc, args.company.company_name || "Perusahaan", `Buku Kas • ${periodLabel}`);
  const filename = buildCashFlowFilename("pdf", args.from, args.to);
  doc.save(filename);
  return filename;
}
