import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { deliveryPhotoError, latestDeliveries, type InvoiceDelivery } from "../finance-delivery";

describe("invoice delivery evidence", () => {
  it("accepts supported photos within the limit", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(deliveryPhotoError({ type, size: 5 * 1024 * 1024 })).toBeNull();
    }
  });
  it("rejects PDF, SVG, empty and oversized photos", () => {
    for (const file of [{ type: "application/pdf", size: 100 }, { type: "image/svg+xml", size: 100 }, { type: "image/jpeg", size: 0 }, { type: "image/png", size: 5242881 }]) {
      expect(deliveryPhotoError(file)).not.toBeNull();
    }
  });
});
describe("delivery register", () => {
  it("shows latest attempt per invoice regardless of query order", () => {
    const rows = [{ invoice_id: 1, attempt: 2, status: "Pending" }, { invoice_id: 2, attempt: 1, status: "Terkirim" }, { invoice_id: 1, attempt: 1, status: "Ditolak" }] as InvoiceDelivery[];
    const latest = latestDeliveries(rows);
    expect(latest.size).toBe(2);
    expect(latest.get(1)?.status).toBe("Pending");
    expect(latest.get(2)?.status).toBe("Terkirim");
  });
});
