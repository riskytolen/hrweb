import { describe, expect, it } from "vitest";
import {
  buildInvoiceCostLines,
  buildInvoiceFilename,
  formatTerbilang,
  hasBankInstruction,
  invoiceClientName,
  numberToWordsId,
} from "../finance-invoice-pdf";

const baseInvoice = {
  invoice_no: "INV-202610-001",
  invoice_date: "2026-10-13",
  subtotal: 10_000_000,
  total_amount: 9_910_000,
};

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

  it("nama klien memakai perusahaan lalu kontak", () => {
    expect(invoiceClientName(null)).toBe("—");
    expect(invoiceClientName(undefined)).toBe("—");
    expect(invoiceClientName({ contact_name: "Budi" })).toBe("Budi");
    expect(invoiceClientName({ company_name: "PT Maju", contact_name: "Budi" })).toBe("PT Maju");
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
});
