import { describe, expect, it } from "vitest";
import {
  cashPeriodFromClosingSnapshot,
  periodEndDate,
  periodStartDate,
  receivableBucket,
  receivableOverdueDays,
  receivableReferenceDate,
  summarizeCashPeriod,
  summarizePriorReceivables,
  summarizePriorReceivablesFromSnapshot,
  summarizeReceivables,
} from "../finance";

describe("finance receivables helpers", () => {
  it("tanggal awal dan akhir periode bulanan dan tahunan", () => {
    expect(periodStartDate(2026, 9)).toBe("2026-10-01");
    expect(periodEndDate(2026, 9)).toBe("2026-10-31");
    expect(periodStartDate(2026, 1)).toBe("2026-02-01");
    expect(periodEndDate(2026, 1)).toBe("2026-02-28");
    expect(periodEndDate(2024, 1)).toBe("2024-02-29");
    expect(periodStartDate(2026, null)).toBe("2026-01-01");
    expect(periodEndDate(2026, null)).toBe("2026-12-31");
  });

  it("referensi keterlambatan memakai akhir periode untuk periode lampau", () => {
    expect(receivableReferenceDate("2026-11-05", "2026-10-31")).toBe("2026-10-31");
    expect(receivableReferenceDate("2026-10-06", "2026-10-31")).toBe("2026-10-06");
  });

  it("hari terlambat memakai tanggal referensi", () => {
    expect(receivableOverdueDays("2026-10-01", "2026-10-06")).toBe(5);
    expect(receivableOverdueDays("2026-10-06", "2026-10-06")).toBe(0);
    expect(receivableOverdueDays("2026-10-10", "2026-10-06")).toBe(0);
    expect(receivableOverdueDays(null, "2026-10-06")).toBe(0);
  });

  it("kelompok umur piutang", () => {
    expect(receivableBucket(0, true)).toBe("Belum jatuh tempo");
    expect(receivableBucket(0, false)).toBe("Belum jatuh tempo");
    expect(receivableBucket(15, true)).toBe("Terlambat 1–30 hari");
    expect(receivableBucket(45, true)).toBe("Terlambat 31–60 hari");
    expect(receivableBucket(75, true)).toBe("Terlambat 61–90 hari");
    expect(receivableBucket(120, true)).toBe("Terlambat > 90 hari");
  });

  it("piutang = total invoice periode - seluruh pembayaran invoice periode, tanpa hitung ganda", () => {
    const summary = summarizeReceivables(
      [
        { id: 1, invoice_no: "INV-1", invoice_date: "2026-10-01", due_date: "2026-10-10", total_amount: 10_000_000, clientName: "A" },
        { id: 2, invoice_no: "INV-2", invoice_date: "2026-10-02", due_date: "2026-10-05", total_amount: 5_000_000, clientName: "B" },
      ],
      [
        { invoice_id: 1, payment_date: "2026-10-03", amount: 4_000_000 },
        { invoice_id: 2, payment_date: "2026-10-04", amount: 5_000_000 },
      ],
      "2026-10-01",
      "2026-10-31",
      "2026-10-06",
    );
    expect(summary.totalInvoiced).toBe(15_000_000);
    expect(summary.totalPaid).toBe(9_000_000);
    expect(summary.totalReceivable).toBe(6_000_000);
    expect(summary.unpaidCount).toBe(1);
    expect(summary.items[0]).toMatchObject({ invoice_no: "INV-1", remaining: 6_000_000 });
  });

  it("invoice bulan sebelumnya tidak masuk laporan Oktober", () => {
    const summary = summarizeReceivables(
      [
        { id: 1, invoice_no: "INV-SEPT", invoice_date: "2026-09-20", due_date: "2026-09-30", total_amount: 10_000_000 },
        { id: 2, invoice_no: "INV-OKT", invoice_date: "2026-10-05", due_date: "2026-11-05", total_amount: 3_000_000 },
      ],
      [{ invoice_id: 1, payment_date: "2026-10-02", amount: 2_000_000 }],
      "2026-10-01",
      "2026-10-31",
      "2026-10-31",
    );
    expect(summary.totalInvoiced).toBe(3_000_000);
    expect(summary.totalPaid).toBe(0);
    expect(summary.totalReceivable).toBe(3_000_000);
    expect(summary.unpaidCount).toBe(1);
    expect(summary.items[0].invoice_no).toBe("INV-OKT");
  });

  it("pembayaran November tetap mengurangi piutang invoice Oktober", () => {
    const summary = summarizeReceivables(
      [{ id: 1, invoice_no: "INV-1", invoice_date: "2026-10-20", due_date: "2026-11-20", total_amount: 3_000_000 }],
      [{ invoice_id: 1, payment_date: "2026-11-02", amount: 3_000_000 }],
      "2026-10-01",
      "2026-10-31",
      "2026-10-31",
    );
    expect(summary.totalPaid).toBe(3_000_000);
    expect(summary.totalReceivable).toBe(0);
    expect(summary.unpaidCount).toBe(0);
  });

  it("pembayaran sebelum periode tetap mengurangi piutang invoice periode", () => {
    const summary = summarizeReceivables(
      [{ id: 1, invoice_no: "INV-1", invoice_date: "2026-10-05", due_date: "2026-11-05", total_amount: 2_000_000 }],
      [{ invoice_id: 1, payment_date: "2026-09-28", amount: 500_000 }],
      "2026-10-01",
      "2026-10-31",
      "2026-10-31",
    );
    expect(summary.totalPaid).toBe(500_000);
    expect(summary.totalReceivable).toBe(1_500_000);
  });

  it("invoice lunas tidak masuk daftar piutang", () => {
    const summary = summarizeReceivables(
      [{ id: 1, invoice_no: "INV-1", invoice_date: "2026-10-01", due_date: "2026-11-01", total_amount: 1_000_000 }],
      [{ invoice_id: 1, payment_date: "2026-10-05", amount: 1_000_000 }],
      "2026-10-01",
      "2026-10-31",
      "2026-10-31",
    );
    expect(summary.totalReceivable).toBe(0);
    expect(summary.unpaidCount).toBe(0);
  });

  it("piutang jatuh tempo dihitung dari sisa yang terlambat", () => {
    const summary = summarizeReceivables(
      [
        { id: 1, invoice_no: "INV-1", invoice_date: "2026-10-01", due_date: "2026-10-03", total_amount: 4_000_000 },
        { id: 2, invoice_no: "INV-2", invoice_date: "2026-10-05", due_date: "2026-12-01", total_amount: 6_000_000 },
      ],
      [{ invoice_id: 1, payment_date: "2026-10-02", amount: 1_000_000 }],
      "2026-10-01",
      "2026-10-31",
      "2026-10-31",
    );
    expect(summary.overdueCount).toBe(1);
    expect(summary.overdueAmount).toBe(3_000_000);
    expect(summary.items[0].invoice_no).toBe("INV-1");
  });

  it("piutang bulan sebelumnya memisahkan pembayaran sebelum, selama, dan sesudah periode", () => {
    const summary = summarizePriorReceivables(
      [
        { id: 1, invoice_no: "INV-SEP", invoice_date: "2026-09-20", due_date: "2026-09-30", total_amount: 10_000_000 },
        { id: 2, invoice_no: "INV-OKT", invoice_date: "2026-10-05", due_date: "2026-11-05", total_amount: 3_000_000 },
      ],
      [
        { invoice_id: 1, payment_date: "2026-09-25", amount: 2_000_000 },
        { invoice_id: 1, payment_date: "2026-10-10", amount: 3_000_000 },
        { invoice_id: 1, payment_date: "2026-11-02", amount: 1_000_000 },
        { invoice_id: 2, payment_date: "2026-10-20", amount: 1_000_000 },
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(summary.opening).toBe(8_000_000);
    expect(summary.paid).toBe(3_000_000);
    expect(summary.remaining).toBe(5_000_000);
    expect(summary.count).toBe(1);
  });

  it("invoice lama yang lunas tidak dihitung sebagai sisa piutang", () => {
    const summary = summarizePriorReceivables(
      [{ id: 1, invoice_no: "INV-SEP", invoice_date: "2026-09-01", due_date: null, total_amount: 4_000_000 }],
      [
        { invoice_id: 1, payment_date: "2026-09-10", amount: 1_500_000 },
        { invoice_id: 1, payment_date: "2026-10-05", amount: 2_500_000 },
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(summary.opening).toBe(2_500_000);
    expect(summary.paid).toBe(2_500_000);
    expect(summary.remaining).toBe(0);
    expect(summary.count).toBe(0);
  });

  it("snapshot Tutup Buku memisahkan piutang lama dari piutang periode berjalan", () => {
    const summary = summarizePriorReceivablesFromSnapshot(
      66_863_360,
      [
        { invoice_date: "2026-09-10", remaining: 12_018_163 },
        { invoice_date: "2026-10-05", remaining: 20_000_000 },
      ],
      "2026-10-01",
    );
    expect(summary.opening).toBe(66_863_360);
    expect(summary.paid).toBe(54_845_197);
    expect(summary.remaining).toBe(12_018_163);
    expect(summary.count).toBe(1);
  });

  it("kas periode memakai payment_date, bukan tanggal invoice", () => {
    const summary = summarizeCashPeriod({
      initialBalance: 0,
      payments: [
        { payment_date: "2026-09-30", amount: 1_000_000 },
        { payment_date: "2026-10-02", amount: 4_000_000 },
        { payment_date: "2026-10-20", amount: 3_000_000 },
        { payment_date: "2026-11-01", amount: 9_000_000 },
      ],
      expenses: [
        { expense_date: "2026-10-05", amount: 2_000_000 },
        { expense_date: "2026-10-10", amount: 500_000 },
        { expense_date: "2026-11-02", amount: 7_000_000 },
      ],
      adjustments: [],
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });
    expect(summary.openingBalance).toBe(1_000_000);
    expect(summary.received).toBe(7_000_000);
    expect(summary.expenses).toBe(2_500_000);
    expect(summary.netCash).toBe(4_500_000);
    expect(summary.endingBalance).toBe(5_500_000);
  });

  it("saldo awal membawa mutasi sebelum periode dan penyesuaian kas", () => {
    const summary = summarizeCashPeriod({
      initialBalance: 10_000_000,
      payments: [
        { payment_date: "2026-09-10", amount: 5_000_000 },
        { payment_date: "2026-10-10", amount: 8_000_000 },
      ],
      expenses: [
        { expense_date: "2026-09-20", amount: 2_000_000 },
        { expense_date: "2026-10-15", amount: 1_000_000 },
      ],
      adjustments: [
        { adjustment_date: "2026-09-25", type: "Masuk", amount: 500_000 },
        { adjustment_date: "2026-10-20", type: "Masuk", amount: 2_000_000 },
        { adjustment_date: "2026-10-21", type: "Keluar", amount: 300_000 },
      ],
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });
    expect(summary.openingBalance).toBe(13_500_000);
    expect(summary.adjustmentIn).toBe(2_000_000);
    expect(summary.adjustmentOut).toBe(300_000);
    expect(summary.netCash).toBe(8_700_000);
    expect(summary.endingBalance).toBe(22_200_000);
  });

  it("invoice September dibayar Oktober menjadi kas Oktober, bukan pendapatan baru", () => {
    const payments = [
      { payment_date: "2026-09-20", amount: 500_000_000 },
      { payment_date: "2026-10-05", amount: 416_922_011 },
    ];
    const expenses = [{ expense_date: "2026-09-15", amount: 788_455_567 }];

    const september = summarizeCashPeriod({
      initialBalance: 0,
      payments,
      expenses,
      adjustments: [],
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    expect(september.received).toBe(500_000_000);
    expect(september.netCash).toBe(-288_455_567);

    const october = summarizeCashPeriod({
      initialBalance: 0,
      payments,
      expenses,
      adjustments: [],
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });
    expect(october.openingBalance).toBe(-288_455_567);
    expect(october.received).toBe(416_922_011);
    expect(october.netCash).toBe(416_922_011);
    expect(october.endingBalance).toBe(128_466_444);
  });

  it("periode closed memakai snapshot Tutup Buku yang immutable", () => {
    const summary = cashPeriodFromClosingSnapshot({
      opening_cash_balance: 0,
      cash_in: 880_494_317,
      cash_out_expenses: 788_455_567,
      adjustment_in: 0,
      adjustment_out: 0,
      ending_cash_balance: 92_038_750,
    });
    expect(summary.openingBalance).toBe(0);
    expect(summary.received).toBe(880_494_317);
    expect(summary.expenses).toBe(788_455_567);
    expect(summary.netCash).toBe(92_038_750);
    expect(summary.endingBalance).toBe(92_038_750);
  });
});
