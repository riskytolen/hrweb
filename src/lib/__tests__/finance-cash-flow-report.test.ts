import { describe, expect, it } from "vitest";
import {
  buildCashFlowFilename,
  computeCashFlowPeriod,
  formatCashPeriodLabel,
  isBeforeCashPeriod,
  isCashDateInRange,
  toCashFlowTableRow,
  type CashAdjustmentInput,
  type CashExpenseInput,
  type CashPaymentInput,
} from "../finance-cash-flow-report";

const payments: CashPaymentInput[] = [
  { id: 1, payment_date: "2026-09-28", amount: 1_000_000, method: "Transfer Bank", invoice_no: "INV-090", client_name: "PT Lama" },
  { id: 2, payment_date: "2026-10-01", amount: 2_000_000, method: "Transfer Bank", invoice_no: "INV-101", client_name: "PT Maju" },
  { id: 3, payment_date: "2026-10-31", amount: 500_000, method: "Tunai", invoice_no: "INV-102", client_name: "PT Maju" },
  { id: 4, payment_date: "2026-11-02", amount: 999_000, method: "Tunai", invoice_no: "INV-103", client_name: "PT Lain" },
];
const expenses: CashExpenseInput[] = [
  { id: 11, expense_date: "2026-09-30", amount: 400_000, method: "Transfer Bank", description: "BBM", category_name: "Operasional" },
  { id: 12, expense_date: "2026-10-15", amount: 300_000, method: "Tunai", description: "Parkir", category_name: "Operasional" },
];
const adjustments: CashAdjustmentInput[] = [
  { id: 21, adjustment_date: "2026-09-29", type: "Masuk", amount: 100_000, description: "Koreksi" },
  { id: 22, adjustment_date: "2026-10-20", type: "Keluar", amount: 50_000, description: "Biaya admin" },
];

describe("finance cash flow report", () => {
  it("rentang inklusif dan batas kosong", () => {
    expect(isCashDateInRange("2026-10-01", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isCashDateInRange("2026-10-31", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isCashDateInRange("2026-09-30", "2026-10-01", "2026-10-31")).toBe(false);
    expect(isCashDateInRange("2026-11-01", "2026-10-01", "2026-10-31")).toBe(false);
    expect(isCashDateInRange("2026-01-05", "", "")).toBe(true);
  });

  it("transaksi sebelum from masuk saldo awal, transaksi pada from masuk periode", () => {
    expect(isBeforeCashPeriod("2026-09-30", "2026-10-01")).toBe(true);
    expect(isBeforeCashPeriod("2026-10-01", "2026-10-01")).toBe(false);

    const r = computeCashFlowPeriod(5_000_000, payments, expenses, adjustments, "2026-10-01", "2026-10-31");
    // Saldo awal = 5.000.000 + 1.000.000 + 100.000 − 400.000
    expect(r.openingBalance).toBe(5_700_000);
    // Transaksi 2026-10-01 ikut periode
    expect(r.entries.some((e) => e.tanggal === "2026-10-01")).toBe(true);
    // Transaksi November tidak ikut
    expect(r.entries.some((e) => e.tanggal === "2026-11-02")).toBe(false);
  });

  it("transaksi pada tanggal akhir ikut saldo akhir", () => {
    const r = computeCashFlowPeriod(0, payments, [], [], "2026-10-01", "2026-10-31");
    expect(r.summary.totalIn).toBe(2_500_000);
    expect(r.summary.endingBalance).toBe(r.summary.openingBalance + r.summary.net);
  });

  it("saldo akhir = saldo awal + mutasi bersih", () => {
    const r = computeCashFlowPeriod(5_000_000, payments, expenses, adjustments, "2026-10-01", "2026-10-31");
    expect(r.summary.totalIn).toBe(2_000_000 + 500_000);
    expect(r.summary.totalOut).toBe(300_000 + 50_000);
    expect(r.summary.net).toBe(r.summary.totalIn - r.summary.totalOut);
    expect(r.summary.endingBalance).toBe(r.openingBalance + r.summary.net);
    expect(r.entries[r.entries.length - 1].balance).toBe(r.summary.endingBalance);
  });

  it("periode kosong mempertahankan saldo awal sebagai saldo akhir", () => {
    const r = computeCashFlowPeriod(5_000_000, payments, expenses, adjustments, "2026-12-01", "2026-12-31");
    expect(r.entries).toHaveLength(0);
    expect(r.summary.totalIn).toBe(0);
    expect(r.summary.totalOut).toBe(0);
    expect(r.summary.endingBalance).toBe(r.summary.openingBalance);
  });

  it("rentang terbuka tanpa from memakai saldo dasar sebagai pembuka", () => {
    const r = computeCashFlowPeriod(5_000_000, payments, expenses, adjustments, "", "2026-09-30");
    expect(r.openingBalance).toBe(5_000_000);
    expect(r.summary.endingBalance).toBe(5_000_000 + 1_000_000 + 100_000 - 400_000);
  });

  it("urutan stabil pada tanggal sama: payment, adjustment, expense, lalu id", () => {
    const r = computeCashFlowPeriod(
      0,
      [{ id: 9, payment_date: "2026-10-10", amount: 10_000, invoice_no: "INV-X", client_name: "C" }],
      [
        { id: 8, expense_date: "2026-10-10", amount: 1_000, description: "E1", category_name: "K" },
        { id: 7, expense_date: "2026-10-10", amount: 2_000, description: "E2", category_name: "K" },
      ],
      [{ id: 5, adjustment_date: "2026-10-10", type: "Masuk", amount: 5_000, description: "A" }],
      "2026-10-01",
      "2026-10-31",
    );
    expect(r.entries.map((e) => e.type)).toEqual(["payment", "adjustment", "expense", "expense"]);
    expect(r.entries.filter((e) => e.type === "expense").map((e) => e.id)).toEqual([7, 8]);
  });

  it("mendukung saldo negatif", () => {
    const r = computeCashFlowPeriod(
      100_000,
      [],
      [{ id: 1, expense_date: "2026-10-05", amount: 250_000, description: "Besar", category_name: "K" }],
      [],
      "2026-10-01",
      "2026-10-31",
    );
    expect(r.summary.endingBalance).toBe(-150_000);
  });

  it("label periode dan nama file konsisten", () => {
    expect(formatCashPeriodLabel("", "")).toBe("Semua periode");
    expect(formatCashPeriodLabel("2026-10-01", "2026-10-31")).toContain("2026");
    expect(buildCashFlowFilename("pdf", "2026-10-01", "2026-10-31")).toBe(
      "Arus_Kas_2026-10-01_2026-10-31.pdf",
    );
    expect(buildCashFlowFilename("csv", "", "")).toBe("Arus_Kas_semua_semua.csv");
  });

  it("baris tabel membawa semua kolom penting", () => {
    const r = computeCashFlowPeriod(0, payments.slice(1, 2), [], [], "", "");
    const row = toCashFlowTableRow(r.entries[0], 0);
    expect(row).toHaveLength(9);
    expect(row[1]).toBe("2026-10-01");
    expect(row[3]).toBe("INV-101");
  });
});
