import { describe, expect, it } from "vitest";
import {
  buildRevenueFilename,
  filterInvoicesByDate,
  filterPaymentsByDate,
  formatPeriodLabel,
  isDateInRange,
  summarizeInvoiceCohort,
  summarizePayments,
  toInvoicePdfRow,
  toPaymentPdfRow,
} from "../finance-revenue-report";

describe("finance revenue report helpers", () => {
  it("rentang tanggal inklusif dan batas kosong", () => {
    expect(isDateInRange("2026-10-01", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isDateInRange("2026-10-31", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isDateInRange("2026-09-30", "2026-10-01", "2026-10-31")).toBe(false);
    expect(isDateInRange("2026-11-01", "2026-10-01", "2026-10-31")).toBe(false);
    expect(isDateInRange("2026-01-01", "", "")).toBe(true);
    expect(isDateInRange("2026-01-01", "2026-02-01", "")).toBe(false);
    expect(isDateInRange("2026-03-01", "", "2026-02-01")).toBe(false);
  });

  it("filter invoice memakai invoice_date dan pembayaran memakai payment_date", () => {
    const invoices = [
      { invoice_date: "2026-10-01" },
      { invoice_date: "2026-09-30" },
      { invoice_date: "2026-11-01" },
    ];
    expect(filterInvoicesByDate(invoices, "2026-10-01", "2026-10-31")).toHaveLength(1);

    const payments = [
      { payment_date: "2026-10-15" },
      { payment_date: "2026-09-01" },
    ];
    expect(filterPaymentsByDate(payments, "2026-10-01", "2026-10-31")).toHaveLength(1);
    expect(filterPaymentsByDate(payments, "", "")).toHaveLength(2);
  });

  it("KPI invoice memakai seluruh pembayaran milik cohort", () => {
    const summary = summarizeInvoiceCohort([
      { total_amount: 1_000_000, paid: 1_000_000, status: "Lunas", pph_amount: 20_000 },
      { total_amount: 2_000_000, paid: 500_000, status: "Sebagian", pph_amount: 40_000 },
      { total_amount: 500_000, paid: 0, status: "Belum Lunas" },
    ]);
    expect(summary).toMatchObject({
      count: 3,
      totalInv: 3_500_000,
      totalPaid: 1_500_000,
      piutang: 2_000_000,
      lunas: 1,
      sebagian: 1,
      belum: 1,
      totalPph: 60_000,
    });
  });

  it("KPI pembayaran menghitung total, rata-rata, dan metode dominan", () => {
    const summary = summarizePayments([
      { amount: 100_000, method: "Transfer Bank" },
      { amount: 300_000, method: "Transfer Bank" },
      { amount: 200_000, method: "Tunai" },
    ]);
    expect(summary.count).toBe(3);
    expect(summary.total).toBe(600_000);
    expect(summary.average).toBe(200_000);
    expect(summary.dominantMethod).toBe("Transfer Bank");
    expect(summary.byMethod[0]).toMatchObject({ method: "Transfer Bank", count: 2 });
  });

  it("label periode dan nama file konsisten", () => {
    expect(formatPeriodLabel("", "")).toBe("Semua periode");
    expect(formatPeriodLabel("2026-10-01", "2026-10-31")).toContain("2026");
    expect(buildRevenueFilename("invoice", "2026-10-01", "2026-10-31")).toBe(
      "Laporan_Invoice_2026-10-01_2026-10-31.pdf",
    );
    expect(buildRevenueFilename("pembayaran", "", "")).toBe("Laporan_Pembayaran_semua_semua.pdf");
  });

  it("row laporan membawa semua kolom penting", () => {
    const invRow = toInvoicePdfRow(
      {
        invoice_no: "INV-001",
        invoice_date: "2026-10-01",
        due_date: "2026-10-15",
        clientName: "PT Maju",
        description: "Sewa armada",
        subtotal: 1_000_000,
        toll_amount: 50_000,
        tax_scheme: "trip_only",
        ppn_percent: 11,
        ppn_amount: 110_000,
        pph_percent: 2,
        pph_amount: 20_000,
        total_amount: 1_090_000,
        paid: 500_000,
        remaining: 590_000,
        status: "Sebagian",
      },
      0,
    );
    expect(invRow).toHaveLength(13);
    expect(invRow[1]).toContain("INV-001");
    expect(invRow[1]).toContain("Biaya Perjalanan Saja");
    expect(invRow[8]).toBe("20000");

    const payRow = toPaymentPdfRow(
      {
        payment_date: "2026-10-05",
        invoice_no: "INV-001",
        clientName: "PT Maju",
        method: "Transfer Bank",
        amount: 500_000,
        notes: "DP",
      },
      0,
    );
    expect(payRow).toHaveLength(7);
    expect(payRow[5]).toBe("500000");
  });
});
