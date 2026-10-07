/**
 * Pure helpers + PDF exporter untuk Finance Laba Rugi.
 *
 * Semantik akuntansi yang dikunci (konsisten dengan halaman):
 * - Periode ditentukan oleh `invoice_date` untuk pendapatan dan
 *   `expense_date` untuk pengeluaran.
 * - Invoice bulan lain tidak ikut periode.
 * - Pembayaran memakai SELURUH pembayaran milik invoice periode tersebut,
 *   tanpa dibatasi `payment_date`.
 * - Laba On Hand = pembayaran yang sudah diterima untuk invoice periode
 *   dikurangi pengeluaran periode.
 * - Piutang periode = total invoice periode dikurangi seluruh pembayaran
 *   milik invoice periode (tanpa saldo bulan sebelumnya).
 */

import { downscaleDataUrl } from "./pdf-logo";

export interface ProfitLossCompanyInfo {
  company_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  npwp?: string | null;
  logo_url?: string | null;
}

export interface ProfitLossCategoryInput {
  name: string;
  total: number;
  pct: number;
}

export interface ProfitLossIncomeRowInput {
  invoice_no: string;
  invoice_date: string;
  clientName: string;
  total_amount: number;
}

export interface ProfitLossReceivableRowInput {
  invoice_no: string;
  clientName: string;
  due_date: string | null;
  total: number;
  paid: number;
  remaining: number;
  bucket: string;
}

export interface ProfitLossPdfArgs {
  periodLabel: string;
  periodPrefix: string;
  pendapatan: number;
  pengeluaran: number;
  laba: number;
  margin: number;
  cashReceived: number;
  cashExpenses: number;
  cashProfit: number;
  cashMargin: number;
  totalInvoiced: number;
  totalPaid: number;
  totalReceivable: number;
  unpaidCount: number;
  overdueCount: number;
  overdueAmount: number;
  categories: ProfitLossCategoryInput[];
  incomes: ProfitLossIncomeRowInput[];
  receivables: ProfitLossReceivableRowInput[];
  company: ProfitLossCompanyInfo;
}

/** Nama file aman untuk export PDF Laba Rugi. */
export function buildProfitLossFilename(periodPrefix: string): string {
  const stamp = (periodPrefix || "").trim() || "semua";
  return `Laba_Rugi_${stamp}.pdf`;
}

export function toProfitLossIncomePdfRow(row: ProfitLossIncomeRowInput, index: number): string[] {
  return [
    String(index + 1),
    row.invoice_date,
    row.invoice_no,
    row.clientName || "—",
    String(row.total_amount),
  ];
}

export function toProfitLossCategoryPdfRow(row: ProfitLossCategoryInput, index: number): string[] {
  return [String(index + 1), row.name, String(row.total), `${row.pct.toFixed(2)}%`];
}

export function toProfitLossReceivablePdfRow(row: ProfitLossReceivableRowInput, index: number): string[] {
  return [
    String(index + 1),
    row.invoice_no,
    row.clientName || "—",
    row.due_date || "—",
    String(row.total),
    String(row.paid),
    String(row.remaining),
    row.bucket || "—",
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

function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "0,00%";
  return `${n.toFixed(2)}%`;
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
    company: ProfitLossCompanyInfo;
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
  pdf.text("LABA RUGI", right, 13, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text("Finance • Laba Rugi", right, 18, { align: "right" });
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

function drawSectionTitle(pdf: PdfDoc, margin: number, y: number, title: string, subtitle: string): number {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  pdf.text(title, margin, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text(subtitle, margin, y + 4.5);
  return y + 8;
}

function drawEmptyNote(pdf: PdfDoc, margin: number, y: number, message: string): number {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text(message, margin, y);
  return y + 6;
}

function ensureSpace(pdf: PdfDoc, y: number, needed: number, margin: number): number {
  const pageHeight = pdf.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 16) {
    pdf.addPage();
    return margin;
  }
  return y;
}

function getFinalY(doc: PdfDoc, fallback: number): number {
  const withTable = doc as unknown as { lastAutoTable?: { finalY?: number } };
  const finalY = withTable.lastAutoTable?.finalY;
  return typeof finalY === "number" && Number.isFinite(finalY) ? finalY : fallback;
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



export async function exportProfitLossPdf(args: ProfitLossPdfArgs): Promise<string> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const periodLabel = args.periodLabel || "Semua periode";

  const rawLogo = args.company.logo_url ? await loadImageDataUrl(args.company.logo_url) : null;
  // Downscale agar logo besar tidak menggembungkan PDF.
  const logoDataUrl = rawLogo ? ((await downscaleDataUrl(rawLogo)) ?? rawLogo) : null;
  drawReportHeader(doc, { pageWidth, margin, company: args.company, logoDataUrl, periodLabel });

  let y = 42;
  y = drawSummaryCards(doc, margin, pageWidth, y, [
    ["Pendapatan", formatRupiah(args.pendapatan)],
    ["Pengeluaran", formatRupiah(args.pengeluaran)],
    ["Laba Bersih", formatRupiah(args.laba)],
    ["Margin Laba", formatPercent(args.margin)],
  ]);
  y = drawSummaryCards(doc, margin, pageWidth, y, [
    ["Diterima Invoice Periode", formatRupiah(args.cashReceived)],
    ["Laba On Hand", formatRupiah(args.cashProfit)],
    [`Piutang (${args.unpaidCount} inv)`, formatRupiah(args.totalReceivable)],
    [`Jatuh Tempo (${args.overdueCount} inv)`, formatRupiah(args.overdueAmount)],
  ]);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  const basisNote =
    "Basis: pendapatan = invoice_date periode • pengeluaran = expense_date periode • " +
    "Laba On Hand = seluruh pembayaran milik invoice periode − pengeluaran periode • " +
    "piutang murni periode tanpa saldo bulan sebelumnya.";
  const noteLines = doc.splitTextToSize(basisNote, pageWidth - margin * 2);
  doc.text(noteLines.slice(0, 3), margin, y);
  y += noteLines.slice(0, 3).length * 3.4 + 3;

  // ── Tabel 1: Pengeluaran per kategori ──
  y = ensureSpace(doc, y, 20, margin);
  y = drawSectionTitle(
    doc,
    margin,
    y,
    "Pengeluaran per Kategori",
    `${args.categories.length} kategori • total ${formatRupiah(args.pengeluaran)}`,
  );
  if (args.categories.length === 0) {
    y = drawEmptyNote(doc, margin, y, "Tidak ada pengeluaran pada periode ini.");
  } else {
    const body = args.categories.map((c, i) => [
      String(i + 1),
      c.name,
      formatRupiah(c.total),
      formatPercent(c.pct),
    ]);
    body.push(["", `${args.categories.length} kategori`, formatRupiah(args.pengeluaran), "TOTAL"]);
    autoTable(doc as never, {
      startY: y,
      head: [["No", "Kategori", "Nominal", "Persentase"]],
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
        0: { halign: "center", cellWidth: 12 },
        1: { cellWidth: "auto" },
        2: { halign: "right", cellWidth: 42 },
        3: { halign: "center", cellWidth: 30 },
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
    y = getFinalY(doc, y + 20) + 6;
  }

  // ── Tabel 2: Rincian pendapatan ──
  y = ensureSpace(doc, y, 20, margin);
  y = drawSectionTitle(
    doc,
    margin,
    y,
    "Rincian Pendapatan",
    `${args.incomes.length} invoice • total ${formatRupiah(args.pendapatan)}`,
  );
  if (args.incomes.length === 0) {
    y = drawEmptyNote(doc, margin, y, "Tidak ada invoice pada periode ini.");
  } else {
    const body = args.incomes.map((r, i) => [
      String(i + 1),
      formatTanggalId(r.invoice_date),
      r.invoice_no,
      r.clientName || "—",
      formatRupiah(r.total_amount),
    ]);
    body.push(["", "", "", `${args.incomes.length} invoice`, formatRupiah(args.pendapatan)]);
    autoTable(doc as never, {
      startY: y,
      head: [["No", "Tanggal", "No. Invoice", "Klien", "Nominal"]],
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
        0: { halign: "center", cellWidth: 12 },
        1: { halign: "center", cellWidth: 26 },
        2: { cellWidth: 38 },
        3: { cellWidth: "auto" },
        4: { halign: "right", cellWidth: 42 },
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
    y = getFinalY(doc, y + 20) + 6;
  }

  // ── Tabel 3: Rincian piutang belum lunas ──
  y = ensureSpace(doc, y, 20, margin);
  y = drawSectionTitle(
    doc,
    margin,
    y,
    "Rincian Piutang Belum Lunas",
    `${args.unpaidCount} invoice • sisa ${formatRupiah(args.totalReceivable)} • jatuh tempo ${formatRupiah(args.overdueAmount)}`,
  );
  if (args.receivables.length === 0) {
    y = drawEmptyNote(doc, margin, y, "Tidak ada piutang belum lunas pada periode ini.");
  } else {
    const body = args.receivables.map((r, i) => [
      String(i + 1),
      r.invoice_no,
      r.clientName || "—",
      r.due_date ? formatTanggalId(r.due_date) : "—",
      formatRupiah(r.total),
      formatRupiah(r.paid),
      formatRupiah(r.remaining),
      r.bucket || "—",
    ]);
    body.push([
      "",
      "",
      "",
      `${args.receivables.length} invoice`,
      formatRupiah(args.totalInvoiced),
      formatRupiah(args.totalPaid),
      formatRupiah(args.totalReceivable),
      "TOTAL",
    ]);
    autoTable(doc as never, {
      startY: y,
      head: [["No", "No. Invoice", "Klien", "Jatuh Tempo", "Total", "Dibayar", "Sisa", "Status"]],
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
        1: { cellWidth: 30 },
        2: { cellWidth: 44 },
        3: { halign: "center", cellWidth: 24 },
        4: { halign: "right", cellWidth: 30 },
        5: { halign: "right", cellWidth: 30 },
        6: { halign: "right", cellWidth: 30 },
        7: { halign: "center", cellWidth: 34 },
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
    y = getFinalY(doc, y + 20) + 6;
  }

  // ── Ringkasan angka kunci (selalu dicetak agar periode kosong tetap bermakna) ──
  y = ensureSpace(doc, y, 30, margin);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(`Ringkasan ${periodLabel}`, margin, y);
  y += 6;
  const summaryRows: [string, string][] = [
    ["Pendapatan (invoice date)", formatRupiah(args.pendapatan)],
    ["Pengeluaran (expense date)", formatRupiah(args.pengeluaran)],
    ["Laba Bersih", formatRupiah(args.laba)],
    ["Margin Laba", formatPercent(args.margin)],
    ["Pembayaran invoice periode yang diterima", formatRupiah(args.cashReceived)],
    ["Pengeluaran periode (kas)", formatRupiah(args.cashExpenses)],
    ["Laba On Hand", formatRupiah(args.cashProfit)],
    ["Margin On Hand", formatPercent(args.cashMargin)],
    ["Invoice periode ini", formatRupiah(args.totalInvoiced)],
    ["Diterima invoice periode", formatRupiah(args.totalPaid)],
    ["Piutang periode ini", formatRupiah(args.totalReceivable)],
  ];
  autoTable(doc as never, {
    startY: y,
    head: [["Uraian", "Nominal"]],
    body: summaryRows,
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
      0: { cellWidth: 120 },
      1: { halign: "right", cellWidth: "auto" },
    },
    margin: { left: margin, right: margin, bottom: 16 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  addReportFooter(doc, args.company.company_name || "Perusahaan", `Laba Rugi • ${periodLabel}`);
  const filename = buildProfitLossFilename(args.periodPrefix);
  doc.save(filename);
  return filename;
}
