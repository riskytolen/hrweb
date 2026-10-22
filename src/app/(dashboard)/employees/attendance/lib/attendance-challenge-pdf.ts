/**
 * Export PDF Laporan Challenge Mingguan CP Suka (Absensi → Analisa → Perorangan).
 *
 * Desain: A4 landscape, tema biru — kop perusahaan dengan logo,
 * kartu ringkasan peserta/lolos/gugur, tabel peringkat lengkap dengan
 * medali emas/perak/perunggu untuk rank 1–3, Lalu footer aturan challenge.
 *
 * Fungsi murni (`buildChallengePdfFilename`, `buildChallengePdfRows`,
 * `challengeMedalColor`) dipisah agar bisa diuji tanpa jsPDF/supabase.
 */

import type { ChallengeEmployeeResult, ChallengeWeek } from "./attendance-helpers";

// ─── Data murni (pure, bisa diuji) ───

type RGB = [number, number, number];

/** Warna medali rank 1–3; null untuk rank lain. */
export function challengeMedalColor(rank: number | null): RGB | null {
  if (rank === 1) return [217, 119, 6]; // emas (amber-600)
  if (rank === 2) return [100, 116, 139]; // perak (slate-500)
  if (rank === 3) return [180, 83, 9]; // perunggu (amber-700)
  return null;
}

/** Nama file aman untuk export PDF Challenge Mingguan. */
export function buildChallengePdfFilename(weekStart: string, weekEnd: string): string {
  return `Challenge_CP_Suka_${weekStart}_${weekEnd}.pdf`;
}

/**
 * Baris tabel PDF dari item challenge. Urutan input dipertahankan
 * (sudah rank lolos → gugur di bawah); styling medal dilakukan renderer.
 */
export function buildChallengePdfRows(items: ChallengeEmployeeResult[]): string[][] {
  return items.map((r) => [
    r.rank === null ? "—" : String(r.rank),
    r.nama,
    `${r.hadirWajib}/${r.totalWajib}`,
    String(r.statusCounts.hadir),
    String(r.statusCounts.terlambat),
    String(r.statusCounts.izin),
    String(r.statusCounts.sakit),
    String(r.statusCounts.cuti),
    String(r.statusCounts.alpha),
    String(r.statusCounts.libur),
    String(r.manual),
    r.avgJamMasuk ?? "—",
    r.lolos ? "LOLOS" : r.alasanGugur.join(" • "),
  ]);
}

// ─── PDF rendering (client-side, dynamic import jspdf) ───

const NAVY: RGB = [15, 23, 42];
const BLUE: RGB = [37, 99, 235];
const BLUE_SOFT: RGB = [219, 234, 254];
const GOLD: RGB = [217, 119, 6];
const GOLD_SOFT: RGB = [254, 243, 199];
const GOLD_BRIGHT: RGB = [146, 64, 14];
const GREEN: RGB = [22, 163, 74];
const GREEN_SOFT: RGB = [220, 252, 231];
const RED: RGB = [220, 38, 38];
const RED_SOFT: RGB = [254, 226, 226];
const MUTED: RGB = [100, 116, 139];
const FAINT: RGB = [148, 163, 184];
const INK: RGB = [15, 23, 42];
const BORDER: RGB = [226, 232, 240];
const LIGHT: RGB = [248, 250, 252];

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
  rect(x: number, y: number, w: number, h: number, style: string): void;
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void;
  getTextWidth(text: string): number;
  splitTextToSize(text: string, width: number): string[];
  getNumberOfPages(): number;
  setPage(n: number): void;
  save(filename: string): void;
}

interface CompanyHeaderInfo {
  nama: string;
  kontak: string;
}

/** Ambil data perusahaan untuk kop PDF; gagal → fallback teks. */
async function fetchCompanyHeader(): Promise<CompanyHeaderInfo> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from("company_settings").select("kode, nilai");
    const map: Record<string, string> = {};
    (data as { kode: string; nilai: string | null }[] | null)?.forEach((row) => {
      map[row.kode] = row.nilai || "";
    });
    const kontak = [map.alamat, map.no_telp, map.email].filter(Boolean).join(" • ");
    return {
      nama: map.nama_perusahaan || "JAMS LOGISTICS",
      kontak,
    };
  } catch {
    return { nama: "JAMS LOGISTICS", kontak: "" };
  }
}

async function loadCompanyLogo(): Promise<string | null> {
  const { loadDownscaledLogoDataUrl } = await import("@/lib/pdf-logo");
  // Logo di-downscale agar PDF tidak menggembung (aset beresolusi besar).
  return loadDownscaledLogoDataUrl("/jamslogistics.png");
}

function drawReportHeader(
  pdf: PdfDoc,
  opts: {
    pageWidth: number;
    margin: number;
    company: CompanyHeaderInfo;
    logoDataUrl: string | null;
    weekLabel: string;
    periodLabel: string;
    search: string;
    isRunning: boolean;
  },
): number {
  const { pageWidth, margin, company, logoDataUrl, weekLabel, periodLabel, search, isRunning } = opts;
  const right = pageWidth - margin;

  // Aksen biru di atas halaman.
  pdf.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
  pdf.rect(margin, 6, pageWidth - margin * 2, 1.6, "F");

  let y = 14;
  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, "PNG", margin, 10, 30, 13);
    } catch {
      /* abaikan logo rusak */
    }
  }
  const textLeft = logoDataUrl ? margin + 34 : margin;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  pdf.text(company.nama, textLeft, y + 1);
  y += 5.5;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  if (company.kontak) {
    const lines = pdf.splitTextToSize(company.kontak, pageWidth - textLeft - 104);
    pdf.text(lines.slice(0, 2), textLeft, y);
    y += lines.slice(0, 2).length * 3.3;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
  pdf.text("CHALLENGE MINGGUAN CP SUKA", right, 14, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text("Absensi • Analisa Perorangan", right, 18.5, { align: "right" });
  pdf.text(`Minggu: ${weekLabel}`, right, 23, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(INK[0], INK[1], INK[2]);
  pdf.text(`Periode: ${periodLabel}`, right, 27.5, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  pdf.text(`Dicetak: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`, right, 32.5, {
    align: "right",
  });

  pdf.setDrawColor(BLUE[0], BLUE[1], BLUE[2]);
  pdf.setLineWidth(0.8);
  pdf.line(margin, 37, right, 37);
  pdf.setLineWidth(0.2);

  // Baris filter + label minggu berjalan.
  const chipY = 37;
  let x = margin;
  pdf.setFontSize(8);
  if (search.trim()) {
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text(`Pencarian: "${search.trim()}"`, x, chipY + 4.5);
    x += pdf.getTextWidth(`Pencarian: "${search.trim()}"`) + 4;
  }
  if (isRunning) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.5);
    const label = "HASIL SEMENTARA — STATUS MASIH BISA BERUBAH";
    const w = pdf.getTextWidth(label) + 4;
    pdf.setFillColor(GOLD_SOFT[0], GOLD_SOFT[1], GOLD_SOFT[2]);
    pdf.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
    pdf.roundedRect(x, chipY + 1, w, 5, 1.5, 1.5, "FD");
    pdf.setTextColor(GOLD_BRIGHT[0], GOLD_BRIGHT[1], GOLD_BRIGHT[2]);
    pdf.text(label, x + 2, chipY + 4.4);
  }
  return chipY + 8;
}

function drawSummaryCards(
  pdf: PdfDoc,
  margin: number,
  pageWidth: number,
  y: number,
  cards: { label: string; value: string; kind: "neutral" | "success" | "danger" }[],
): number {
  const gap = 3;
  const w = (pageWidth - margin * 2 - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, i) => {
    const x = margin + i * (w + gap);
    if (card.kind === "success") {
      pdf.setFillColor(GREEN_SOFT[0], GREEN_SOFT[1], GREEN_SOFT[2]);
    } else if (card.kind === "danger") {
      pdf.setFillColor(RED_SOFT[0], RED_SOFT[1], RED_SOFT[2]);
    } else {
      pdf.setFillColor(BLUE_SOFT[0], BLUE_SOFT[1], BLUE_SOFT[2]);
    }
    pdf.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    pdf.roundedRect(x, y, w, 14, 2, 2, "FD");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text(card.label, x + 3, y + 5);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    if (card.kind === "success") {
      pdf.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
    } else if (card.kind === "danger") {
      pdf.setTextColor(RED[0], RED[1], RED[2]);
    } else {
      pdf.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
    }
    pdf.text(card.value, x + 3, y + 10.5);
  });
  return y + 18;
}

function addReportFooter(pdf: PdfDoc, weekLabel: string): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    pdf.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    pdf.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    pdf.setTextColor(FAINT[0], FAINT[1], FAINT[2]);
    pdf.text(
      `Divisi CP Suka • Senin–Minggu (${weekLabel}) • maksimal 1 absen manual • seri diputuskan rata-rata jam masuk paling awal`,
      14,
      pageHeight - 6,
    );
    pdf.text(`Halaman ${p} dari ${pages}`, pageWidth - 14, pageHeight - 6, { align: "right" });
  }
}

/** Generate PDF Laporan Challenge Mingguan CP Suka dan simpan ke browser. */
export async function exportChallengeWeekPdf(args: {
  week: ChallengeWeek;
  items: ChallengeEmployeeResult[];
  periodLabel: string;
  search: string;
}): Promise<string> {
  const { week, items, periodLabel, search } = args;
  if (week.isFuture) throw new Error("Minggu belum dimulai — belum ada yang bisa dicetak.");
  if (items.length === 0) throw new Error("Tidak ada peserta yang dinilai pada minggu ini.");

  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as PdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  const [company, logoDataUrl] = await Promise.all([fetchCompanyHeader(), loadCompanyLogo()]);

  let y = drawReportHeader(doc, {
    pageWidth,
    margin,
    company,
    logoDataUrl,
    weekLabel: week.label,
    periodLabel,
    search,
    isRunning: week.isRunning,
  });

  const lolos = items.filter((i) => i.lolos).length;
  const gugur = items.length - lolos;
  y = drawSummaryCards(doc, margin, pageWidth, y, [
    { label: "Peserta Dinilai", value: `${items.length} pegawai`, kind: "neutral" },
    { label: "Lolos", value: `${lolos} peserta`, kind: "success" },
    { label: "Gugur", value: `${gugur} peserta`, kind: "danger" },
  ]);

  autoTable(doc as never, {
    startY: y,
    head: [[
      "Rank", "Pegawai", "Kehadiran Wajib", "Hadir", "Telat", "Izin", "Sakit", "Cuti", "Alpha", "Libur",
      "Manual", "Rata-rata Jam", "Status",
    ]],
    body: buildChallengePdfRows(items),
    theme: "grid",
    styles: {
      fontSize: 7.5,
      cellPadding: 1.8,
      lineColor: BORDER,
      lineWidth: 0.1,
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: "bold", halign: "center", fontSize: 7.5 },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { halign: "center", cellWidth: 11 },
      1: { cellWidth: 42 },
      2: { halign: "center", cellWidth: 20 },
      3: { halign: "center", cellWidth: 13 },
      4: { halign: "center", cellWidth: 14 },
      5: { halign: "center", cellWidth: 13 },
      6: { halign: "center", cellWidth: 13 },
      7: { halign: "center", cellWidth: 13 },
      8: { halign: "center", cellWidth: 14 },
      9: { halign: "center", cellWidth: 13 },
      10: { halign: "center", cellWidth: 14 },
      11: { halign: "center", cellWidth: 18 },
      12: { halign: "left" },
    },
    margin: { left: margin, right: margin, bottom: 16 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== "body") return;
      const item = items[data.row.index] as ChallengeEmployeeResult | undefined;
      if (!item) return;
      const col = data.column.index as number;
      if (col === 0) {
        const medal = challengeMedalColor(item.rank);
        if (medal) {
          data.cell.styles.fillColor = medal;
          data.cell.styles.textColor = 255;
          data.cell.styles.fontStyle = "bold";
        } else {
          data.cell.styles.textColor = FAINT;
        }
      } else if (col === 1) {
        data.cell.styles.fontStyle = "bold";
      } else if (col === 2) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = item.lolos ? GREEN : RED;
      } else if (col >= 3 && col <= 9) {
        const count = item.statusCounts[
          ["hadir", "terlambat", "izin", "sakit", "cuti", "alpha", "libur"][col - 3] as keyof ChallengeEmployeeResult["statusCounts"]
        ];
        if (count === 0) data.cell.styles.textColor = FAINT;
        else data.cell.styles.fontStyle = "bold";
      } else if (col === 10) {
        if (item.manual === 0) data.cell.styles.textColor = FAINT;
        else if (item.manual === 1) {
          data.cell.styles.textColor = GOLD_BRIGHT;
          data.cell.styles.fontStyle = "bold";
        } else {
          data.cell.styles.textColor = RED;
          data.cell.styles.fontStyle = "bold";
        }
      } else if (col === 12) {
        if (item.lolos) {
          data.cell.styles.textColor = GREEN;
          data.cell.styles.fontStyle = "bold";
        } else {
          data.cell.styles.textColor = RED;
          data.cell.styles.fontSize = 7;
        }
      }
    },
  });

  addReportFooter(doc, week.label);
  const filename = buildChallengePdfFilename(week.weekStart, week.weekEnd);
  doc.save(filename);
  return filename;
}
