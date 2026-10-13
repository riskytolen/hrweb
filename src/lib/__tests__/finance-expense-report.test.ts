import { describe, expect, it } from "vitest";
import {
  buildExpenseFilename,
  filterExpensesByDate,
  formatExpensePeriodLabel,
  isExpenseDateInRange,
  summarizeExpenses,
  toExpensePdfRow,
} from "../finance-expense-report";

const rows = [
  { expense_date: "2026-09-30", amount: 400_000, category_name: "BBM" },
  { expense_date: "2026-10-01", amount: 2_000_000, category_name: "Sewa Mobil" },
  { expense_date: "2026-10-15", amount: 300_000, category_name: "BBM" },
  { expense_date: "2026-10-31", amount: 500_000, category_name: "Parkir" },
  { expense_date: "2026-11-01", amount: 999_000, category_name: "Lain-lain" },
];

describe("finance expense report", () => {
  it("rentang inklusif dan batas kosong", () => {
    expect(isExpenseDateInRange("2026-10-01", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isExpenseDateInRange("2026-10-31", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isExpenseDateInRange("2026-09-30", "2026-10-01", "2026-10-31")).toBe(false);
    expect(isExpenseDateInRange("2026-11-01", "2026-10-01", "2026-10-31")).toBe(false);
    expect(isExpenseDateInRange("2026-01-05", "", "")).toBe(true);
    expect(isExpenseDateInRange("", "2026-10-01", "2026-10-31")).toBe(false);
  });

  it("filter tanggal memakai expense_date", () => {
    const out = filterExpensesByDate(rows, "2026-10-01", "2026-10-31");
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.expense_date)).toEqual(["2026-10-01", "2026-10-15", "2026-10-31"]);
  });

  it("tanpa batas mengembalikan semua baris", () => {
    expect(filterExpensesByDate(rows, "", "")).toHaveLength(5);
    expect(filterExpensesByDate(rows, "2026-10-01", "").map((r) => r.expense_date)).toEqual([
      "2026-10-01",
      "2026-10-15",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("ringkasan dari himpunan terfilter", () => {
    const s = summarizeExpenses(filterExpensesByDate(rows, "2026-10-01", "2026-10-31"));
    expect(s.count).toBe(3);
    expect(s.total).toBe(2_800_000);
    expect(s.average).toBe(Math.round(2_800_000 / 3));
    expect(s.topCategoryName).toBe("Sewa Mobil");
    expect(s.topCategoryTotal).toBe(2_000_000);
  });

  it("ringkasan kosong aman", () => {
    const s = summarizeExpenses([]);
    expect(s).toMatchObject({ count: 0, total: 0, average: 0, topCategoryTotal: 0 });
  });

  it("label periode Indonesia", () => {
    expect(formatExpensePeriodLabel("", "")).toBe("Semua periode");
    expect(formatExpensePeriodLabel("2026-10-01", "2026-10-31")).toContain("Okt 2026");
    expect(formatExpensePeriodLabel("2026-10-01", "")).toContain("Sejak");
    expect(formatExpensePeriodLabel("", "2026-10-31")).toContain("Sampai");
  });

  it("nama file export berperiode", () => {
    expect(buildExpenseFilename("pdf", "2026-10-01", "2026-10-31")).toBe(
      "Pengeluaran_2026-10-01_2026-10-31.pdf",
    );
    expect(buildExpenseFilename("csv", "", "")).toBe("Pengeluaran_semua_semua.csv");
  });

  it("serialisasi baris PDF", () => {
    const cells = toExpensePdfRow(
      {
        expense_date: "2026-10-15",
        category_name: "BBM",
        description: "Isi solar",
        vendor: "SPBU",
        method: "Tunai",
        amount: 300_000,
      },
      0,
    );
    expect(cells).toEqual(["1", "2026-10-15", "BBM", "Isi solar", "SPBU", "Tunai", "300000"]);
  });
});
