import { describe, it, expect } from "vitest";
import { computePpn11, summarizeClientPpn, buildMonthlyPajak } from "@/lib/finance-tax";

describe("computePpn11", () => {
  it("100jt => 1.1jt", () => {
    expect(computePpn11(100_000_000)).toBe(1_100_000);
  });
  it("150jt => 1.65jt", () => {
    expect(computePpn11(150_000_000)).toBe(1_650_000);
  });
  it("pembulatan", () => {
    expect(computePpn11(1_000)).toBe(11); // 11.0
    expect(computePpn11(1_001)).toBe(11); // 11.011 → 11
  });
  it("0 atau negatif => 0", () => {
    expect(computePpn11(0)).toBe(0);
    expect(computePpn11(-5)).toBe(0);
  });
});

describe("summarizeClientPpn", () => {
  it("total + per client", () => {
    const rows = [
      { clientLabel: "A", subtotal: 100_000_000 },
      { clientLabel: "A", subtotal: 50_000_000 },
      { clientLabel: "B", subtotal: 50_000_000 },
    ];
    const summary = summarizeClientPpn(rows);
    expect(summary.find((s) => s.clientLabel === "A")?.totalPpn).toBe(1_650_000);
    expect(summary[0].totalPpn).toBeGreaterThanOrEqual(summary[1].totalPpn);
  });
  it("tanpa client tetap dihitung", () => {
    const rows = [{ clientLabel: "Tanpa Client", subtotal: 10_000 }];
    const s = summarizeClientPpn(rows);
    expect(s[0].clientLabel).toBe("Tanpa Client");
  });
  it("memakai PPN/PPh tersimpan sesuai skema pajak", () => {
    const rows = [
      // trip_only: dasar 10jt → PPN 110rb, PPh 200rb
      { clientLabel: "A", subtotal: 11_000_000, ppn_amount: 110_000, pph_amount: 200_000 },
      // all_components: dasar 11jt → PPN 121rb, PPh 220rb
      { clientLabel: "A", subtotal: 11_000_000, ppn_amount: 121_000, pph_amount: 220_000 },
    ];
    const s = summarizeClientPpn(rows);
    expect(s).toHaveLength(1);
    expect(s[0].totalTagihan).toBe(22_000_000);
    expect(s[0].totalPpn).toBe(231_000);
    expect(s[0].totalPph).toBe(420_000);
  });
});

describe("buildMonthlyPajak", () => {
  it("omzet - pengeluaran = hasil", () => {
    const invoices = [
      { invoice_date: "2026-01-10", subtotal: 100_000_000 },
      { invoice_date: "2026-01-20", subtotal: 50_000_000 },
      { invoice_date: "2026-02-01", subtotal: 20_000_000 },
    ];
    const expenses = [{ expense_date: "2026-01-15", amount: 40_000_000 }];
    const months = buildMonthlyPajak(invoices, expenses, 2026);
    expect(months[0].omzet).toBe(150_000_000);
    expect(months[0].pengeluaran).toBe(40_000_000);
    expect(months[0].hasil).toBe(110_000_000);
    expect(months[1].omzet).toBe(20_000_000);
  });
});
