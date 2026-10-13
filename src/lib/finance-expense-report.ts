/**
 * Pure helpers + PDF exporter untuk Finance Pengeluaran.
 *
 * Konvensi yang dikunci:
 * - Filter memakai `expense_date`.
 * - Batas tanggal inklusif, string kosong berarti tanpa batas.
 * - Tabel, ringkasan, CSV, dan PDF memakai himpunan baris yang sama:
 *   filter tanggal → filter kategori → search.
 */

import { downscaleDataUrl } from "./pdf-logo";

export interface ExpenseCompanyInfo {
  company_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  npwp?: string | null;
  logo_url?: string | null;
}

export interface ExpensePdfInput {
  expense_date: string;
  category_name: string;
  description: string;
  vendor: string;
  method: string;
  amount: number;
  notes?: string | null;
}

export interface ExpensePeriodSummary {
  count: number;
  total: number;
  average: number;
  topCategoryName: string;
  topCategoryTotal: number;
}

/** Cek tanggal YYYY-MM-DD masuk rentang inklusif. Batas kosong = tanpa batas. */
export function isExpenseDateInRange(date: string, from: string, to: string): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function filterExpensesByDate<T extends { expense_date: string }>(
  rows: T[],
  from: string,
  to: string,
): T[] {
  if (!from && !to) return rows;
  return rows.filter((r) => isExpenseDateInRange(r.expense_date, from, to));
}

function defaultFmtDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Label periode Indonesia untuk header laporan. */
export function formatExpensePeriodLabel(
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

/** Ringkasan himpunan baris yang tampil (sudah difilter tanggal/kategori/search). */
export function summarizeExpenses(
  rows: { amount: number; category_name?: string | null }[],
): ExpensePeriodSummary {
  let total = 0;
  const byCat = new Map<string, number>();
  for (const r of rows) {
    total += r.amount || 0;
    const name = (r.category_name || "Tanpa kategori").trim() || "Tanpa kategori";
    byCat.set(name, (byCat.get(name) || 0) + (r.amount || 0));
  }
  let topCategoryName = "—";
  let topCategoryTotal = 0;
  for (const [name, sum] of byCat) {
    if (sum > topCategoryTotal) {
      topCategoryName = name;
      topCategoryTotal = sum;
    }
  }
  return {
    count: rows.length,
    total,
    average: rows.length > 0 ? Math.round(total / rows.length) : 0,
    topCategoryName: rows.length > 0 ? topCategoryName : "—",
    topCategoryTotal,
  };
}

/** Nama file aman untuk export. */
export function buildExpenseFilename(
  kind: "pdf" | "csv",
  from: string,
  to: string,
): string {
  const stamp = (s: string) => (s ? s : "semua");
  return `Pengeluaran_${stamp(from)}_${stamp(to)}.${kind}`;
}

export function toExpensePdfRow(row: ExpensePdfInput, index: number): string[] {
  return [
    String(index + 1),
    row.expense_date,
    row.category_name || "—",
    row.description || "—",
    row.vendor || "—",
    row.method || "—",
    String(row.amount),
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
    company: ExpenseCompanyInfo;
    logoDataUrl: string | null;
    periodLabel: string;
    filterLine: string;
  },
): void {
  const { pageWidth, margin, company, logoDataUrl, periodLabel, filterLine } = opts;
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
  pdf.text("REGISTER PENGELUARAN", right, 13, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text("Finance • Pengeluaran", right, 18, { align: "right" });
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

export async function exportExpensesPdf(args: {
  rows: ExpensePdfInput[];
  from: string;
  to: string;
  categoryFilter: string;
  search: string;
  company: ExpenseCompanyInfo;
  summary: ExpensePeriodSummary;
}): Promise<string> {
  if (args.rows.length === 0) throw new Error("Tidak ada pengeluaran pada filter aktif.");
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const periodLabel = formatExpensePeriodLabel(args.from, args.to);
  const filterBits: string[] = [];
  if (args.categoryFilter && args.categoryFilter !== "Semua") filterBits.push(`Kategori: ${args.categoryFilter}`);
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
    periodLabel,
    filterLine,
  });

  let y = 42;
  y = drawSummaryCards(doc, margin, pageWidth, y, [
    ["Jumlah Transaksi", `${args.summary.count} transaksi`],
    ["Total Pengeluaran", formatRupiah(args.summary.total)],
    ["Rata-rata", formatRupiah(args.summary.average)],
    ["Kategori Teratas", `${args.summary.topCategoryName} • ${formatRupiah(args.summary.topCategoryTotal)}`],
  ]);

  const body = args.rows.map((r, i) => [
    String(i + 1),
    formatTanggalId(r.expense_date),
    r.category_name || "—",
    r.description || "—",
    r.vendor || "—",
    r.method || "—",
    formatRupiah(r.amount),
  ]);
  body.push([
    "",
    "",
    "",
    `${args.rows.length} transaksi`,
    "",
    "TOTAL",
    formatRupiah(args.rows.reduce((s, r) => s + (r.amount || 0), 0)),
  ]);

  autoTable(doc as never, {
    startY: y,
    head: [["No", "Tanggal", "Kategori", "Deskripsi", "Vendor", "Metode", "Nominal"]],
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
      2: { halign: "center", cellWidth: 32 },
      3: { cellWidth: "auto" },
      4: { cellWidth: 34 },
      5: { halign: "center", cellWidth: 26 },
      6: { halign: "right", cellWidth: 30 },
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

  addReportFooter(doc, args.company.company_name || "Perusahaan", `Register Pengeluaran • ${periodLabel}`);
  const filename = buildExpenseFilename("pdf", args.from, args.to);
  doc.save(filename);
  return filename;
}
