import { describe, expect, it } from "vitest";
import { calculateInvoiceTotals, invoiceTaxSchemeLabel } from "../finance";

describe("calculateInvoiceTotals", () => {
  const base = {
    trip_amount: 10_000_000,
    toll_amount: 500_000,
    parking_amount: 200_000,
    other_amount: 300_000,
    ppn_percent: 1.1,
    pph_percent: 2,
  };

  it("trip_only: pajak hanya dari Biaya Perjalanan", () => {
    const t = calculateInvoiceTotals({ ...base, tax_scheme: "trip_only" });
    expect(t.base_amount).toBe(11_000_000);
    expect(t.tax_base_amount).toBe(10_000_000);
    expect(t.ppn_amount).toBe(110_000);
    expect(t.pph_amount).toBe(200_000);
    expect(t.total_amount).toBe(11_000_000 + 110_000 - 200_000);
  });

  it("all_components: pajak dari seluruh komponen biaya", () => {
    const t = calculateInvoiceTotals({ ...base, tax_scheme: "all_components" });
    expect(t.base_amount).toBe(11_000_000);
    expect(t.tax_base_amount).toBe(11_000_000);
    expect(t.ppn_amount).toBe(121_000);
    expect(t.pph_amount).toBe(220_000);
    expect(t.total_amount).toBe(11_000_000 + 121_000 - 220_000);
  });

  it("invoice lama tanpa pajak tidak berubah totalnya", () => {
    const t = calculateInvoiceTotals({
      trip_amount: 5_000_000,
      ppn_percent: 0,
      pph_percent: 0,
    });
    expect(t.base_amount).toBe(5_000_000);
    expect(t.ppn_amount).toBe(0);
    expect(t.pph_amount).toBe(0);
    expect(t.total_amount).toBe(5_000_000);
  });

  it("nilai negatif/nol diamankan ke 0", () => {
    const t = calculateInvoiceTotals({
      trip_amount: -100,
      toll_amount: NaN,
      parking_amount: undefined,
      other_amount: null,
      ppn_percent: 1.1,
      pph_percent: 2,
    });
    expect(t.base_amount).toBe(0);
    expect(t.tax_base_amount).toBe(0);
    expect(t.ppn_amount).toBe(0);
    expect(t.pph_amount).toBe(0);
    expect(t.total_amount).toBe(0);
  });

  it("skema tak dikenal default ke trip_only", () => {
    const t = calculateInvoiceTotals({ ...base, tax_scheme: "ngawur" });
    expect(t.tax_scheme).toBe("trip_only");
    expect(t.tax_base_amount).toBe(10_000_000);
  });

  it("label skema pajak", () => {
    expect(invoiceTaxSchemeLabel("trip_only")).toBe("Biaya Perjalanan Saja");
    expect(invoiceTaxSchemeLabel("all_components")).toBe("Seluruh Komponen Biaya");
    expect(invoiceTaxSchemeLabel(null)).toBe("Biaya Perjalanan Saja");
  });
});
