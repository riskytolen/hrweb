/**
 * Generator PDF invoice fisik Finance — A4 landscape, siap cetak.
 *
 * Isi dokumen (tanpa status/riwayat pembayaran — murni surat tagihan):
 * - Kop: logo + identitas perusahaan (kiri), judul INVOICE + nomor/tanggal (kanan)
 * - Ditagihkan kepada (klien) + deskripsi pekerjaan
 * - Tabel rincian komponen biaya (komponen Rp0 disembunyikan)
 * - Total Biaya, Dasar Pengenaan Pajak (DPP), PPN, PPh, Total Tagihan
 * - Terbilang, catatan, instruksi transfer rekening utama
 * - TTD digital (PNG transparan) bila diupload; fallback tanda tangan basah/stempel
 */

import { loadDownscaledLogoDataUrl } from "./pdf-logo";
import { invoiceTaxSchemeLabel } from "./finance";
import {
  computeSignatureBox,
  findVisibleAlphaBounds,
  SIGNATURE_MAX_H_MM,
  SIGNATURE_MAX_W_MM,
} from "./finance-signature";

export interface InvoicePdfClient {
  company_name?: string | null;
  contact_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface InvoicePdfCompany {
  company_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  npwp?: string | null;
  logo_url?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_name?: string | null;
  signer_city?: string | null;
  signer_name?: string | null;
  signer_title?: string | null;
  /** Signed URL sesaat file TTD digital (PNG transparan). Null = tanda tangan manual. */
  signer_signature_url?: string | null;
}

export interface InvoicePdfInput {
  invoice_no: string;
  invoice_date: string;
  due_date?: string | null;
  description?: string | null;
  trip_amount?: number | null;
  toll_amount?: number | null;
  parking_amount?: number | null;
  other_amount?: number | null;
  /** Total biaya sebelum pajak (= subtotal). */
  subtotal: number;
  tax_scheme?: string | null;
  tax_base_amount?: number | null;
  ppn_percent?: number | string | null;
  ppn_amount?: number | null;
  pph_percent?: number | string | null;
  pph_amount?: number | null;
  total_amount: number;
  notes?: string | null;
}

export interface InvoiceCostLine {
  label: string;
  amount: number;
}

const BLUE: [number, number, number] = [37, 99, 235];
const NAVY: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];
const INK: [number, number, number] = [15, 23, 42];
const BORDER: [number, number, number] = [226, 232, 240];
const LIGHT_BLUE: [number, number, number] = [219, 234, 254];
const SOFT: [number, number, number] = [248, 250, 252];
const SKY: [number, number, number] = [239, 246, 255];
const DANGER: [number, number, number] = [190, 18, 60];

export interface InvoiceSummaryRow {
  label: string;
  value: string;
  caption?: string;
  emphasis?: "normal" | "deduction" | "total";
}

export interface PaymentInstructionRow {
  label: string;
  value: string;
}

/** Nama file aman dari nomor invoice: `Invoice_<no-dis Sanitized>.pdf`. */
export function buildInvoiceFilename(invoiceNo: string): string {
  const safe = (invoiceNo || "invoice").replace(/[^a-zA-Z0-9-_.]+/g, "_").slice(0, 80) || "invoice";
  return `Invoice_${safe}.pdf`;
}

function toAmount(n: number | null | undefined): number {
  return Number.isFinite(n as number) ? Math.max(0, Math.round(n as number)) : 0;
}

/**
 * Proyeksi komponen biaya untuk tabel rincian. Komponen Rp0 disembunyikan
 * agar invoice fisik ringkas; jika semuanya nol, tampilkan satu baris
 * "Total Biaya" agar tabel tidak kosong.
 */
export function buildInvoiceCostLines(inv: InvoicePdfInput): InvoiceCostLine[] {
  const lines: InvoiceCostLine[] = [];
  const trip = toAmount(inv.trip_amount);
  const toll = toAmount(inv.toll_amount);
  const parking = toAmount(inv.parking_amount);
  const other = toAmount(inv.other_amount);
  if (trip > 0) lines.push({ label: "Biaya Perjalanan", amount: trip });
  if (toll > 0) lines.push({ label: "Biaya Toll", amount: toll });
  if (parking > 0) lines.push({ label: "Biaya Parkir", amount: parking });
  if (other > 0) lines.push({ label: "Biaya Lain", amount: other });
  if (lines.length === 0 && toAmount(inv.subtotal) > 0) {
    lines.push({ label: "Total Biaya", amount: toAmount(inv.subtotal) });
  }
  return lines;
}

/** True bila ada instruksi rekening yang layak tampil. */
export function hasBankInstruction(company: InvoicePdfCompany): boolean {
  return Boolean(company.bank_account_number?.trim());
}

/** Nama klien untuk blok "Ditagihkan Kepada". */
export function invoiceClientName(client: InvoicePdfClient | null | undefined): string {
  if (!client) return "—";
  return client.company_name?.trim() || client.contact_name?.trim() || "—";
}

/** Ringkasan pajak yang eksplisit: PPN menambah, PPh mengurangi total tagihan. */
export function buildInvoiceSummaryRows(inv: InvoicePdfInput): InvoiceSummaryRow[] {
  return [
    { label: "Total Biaya", value: formatRupiah(toAmount(inv.subtotal)) },
    {
      label: "Dasar Pengenaan Pajak (DPP)",
      value: formatRupiah(toAmount(inv.tax_base_amount ?? inv.subtotal)),
      caption: invoiceTaxSchemeLabel(inv.tax_scheme),
    },
    {
      label: `PPN (${formatPercent(inv.ppn_percent)})`,
      value: `+${formatRupiah(toAmount(inv.ppn_amount))}`,
    },
    {
      label: `Potongan PPh (${formatPercent(inv.pph_percent)})`,
      value: `-${formatRupiah(toAmount(inv.pph_amount))}`,
      emphasis: "deduction",
    },
    {
      label: "TOTAL TAGIHAN",
      value: formatRupiah(toAmount(inv.total_amount)),
      emphasis: "total",
    },
  ];
}

/** Baris rekening agar blok pembayaran PDF tidak berupa satu kalimat panjang. */
export function buildPaymentInstructionRows(company: InvoicePdfCompany): PaymentInstructionRow[] {
  if (!hasBankInstruction(company)) return [];
  return [
    { label: "Bank", value: company.bank_name?.trim() || "—" },
    { label: "Nomor Rekening", value: company.bank_account_number?.trim() || "—" },
    { label: "Atas Nama", value: company.bank_account_name?.trim() || "—" },
  ];
}

// ─── Terbilang rupiah ───

const UNITS = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"];

/** Ubah bilangan bulat non-negatif menjadi kata bahasa Indonesia. Pure. */
export function numberToWordsId(n: number): string {
  if (!Number.isFinite(n)) return "nol";
  const v = Math.floor(Math.abs(n));
  if (v === 0) return "nol";
  if (v < 10) return UNITS[v];
  if (v < 20) return v === 10 ? "sepuluh" : v === 11 ? "sebelas" : `${UNITS[v - 10]} belas`;
  if (v < 100) {
    const t = Math.floor(v / 10);
    const r = v % 10;
    return r === 0 ? `${UNITS[t]} puluh` : `${UNITS[t]} puluh ${UNITS[r]}`;
  }
  if (v < 1000) {
    const h = Math.floor(v / 100);
    const r = v % 100;
    const head = h === 1 ? "seratus" : `${UNITS[h]} ratus`;
    return r === 0 ? head : `${head} ${numberToWordsId(r)}`;
  }
  if (v < 1_000_000) {
    const t = Math.floor(v / 1000);
    const r = v % 1000;
    const head = t === 1 ? "seribu" : `${numberToWordsId(t)} ribu`;
    return r === 0 ? head : `${head} ${numberToWordsId(r)}`;
  }
  if (v < 1_000_000_000) {
    const m = Math.floor(v / 1_000_000);
    const r = v % 1_000_000;
    const head = `${numberToWordsId(m)} juta`;
    return r === 0 ? head : `${head} ${numberToWordsId(r)}`;
  }
  if (v < 1_000_000_000_000) {
    const b = Math.floor(v / 1_000_000_000);
    const r = v % 1_000_000_000;
    const head = `${numberToWordsId(b)} miliar`;
    return r === 0 ? head : `${head} ${numberToWordsId(r)}`;
  }
  const t = Math.floor(v / 1_000_000_000_000);
  const r = v % 1_000_000_000_000;
  const head = `${numberToWordsId(t)} triliun`;
  return r === 0 ? head : `${head} ${numberToWordsId(r)}`;
}

/** "Sembilan juta sembilan ratus sepuluh ribu rupiah". Pure. */
export function formatTerbilang(n: number): string {
  const words = numberToWordsId(n);
  const cap = words.charAt(0).toUpperCase() + words.slice(1);
  return `${cap} rupiah`;
}

function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0).replace(/\s+/g, "");
}

function formatTanggalId(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function formatPercent(p: number | string | null | undefined): string {
  const n = Number(p);
  if (!Number.isFinite(n) || n === 0) return "0%";
  return `${Number(n.toFixed(2))}%`;
}

// ─── PDF rendering (client-side, dynamic import jspdf) ───

export interface PdfTextDoc {
  setFont(font: string, style: string): void;
  setFontSize(size: number): void;
  getTextWidth(text: string): number;
  splitTextToSize(text: string, width: number): string[];
}

interface PdfDoc extends PdfTextDoc {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
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
  lastAutoTable: { finalY: number };
  save(filename: string): void;
}

/** Muat TTD digital dan hitung ukuran proporsional tanpa memperbesar (mm). */
async function loadSignatureBox(
  url: string | null | undefined,
  maxW: number = SIGNATURE_MAX_W_MM,
  maxH: number = SIGNATURE_MAX_H_MM,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!url) return null;
  try {
    const dataUrl = await loadDownscaledLogoDataUrl(url);
    if (!dataUrl) return null;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("signature"));
      img.src = dataUrl;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    const canvas = document.createElement("canvas");
    canvas.width = iw;
    canvas.height = ih;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, iw, ih);
    const bounds = findVisibleAlphaBounds(ctx.getImageData(0, 0, iw, ih).data, iw, ih);
    let signatureDataUrl = dataUrl;
    let visibleW = iw;
    let visibleH = ih;
    if (bounds) {
      const crop = document.createElement("canvas");
      crop.width = bounds.width;
      crop.height = bounds.height;
      const cropCtx = crop.getContext("2d");
      if (cropCtx) {
        cropCtx.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
        signatureDataUrl = crop.toDataURL("image/png");
        visibleW = bounds.width;
        visibleH = bounds.height;
      }
    }
    const box = computeSignatureBox(visibleW, visibleH, maxW, maxH);
    if (box.w <= 0 || box.h <= 0) return null;
    return { dataUrl: signatureDataUrl, w: box.w, h: box.h };
  } catch {
    return null;
  }
}

/** Muat logo dan hitung ukuran proporsional dalam kotak maksimum (mm). */
async function loadLogoBox(
  url: string | null | undefined,
  maxW: number,
  maxH: number,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!url) return null;
  try {
    const dataUrl = await loadDownscaledLogoDataUrl(url);
    if (!dataUrl) return null;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo"));
      img.src = dataUrl;
    });
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    const scale = Math.min(maxW / iw, maxH / ih);
    return { dataUrl, w: iw * scale, h: ih * scale };
  } catch {
    return null;
  }
}

function setColor(pdf: PdfDoc, color: [number, number, number], mode: "text" | "fill" | "draw"): void {
  if (mode === "text") pdf.setTextColor(color[0], color[1], color[2]);
  if (mode === "fill") pdf.setFillColor(color[0], color[1], color[2]);
  if (mode === "draw") pdf.setDrawColor(color[0], color[1], color[2]);
}

function drawCard(pdf: PdfDoc, x: number, y: number, w: number, h: number, fill: [number, number, number] = [255, 255, 255]): void {
  setColor(pdf, fill, "fill");
  setColor(pdf, BORDER, "draw");
  pdf.setLineWidth(0.15);
  pdf.roundedRect(x, y, w, h, 2.6, 2.6, "FD");
}

function drawCapsLabel(pdf: PdfDoc, label: string, x: number, y: number, color: [number, number, number] = MUTED): void {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.3);
  setColor(pdf, color, "text");
  pdf.text(label.toUpperCase(), x, y);
}

function fitLineToWidth(pdf: PdfTextDoc, text: string, width: number): string {
  if (pdf.getTextWidth(text) <= width) return text;

  const ellipsis = "...";
  let trimmed = text.trimEnd();
  while (trimmed.length > 0 && pdf.getTextWidth(`${trimmed}${ellipsis}`) > width) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed ? `${trimmed}${ellipsis}` : ellipsis;
}

export function splitLimited(
  pdf: PdfTextDoc,
  text: string,
  width: number,
  limit: number,
  font: { family?: string; style?: string; size?: number } = {},
): string[] {
  if (font.family || font.style) pdf.setFont(font.family || "helvetica", font.style || "normal");
  if (font.size) pdf.setFontSize(font.size);
  const lines = pdf.splitTextToSize(text, width);
  const out = (lines.length <= limit ? lines : lines.slice(0, limit)).map((line) => fitLineToWidth(pdf, line, width));
  if (lines.length <= limit) return out;
  const last = out[out.length - 1] || "";
  out[out.length - 1] = fitLineToWidth(pdf, last.endsWith("...") ? last : `${last}...`, width);
  return out;
}

function addInvoiceFooter(pdf: PdfDoc, companyName: string, invoiceNo: string): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    pdf.setLineWidth(0.2);
    pdf.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(140);
    pdf.text(`${companyName} • Invoice ${invoiceNo}`, 14, pageHeight - 6);
    pdf.text(`Halaman ${p} dari ${pages}`, pageWidth - 14, pageHeight - 6, { align: "right" });
  }
}

export async function exportInvoicePdf(args: {
  invoice: InvoicePdfInput;
  client: InvoicePdfClient | null | undefined;
  company: InvoicePdfCompany;
}): Promise<string> {
  const { invoice, client, company } = args;
  if (!invoice.invoice_no) throw new Error("Nomor invoice wajib ada untuk membuat PDF.");

  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth(); // 297
  const pageHeight = doc.internal.pageSize.getHeight(); // 210
  const margin = 13;
  const right = pageWidth - margin;
  const contentW = pageWidth - margin * 2;
  const footerSpace = 12;

  // ── Header modern: identitas perusahaan + panel invoice ──
  const [logo, signature] = await Promise.all([
    loadLogoBox(company.logo_url, 31, 15),
    loadSignatureBox(company.signer_signature_url),
  ]);
  const headerY = 9;
  const headerH = 29;
  const metaW = 92;
  const brandW = contentW - metaW - 7;
  drawCard(doc, margin, headerY, contentW, headerH, [255, 255, 255]);
  setColor(doc, SKY, "fill");
  setColor(doc, BORDER, "draw");
  doc.roundedRect(right - metaW, headerY, metaW, headerH, 2.6, 2.6, "FD");
  setColor(doc, BLUE, "fill");
  doc.rect(right - metaW, headerY, 3, headerH, "F");

  if (logo) {
    try {
      pdfSafeAddImage(doc, logo.dataUrl, margin + 5, headerY + 7, logo.w, logo.h);
    } catch {
      /* abaikan logo rusak */
    }
  }
  const textLeft = margin + 5 + (logo ? logo.w + 6 : 0);
  const leftTextW = brandW - (textLeft - margin) - 6;
  let ly = headerY + 8.8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.2);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  const nameLines = splitLimited(doc, company.company_name || "Perusahaan", Math.max(45, leftTextW), 1);
  doc.text(nameLines.slice(0, 2), textLeft, ly);
  ly += 4.9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.1);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  const contactBits = [company.address, [company.phone, company.email].filter(Boolean).join(" • ")]
    .filter(Boolean)
    .join(" • ");
  if (contactBits) {
    const cl = splitLimited(doc, contactBits, Math.max(45, leftTextW), 2);
    doc.text(cl, textLeft, ly);
    ly += cl.length * 3.3;
  }
  if (company.npwp) {
    doc.text(`NPWP: ${company.npwp}`, textLeft, ly);
    ly += 3.8;
  }

  const metaX = right - metaW + 8;
  const metaRight = right - 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  setColor(doc, NAVY, "text");
  doc.text("INVOICE", metaRight, headerY + 10, { align: "right" });
  doc.setFontSize(10);
  setColor(doc, BLUE, "text");
  doc.text(invoice.invoice_no, metaRight, headerY + 15.6, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  setColor(doc, MUTED, "text");
  doc.text("Tanggal", metaX, headerY + 22.3);
  doc.text(formatTanggalId(invoice.invoice_date), metaRight, headerY + 22.3, { align: "right" });
  doc.setFont("helvetica", "bold");
  setColor(doc, DANGER, "text");
  doc.text("Jatuh Tempo", metaX, headerY + 26.8);
  doc.text(formatTanggalId(invoice.due_date), metaRight, headerY + 26.8, { align: "right" });

  // ── Info utama: kartu klien dan detail tagihan ──
  let y = headerY + headerH + 4;
  const gapCols = 6;
  const leftColW = Math.round(contentW * 0.45);
  const rightColX = margin + leftColW + gapCols;
  const rightColW = contentW - leftColW - gapCols;
  const clientName = invoiceClientName(client);
  const clientNameLines = splitLimited(doc, clientName, leftColW - 10, 1, { style: "bold", size: 9.7 });
  const clientBits = [client?.address, [client?.phone, client?.email].filter(Boolean).join(" • ")]
    .filter(Boolean)
    .join(" • ");
  const clientLines = clientBits ? splitLimited(doc, clientBits, leftColW - 10, 2, { size: 7.4 }) : [];
  const desc = invoice.description?.trim() || "—";
  const detailTextW = rightColW - 12;
  const dLines = splitLimited(doc, desc, detailTextW, 3, { size: 8.2 });
  const cardH = 25;
  drawCard(doc, margin, y, leftColW, cardH, SOFT);
  drawCard(doc, rightColX, y, rightColW, cardH, [255, 255, 255]);
  drawCapsLabel(doc, "Ditagihkan Kepada", margin + 5, y + 6);
  drawCapsLabel(doc, "Detail Tagihan", rightColX + 5, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.7);
  setColor(doc, INK, "text");
  doc.text(clientNameLines, margin + 5, y + 12);
  if (client?.company_name && client.contact_name) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, MUTED, "text");
    doc.text(client.contact_name, margin + 5, y + 12 + clientNameLines.length * 4.5);
  }
  if (clientLines.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.4);
    setColor(doc, MUTED, "text");
    doc.text(clientLines, margin + 5, y + 17);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  setColor(doc, INK, "text");
  doc.text(dLines, rightColX + 5, y + 12);
  y += cardH + 4;

  // ── Tabel rincian biaya ──
  const lines = buildInvoiceCostLines(invoice);
  const body = lines.map((l, i) => [String(i + 1), l.label, formatRupiah(l.amount)]);
  autoTable(doc as never, {
    startY: y,
    head: [["No", "Rincian Tagihan", "Jumlah"]],
    body,
    theme: "grid",
    styles: {
      fontSize: 8.2,
      cellPadding: 1.7,
      lineColor: BORDER,
      lineWidth: 0.1,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", halign: "center", minCellHeight: 6.4 },
    alternateRowStyles: { fillColor: SOFT },
    columnStyles: {
      0: { halign: "center", cellWidth: 13 },
      1: { cellWidth: "auto" },
      2: { halign: "right", cellWidth: 58 },
    },
    margin: { left: margin, right: margin, bottom: footerSpace + 3 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  // ── Area bawah: terbilang/catatan/pembayaran + ringkasan/tanda tangan ──
  const leftBottomW = Math.round(contentW * 0.57);
  const totalW = contentW - leftBottomW - gapCols;
  const totalX = margin + leftBottomW + gapCols;
  const lowerY = doc.lastAutoTable.finalY + 4;
  const notesLines = invoice.notes?.trim() ? splitLimited(doc, invoice.notes.trim(), leftBottomW - 10, 3) : [];
  const paymentRows = buildPaymentInstructionRows(company);
  const lowerH = Math.max(52, pageHeight - lowerY - footerSpace - 5);
  const leftCardH = lowerH;
  const rightCardH = lowerH;
  drawCard(doc, margin, lowerY, leftBottomW, leftCardH, [255, 255, 255]);
  drawCard(doc, totalX, lowerY, totalW, rightCardH, [255, 255, 255]);

  let by = lowerY + 7;
  drawCapsLabel(doc, "Terbilang", margin + 5, by);
  by += 4.5;
  setColor(doc, SKY, "fill");
  setColor(doc, BORDER, "draw");
  doc.roundedRect(margin + 5, by - 3, leftBottomW - 10, 11.5, 2, 2, "FD");
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  setColor(doc, INK, "text");
  const words = splitLimited(doc, `"${formatTerbilang(toAmount(invoice.total_amount))}"`, leftBottomW - 17, 2);
  doc.text(words, margin + 8, by + 2);
  by += 12.5;

  if (notesLines.length > 0) {
    drawCapsLabel(doc, "Catatan", margin + 5, by);
    by += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    setColor(doc, MUTED, "text");
    doc.text(notesLines, margin + 5, by);
    by += notesLines.length * 3.2 + 2;
  }

  if (paymentRows.length > 0) {
    drawCapsLabel(doc, "Informasi Pembayaran", margin + 5, by, BLUE);
    by += 4.3;
    paymentRows.forEach((row, idx) => {
      const yy = by + idx * 5.3;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.4);
      setColor(doc, MUTED, "text");
      doc.text(row.label, margin + 5, yy);
      doc.setFont("helvetica", row.label === "Nomor Rekening" ? "bold" : "normal");
      doc.setFontSize(row.label === "Nomor Rekening" ? 8.6 : 7.8);
      setColor(doc, INK, "text");
      doc.text(row.value, margin + 45, yy);
    });
    by += paymentRows.length * 5.3 + 1.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.9);
    setColor(doc, MUTED, "text");
    doc.text(splitLimited(doc, `Mohon cantumkan nomor invoice ${invoice.invoice_no} pada berita transfer.`, leftBottomW - 10, 1), margin + 5, by);
  }

  // Ringkasan pembayaran dan pajak.
  let ty = lowerY + 7;
  drawCapsLabel(doc, "Ringkasan Tagihan", totalX + 5, ty, BLUE);
  ty += 4.4;
  buildInvoiceSummaryRows(invoice).forEach((row) => {
    const isTotal = row.emphasis === "total";
    const rh = isTotal ? 9.5 : row.caption ? 7 : 5.6;
    if (isTotal) {
      setColor(doc, LIGHT_BLUE, "fill");
      setColor(doc, BLUE, "draw");
      doc.roundedRect(totalX + 5, ty, totalW - 10, rh, 2, 2, "FD");
    } else {
      setColor(doc, BORDER, "draw");
      doc.line(totalX + 5, ty + rh, totalX + totalW - 5, ty + rh);
    }
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    doc.setFontSize(isTotal ? 9.4 : 7.7);
    setColor(doc, row.emphasis === "deduction" ? DANGER : INK, "text");
    doc.text(row.label, totalX + 6.5, ty + (isTotal ? 6.1 : 3.7));
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    doc.setFontSize(isTotal ? 9.7 : 7.7);
    doc.text(row.value, totalX + totalW - 7, ty + (isTotal ? 6.1 : 3.7), { align: "right" });
    if (row.caption) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.3);
      setColor(doc, MUTED, "text");
      doc.text(splitLimited(doc, row.caption, totalW - 50, 1), totalX + 6.5, ty + 6.2);
    }
    ty += rh;
  });

  // Tanda tangan tetap di kartu kanan bawah, dekat ringkasan tagihan.
  let sy = Math.max(ty + 4, lowerY + rightCardH - 32);
  const signW = totalW - 10;
  const signX = totalX + 5;
  const city = company.signer_city?.trim();
  const placeDate = city ? `${city}, ${formatTanggalId(invoice.invoice_date)}` : formatTanggalId(invoice.invoice_date);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  const dateY = sy;
  const regardsY = sy + 3.8;
  const nameY = sy + 18;
  doc.text(placeDate, signX + signW / 2, dateY, { align: "center" });
  doc.text("Hormat kami,", signX + signW / 2, regardsY, { align: "center" });
  // TTD digital sengaja dibuat besar dan boleh menimpa teks/nama agar terasa seperti TTD/cap asli.
  if (signature) {
    try {
      const sx = signX + (signW - signature.w) / 2;
      const signatureY = (regardsY + nameY) / 2 - signature.h / 2;
      pdfSafeAddImage(doc, signature.dataUrl, sx, signatureY, signature.w, signature.h);
    } catch {
      /* abaikan TTD rusak */
    }
  }
  sy = nameY;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.7);
  const signerName = company.signer_name?.trim() || "( .............................. )";
  doc.text(signerName, signX + signW / 2, sy, { align: "center" });
  if (company.signer_name?.trim()) {
    const nw = doc.getTextWidth(signerName);
    doc.setDrawColor(INK[0], INK[1], INK[2]);
    doc.line(signX + signW / 2 - nw / 2, sy + 1.5, signX + signW / 2 + nw / 2, sy + 1.5);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(company.signer_title?.trim() || "Penandatangan", signX + signW / 2, sy + 6, { align: "center" });

  addInvoiceFooter(doc, company.company_name || "Perusahaan", invoice.invoice_no);
  const filename = buildInvoiceFilename(invoice.invoice_no);
  doc.save(filename);
  return filename;
}

function pdfSafeAddImage(doc: PdfDoc, dataUrl: string, x: number, y: number, w: number, h: number): void {
  doc.addImage(dataUrl, "PNG", x, y, w, h);
}
