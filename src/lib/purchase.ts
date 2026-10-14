/**
 * Helper Purchase / Pengajuan PO — client-safe (pure, tanpa impor server).
 *
 * Aturan yang dikunci:
 * - Status PROSES dan status PEMBAYARAN disimpan terpisah.
 * - Paid / Installment dihitung dari pembayaran tercatat, bukan dipilih manual.
 * - Nomor PO: PO/YYYY/MM/00001 (dibuat di database via RPC).
 */

export const PURCHASE_PAGE_SIZES = [10, 25, 50, 100] as const;
export const PURCHASE_DEFAULT_PAGE_SIZE = 10;
export const PURCHASE_MAX_PAGE_SIZE = 100;

export const PURCHASE_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;
export const PURCHASE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const PURCHASE_MAX_ATTACHMENTS = 5;

export type PurchaseProcessStatus =
  | "po_masuk"
  | "po_diterima"
  | "on_process"
  | "waiting_list"
  | "pending_payment"
  | "non_approve"
  | "cancel";

export type PurchasePaymentStatus = "unpaid" | "installment" | "paid";

export interface PurchaseProcessStatusMeta {
  value: PurchaseProcessStatus;
  label: string;
  tone: "info" | "primary" | "warning" | "success" | "danger" | "muted";
}

export const PURCHASE_PROCESS_STATUSES: PurchaseProcessStatusMeta[] = [
  { value: "po_masuk", label: "PO Masuk", tone: "info" },
  { value: "po_diterima", label: "PO Diterima", tone: "primary" },
  { value: "on_process", label: "On Process", tone: "warning" },
  { value: "waiting_list", label: "Waiting List", tone: "muted" },
  { value: "pending_payment", label: "Pending Payment", tone: "warning" },
  { value: "non_approve", label: "Non Approve", tone: "danger" },
  { value: "cancel", label: "Cancel PO", tone: "danger" },
];

export const PURCHASE_PAYMENT_STATUS_META: Record<PurchasePaymentStatus, { label: string; tone: "muted" | "warning" | "success" }> = {
  unpaid: { label: "Belum Dibayar", tone: "muted" },
  installment: { label: "Installment", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
};

const TERMINAL_STATUSES: PurchaseProcessStatus[] = ["non_approve", "cancel"];

/** Status pembayaran diturunkan dari nominal vs total terbayar. Pure. */
export function purchasePaymentStatus(amount: number, totalPaid: number): PurchasePaymentStatus {
  const total = Math.max(0, Math.round(amount) || 0);
  const paid = Math.max(0, Math.round(totalPaid) || 0);
  if (total <= 0 || paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "installment";
}

/** Sisa tagihan PO (tidak pernah negatif). Pure. */
export function purchaseRemaining(amount: number, totalPaid: number): number {
  return Math.max(0, (Math.round(amount) || 0) - (Math.round(totalPaid) || 0));
}

export function isPurchaseTerminal(status: PurchaseProcessStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Transisi status proses yang diperbolehkan. Pure. */
export function canTransitionPurchaseStatus(
  from: PurchaseProcessStatus,
  to: PurchaseProcessStatus,
  opts: { hasPayments: boolean } = { hasPayments: false },
): boolean {
  if (from === to) return false;
  if (isPurchaseTerminal(from)) return false;
  if (isPurchaseTerminal(to) && opts.hasPayments) return false;
  const graph: Record<Exclude<PurchaseProcessStatus, "non_approve" | "cancel">, PurchaseProcessStatus[]> = {
    po_masuk: ["po_diterima", "non_approve", "cancel"],
    po_diterima: ["on_process", "waiting_list", "pending_payment", "non_approve", "cancel"],
    on_process: ["waiting_list", "pending_payment", "non_approve", "cancel"],
    waiting_list: ["on_process", "pending_payment", "non_approve", "cancel"],
    pending_payment: ["on_process", "waiting_list", "non_approve", "cancel"],
  };
  return (graph[from as keyof typeof graph] || []).includes(to);
}

/** Status terminal wajib menyertakan alasan. Pure. */
export function purchaseStatusNeedsReason(status: PurchaseProcessStatus): boolean {
  return isPurchaseTerminal(status);
}

/** Pembayaran baru hanya untuk PO yang belum ditolak/dibatalkan. Pure. */
export function canRecordPurchasePayment(status: PurchaseProcessStatus): boolean {
  return !isPurchaseTerminal(status);
}

export interface PurchaseFormInput {
  title: string;
  detail: string;
  amount: number;
  vendor_name: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  purpose: string;
}

export interface PurchaseFormErrors {
  title?: string;
  detail?: string;
  amount?: string;
  vendor_name?: string;
  bank_name?: string;
  account_number?: string;
  account_name?: string;
  purpose?: string;
}

/** Validasi form pengajuan di client. Pure — server memvalidasi ulang. */
export function validatePurchaseForm(input: PurchaseFormInput): PurchaseFormErrors {
  const errors: PurchaseFormErrors = {};
  const required = (v: string) => v.trim().length > 0;
  if (!required(input.title)) errors.title = "Judul kebutuhan wajib diisi.";
  else if (input.title.trim().length > 160) errors.title = "Judul maksimal 160 karakter.";
  if (!required(input.detail)) errors.detail = "Detail kebutuhan wajib diisi.";
  if (!Number.isFinite(input.amount) || Math.round(input.amount) <= 0) {
    errors.amount = "Nominal PO harus lebih dari Rp0.";
  } else if (Math.round(input.amount) > 100_000_000_000) {
    errors.amount = "Nominal PO melebihi batas wajar.";
  }
  if (!required(input.vendor_name)) errors.vendor_name = "Nama penerima/vendor wajib diisi.";
  if (!required(input.bank_name)) errors.bank_name = "Nama bank tujuan wajib diisi.";
  if (!required(input.account_number)) errors.account_number = "Nomor rekening tujuan wajib diisi.";
  else if (!/^[0-9\s-]{4,32}$/.test(input.account_number.trim())) {
    errors.account_number = "Nomor rekening 4–32 digit (boleh spasi/strip).";
  }
  if (!required(input.account_name)) errors.account_name = "Nama pemilik rekening wajib diisi.";
  if (!required(input.purpose)) errors.purpose = "Keterangan pembayaran wajib diisi.";
  return errors;
}

export interface PurchasePaymentInput {
  payment_date: string;
  amount: number;
}

/** Validasi input pembayaran di client. Pure — server memvalidasi ulang. */
export function validatePurchasePayment(
  input: PurchasePaymentInput,
  orderAmount: number,
  totalPaid: number,
): string | null {
  if (!input.payment_date) return "Tanggal pembayaran wajib diisi.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payment_date)) return "Format tanggal tidak valid.";
  if (!Number.isFinite(input.amount) || Math.round(input.amount) <= 0) {
    return "Nominal pembayaran harus lebih dari Rp0.";
  }
  const remaining = purchaseRemaining(orderAmount, totalPaid);
  if (Math.round(input.amount) > remaining) {
    return `Nominal melebihi sisa tagihan (${remaining.toLocaleString("id-ID")}).`;
  }
  return null;
}

/** Validasi file lampiran di client. Pure — server memvalidasi ulang. */
export function purchaseAttachmentError(
  file: { type?: string | null; size?: number | null; name?: string | null } | null | undefined,
  existingCount: number,
): string | null {
  if (!file) return "Pilih file terlebih dahulu.";
  if (!(PURCHASE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type || "")) {
    return "Lampiran harus PDF, JPG, JPEG, atau PNG.";
  }
  if (!Number.isFinite(file.size as number) || (file.size as number) <= 0) return "Ukuran file tidak valid.";
  if ((file.size as number) > PURCHASE_MAX_ATTACHMENT_BYTES) return "Ukuran tiap file maksimal 10 MB.";
  if (existingCount >= PURCHASE_MAX_ATTACHMENTS) return `Maksimal ${PURCHASE_MAX_ATTACHMENTS} lampiran per PO.`;
  return null;
}

// ─── Agregasi summary (pure, dipakai API + test) ───

export interface PurchaseSummaryOrder {
  id: number;
  amount: number;
  total_paid: number;
  process_status: PurchaseProcessStatus;
  requester_jabatan_id: number | null;
  requester_jabatan_nama: string | null;
  requester_name: string;
}

export interface PurchaseStatusSummary {
  status: PurchaseProcessStatus;
  label: string;
  count: number;
  poTotal: number;
  paidTotal: number;
  percent: number;
}

export interface PurchaseJabatanSummary {
  jabatan_id: number | null;
  jabatan_nama: string;
  count: number;
  poTotal: number;
  paidTotal: number;
  remaining: number;
}

export interface PurchaseSummary {
  totalOrders: number;
  poTotal: number;
  paidTotal: number;
  remaining: number;
  byStatus: PurchaseStatusSummary[];
  byJabatan: PurchaseJabatanSummary[];
}

/** Agregasi summary dari seluruh baris hasil filter (bukan hanya halaman aktif). Pure. */
export function summarizePurchaseOrders(orders: PurchaseSummaryOrder[]): PurchaseSummary {
  const totalOrders = orders.length;
  const poTotal = orders.reduce((s, o) => s + (Math.round(o.amount) || 0), 0);
  const paidTotal = orders.reduce((s, o) => s + Math.min(Math.round(o.total_paid) || 0, Math.round(o.amount) || 0), 0);

  const byStatus: PurchaseStatusSummary[] = PURCHASE_PROCESS_STATUSES.map((meta) => {
    const rows = orders.filter((o) => o.process_status === meta.value);
    const statusPo = rows.reduce((s, o) => s + (Math.round(o.amount) || 0), 0);
    const statusPaid = rows.reduce(
      (s, o) => s + Math.min(Math.round(o.total_paid) || 0, Math.round(o.amount) || 0),
      0,
    );
    return {
      status: meta.value,
      label: meta.label,
      count: rows.length,
      poTotal: statusPo,
      paidTotal: statusPaid,
      percent: totalOrders > 0 ? (rows.length / totalOrders) * 100 : 0,
    };
  });

  const jabatanMap = new Map<string, PurchaseJabatanSummary>();
  for (const o of orders) {
    const key = o.requester_jabatan_id === null ? "tanpa-jabatan" : String(o.requester_jabatan_id);
    const cur = jabatanMap.get(key) || {
      jabatan_id: o.requester_jabatan_id,
      jabatan_nama: o.requester_jabatan_nama?.trim() || "Tanpa Jabatan",
      count: 0,
      poTotal: 0,
      paidTotal: 0,
      remaining: 0,
    };
    const amt = Math.round(o.amount) || 0;
    const paid = Math.min(Math.round(o.total_paid) || 0, amt);
    cur.count += 1;
    cur.poTotal += amt;
    cur.paidTotal += paid;
    cur.remaining += Math.max(0, amt - paid);
    jabatanMap.set(key, cur);
  }

  return {
    totalOrders,
    poTotal,
    paidTotal,
    remaining: Math.max(0, poTotal - paidTotal),
    byStatus,
    byJabatan: Array.from(jabatanMap.values()).sort((a, b) => b.poTotal - a.poTotal),
  };
}

/** Format nomor PO untuk periode & urutan. Pure. */
export function formatPurchaseOrderNo(year: number, month: number, seq: number): string {
  const mm = String(month).padStart(2, "0");
  return `PO/${year}/${mm}/${String(seq).padStart(5, "0")}`;
}
