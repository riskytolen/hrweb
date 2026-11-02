import { supabase } from "@/lib/supabase";
export const DELIVERY_STATUSES = ["Pending", "Terkirim", "Ditolak", "Revisi"] as const;
export const DELIVERY_METHODS = ["Lalamove", "Tim JAMS", "Lainnya"] as const;
export const DELIVERY_BUCKET = "finance-invoice-delivery-proofs";
export interface InvoiceDelivery {
  id: number; invoice_id: number; attempt: number; version: number;
  status: typeof DELIVERY_STATUSES[number]; sent_at: string;
  method: string; sender: string; recipient: string; proof_path: string | null;
  notes: string; actor_name: string; updated_at: string;
}
export interface DeliveryEvent {
  id: number; actor_name: string; created_at: string; snapshot: InvoiceDelivery;
}
export function deliveryPhotoError(file: { type: string; size: number }): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Bukti harus foto JPG, PNG, atau WebP.";
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) return "Ukuran foto maksimal 5 MB dan tidak boleh kosong.";
  return null;
}
export async function fetchDeliveries(): Promise<InvoiceDelivery[]> {
  const rows: InvoiceDelivery[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from("finance_invoice_deliveries").select("*").order("id").range(start, start + 999);
    if (error) throw error;
    rows.push(...(data as InvoiceDelivery[]));
    if (data.length < 1000) return rows;
  }
}
export function latestDeliveries(rows: InvoiceDelivery[]): Map<number, InvoiceDelivery> {
  const map = new Map<number, InvoiceDelivery>();
  for (const row of rows) if ((map.get(row.invoice_id)?.attempt ?? 0) < row.attempt) map.set(row.invoice_id, row);
  return map;
}
export async function deliveryPhotoUrl(path: string) {
  const { data, error } = await supabase.storage.from(DELIVERY_BUCKET).createSignedUrl(path, 180);
  if (error) throw error;
  return data.signedUrl;
}
