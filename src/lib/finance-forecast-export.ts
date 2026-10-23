/**
 * Export Finance → Forecast Finance (PDF + Excel).
 *
 * Susunan mengikuti lembar kerja forecast mingguan:
 * - kop perusahaan + identitas laporan (tema biru),
 * - kartu ringkasan bulan,
 * - tabel per minggu dengan panel PEMASUKAN / PENGELUARAN berdampingan,
 * - baris total minggu + ringkasan bulan di akhir,
 * - footer nomor halaman pada PDF.
 *
 * Semua nilai memakai nominal RENCANA. Pembayaran hanya pelacakan
 * (Sisa = nominal − pembayaran) dan tidak mengubah saldo forecast.
 */

import { downscaleDataUrl } from "./pdf-logo";
import {
  buildForecastFilename,
  buildForecastWeeks,
  computeForecast,
  computeForecastExpenseCategoryTotals,
  forecastMonthLabel,
  type ForecastExpenseLike,
  type ForecastIncomeLike,
  type ForecastSummary,
  type ForecastWeek,
  type ForecastWeekSummary,
} from "./finance-forecast";

export interface ForecastCompanyInfo {
  company_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  npwp?: string | null;
  logo_url?: string | null;
}

export interface ForecastIncomeExportRow extends ForecastIncomeLike {
  description: string;
  planned_date: string;
  invoice_id?: number | null;
}

export interface ForecastExpenseExportRow extends ForecastExpenseLike {
  description: string;
  planned_date: string;
  category?: string | null;
}

export interface ForecastExportInput {
  periodKey: string;
  openingBalance: number;
  incomes: ForecastIncomeExportRow[];
  expenses: ForecastExpenseExportRow[];
  company: ForecastCompanyInfo;
}

// Palet tema biru (selaras laporan Finance lain).
const NAVY: [number, number, number] = [30, 58, 95];
const BLUE: [number, number, number] = [37, 99, 235];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const BORDER: [number, number, number] = [203, 213, 225];
const SOFT_BLUE: [number, number, number] = [239, 246, 255];
const GREEN: [number, number, number] = [4, 120, 87];
const RED: [number, number, number] = [185, 28, 28];

function rp(n: number): string {
  const value = Math.round(Number.isFinite(n) ? n : 0);
  const sign = value < 0 ? "−" : "";
  return `${sign}Rp ${Math.abs(value).toLocaleString("id-ID")}`;
}

function rpOrDash(n: number): string {
  return Math.round(Number.isFinite(n) ? n : 0) === 0 ? "—" : rp(n);
}

function shortDate(date: string): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
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

// ─── PDF ───

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
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style: string): void;
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void;
  addPage(): void;
  getNumberOfPages(): number;
  setPage(n: number): void;
  splitTextToSize(text: string, width: number): string[];
  save(filename: string): void;
}

function drawPdfHeader(
  pdf: PdfDoc,
  opts: {
    pageWidth: number;
    margin: number;
    company: ForecastCompanyInfo;
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
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  pdf.text("FORECAST FINANCE", right, 13, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text("Finance • Rencana Kas Mingguan", right, 18, { align: "right" });
  pdf.text(`Periode: ${periodLabel}`, right, 22.5, { align: "right" });
  pdf.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, right, 27, { align: "right" });

  pdf.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
  pdf.setLineWidth(0.7);
  pdf.line(margin, 37, right, 37);
  pdf.setLineWidth(0.2);
}

function drawPdfSummaryCards(
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

function lastAutoTableY(pdf: PdfDoc, fallback: number): number {
  return (pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;
}

function drawPdfFooter(pdf: PdfDoc, companyName: string, periodLabel: string): void {
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
    pdf.text(`${companyName} • Forecast Finance • ${periodLabel}`, 14, pageHeight - 6);
    pdf.text(`Halaman ${p} dari ${pages}`, pageWidth - 14, pageHeight - 6, { align: "right" });
  }
}

function weekBodyRows(
  week: ForecastWeek,
  weekSummary: ForecastWeekSummary,
  incomes: ForecastIncomeExportRow[],
  expenses: ForecastExpenseExportRow[],
): unknown[] {
  const weekIncomes = incomes.filter((r) => r.week_no === week.weekNo);
  const weekExpenses = expenses.filter((r) => r.week_no === week.weekNo);
  const rows: unknown[] = [
    {
      content: `MINGGU ${week.weekNo}  •  ${week.rangeLabel.toUpperCase()}`,
      colSpan: 9,
      styles: {
        fillColor: [219, 234, 254],
        textColor: NAVY,
        fontStyle: "bold",
        fontSize: 8.2,
        cellPadding: 2.2,
      },
    },
  ];

  const pairCount = Math.max(weekIncomes.length, weekExpenses.length);
  if (pairCount === 0) {
    rows.push([
      {
        content: "Belum ada rencana pemasukan / pengeluaran pada minggu ini.",
        colSpan: 9,
        styles: { textColor: MUTED, fontStyle: "italic", halign: "center" },
      },
    ]);
  }

  for (let i = 0; i < pairCount; i += 1) {
    const inc = weekIncomes[i];
    const exp = weekExpenses[i];
    rows.push([
      inc?.description ?? "",
      inc ? shortDate(inc.planned_date) : "",
      inc ? rp(inc.amount) : "",
      exp ? shortDate(exp.planned_date) : "",
      exp?.description ?? "",
      exp ? rp(exp.amount) : "",
      exp ? rpOrDash(exp.payment) : "",
      exp ? rpOrDash(exp.admin) : "",
      exp ? rpOrDash(exp.amount - exp.payment) : "",
    ]);
  }

  rows.push([
    {
      content:
        `Total Minggu ${week.weekNo}  —  Pemasukan ${rp(weekSummary.income)}  •  ` +
        `Pengeluaran ${rp(weekSummary.nominalOut)}  •  Dibayar ${rp(weekSummary.payment)}  •  ` +
        `Admin ${rp(weekSummary.admin)}  •  Saldo ${rp(weekSummary.closing)}`,
      colSpan: 9,
      styles: {
        fillColor: [248, 250, 252],
        textColor: INK,
        fontStyle: "bold",
        halign: "right",
        fontSize: 7.4,
      },
    },
  ]);

  return rows;
}

interface ForecastRecapItems {
  left: [string, number][];
  right: [string, number][];
  totalSaldo: number;
  totalPengeluaran: number;
  margin: number;
}

/** Susunan rekap bulanan yang sama untuk PDF dan Excel. */
function buildRecapItems(
  summary: ForecastSummary,
  expenses: ForecastExpenseExportRow[],
): ForecastRecapItems {
  const left: [string, number][] = [["Saldo Awal", summary.openingBalance]];
  for (const week of summary.weeks) {
    left.push([`Minggu ${week.weekNo}`, week.income]);
  }
  left.push(["Lainnya", 0]);

  const right: [string, number][] = computeForecastExpenseCategoryTotals(expenses).map(
    (item) => [item.category, item.amount],
  );

  return {
    left,
    right,
    totalSaldo: summary.totalAvailable,
    totalPengeluaran: summary.totalNominalOut,
    margin: summary.totalAvailable - summary.totalNominalOut,
  };
}

export async function exportForecastPdf(args: ForecastExportInput): Promise<string> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const periodLabel = forecastMonthLabel(args.periodKey);
  const weeks = buildForecastWeeks(args.periodKey);
  const summary = computeForecast(args.openingBalance, args.incomes, args.expenses);

  const rawLogo = args.company.logo_url ? await loadImageDataUrl(args.company.logo_url) : null;
  const logoDataUrl = rawLogo ? ((await downscaleDataUrl(rawLogo)) ?? rawLogo) : null;
  drawPdfHeader(doc, { pageWidth, margin, company: args.company, logoDataUrl, periodLabel });

  let y = 42;
  y = drawPdfSummaryCards(doc, margin, pageWidth, y, [
    ["Total Pemasukan", rp(summary.totalIncome)],
    ["Total Pengeluaran", rp(summary.totalNominalOut)],
    ["Total Pembayaran", rp(summary.totalPayment)],
    ["Saldo Akhir Forecast", rp(summary.closingBalance)],
  ]);

  const body: unknown[] = [];
  for (const week of weeks) {
    body.push(
      ...weekBodyRows(week, summary.weeks[week.weekNo - 1], args.incomes, args.expenses),
    );
  }

  body.push({
    content: "RINGKASAN BULAN",
    colSpan: 9,
    styles: {
      fillColor: NAVY,
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: 2.2,
    },
  });

  const summaryPairs: [string, number, string, number][] = [
    ["Saldo Awal Bulan", summary.openingBalance, "Total Pemasukan", summary.totalIncome],
    ["Dana Tersedia", summary.totalAvailable, "Total Pengeluaran", summary.totalNominalOut],
    ["Total Pembayaran", summary.totalPayment, "Sisa Kewajiban", summary.totalSisa],
    ["Total Admin", summary.totalAdmin, "Saldo Akhir Forecast", summary.closingBalance],
  ];
  summaryPairs.forEach(([labelA, valueA, labelB, valueB], idx) => {
    const isLast = idx === summaryPairs.length - 1;
    const labelStyle = {
      fillColor: SOFT_BLUE,
      fontStyle: "bold",
      textColor: INK,
    };
    const valueStyle = {
      fillColor: isLast ? [219, 234, 254] : SOFT_BLUE,
      fontStyle: "bold",
      textColor: isLast ? BLUE : INK,
      halign: "right",
    };
    body.push([
      { content: labelA, colSpan: 3, styles: labelStyle },
      { content: rp(valueA), colSpan: 1, styles: valueStyle },
      { content: labelB, colSpan: 3, styles: labelStyle },
      { content: rp(valueB), colSpan: 2, styles: valueStyle },
    ]);
  });

  autoTable(doc as never, {
    startY: y,
    head: [
      [
        { content: "PEMASUKAN", colSpan: 3, styles: { halign: "center", fillColor: GREEN, fontSize: 8 } },
        { content: "PENGELUARAN", colSpan: 6, styles: { halign: "center", fillColor: RED, fontSize: 8 } },
      ],
      ["Keterangan", "Tanggal", "Nominal", "Tanggal", "Keterangan", "Nominal", "Pembayaran", "Admin", "Sisa"],
    ],
    body: body as never,
    theme: "grid",
    styles: {
      fontSize: 7.2,
      cellPadding: 1.6,
      lineColor: BORDER,
      lineWidth: 0.1,
      valign: "middle",
      overflow: "linebreak",
      textColor: INK,
    },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 19, halign: "center" },
      2: { cellWidth: 25, halign: "right" },
      3: { cellWidth: 19, halign: "center" },
      4: { cellWidth: 56 },
      5: { cellWidth: 25, halign: "right" },
      6: { cellWidth: 23, halign: "right" },
      7: { cellWidth: 19, halign: "right" },
      8: { cellWidth: 25, halign: "right" },
    },
    margin: { left: margin, right: margin, bottom: 16 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  // Rekap bulanan bergaya lembar PDF: saldo di kiri, kategori di kanan.
  const recap = buildRecapItems(summary, args.expenses);
  const pageHeight = doc.internal.pageSize.getHeight();
  let recapY = lastAutoTableY(doc, y) + 8;
  if (recapY + 40 > pageHeight - 16) {
    doc.addPage();
    recapY = 18;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text("REKAP BULANAN — SALDO & PENGELUARAN PER KATEGORI", margin, recapY);
  recapY += 3;

  const recapRowCount = Math.max(recap.left.length, recap.right.length);
  const recapBody: unknown[] = [];
  for (let i = 0; i < recapRowCount; i += 1) {
    const left = recap.left[i];
    const right = recap.right[i];
    recapBody.push([
      left?.[0] ?? "",
      left ? rp(left[1]) : "",
      right?.[0] ?? "",
      right ? rp(right[1]) : "",
    ]);
  }
  recapBody.push([
    {
      content: "TOTAL SALDO",
      styles: { fontStyle: "bold", fillColor: [219, 234, 254], textColor: BLUE },
    },
    {
      content: rp(recap.totalSaldo),
      styles: { halign: "right", fontStyle: "bold", fillColor: [219, 234, 254], textColor: BLUE },
    },
    {
      content: "TOTAL PENGELUARAN",
      styles: { fontStyle: "bold", fillColor: [254, 226, 226], textColor: RED },
    },
    {
      content: rp(recap.totalPengeluaran),
      styles: { halign: "right", fontStyle: "bold", fillColor: [254, 226, 226], textColor: RED },
    },
  ]);

  autoTable(doc as never, {
    startY: recapY,
    head: [
      [
        { content: "SALDO", colSpan: 2, styles: { halign: "center", fillColor: NAVY, textColor: 255 } },
        { content: "PENGELUARAN", colSpan: 2, styles: { halign: "center", fillColor: NAVY, textColor: 255 } },
      ],
    ],
    body: recapBody as never,
    theme: "grid",
    styles: {
      fontSize: 7.2,
      cellPadding: 1.6,
      lineColor: BORDER,
      lineWidth: 0.1,
      textColor: INK,
      valign: "middle",
    },
    headStyles: { fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 40, halign: "right" },
      2: { cellWidth: 100 },
      3: { cellWidth: 59, halign: "right" },
    },
    margin: { left: margin, right: margin, bottom: 16 },
    rowPageBreak: "avoid",
  });

  let marginY = lastAutoTableY(doc, recapY) + 6;
  if (marginY + 34 > pageHeight - 16) {
    doc.addPage();
    marginY = 18;
  }

  doc.setFillColor(RED[0], RED[1], RED[2]);
  doc.roundedRect(margin, marginY, pageWidth - margin * 2, 11, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text("MARGIN BERSIH", margin + 4, marginY + 7);
  doc.text(rp(recap.margin), pageWidth - margin - 4, marginY + 7, { align: "right" });

  autoTable(doc as never, {
    startY: marginY + 14,
    body: [
      [
        { content: "Admin", styles: { fontStyle: "bold" } },
        { content: rp(summary.totalAdmin), styles: { halign: "right" } },
        {
          content: "Saldo Akhir setelah Admin",
          styles: { fontStyle: "bold", fillColor: [219, 234, 254], textColor: BLUE },
        },
        {
          content: rp(summary.closingBalance),
          styles: { halign: "right", fontStyle: "bold", fillColor: [219, 234, 254], textColor: BLUE },
        },
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 7.2,
      cellPadding: 2,
      lineColor: BORDER,
      lineWidth: 0.1,
      textColor: INK,
    },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 40, halign: "right" },
      2: { cellWidth: 100 },
      3: { cellWidth: 59, halign: "right" },
    },
    margin: { left: margin, right: margin, bottom: 16 },
  });

  drawPdfFooter(doc, args.company.company_name || "Perusahaan", periodLabel);
  const filename = buildForecastFilename("pdf", args.periodKey);
  doc.save(filename);
  return filename;
}

// ─── XLSX ───

type XlsxCell = string | number;

function pushWeekRows(
  rows: XlsxCell[][],
  mergeRows: number[],
  week: ForecastWeek,
  weekSummary: ForecastWeekSummary,
  incomes: ForecastIncomeExportRow[],
  expenses: ForecastExpenseExportRow[],
): void {
  const weekIncomes = incomes.filter((r) => r.week_no === week.weekNo);
  const weekExpenses = expenses.filter((r) => r.week_no === week.weekNo);

  mergeRows.push(rows.length);
  rows.push([`MINGGU ${week.weekNo} (${week.rangeLabel})`]);
  rows.push(["PEMASUKAN", "", "", "", "PENGELUARAN", "", "", "", "", ""]);
  rows.push([
    "Keterangan", "Tanggal", "Nominal", "",
    "Tanggal", "Keterangan", "Nominal", "Pembayaran", "Admin", "Sisa",
  ]);

  const pairCount = Math.max(weekIncomes.length, weekExpenses.length);
  if (pairCount === 0) {
    rows.push(["Belum ada rencana pada minggu ini.", "", "", "", "", "", "", "", "", ""]);
  }
  for (let i = 0; i < pairCount; i += 1) {
    const inc = weekIncomes[i];
    const exp = weekExpenses[i];
    rows.push([
      inc?.description ?? "",
      inc ? shortDate(inc.planned_date) : "",
      inc ? inc.amount : "",
      "",
      exp ? shortDate(exp.planned_date) : "",
      exp?.description ?? "",
      exp ? exp.amount : "",
      exp ? exp.payment : "",
      exp ? exp.admin : "",
      exp ? exp.amount - exp.payment : "",
    ]);
  }

  rows.push([
    `Total Minggu ${week.weekNo}`, "", weekSummary.income, "",
    "", "", weekSummary.nominalOut, weekSummary.payment, weekSummary.admin,
    weekSummary.sisa,
  ]);
  rows.push([
    "Saldo Awal Minggu", "", weekSummary.opening, "",
    "", "Saldo Akhir Minggu", weekSummary.closing, "", "", "",
  ]);
  rows.push([]);
}

export async function exportForecastXlsx(args: ForecastExportInput): Promise<string> {
  const XLSX = await import("xlsx");
  const periodLabel = forecastMonthLabel(args.periodKey);
  const weeks = buildForecastWeeks(args.periodKey);
  const summary = computeForecast(args.openingBalance, args.incomes, args.expenses);

  const rows: XlsxCell[][] = [];
  const mergeRows: number[] = [];

  rows.push(["FORECAST FINANCE"]);
  rows.push(["Perusahaan", args.company.company_name || "Perusahaan"]);
  rows.push(["Periode", periodLabel]);
  rows.push([
    "Saldo Awal Bulan",
    args.openingBalance,
    "",
    "Dicetak",
    new Date().toLocaleString("id-ID"),
  ]);
  rows.push([]);

  for (const week of weeks) {
    pushWeekRows(rows, mergeRows, week, summary.weeks[week.weekNo - 1], args.incomes, args.expenses);
  }

  mergeRows.push(rows.length);
  rows.push(["RINGKASAN BULAN"]);
  rows.push(["Saldo Awal Bulan", summary.openingBalance]);
  rows.push(["Total Pemasukan", summary.totalIncome]);
  rows.push(["Total Dana Tersedia", summary.totalAvailable]);
  rows.push(["Total Pengeluaran", summary.totalNominalOut]);
  rows.push(["Total Pembayaran", summary.totalPayment]);
  rows.push(["Sisa Kewajiban", summary.totalSisa]);
  rows.push(["Total Admin", summary.totalAdmin]);
  rows.push(["Saldo Akhir Forecast", summary.closingBalance]);

  rows.push([]);
  mergeRows.push(rows.length);
  rows.push(["REKAP BULANAN — SALDO & PENGELUARAN PER KATEGORI"]);
  rows.push(["SALDO", "", "", "", "", "PENGELUARAN", "", "", "", ""]);

  const recap = buildRecapItems(summary, args.expenses);
  const recapRowCount = Math.max(recap.left.length, recap.right.length);
  for (let i = 0; i < recapRowCount; i += 1) {
    const left = recap.left[i];
    const right = recap.right[i];
    rows.push([
      left?.[0] ?? "",
      left?.[1] ?? "",
      "",
      "",
      "",
      right?.[0] ?? "",
      right?.[1] ?? "",
      "",
      "",
      "",
    ]);
  }
  rows.push([
    "TOTAL SALDO",
    recap.totalSaldo,
    "",
    "",
    "",
    "TOTAL PENGELUARAN",
    recap.totalPengeluaran,
    "",
    "",
    "",
  ]);
  rows.push([]);
  rows.push(["MARGIN BERSIH", recap.margin]);
  rows.push(["Admin", summary.totalAdmin]);
  rows.push(["Saldo Akhir setelah Admin", summary.closingBalance]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = mergeRows.map((r) => ({
    s: { r, c: 0 },
    e: { r, c: 9 },
  }));
  sheet["!cols"] = [
    { wch: 38 }, { wch: 14 }, { wch: 16 }, { wch: 3 }, { wch: 14 },
    { wch: 36 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 16 },
  ];

  // Format ribuan untuk semua sel numerik.
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (cell && typeof cell.v === "number") cell.z = "#,##0";
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Forecast");
  const filename = buildForecastFilename("xlsx", args.periodKey);
  XLSX.writeFile(workbook, filename, { compression: true });
  return filename;
}
