import { describe, expect, it } from "vitest";
import {
  computeClosingPreview,
  isMonthEnded,
  monthEndOf,
  monthStartOf,
  nextMonthStart,
  parseFinanceDbError,
  prevMonthStart,
} from "../finance-closing";

describe("finance closing helpers", () => {
  it("normalisasi awal dan akhir bulan", () => {
    expect(monthStartOf("2026-09-15")).toBe("2026-09-01");
    expect(monthEndOf("2026-09-01")).toBe("2026-09-30");
    expect(monthEndOf("2026-10-01")).toBe("2026-10-31");
    expect(monthEndOf("2024-02-01")).toBe("2024-02-29");
    expect(nextMonthStart("2026-09-01")).toBe("2026-10-01");
    expect(prevMonthStart("2026-10-01")).toBe("2026-09-01");
  });

  it("bulan hanya boleh ditutup setelah berakhir", () => {
    expect(isMonthEnded("2026-09-01", "2026-10-01")).toBe(true);
    expect(isMonthEnded("2026-09-01", "2026-09-30")).toBe(false);
    expect(isMonthEnded("2026-10-01", "2026-10-13")).toBe(false);
  });

  it("invoice September dibayar Oktober: kas masuk Oktober, piutang September tetap", () => {
    const invoices = [
      { id: 1, invoice_no: "INV-SEPT", invoice_date: "2026-09-20", due_date: "2026-09-30", total_amount: 10_000_000, subtotal: 10_000_000, ppn_amount: 0, pph_amount: 0, clientName: "A" },
    ];
    const payments = [{ invoice_id: 1, payment_date: "2026-10-02", amount: 10_000_000 }];

    const sept = computeClosingPreview({
      periodStart: "2026-09-01",
      invoices,
      payments,
      expenses: [{ expense_date: "2026-09-05", amount: 1_000_000 }],
      adjustments: [],
      openingPrevBalance: null,
      initialCashBalance: 0,
    });

    expect(sept.revenue_total).toBe(10_000_000);
    expect(sept.cash_in).toBe(0);
    expect(sept.cash_on_hand_profit).toBe(-1_000_000);
    expect(sept.ending_cash_balance).toBe(-1_000_000);
    expect(sept.closing_receivable).toBe(10_000_000);
    expect(sept.receivables).toHaveLength(1);

    const okt = computeClosingPreview({
      periodStart: "2026-10-01",
      invoices: [
        ...invoices,
        { id: 2, invoice_no: "INV-OKT", invoice_date: "2026-10-05", due_date: "2026-11-05", total_amount: 5_000_000, subtotal: 5_000_000, ppn_amount: 0, pph_amount: 0, clientName: "B" },
      ],
      payments: [...payments, { invoice_id: 2, payment_date: "2026-10-06", amount: 2_000_000 }],
      expenses: [{ expense_date: "2026-10-07", amount: 1_500_000 }],
      adjustments: [],
      openingPrevBalance: sept.ending_cash_balance,
      initialCashBalance: 0,
    });

    // Defisit September tidak dibawa; opening Oktober nol.
    expect(okt.opening_prev_balance).toBe(-1_000_000);
    expect(okt.deficit_reset).toBe(1_000_000);
    expect(okt.opening_cash_balance).toBe(0);
    expect(okt.cash_in).toBe(12_000_000);
    expect(okt.revenue_total).toBe(5_000_000);
    expect(okt.opening_receivable).toBe(10_000_000);
    expect(okt.closing_receivable).toBe(3_000_000);
  });

  it("saldo positif dibawa penuh, saldo negatif di-nol-kan", () => {
    const base = {
      periodStart: "2026-10-01",
      invoices: [],
      payments: [],
      expenses: [],
      adjustments: [],
      initialCashBalance: 0,
    };
    const positif = computeClosingPreview({ ...base, openingPrevBalance: 500_000 });
    expect(positif.opening_cash_balance).toBe(500_000);
    expect(positif.deficit_reset).toBe(0);

    const negatif = computeClosingPreview({ ...base, openingPrevBalance: -200_000 });
    expect(negatif.opening_cash_balance).toBe(0);
    expect(negatif.deficit_reset).toBe(200_000);
  });

  it("pembayaran setelah periode tidak mengubah piutang closing", () => {
    const preview = computeClosingPreview({
      periodStart: "2026-10-01",
      invoices: [
        { id: 1, invoice_no: "INV-1", invoice_date: "2026-10-20", due_date: "2026-11-20", total_amount: 3_000_000, clientName: "A" },
      ],
      payments: [{ invoice_id: 1, payment_date: "2026-11-02", amount: 3_000_000 }],
      expenses: [],
      adjustments: [],
      openingPrevBalance: 0,
      initialCashBalance: 0,
    });
    expect(preview.cash_in).toBe(0);
    expect(preview.closing_receivable).toBe(3_000_000);
  });

  it("menerjemahkan error DB closing ke bahasa Indonesia", () => {
    expect(parseFinanceDbError(new Error("FINANCE_PERIOD_CLOSED:2026-09-15"))).toContain("sudah ditutup");
    expect(parseFinanceDbError(new Error("FINANCE_PAYMENT_OVERPAID: x"))).toContain("melebihi sisa");
    expect(parseFinanceDbError(new Error("FINANCE_SEQUENCE: y"))).toContain("berurutan");
  });
});
