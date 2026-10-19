import { describe, expect, it } from "vitest";
import {
  buildInvoiceSummaryRows,
  buildInvoiceCostLines,
  buildInvoiceFilename,
  buildPaymentInstructionRows,
  computeClientBlockLayout,
  formatTerbilang,
  hasBankInstruction,
  invoiceClientName,
  numberToWordsId,
  splitLimited,
  type PdfTextDoc,
} from "../finance-invoice-pdf";

const baseInvoice = {
  invoice_no: "INV-202610-001",
  invoice_date: "2026-10-13",
  subtotal: 10_000_000,
  total_amount: 9_910_000,
};

class FakePdfTextDoc implements PdfTextDoc {
  private fontSize = 8;

  setFont(): void {}

  setFontSize(size: number): void {
    this.fontSize = size;
  }

  getTextWidth(text: string): number {
    return text.length * this.fontSize * 0.35;
  }

  splitTextToSize(text: string, width: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (current && this.getTextWidth(next) > width) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }
}

describe("finance invoice pdf helpers", () => {
  it("nama file aman dari nomor invoice", () => {
    expect(buildInvoiceFilename("INV-202610-001")).toBe("Invoice_INV-202610-001.pdf");
    expect(buildInvoiceFilename("INV 2026/10 & 001")).toBe("Invoice_INV_2026_10_001.pdf");
    expect(buildInvoiceFilename("")).toBe("Invoice_invoice.pdf");
  });

  it("komponen Rp0 disembunyikan dari rincian", () => {
    const lines = buildInvoiceCostLines({
      ...baseInvoice,
      trip_amount: 10_000_000,
      toll_amount: 0,
      parking_amount: null,
      other_amount: 250_000,
    });
    expect(lines).toEqual([
      { label: "Biaya Perjalanan", amount: 10_000_000 },
      { label: "Biaya Lain", amount: 250_000 },
    ]);
  });

  it("semua komponen nol memakai fallback total biaya", () => {
    expect(
      buildInvoiceCostLines({ ...baseInvoice, trip_amount: 0, toll_amount: 0, parking_amount: 0, other_amount: 0 }),
    ).toEqual([{ label: "Total Biaya", amount: 10_000_000 }]);
    expect(
      buildInvoiceCostLines({ ...baseInvoice, subtotal: 0, trip_amount: 0 }),
    ).toEqual([]);
  });

  it("instruksi rekening hanya bila nomor rekening ada", () => {
    expect(hasBankInstruction({ company_name: "PT X", bank_account_number: "123" })).toBe(true);
    expect(hasBankInstruction({ company_name: "PT X", bank_name: "BCA" })).toBe(false);
    expect(hasBankInstruction({ company_name: "PT X", bank_account_number: "  " })).toBe(false);
  });

  it("instruksi pembayaran disusun per baris agar jelas", () => {
    expect(buildPaymentInstructionRows({ company_name: "PT X" })).toEqual([]);
    expect(buildPaymentInstructionRows({
      company_name: "PT X",
      bank_name: "BCA",
      bank_account_number: "7152174317",
      bank_account_name: "CV. Jami Berkah Transindo",
    })).toEqual([
      { label: "Bank", value: "BCA" },
      { label: "Nomor Rekening", value: "7152174317" },
      { label: "Atas Nama", value: "CV. Jami Berkah Transindo" },
    ]);
  });

  it("ringkasan tagihan menampilkan PPh sebagai potongan", () => {
    const rows = buildInvoiceSummaryRows({
      ...baseInvoice,
      tax_scheme: "trip_only",
      tax_base_amount: 10_000_000,
      ppn_percent: 1.1,
      ppn_amount: 110_000,
      pph_percent: 2,
      pph_amount: 200_000,
    });

    expect(rows.map((r) => r.label)).toEqual([
      "Total Biaya",
      "Dasar Pengenaan Pajak (DPP)",
      "PPN (1.1%)",
      "Potongan PPh (2%)",
      "TOTAL TAGIHAN",
    ]);
    expect(rows[1]).toMatchObject({ caption: "Biaya Perjalanan Saja" });
    expect(rows[2].value).toBe("+Rp110.000");
    expect(rows[3]).toMatchObject({ value: "-Rp200.000", emphasis: "deduction" });
    expect(rows[4]).toMatchObject({ value: "Rp9.910.000", emphasis: "total" });
  });

  it("nama klien memakai perusahaan lalu kontak", () => {
    expect(invoiceClientName(null)).toBe("—");
    expect(invoiceClientName(undefined)).toBe("—");
    expect(invoiceClientName({ contact_name: "Budi" })).toBe("Budi");
    expect(invoiceClientName({ company_name: "PT Maju", contact_name: "Budi" })).toBe("PT Maju");
  });

  it("blok client: nama, kontak, dan alamat tidak bertumpuk", () => {
    const top = 100;
    const layout = computeClientBlockLayout(top, { hasContact: true, addrLines: 2 });
    expect(layout.nameY).toBe(top + 12);
    // Kontak selalu berjarak aman di bawah nama (regresi teks bertumpuk di PDF).
    expect((layout.contactY ?? 0) - layout.nameY).toBeGreaterThanOrEqual(4.5);
    expect(layout.addrY).toBeGreaterThan(layout.contactY ?? 0);
    const lastBaseline = layout.addrY + layout.addrLineGap; // baris alamat ke-2
    expect(lastBaseline).toBeLessThan(top + layout.cardH);
    expect(layout.cardH).toBeCloseTo(27.4);
  });

  it("blok client tanpa kontak/alamat tetap memakai tinggi kartu minimum", () => {
    const layout = computeClientBlockLayout(42, { hasContact: false, addrLines: 0 });
    expect(layout.contactY).toBeNull();
    expect(layout.addrY).toBe(42 + 12 + 4.6);
    expect(layout.cardH).toBe(25);
  });

  it("terbilang angka Indonesia", () => {
    expect(numberToWordsId(0)).toBe("nol");
    expect(numberToWordsId(7)).toBe("tujuh");
    expect(numberToWordsId(10)).toBe("sepuluh");
    expect(numberToWordsId(11)).toBe("sebelas");
    expect(numberToWordsId(19)).toBe("sembilan belas");
    expect(numberToWordsId(20)).toBe("dua puluh");
    expect(numberToWordsId(25)).toBe("dua puluh lima");
    expect(numberToWordsId(100)).toBe("seratus");
    expect(numberToWordsId(101)).toBe("seratus satu");
    expect(numberToWordsId(1000)).toBe("seribu");
    expect(numberToWordsId(1100)).toBe("seribu seratus");
    expect(numberToWordsId(2500)).toBe("dua ribu lima ratus");
    expect(numberToWordsId(1_000_000)).toBe("satu juta");
    expect(numberToWordsId(1_500_000)).toBe("satu juta lima ratus ribu");
    expect(numberToWordsId(1_000_000_000)).toBe("satu miliar");
    expect(numberToWordsId(2_000_000_000_000)).toBe("dua triliun");
  });

  it("format terbilang total tagihan", () => {
    expect(formatTerbilang(9_910_000)).toBe(
      "Sembilan juta sembilan ratus sepuluh ribu rupiah",
    );
    expect(formatTerbilang(0)).toBe("Nol rupiah");
    expect(formatTerbilang(500_000)).toBe("Lima ratus ribu rupiah");
  });

  it("detail tagihan panjang dipotong agar tetap muat di card", () => {
    const pdf = new FakePdfTextDoc();
    const width = 98;
    const lines = splitLimited(
      pdf,
      "BIAYA PERJALANAN ALL IN DARI PT. MULIA TANGGUH PERSADA KE GLOBAL NUSANTARA SINERGI DENGAN KETERANGAN TAMBAHAN YANG SANGAT PANJANG",
      width,
      3,
      { size: 8.2 },
    );

    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/\.\.\.$/);
    expect(lines.every((line) => pdf.getTextWidth(line) <= width)).toBe(true);
  });
});
