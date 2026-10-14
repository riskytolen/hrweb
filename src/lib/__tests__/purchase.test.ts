import { describe, expect, it } from "vitest";
import {
  canRecordPurchasePayment,
  canTransitionPurchaseStatus,
  formatPurchaseOrderNo,
  purchaseAttachmentError,
  purchasePaymentStatus,
  purchaseRemaining,
  purchaseStatusNeedsReason,
  summarizePurchaseOrders,
  validatePurchaseForm,
  validatePurchasePayment,
} from "../purchase";

const validForm = {
  title: "Pengadaan laptop operasional",
  detail: "2 unit laptop untuk admin purchasing",
  amount: 25_000_000,
  vendor_name: "PT Maju Jaya",
  bank_name: "BCA",
  account_number: "1234567890",
  account_name: "PT Maju Jaya",
  purpose: "Pembayaran pengadaan laptop operasional",
};

describe("purchase status", () => {
  it("menurunkan status pembayaran dari nominal dan total bayar", () => {
    expect(purchasePaymentStatus(10_000_000, 0)).toBe("unpaid");
    expect(purchasePaymentStatus(10_000_000, 4_000_000)).toBe("installment");
    expect(purchasePaymentStatus(10_000_000, 10_000_000)).toBe("paid");
    expect(purchasePaymentStatus(0, 0)).toBe("unpaid");
    expect(purchaseRemaining(10_000_000, 4_000_000)).toBe(6_000_000);
    expect(purchaseRemaining(10_000_000, 12_000_000)).toBe(0);
  });

  it("transisi status mengikuti alur Purchasing", () => {
    expect(canTransitionPurchaseStatus("po_masuk", "po_diterima")).toBe(true);
    expect(canTransitionPurchaseStatus("po_masuk", "on_process")).toBe(false);
    expect(canTransitionPurchaseStatus("po_diterima", "pending_payment")).toBe(true);
    expect(canTransitionPurchaseStatus("pending_payment", "on_process")).toBe(true);
    expect(canTransitionPurchaseStatus("po_masuk", "po_masuk")).toBe(false);
    expect(canTransitionPurchaseStatus("cancel", "on_process")).toBe(false);
    // PO berbayar tidak boleh ditolak/dibatalkan langsung.
    expect(canTransitionPurchaseStatus("on_process", "cancel", { hasPayments: true })).toBe(false);
    expect(canTransitionPurchaseStatus("on_process", "cancel", { hasPayments: false })).toBe(true);
    expect(purchaseStatusNeedsReason("non_approve")).toBe(true);
    expect(purchaseStatusNeedsReason("on_process")).toBe(false);
    expect(canRecordPurchasePayment("pending_payment")).toBe(true);
    expect(canRecordPurchasePayment("cancel")).toBe(false);
  });
});

describe("purchase validation", () => {
  it("form valid lolos validasi", () => {
    expect(validatePurchaseForm(validForm)).toEqual({});
  });

  it("form kosong dan nominal nol ditolak", () => {
    const errors = validatePurchaseForm({
      ...validForm,
      title: "  ",
      amount: 0,
      account_number: "ABC",
      purpose: "",
    });
    expect(errors.title).toBeTruthy();
    expect(errors.amount).toBeTruthy();
    expect(errors.account_number).toBeTruthy();
    expect(errors.purpose).toBeTruthy();
  });

  it("pembayaran melebihi sisa ditolak", () => {
    expect(validatePurchasePayment({ payment_date: "2026-10-05", amount: 4_000_000 }, 10_000_000, 4_000_000)).toBeNull();
    expect(validatePurchasePayment({ payment_date: "", amount: 1_000 }, 10_000_000, 0)).toMatch(/Tanggal/);
    expect(validatePurchasePayment({ payment_date: "2026-10-05", amount: 7_000_000 }, 10_000_000, 4_000_000)).toMatch(/sisa/);
  });

  it("lampiran non-PDF/gambar atau kebesaran ditolak", () => {
    expect(purchaseAttachmentError({ type: "image/png", size: 1000 }, 0)).toBeNull();
    expect(purchaseAttachmentError({ type: "application/zip", size: 1000 }, 0)).toMatch(/PDF/);
    expect(purchaseAttachmentError({ type: "application/pdf", size: 11 * 1024 * 1024 }, 0)).toMatch(/10 MB/);
    expect(purchaseAttachmentError({ type: "application/pdf", size: 1000 }, 5)).toMatch(/Maksimal 5/);
  });
});

describe("purchase summary", () => {
  it("mengagregasi status, nominal, persen, dan rekap jabatan", () => {
    const summary = summarizePurchaseOrders([
      { id: 1, amount: 10_000_000, total_paid: 10_000_000, process_status: "pending_payment", requester_jabatan_id: 3, requester_jabatan_nama: "Wakor", requester_name: "A" },
      { id: 2, amount: 10_000_000, total_paid: 4_000_000, process_status: "pending_payment", requester_jabatan_id: 3, requester_jabatan_nama: "Wakor", requester_name: "B" },
      { id: 3, amount: 5_000_000, total_paid: 0, process_status: "po_masuk", requester_jabatan_id: 5, requester_jabatan_nama: "Koordinator", requester_name: "C" },
    ]);
    expect(summary.totalOrders).toBe(3);
    expect(summary.poTotal).toBe(25_000_000);
    expect(summary.paidTotal).toBe(14_000_000);
    expect(summary.remaining).toBe(11_000_000);
    const pending = summary.byStatus.find((s) => s.status === "pending_payment")!;
    expect(pending.count).toBe(2);
    expect(pending.poTotal).toBe(20_000_000);
    expect(pending.paidTotal).toBe(14_000_000);
    expect(pending.percent).toBeCloseTo(66.6667, 3);
    const wakor = summary.byJabatan.find((j) => j.jabatan_nama === "Wakor")!;
    expect(wakor.count).toBe(2);
    expect(wakor.remaining).toBe(6_000_000);
  });

  it("format nomor PO konsisten", () => {
    expect(formatPurchaseOrderNo(2026, 10, 1)).toBe("PO/2026/10/00001");
    expect(formatPurchaseOrderNo(2026, 1, 120)).toBe("PO/2026/01/00120");
  });
});
