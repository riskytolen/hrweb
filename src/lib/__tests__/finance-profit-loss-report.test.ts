import { describe, expect, it } from "vitest";
import {
  buildProfitLossFilename,
  toProfitLossCategoryPdfRow,
  toProfitLossIncomePdfRow,
  toProfitLossReceivablePdfRow,
} from "../finance-profit-loss-report";

describe("finance profit loss report helpers", () => {
  it("nama file memakai prefix periode bulanan dan tahunan", () => {
    expect(buildProfitLossFilename("2026-10")).toBe("Laba_Rugi_2026-10.pdf");
    expect(buildProfitLossFilename("2026")).toBe("Laba_Rugi_2026.pdf");
    expect(buildProfitLossFilename("")).toBe("Laba_Rugi_semua.pdf");
  });

  it("baris pendapatan membawa kolom penting", () => {
    const row = toProfitLossIncomePdfRow(
      { invoice_no: "INV-101", invoice_date: "2026-10-05", clientName: "PT Maju", total_amount: 1500000 },
      0,
    );
    expect(row).toHaveLength(5);
    expect(row[0]).toBe("1");
    expect(row[1]).toBe("2026-10-05");
    expect(row[2]).toBe("INV-101");
    expect(row[3]).toBe("PT Maju");
    expect(row[4]).toBe("1500000");
  });

  it("baris kategori memakai persentase dua desimal", () => {
    const row = toProfitLossCategoryPdfRow({ name: "Operasional", total: 300000, pct: 12.345 }, 1);
    expect(row).toHaveLength(4);
    expect(row[0]).toBe("2");
    expect(row[1]).toBe("Operasional");
    expect(row[2]).toBe("300000");
    expect(row[3]).toBe("12.35%");
  });

  it("baris piutang membawa total, dibayar, sisa, dan status", () => {
    const row = toProfitLossReceivablePdfRow(
      {
        invoice_no: "INV-102",
        clientName: "PT Mundur",
        due_date: "2026-10-20",
        total: 2000000,
        paid: 500000,
        remaining: 1500000,
        bucket: "Terlambat 1–30 hari",
      },
      0,
    );
    expect(row).toHaveLength(8);
    expect(row[1]).toBe("INV-102");
    expect(row[4]).toBe("2000000");
    expect(row[5]).toBe("500000");
    expect(row[6]).toBe("1500000");
    expect(row[7]).toBe("Terlambat 1–30 hari");
  });

  it("mendukung nilai negatif dan data kosong", () => {
    const loss = toProfitLossCategoryPdfRow({ name: "Rugi", total: -250000, pct: 0 }, 0);
    expect(loss[2]).toBe("-250000");

    const emptyClient = toProfitLossIncomePdfRow(
      { invoice_no: "INV-000", invoice_date: "2026-10-01", clientName: "", total_amount: 0 },
      0,
    );
    expect(emptyClient[3]).toBe("—");

    const noDue = toProfitLossReceivablePdfRow(
      { invoice_no: "INV-003", clientName: "", due_date: null, total: 0, paid: 0, remaining: 0, bucket: "" },
      2,
    );
    expect(noDue[0]).toBe("3");
    expect(noDue[2]).toBe("—");
    expect(noDue[3]).toBe("—");
    expect(noDue[7]).toBe("—");
  });
});
