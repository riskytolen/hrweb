import type { DbLegalDocument } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";

type EmployeeInfo = {
  id?: string;
  nama: string;
  no_ktp?: string;
  alamat?: string;
  jabatan?: string;
};

type CompanyInfo = {
  nama_perusahaan: string;
  nama_badan_hukum: string;
  alamat: string;
  no_telp: string;
  email: string;
  kota_surat: string;
  penandatangan_nama: string;
  penandatangan_jabatan: string;
  mengetahui_nama: string;
  mengetahui_jabatan: string;
};

const BULAN_ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

async function getCompanyInfo(): Promise<CompanyInfo> {
  const { data } = await supabase.from("company_settings").select("kode, nilai");
  const map: Record<string, string> = {};
  data?.forEach((d: { kode: string; nilai: string }) => { map[d.kode] = d.nilai; });
  return {
    nama_perusahaan: map.nama_perusahaan || "JAMS LOGISTICS",
    nama_badan_hukum: map.nama_badan_hukum || "CV. JAMI BERKAH TRANSINDO",
    alamat: map.alamat || "",
    no_telp: map.no_telp || "",
    email: map.email || "",
    kota_surat: map.kota_surat || "Jakarta",
    penandatangan_nama: map.penandatangan_nama || "",
    penandatangan_jabatan: map.penandatangan_jabatan || "Head Admin & System",
    mengetahui_nama: map.mengetahui_nama || "",
    mengetahui_jabatan: map.mengetahui_jabatan || "Head Operasional",
  };
}

function formatTanggalPanjang(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
}

function formatTanggalShort(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return `${String(dt.getDate()).padStart(2, "0")} ${["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"][dt.getMonth()]} ${dt.getFullYear()}`;
}

/**
 * Generate nomor surat SP otomatis
 * Format: XX/bulan-romawi/JAMS/tahun
 */
export function generateNomorSP(tingkatSp: string, nomorUrut: number, tanggalTerbit: string): string {
  const dt = new Date(tanggalTerbit + "T00:00:00");
  const bulan = BULAN_ROMAWI[dt.getMonth()];
  const tahun = dt.getFullYear();
  const nomor = String(nomorUrut).padStart(2, "0");
  return `${nomor}/${bulan}/JAMS/${tahun}`;
}

/**
 * Generate PDF Surat PKWT (Perjanjian Kerja Waktu Tertentu)
 * Design profesional dengan layout rapi
 */
export async function generatePKWT(doc: DbLegalDocument, employee: EmployeeInfo) {
  const { default: jsPDF } = await import("jspdf");
  const company = await getCompanyInfo();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 15;

  // Helper: add footer on each page
  const addFooter = () => {
    const fy = pageHeight - 12;
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(130);
    pdf.setDrawColor(41, 128, 185);
    pdf.setLineWidth(0.4);
    pdf.line(margin, fy - 4, pageWidth - margin, fy - 4);
    const footerLines = pdf.splitTextToSize(company.alamat, contentWidth);
    pdf.text(footerLines[0] || "", margin, fy);
    pdf.text(`Hp : ${company.no_telp} | Email : ${company.email}`, margin, fy + 3.5);
  };

  // Helper: check page break
  const checkPage = (needed: number) => {
    if (y > pageHeight - needed) {
      addFooter();
      pdf.addPage();
      y = 20;
    }
  };

  // ═══ KOP SURAT (logo di tengah) ═══
  try {
    const logoImg = new Image();
    logoImg.src = "/jamslogistics.png";
    await new Promise((resolve, reject) => { logoImg.onload = resolve; logoImg.onerror = reject; });
    const logoW = 70;
    const logoH = 25;
    pdf.addImage(logoImg, "PNG", (pageWidth - logoW) / 2, y, logoW, logoH);
    y += logoH + 4;
  } catch {
    pdf.setFontSize(16);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(41, 128, 185);
    pdf.text(company.nama_perusahaan, pageWidth / 2, y + 8, { align: "center" });
    pdf.setFontSize(10);
    pdf.setTextColor(60);
    pdf.setFont("helvetica", "normal");
    pdf.text(company.nama_badan_hukum, pageWidth / 2, y + 14, { align: "center" });
    y += 22;
  }

  // Garis header
  pdf.setDrawColor(41, 128, 185);
  pdf.setLineWidth(1);
  pdf.line(margin, y, pageWidth - margin, y);
  pdf.setLineWidth(0.3);
  pdf.line(margin, y + 1.5, pageWidth - margin, y + 1.5);

  // ═══ JUDUL ═══
  y += 12;
  pdf.setTextColor(0);
  pdf.setFontSize(13);
  pdf.setFont("helvetica", "bold");
  pdf.text("PERJANJIAN KERJA WAKTU TERTENTU (PKWT)", pageWidth / 2, y, { align: "center" });
  y += 6;
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text(`Nomor : ${doc.nomor_kontrak || "-"}`, pageWidth / 2, y, { align: "center" });

  // ═══ PEMBUKAAN ═══
  y += 10;
  pdf.setFontSize(10);

  const addParagraph = (text: string, indent = 0) => {
    const lines = pdf.splitTextToSize(text, contentWidth - indent);
    for (const line of lines) {
      checkPage(25);
      pdf.text(line, margin + indent, y);
      y += 4.8;
    }
    y += 2;
  };

  const addSectionTitle = (title: string) => {
    checkPage(20);
    y += 4;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(title, margin, y);
    y += 6;
    pdf.setFont("helvetica", "normal");
  };

  addParagraph(`Pada hari ini, tanggal ${formatTanggalShort(doc.tanggal_terbit)}, yang bertanda tangan di bawah ini :`);

  // ═══ PIHAK PERTAMA ═══
  y += 3;
  pdf.setFont("helvetica", "bold");
  pdf.text("PIHAK PERTAMA", margin, y); y += 5.5;
  pdf.setFont("helvetica", "normal");

  const labelW = 30;
  pdf.text("Nama", margin + 5, y);
  pdf.text(`: ${company.nama_badan_hukum}`, margin + labelW, y); y += 5;
  pdf.text("Alamat", margin + 5, y);
  const alamatLines = pdf.splitTextToSize(`: ${company.alamat}`, contentWidth - labelW - 5);
  for (const line of alamatLines) { pdf.text(line, margin + labelW, y); y += 4.5; }
  y += 1;
  pdf.text("Jabatan", margin + 5, y);
  pdf.text(`: ${company.penandatangan_jabatan}`, margin + labelW, y); y += 5;

  pdf.text("Dalam hal ini bertindak untuk dan atas nama perusahaan, selanjutnya disebut", margin + 5, y); y += 5;
  pdf.setFont("helvetica", "bold");
  pdf.text("PIHAK PERTAMA.", margin + 5, y); y += 3;

  // ═══ PIHAK KEDUA ═══
  y += 5;
  pdf.setFont("helvetica", "bold");
  pdf.text("PIHAK KEDUA", margin, y); y += 5.5;
  pdf.setFont("helvetica", "normal");

  pdf.text("Nama", margin + 5, y);
  pdf.text(`: ${employee.nama}`, margin + labelW, y); y += 5;
  if (employee.id) {
    pdf.text("ID Pegawai", margin + 5, y);
    pdf.text(`: ${employee.id}`, margin + labelW, y); y += 5;
  }
  if (employee.no_ktp) {
    pdf.text("No. KTP", margin + 5, y);
    pdf.text(`: ${employee.no_ktp}`, margin + labelW, y); y += 5;
  }
  if (employee.jabatan) {
    pdf.text("Jabatan", margin + 5, y);
    pdf.text(`: ${employee.jabatan}`, margin + labelW, y); y += 5;
  }
  if (employee.alamat) {
    pdf.text("Alamat", margin + 5, y);
    const empAlamatLines = pdf.splitTextToSize(`: ${employee.alamat}`, contentWidth - labelW - 5);
    for (const line of empAlamatLines) { pdf.text(line, margin + labelW, y); y += 4.5; }
    y += 1;
  }

  pdf.text("Selanjutnya disebut ", margin + 5, y);
  pdf.setFont("helvetica", "bold");
  pdf.text("PIHAK KEDUA.", margin + 42, y);
  pdf.setFont("helvetica", "normal");
  y += 7;

  addParagraph("Kedua belah pihak sepakat untuk mengikatkan diri dalam Perjanjian Kerja Waktu Tertentu (PKWT) dengan ketentuan dan syarat-syarat sebagai berikut :");

  // ═══ PASAL 1 ═══
  addSectionTitle("Pasal 1 – Jangka Waktu Perjanjian");
  addParagraph(`1. Perjanjian kerja ini berlaku untuk jangka waktu tertentu, terhitung mulai tanggal ${formatTanggalShort(doc.tanggal_terbit)} sampai dengan tanggal ${formatTanggalShort(doc.tanggal_berakhir || doc.tanggal_terbit)}.`);
  addParagraph(`2. Perjanjian ini merupakan kontrak ke-${doc.kontrak_ke || 1} (${["satu", "dua", "tiga", "empat", "lima"][((doc.kontrak_ke || 1) - 1)] || doc.kontrak_ke}).`);
  addParagraph("3. Apabila jangka waktu perjanjian ini berakhir dan tidak diperpanjang, maka hubungan kerja antara kedua belah pihak berakhir dengan sendirinya.");

  // ═══ PASAL 2 ═══
  addSectionTitle("Pasal 2 – Tugas dan Tanggung Jawab");
  addParagraph(`1. PIHAK KEDUA ditempatkan pada jabatan ${employee.jabatan || "-"} dan bersedia melaksanakan tugas serta tanggung jawab yang diberikan oleh PIHAK PERTAMA.`);
  addParagraph("2. PIHAK KEDUA bersedia ditempatkan di lokasi kerja yang ditentukan oleh PIHAK PERTAMA.");
  addParagraph("3. PIHAK KEDUA wajib melaksanakan pekerjaan dengan penuh tanggung jawab dan dedikasi.");

  // ═══ PASAL 3 ═══
  addSectionTitle("Pasal 3 – Hak dan Kewajiban");
  addParagraph("1. PIHAK KEDUA berhak menerima upah/gaji sesuai dengan ketentuan yang berlaku di perusahaan.");
  addParagraph("2. PIHAK KEDUA berhak mendapatkan perlindungan keselamatan dan kesehatan kerja.");
  addParagraph("3. PIHAK KEDUA wajib mematuhi seluruh peraturan perusahaan dan tata tertib yang berlaku.");
  addParagraph("4. PIHAK KEDUA wajib menjaga kerahasiaan seluruh informasi perusahaan.");

  // ═══ PASAL 4 ═══
  addSectionTitle("Pasal 4 – Berakhirnya Perjanjian");
  addParagraph("Perjanjian kerja ini berakhir apabila :");
  addParagraph("a. Jangka waktu perjanjian telah berakhir.", 5);
  addParagraph("b. Adanya pelanggaran berat oleh salah satu pihak.", 5);
  addParagraph("c. Pekerja meninggal dunia.", 5);
  addParagraph("d. Adanya putusan pengadilan yang berkekuatan hukum tetap.", 5);
  addParagraph("e. Adanya keadaan memaksa (force majeure).", 5);

  // ═══ CATATAN ═══
  if (doc.catatan) {
    addSectionTitle("Catatan Tambahan");
    addParagraph(doc.catatan);
  }

  // ═══ PENUTUP ═══
  checkPage(70);
  y += 5;
  addParagraph("Demikian Perjanjian Kerja Waktu Tertentu ini dibuat dan ditandatangani oleh kedua belah pihak dalam keadaan sadar tanpa adanya paksaan dari pihak manapun, dibuat dalam rangkap 2 (dua) yang masing-masing mempunyai kekuatan hukum yang sama.");

  // ═══ TANDA TANGAN ═══
  checkPage(55);
  y += 6;
  pdf.setFontSize(10);
  pdf.text(`${company.kota_surat}, ${formatTanggalShort(doc.tanggal_terbit)}`, pageWidth - margin, y, { align: "right" });

  y += 10;
  const colLeft = margin + 30;
  const colRight = pageWidth - margin - 30;

  pdf.setFont("helvetica", "bold");
  pdf.text("PIHAK PERTAMA", colLeft, y, { align: "center" });
  pdf.text("PIHAK KEDUA", colRight, y, { align: "center" });

  y += 25;
  pdf.setFont("helvetica", "normal");
  pdf.text(`(${company.penandatangan_nama || "________________"})`, colLeft, y, { align: "center" });
  pdf.text(`(${employee.nama})`, colRight, y, { align: "center" });
  y += 4;
  pdf.setFontSize(8);
  pdf.setTextColor(100);
  pdf.text(company.penandatangan_jabatan, colLeft, y, { align: "center" });
  if (employee.jabatan) pdf.text(employee.jabatan, colRight, y, { align: "center" });

  // Mengetahui
  pdf.setTextColor(0);
  pdf.setFontSize(10);
  y += 10;
  pdf.setFont("helvetica", "bold");
  pdf.text("Mengetahui,", pageWidth / 2, y, { align: "center" });
  y += 5;
  pdf.setFont("helvetica", "normal");
  pdf.text(company.mengetahui_jabatan, pageWidth / 2, y, { align: "center" });
  y += 22;
  pdf.text(`(${company.mengetahui_nama || "________________"})`, pageWidth / 2, y, { align: "center" });

  // ═══ FOOTER ═══
  addFooter();

  pdf.save(`PKWT_${employee.nama.replace(/\s+/g, "_")}_${doc.tanggal_terbit}.pdf`);
}

/**
 * Generate PDF Surat Peringatan (SP-1, SP-2, SP-3)
 * Design sesuai format resmi perusahaan
 */
export async function generateSP(doc: DbLegalDocument, employee: EmployeeInfo) {
  const { default: jsPDF } = await import("jspdf");
  const company = await getCompanyInfo();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  const spLabel = doc.tingkat_sp === "SP-1" ? "Surat Peringatan 1"
    : doc.tingkat_sp === "SP-2" ? "Surat Peringatan 2"
    : "Surat Peringatan 3";

  const spNumber = doc.tingkat_sp === "SP-1" ? 1 : doc.tingkat_sp === "SP-2" ? 2 : 3;

  // Fetch masa berlaku dari settings
  const { data: settingData } = await supabase.from("legal_settings").select("masa_berlaku_bulan").eq("kode", doc.tingkat_sp).single();
  const masaBerlaku = settingData?.masa_berlaku_bulan || 6;

  // ═══ KOP SURAT (logo komplit di tengah) ═══
  try {
    const logoImg = new Image();
    logoImg.src = "/jamslogistics.png";
    await new Promise((resolve, reject) => { logoImg.onload = resolve; logoImg.onerror = reject; });
    const logoW = 70;
    const logoH = 25;
    pdf.addImage(logoImg, "PNG", (pageWidth - logoW) / 2, y, logoW, logoH);
    y += logoH + 4;
  } catch {
    // Fallback text jika logo gagal
    pdf.setFontSize(18);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(41, 128, 185);
    pdf.text(company.nama_perusahaan, pageWidth / 2, y + 8, { align: "center" });
    pdf.setFontSize(11);
    pdf.setTextColor(60);
    pdf.setFont("helvetica", "normal");
    pdf.text(company.nama_badan_hukum, pageWidth / 2, y + 15, { align: "center" });
    y += 22;
  }

  // Garis pemisah tebal
  pdf.setDrawColor(41, 128, 185);
  pdf.setLineWidth(1.2);
  pdf.line(margin, y, pageWidth - margin, y);
  pdf.setDrawColor(200);
  pdf.setLineWidth(0.3);
  pdf.line(margin, y + 2, pageWidth - margin, y + 2);

  // ═══ NOMOR & HAL ═══
  y += 12;
  pdf.setTextColor(0);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text(`No`, margin, y);
  pdf.text(`: ${doc.nomor_kontrak || "-"}`, margin + 15, y);
  y += 5.5;
  pdf.text(`Hal`, margin, y);
  pdf.setFont("helvetica", "bold");
  pdf.text(`: ${spLabel}`, margin + 15, y);

  // ═══ KEPADA ═══
  y += 10;
  pdf.setFont("helvetica", "normal");
  pdf.text("Kepada", margin, y);
  y += 6;
  pdf.text("NAMA", margin, y);
  pdf.setFont("helvetica", "bold");
  pdf.text(`: ${employee.nama}`, margin + 25, y);
  y += 5.5;
  pdf.setFont("helvetica", "normal");
  pdf.text("ID PEGAWAI", margin, y);
  pdf.setFont("helvetica", "bold");
  pdf.text(`: ${employee.id || "-"}`, margin + 25, y);
  y += 5.5;
  pdf.setFont("helvetica", "normal");
  pdf.text("JABATAN", margin, y);
  pdf.setFont("helvetica", "bold");
  pdf.text(`: ${employee.jabatan || "-"}`, margin + 25, y);

  // ═══ ISI SURAT ═══
  y += 12;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  const addParagraph = (text: string, indent = 0) => {
    const lines = pdf.splitTextToSize(text, contentWidth - indent);
    for (const line of lines) {
      if (y > pageHeight - 50) { pdf.addPage(); y = 20; }
      pdf.text(line, margin + indent, y);
      y += 5;
    }
    y += 2;
  };

  addParagraph(`Sehubungan kinerja saudara sebagai karyawan yang harus memenuhi dan melaksanakan semua kewajiban dan tata tertib serta disiplin dalam bekerja yang harus saudara lakukan sepenuhnya, maka dengan ini kami memberikan peringatan kepada saudara atas tindakan penyimpangan yang tidak dilaksanakan sebagaimana mestinya seperti yang kami garis bawahi sebagai berikut ini :`);

  // Pelanggaran (bullet point)
  y += 3;
  pdf.setFont("helvetica", "bold");
  const pelanggaranLines = (doc.pelanggaran || "INDISIPLINER").split("\n");
  for (const line of pelanggaranLines) {
    if (y > pageHeight - 50) { pdf.addPage(); y = 20; }
    pdf.text(`•  ${line.trim()}`, margin + 5, y);
    y += 5.5;
  }

  // Paragraf konsekuensi
  y += 5;
  pdf.setFont("helvetica", "normal");

  let konsekuensi = `Segala konsekuensi administrasi kami berikan kepada saudara atas kesalahan tersebut. `;
  if (spNumber < 3) {
    konsekuensi += `Dan apabila di kemudian hari yang bersangkutan mengulangi kesalahannya maka perusahaan akan memberikan konsekuensi atas kesalahan jauh lebih berat lagi hingga merujuk pada pemberhentian.`;
  } else {
    konsekuensi += `Surat Peringatan ini merupakan peringatan terakhir. Apabila yang bersangkutan mengulangi kesalahannya maka perusahaan berhak melakukan Pemutusan Hubungan Kerja (PHK) sesuai peraturan perundang-undangan yang berlaku.`;
  }
  addParagraph(konsekuensi);

  addParagraph(`Demikian ${spLabel} ini kami sampaikan dan berlaku selama ${masaBerlaku} bulan dan selama menjadi karyawan ${company.nama_badan_hukum}.`);

  addParagraph("Kepada yang bersangkutan harap diperhatikan dan diperbaiki dengan segera.");

  // ═══ TANDA TANGAN ═══
  if (y > pageHeight - 70) { pdf.addPage(); y = 20; }
  y += 8;
  pdf.setFontSize(10);
  pdf.text(`${company.kota_surat}, ${formatTanggalShort(doc.tanggal_terbit)}`, margin, y);

  y += 10;
  const colLeft = margin + 25;
  const colRight = pageWidth - margin - 35;

  pdf.setFont("helvetica", "bold");
  pdf.text(company.penandatangan_jabatan, colLeft, y, { align: "center" });
  pdf.text("Karyawan", colRight, y, { align: "center" });

  y += 22;
  pdf.setFont("helvetica", "normal");
  pdf.text(`(${company.penandatangan_nama || "________________"})`, colLeft, y, { align: "center" });
  pdf.text(`(${employee.nama})`, colRight, y, { align: "center" });

  // Mengetahui
  y += 12;
  pdf.setFont("helvetica", "bold");
  pdf.text("Mengetahui", pageWidth / 2, y, { align: "center" });
  y += 5;
  pdf.setFont("helvetica", "normal");
  pdf.text(company.mengetahui_jabatan, pageWidth / 2, y, { align: "center" });
  y += 22;
  pdf.text(`(${company.mengetahui_nama || "________________"})`, pageWidth / 2, y, { align: "center" });

  // ═══ FOOTER ═══
  const footerY = pageHeight - 15;
  pdf.setFontSize(7);
  pdf.setTextColor(100);
  pdf.setDrawColor(41, 128, 185);
  pdf.setLineWidth(0.5);
  pdf.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
  pdf.setFont("helvetica", "normal");
  const footerText = `${company.alamat}`;
  const footerLines = pdf.splitTextToSize(footerText, contentWidth);
  let fy = footerY;
  for (const line of footerLines) {
    pdf.text(line, margin, fy);
    fy += 3.5;
  }
  pdf.text(`Hp : ${company.no_telp} | Email : ${company.email}`, margin, fy);

  pdf.save(`${doc.tingkat_sp}_${employee.nama.replace(/\s+/g, "_")}_${doc.tanggal_terbit}.pdf`);
}
