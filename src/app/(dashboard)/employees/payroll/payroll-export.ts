import { supabase } from "@/lib/supabase";
import { PENDAPATAN_FIELDS, POTONGAN_FIELDS, type FieldDef, type PayrollRow } from "./constants";

type PeriodRange = { start: string; end: string; label: string };

type PayrollCompanyInfo = {
  namaPerusahaan: string;
  namaBadanHukum: string;
  alamat: string;
  noTelp: string;
  email: string;
};

type PayrollEmployeeSnapshot = {
  nama: string;
  jabatan: string;
  bank: string;
  noRekening: string;
  namaRekening: string;
};

type PayrollTotals = {
  totalPendapatan: number;
  totalPotongan: number;
  totalNetto: number;
};

type PdfDoc = {
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  setFillColor: (...args: number[]) => void;
  setDrawColor: (...args: number[]) => void;
  setFont: (fontName: string, fontStyle?: string) => void;
  setFontSize: (size: number) => void;
  setLineWidth: (width: number) => void;
  setPage: (pageNumber: number) => void;
  setTextColor: (...args: number[]) => void;
  addImage: (imageData: HTMLImageElement, format: string, x: number, y: number, width: number, height: number) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  rect: (x: number, y: number, width: number, height: number, style?: string) => void;
  roundedRect: (x: number, y: number, width: number, height: number, rx: number, ry: number, style?: string) => void;
  splitTextToSize: (text: string, maxWidth: number) => string[];
  text: (text: string | string[], x: number, y: number, options?: { align?: "left" | "center" | "right" }) => void;
  getNumberOfPages: () => number;
  save: (filename: string) => void;
};

const rupiahFormatter = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

function formatRupiah(value: number | null | undefined): string {
  return rupiahFormatter.format(Number(value || 0));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fileSafe(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "pegawai";
}

function amount(row: PayrollRow, key: string): number {
  const value = (row as unknown as Record<string, unknown>)[key];
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function textValue(row: PayrollRow, key: string): string {
  const value = (row as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function getFieldRows(row: PayrollRow, fields: FieldDef[]): [string, string, string][] {
  return fields.map((field) => [field.label, field.keteranganKey ? textValue(row, field.keteranganKey) || "-" : "-", formatRupiah(amount(row, field.key))]);
}

export function getPayrollEmployeeSnapshot(row: PayrollRow): PayrollEmployeeSnapshot {
  const pegawai = row.pegawai as { bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null } | undefined;
  return {
    nama: row.final_employee_nama || row.pegawaiNama || row.employee_id,
    jabatan: row.final_employee_jabatan || row.pegawaiJabatan || "-",
    bank: row.final_employee_bank || pegawai?.bank || "-",
    noRekening: row.final_employee_no_rekening || pegawai?.no_rekening || "-",
    namaRekening: row.final_employee_nama_rekening || pegawai?.nama_rekening || "-",
  };
}

export function getPayrollTotals(rows: PayrollRow[]): PayrollTotals {
  return rows.reduce(
    (totals, row) => ({
      totalPendapatan: totals.totalPendapatan + amount(row, "total_pendapatan"),
      totalPotongan: totals.totalPotongan + amount(row, "total_potongan"),
      totalNetto: totals.totalNetto + amount(row, "netto"),
    }),
    { totalPendapatan: 0, totalPotongan: 0, totalNetto: 0 },
  );
}

async function getPayrollCompanyInfo(): Promise<PayrollCompanyInfo> {
  const { data } = await supabase.from("company_settings").select("kode, nilai");
  const settings: Record<string, string> = {};
  (data as { kode: string; nilai: string | null }[] | null)?.forEach((row) => {
    settings[row.kode] = row.nilai || "";
  });
  return {
    namaPerusahaan: settings.nama_perusahaan || "JAMS LOGISTICS",
    namaBadanHukum: settings.nama_badan_hukum || "CV. JAMI BERKAH TRANSINDO",
    alamat: settings.alamat || "",
    noTelp: settings.no_telp || "",
    email: settings.email || "",
  };
}

async function addLogo(doc: PdfDoc, pageWidth: number, y: number, width: number, height: number): Promise<boolean> {
  try {
    const logo = new Image();
    await new Promise<void>((resolve, reject) => {
      logo.onload = () => resolve();
      logo.onerror = () => reject(new Error("Logo gagal dimuat"));
      logo.src = "/jamslogistics.png";
    });
    doc.addImage(logo, "PNG", (pageWidth - width) / 2, y, width, height);
    return true;
  } catch {
    return false;
  }
}

async function addPortraitHeader(doc: PdfDoc, company: PayrollCompanyInfo): Promise<number> {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 12;
  const hasLogo = await addLogo(doc, pageWidth, y, 56, 20);
  if (hasLogo) {
    y += 24;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(37, 99, 235);
    doc.text(company.namaPerusahaan, pageWidth / 2, y + 8, { align: "center" });
    y += 18;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30);
  doc.text(company.namaBadanHukum, pageWidth / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(90);
  if (company.alamat) doc.text(company.alamat, pageWidth / 2, y + 4, { align: "center" });
  const contacts = [company.noTelp && `Telp: ${company.noTelp}`, company.email && `Email: ${company.email}`].filter(Boolean).join(" | ");
  if (contacts) doc.text(contacts, pageWidth / 2, y + 8, { align: "center" });
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.8);
  doc.line(18, y + 12, pageWidth - 18, y + 12);
  return y + 22;
}

function addFooter(doc: PdfDoc, company: PayrollCompanyInfo, label: string): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(210);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(`${company.namaPerusahaan} - ${label}`, 14, pageHeight - 6);
    doc.text(`Halaman ${page} dari ${pages}`, pageWidth - 14, pageHeight - 6, { align: "right" });
  }
}

function lastAutoTableY(doc: PdfDoc, fallback: number): number {
  return ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback);
}

export async function exportPayrollSlipPdf(row: PayrollRow, periodRange: PeriodRange): Promise<string> {
  if (row.status !== "Final") throw new Error("Slip hanya bisa diexport setelah status Final.");

  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const company = await getPayrollCompanyInfo();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pdf = doc as unknown as PdfDoc;
  const pageWidth = pdf.internal.pageSize.getWidth();
  let y = await addPortraitHeader(pdf, company);
  const employee = getPayrollEmployeeSnapshot(row);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(20);
  pdf.text("SLIP GAJI", pageWidth / 2, y, { align: "center" });
  y += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(90);
  pdf.text(`Periode ${periodRange.label} (${formatDate(periodRange.start)} - ${formatDate(periodRange.end)})`, pageWidth / 2, y, { align: "center" });
  y += 8;

  autoTable(doc, {
    startY: y,
    theme: "grid",
    body: [
      ["Nomor Slip", `#${row.id}`, "Status", "Final"],
      ["ID Pegawai", row.employee_id, "Nama", employee.nama],
      ["Jabatan", employee.jabatan, "Finalisasi", formatDateTime(row.locked_at || row.final_snapshot_at)],
      ["Bank", employee.bank, "No. Rekening", employee.noRekening],
      ["Nama Rekening", employee.namaRekening, "Snapshot", formatDateTime(row.final_snapshot_at)],
    ],
    styles: { fontSize: 8, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.1 },
    columnStyles: {
      0: { fontStyle: "bold", textColor: [80, 80, 80], cellWidth: 28 },
      1: { cellWidth: 60 },
      2: { fontStyle: "bold", textColor: [80, 80, 80], cellWidth: 28 },
      3: { cellWidth: 56 },
    },
    margin: { left: 18, right: 18 },
  });

  y = lastAutoTableY(pdf, y) + 8;
  const tableRows = [
    ["PENDAPATAN", "", ""],
    ...getFieldRows(row, PENDAPATAN_FIELDS),
    ["Total Pendapatan", "", formatRupiah(row.total_pendapatan)],
    ["POTONGAN", "", ""],
    ...getFieldRows(row, POTONGAN_FIELDS),
    ["Total Potongan", "", formatRupiah(row.total_potongan)],
    ["GAJI BERSIH", "", formatRupiah(row.netto)],
  ];

  autoTable(doc, {
    startY: y,
    head: [["Komponen", "Keterangan", "Nominal"]],
    body: tableRows,
    styles: { fontSize: 8, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 70 },
      2: { cellWidth: 40, halign: "right" },
    },
    margin: { left: 18, right: 18, bottom: 18 },
    didParseCell: (data) => {
      const label = Array.isArray(data.row.raw) ? String(data.row.raw[0]) : "";
      if (label === "PENDAPATAN" || label === "POTONGAN") {
        data.cell.styles.fillColor = [239, 246, 255];
        data.cell.styles.textColor = [37, 99, 235];
        data.cell.styles.fontStyle = "bold";
      }
      if (label === "Total Pendapatan" || label === "Total Potongan" || label === "GAJI BERSIH") {
        data.cell.styles.fillColor = label === "GAJI BERSIH" ? [219, 234, 254] : [248, 250, 252];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  y = lastAutoTableY(pdf, y) + 8;
  if (row.catatan) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(30);
    pdf.text("Catatan", 18, y);
    y += 4;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(90);
    const noteLines = pdf.splitTextToSize(row.catatan, pageWidth - 36);
    pdf.text(noteLines, 18, y);
  }

  const pageHeight = pdf.internal.pageSize.getHeight();
  const signY = Math.max(lastAutoTableY(pdf, y) + 16, pageHeight - 54);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(80);
  pdf.text("Dibuat oleh,", 28, signY);
  pdf.text("Diterima oleh,", pageWidth - 58, signY);
  pdf.setFont("helvetica", "bold");
  pdf.text(company.namaPerusahaan, 28, signY + 24);
  pdf.text(employee.nama, pageWidth - 58, signY + 24);

  addFooter(pdf, company, `Slip Gaji ${row.periode}`);
  const filename = `Slip_Gaji_${row.periode}_${fileSafe(row.employee_id)}_${fileSafe(employee.nama)}.pdf`;
  pdf.save(filename);
  return filename;
}

export async function exportPayrollRecapPdf(rows: PayrollRow[], periodKey: string, periodRange: PeriodRange): Promise<string> {
  if (rows.length === 0) throw new Error("Tidak ada payroll Final untuk diexport.");
  if (rows.some((row) => row.status !== "Final")) throw new Error("Rekap resmi hanya bisa diexport saat semua slip sudah Final.");

  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const company = await getPayrollCompanyInfo();
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pdf = doc as unknown as PdfDoc;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const totals = getPayrollTotals(rows);

  pdf.setFillColor(37, 99, 235);
  pdf.rect(14, 10, pageWidth - 28, 1.5, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(17);
  pdf.setTextColor(25);
  pdf.text("Rekap Payroll Final", 14, 23);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(90);
  pdf.text(`${company.namaPerusahaan} - ${periodRange.label}`, 14, 30);
  pdf.text(`${formatDate(periodRange.start)} - ${formatDate(periodRange.end)}`, pageWidth - 14, 23, { align: "right" });
  pdf.text(`Export: ${new Date().toLocaleString("id-ID")}`, pageWidth - 14, 30, { align: "right" });

  const cards = [
    ["Slip Final", `${rows.length} pegawai`],
    ["Pendapatan", formatRupiah(totals.totalPendapatan)],
    ["Potongan", formatRupiah(totals.totalPotongan)],
    ["Netto Transfer", formatRupiah(totals.totalNetto)],
  ];
  const cardWidth = (pageWidth - 28 - 9) / 4;
  cards.forEach(([label, value], index) => {
    const x = 14 + index * (cardWidth + 3);
    pdf.setFillColor(index === 3 ? 219 : 248, index === 3 ? 234 : 250, index === 3 ? 254 : 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(x, 38, cardWidth, 15, 2, 2, "FD");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(90);
    pdf.text(label, x + 3, 44);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(index === 3 ? 37 : 30, index === 3 ? 99 : 30, index === 3 ? 235 : 30);
    pdf.text(value, x + 3, 50);
  });

  const body = rows.map((row, index) => {
    const employee = getPayrollEmployeeSnapshot(row);
    return [
      String(index + 1),
      row.employee_id,
      employee.nama,
      employee.jabatan,
      employee.bank,
      employee.noRekening,
      employee.namaRekening,
      formatRupiah(row.total_pendapatan),
      formatRupiah(row.total_potongan),
      formatRupiah(row.netto),
    ];
  });
  body.push(["", "", "", "", "", "", "TOTAL", formatRupiah(totals.totalPendapatan), formatRupiah(totals.totalPotongan), formatRupiah(totals.totalNetto)]);

  autoTable(doc, {
    startY: 60,
    head: [["No", "ID", "Pegawai", "Jabatan", "Bank", "No Rekening", "Nama Rekening", "Pendapatan", "Potongan", "Netto"]],
    body,
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 18 },
      2: { cellWidth: 43 },
      3: { cellWidth: 28 },
      4: { cellWidth: 20 },
      5: { cellWidth: 30 },
      6: { cellWidth: 32 },
      7: { cellWidth: 28, halign: "right" },
      8: { cellWidth: 28, halign: "right" },
      9: { cellWidth: 28, halign: "right" },
    },
    styles: { fontSize: 6.8, cellPadding: 1.6, lineColor: [226, 232, 240], lineWidth: 0.1, valign: "middle" },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14, bottom: 16 },
    didParseCell: (data) => {
      const raw = Array.isArray(data.row.raw) ? data.row.raw : [];
      if (raw[6] === "TOTAL") {
        data.cell.styles.fillColor = [219, 234, 254];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(210);
    pdf.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(140);
    pdf.text(`${company.namaPerusahaan} - Rekap Payroll Final ${periodKey}`, 14, pageHeight - 6);
    pdf.text(`Halaman ${page} dari ${pages}`, pageWidth - 14, pageHeight - 6, { align: "right" });
  }

  const filename = `Rekap_Payroll_Final_${periodKey}.pdf`;
  pdf.save(filename);
  return filename;
}

export async function exportPayrollRecapXlsx(rows: PayrollRow[], periodKey: string, periodRange: PeriodRange): Promise<string> {
  if (rows.length === 0) throw new Error("Tidak ada payroll Final untuk diexport.");
  if (rows.some((row) => row.status !== "Final")) throw new Error("Rekap resmi hanya bisa diexport saat semua slip sudah Final.");

  const XLSX = await import("xlsx");
  const company = await getPayrollCompanyInfo();
  const totals = getPayrollTotals(rows);
  const workbook = XLSX.utils.book_new();
  const keteranganFields = [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].filter((field) => field.keteranganKey);

  const summaryRows = [
    ["Rekap Payroll Final"],
    ["Perusahaan", company.namaPerusahaan],
    ["Periode", periodRange.label],
    ["Rentang", `${formatDate(periodRange.start)} - ${formatDate(periodRange.end)}`],
    ["Jumlah Slip Final", rows.length],
    ["Total Pendapatan", totals.totalPendapatan],
    ["Total Potongan", totals.totalPotongan],
    ["Total Netto", totals.totalNetto],
    ["Waktu Export", new Date().toLocaleString("id-ID")],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 24 }, { wch: 34 }];
  [5, 6, 7].forEach((rowIndex) => {
    const cell = summarySheet[XLSX.utils.encode_cell({ r: rowIndex, c: 1 })];
    if (cell) cell.z = '"Rp" #,##0;[Red]-"Rp" #,##0';
  });
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Ringkasan");

  const headers = [
    "No",
    "ID Pegawai",
    "Nama Pegawai",
    "Jabatan",
    "Bank",
    "No Rekening",
    "Nama Rekening",
    ...PENDAPATAN_FIELDS.map((field) => field.label),
    "Total Pendapatan",
    ...POTONGAN_FIELDS.map((field) => field.label),
    "Total Potongan",
    "Netto Transfer",
    ...keteranganFields.map((field) => `Keterangan ${field.label}`),
    "Catatan",
    "Status",
    "Final Snapshot",
  ];
  const amountColumns = new Set<number>();
  const firstAmountColumn = 7;
  PENDAPATAN_FIELDS.forEach((_, index) => amountColumns.add(firstAmountColumn + index));
  const totalPendapatanIndex = firstAmountColumn + PENDAPATAN_FIELDS.length;
  amountColumns.add(totalPendapatanIndex);
  const firstPotonganColumn = totalPendapatanIndex + 1;
  POTONGAN_FIELDS.forEach((_, index) => amountColumns.add(firstPotonganColumn + index));
  const totalPotonganIndex = firstPotonganColumn + POTONGAN_FIELDS.length;
  const nettoIndex = totalPotonganIndex + 1;
  amountColumns.add(totalPotonganIndex);
  amountColumns.add(nettoIndex);

  const rowsData = rows.map((row, index) => {
    const employee = getPayrollEmployeeSnapshot(row);
    return [
      index + 1,
      row.employee_id,
      employee.nama,
      employee.jabatan,
      employee.bank,
      employee.noRekening,
      employee.namaRekening,
      ...PENDAPATAN_FIELDS.map((field) => amount(row, field.key)),
      amount(row, "total_pendapatan"),
      ...POTONGAN_FIELDS.map((field) => amount(row, field.key)),
      amount(row, "total_potongan"),
      amount(row, "netto"),
      ...keteranganFields.map((field) => field.keteranganKey ? textValue(row, field.keteranganKey) : ""),
      row.catatan || "",
      row.status,
      row.final_snapshot_at || row.locked_at || "",
    ];
  });
  const totalRow = headers.map((_, index) => {
    if (index === 0) return "TOTAL";
    if (!amountColumns.has(index)) return "";
    return rowsData.reduce((sum, row) => sum + Number(row[index] || 0), 0);
  });
  const recapRows = [headers, ...rowsData, totalRow];
  const recapSheet = XLSX.utils.aoa_to_sheet(recapRows);
  recapSheet["!cols"] = headers.map((header) => {
    if (["Nama Pegawai", "Nama Rekening", "Catatan"].includes(header)) return { wch: 28 };
    if (["ID Pegawai", "Jabatan", "No Rekening", "Final Snapshot"].includes(header)) return { wch: 18 };
    return { wch: 14 };
  });
  recapSheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: recapRows.length - 1, c: headers.length - 1 } }) };
  amountColumns.forEach((col) => {
    for (let row = 1; row < recapRows.length; row += 1) {
      const cell = recapSheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell) cell.z = '"Rp" #,##0;[Red]-"Rp" #,##0';
    }
  });
  XLSX.utils.book_append_sheet(workbook, recapSheet, "Rekap Final");

  const filename = `Rekap_Payroll_Final_${periodKey}.xlsx`;
  XLSX.writeFile(workbook, filename, { compression: true });
  return filename;
}
