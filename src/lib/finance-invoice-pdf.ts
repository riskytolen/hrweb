/**
 * Generator PDF invoice fisik Finance — A4 landscape, siap cetak.
 *
 * Isi dokumen (tanpa status/riwayat pembayaran — murni surat tagihan):
 * - Kop: logo + identitas perusahaan (kiri), judul INVOICE + nomor/tanggal (kanan)
 * - Ditagihkan kepada (klien) + deskripsi pekerjaan
 * - Tabel rincian komponen biaya (komponen Rp0 disembunyikan)
 * - Total Biaya, Dasar Pengenaan Pajak (DPP), PPN, PPh, Total Tagihan
 * - Terbilang, catatan, instruksi transfer rekening utama
 * - Kolom tanda tangan manual (tanda tangan basah/stempel)
 */

import { loadDownscaledLogoDataUrl } from "./pdf-logo";
import { invoiceTaxSchemeLabel } from "./finance";

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
  }).format(n || 0);
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
  lastAutoTable: { finalY: number };
  save(filename: string): void;
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
  const margin = 14;
  const right = pageWidth - margin;
  const contentW = pageWidth - margin * 2;

  // ── Kop: kiri identitas perusahaan, kanan judul invoice ──
  const logo = await loadLogoBox(company.logo_url, 30, 15);
  const textLeft = margin + (logo ? logo.w + 4 : 0);
  const leftTextW = right - 108 - textLeft; // sisakan kolom kanan
  let ly = 12;
  if (logo) {
    try {
      pdfSafeAddImage(doc, logo.dataUrl, margin, 8, logo.w, logo.h);
    } catch {
      /* abaikan logo rusak */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  const nameLines = doc.splitTextToSize(company.company_name || "Perusahaan", Math.max(40, leftTextW));
  doc.text(nameLines.slice(0, 2), textLeft, ly);
  ly += nameLines.slice(0, 2).length * 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  const contactBits = [company.address, [company.phone, company.email].filter(Boolean).join(" • ")]
    .filter(Boolean)
    .join(" • ");
  if (contactBits) {
    const cl = doc.splitTextToSize(contactBits, Math.max(40, leftTextW));
    doc.text(cl.slice(0, 3), textLeft, ly);
    ly += cl.slice(0, 3).length * 3.6;
  }
  if (company.npwp) {
    doc.text(`NPWP: ${company.npwp}`, textLeft, ly);
    ly += 3.8;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text("INVOICE", right, 14, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.text(invoice.invoice_no, right, 20, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(`Tanggal: ${formatTanggalId(invoice.invoice_date)}`, right, 25, { align: "right" });
  doc.text(`Jatuh Tempo: ${formatTanggalId(invoice.due_date)}`, right, 29.5, { align: "right" });

  const ruleY = Math.max(ly + 2, 34);
  doc.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.setLineWidth(0.8);
  doc.line(margin, ruleY, right, ruleY);
  doc.setLineWidth(0.2);

  // ── Ditagihkan kepada + deskripsi pekerjaan ──
  let y = ruleY + 6;
  const leftColW = Math.round(contentW * 0.48);
  const gapCols = 8;
  const rightColX = margin + leftColW + gapCols;
  const rightColW = contentW - leftColW - gapCols;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text("DITAGIHKAN KEPADA", margin, y);
  doc.text("KETERANGAN", rightColX, y);
  y += 4.5;

  const clientName = invoiceClientName(client);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  const nameW = doc.splitTextToSize(clientName, leftColW);
  doc.text(nameW.slice(0, 2), margin, y);
  let leftY = y + nameW.slice(0, 2).length * 4.6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  const clientBits = [client?.address, [client?.phone, client?.email].filter(Boolean).join(" • ")]
    .filter(Boolean)
    .join(" • ");
  if (clientBits) {
    const cLines = doc.splitTextToSize(clientBits, leftColW);
    doc.text(cLines, margin, leftY);
    leftY += cLines.length * 3.8;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  const desc = invoice.description?.trim() || "—";
  const dLines = doc.splitTextToSize(desc, rightColW);
  doc.text(dLines, rightColX, y);
  const rightY = y + dLines.length * 4;

  y = Math.max(leftY, rightY) + 4;

  // ── Tabel rincian biaya ──
  const lines = buildInvoiceCostLines(invoice);
  const body = lines.map((l, i) => [String(i + 1), l.label, formatRupiah(l.amount)]);
  autoTable(doc as never, {
    startY: y,
    head: [["No", "Uraian", "Jumlah (Rp)"]],
    body,
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 2.2,
      lineColor: BORDER,
      lineWidth: 0.1,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: "center", cellWidth: 14 },
      1: { cellWidth: "auto" },
      2: { halign: "right", cellWidth: 55 },
    },
    margin: { left: margin, right: margin, bottom: 16 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  let ty = doc.lastAutoTable.finalY + 4;

  // Total + tanda tangan butuh ±110mm; pindah halaman bila tidak muat.
  const bottomNeed = 112;
  if (ty > pageHeight - margin - bottomNeed) {
    doc.addPage();
    ty = margin + 2;
  }

  // ── Blok total (kanan) ──
  const totalW = 105;
  const totalX = right - totalW;
  const rowH = 6.2;
  const totals: { label: string; value: string; bold?: boolean }[] = [
    { label: "Total Biaya", value: formatRupiah(toAmount(invoice.subtotal)) },
    {
      label: `Dasar Pengenaan Pajak (DPP) • ${invoiceTaxSchemeLabel(invoice.tax_scheme)}`,
      value: formatRupiah(toAmount(invoice.tax_base_amount ?? invoice.subtotal)),
    },
  ];
  if (toAmount(invoice.ppn_amount) > 0) {
    totals.push({ label: `PPN (${formatPercent(invoice.ppn_percent)})`, value: formatRupiah(toAmount(invoice.ppn_amount)) });
  }
  if (toAmount(invoice.pph_amount) > 0) {
    totals.push({ label: `PPh (${formatPercent(invoice.pph_percent)})`, value: formatRupiah(toAmount(invoice.pph_amount)) });
  }
  totals.push({ label: "TOTAL TAGIHAN", value: formatRupiah(toAmount(invoice.total_amount)), bold: true });

  totals.forEach((t, i) => {
    const isLast = i === totals.length - 1;
    const rh = isLast ? rowH + 1.6 : rowH;
    if (isLast) {
      doc.setFillColor(LIGHT_BLUE[0], LIGHT_BLUE[1], LIGHT_BLUE[2]);
      doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
      doc.roundedRect(totalX, ty, totalW, rh + 1.4, 1.5, 1.5, "FD");
    } else {
      doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
      doc.line(totalX, ty + rh, right, ty + rh);
    }
    doc.setFont("helvetica", isLast ? "bold" : "normal");
    doc.setFontSize(isLast ? 10 : 8.5);
    doc.setTextColor(isLast ? NAVY[0] : INK[0], isLast ? NAVY[1] : INK[1], isLast ? NAVY[2] : INK[2]);
    const labelLines = doc.splitTextToSize(t.label, totalW - 52);
    doc.text(labelLines.slice(0, 2), totalX + 2, ty + 4.2);
    doc.text(t.value, right - 2, ty + 4.2 + (isLast ? 0.8 : 0), { align: "right" });
    ty += rh + (isLast ? 1.4 : 0);
  });
  const afterTotalsY = ty + 4;

  // ── Bawah: kiri terbilang/catatan/rekening, kanan tanda tangan ──
  let by = doc.lastAutoTable.finalY + 4;
  const leftBottomW = totalX - margin - gapCols;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text("TERBILANG", margin, by);
  by += 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  const words = doc.splitTextToSize(`"${formatTerbilang(toAmount(invoice.total_amount))}"`, leftBottomW);
  doc.text(words, margin, by);
  by += words.length * 4 + 3;

  if (invoice.notes?.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text("CATATAN", margin, by);
    by += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    const nLines = doc.splitTextToSize(invoice.notes.trim(), leftBottomW);
    // Halaman baru bila catatan tidak muat di sisa ruang.
    if (by + nLines.length * 3.8 > pageHeight - margin - 8) {
      doc.addPage();
      by = margin + 2;
    }
    doc.text(nLines, margin, by);
    by += nLines.length * 3.8 + 3;
  }

  if (hasBankInstruction(company)) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text("PEMBAYARAN", margin, by);
    by += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    const bankLine = `Mohon transfer ke ${company.bank_name?.trim() || "rekening berikut"} • No. Rek ${company.bank_account_number?.trim()}${company.bank_account_name?.trim() ? ` • a.n. ${company.bank_account_name.trim()}` : ""}`;
    const bLines = doc.splitTextToSize(bankLine, leftBottomW);
    doc.text(bLines, margin, by);
    by += bLines.length * 3.8;
  }

  // ── Tanda tangan (kanan bawah) ──
  let sy = Math.max(afterTotalsY + 2, pageHeight - margin - 52);
  if (sy + 50 > pageHeight - margin) {
    doc.addPage();
    sy = margin + 4;
  }
  const signW = totalW + 10;
  const signX = right - signW;
  const city = company.signer_city?.trim();
  const placeDate = city ? `${city}, ${formatTanggalId(invoice.invoice_date)}` : formatTanggalId(invoice.invoice_date);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(placeDate, signX + signW / 2, sy, { align: "center" });
  doc.text("Hormat kami,", signX + signW / 2, sy + 4.5, { align: "center" });
  // Ruang tanda tangan basah/stempel manual.
  sy += 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  const signerName = company.signer_name?.trim() || "( .............................. )";
  doc.text(signerName, signX + signW / 2, sy, { align: "center" });
  if (company.signer_name?.trim()) {
    const nw = doc.getTextWidth(signerName);
    doc.setDrawColor(INK[0], INK[1], INK[2]);
    doc.line(signX + signW / 2 - nw / 2, sy + 1.5, signX + signW / 2 + nw / 2, sy + 1.5);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
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
