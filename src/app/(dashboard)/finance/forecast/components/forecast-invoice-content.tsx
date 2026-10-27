"use client";

import { formatCurrency } from "@/lib/utils";

export interface ForecastInvoiceDetailView {
  invoiceNo: string;
  description?: string | null;
  clientLabel?: string | null;
  clientContact?: string | null;
  tollAmount?: number | null;
  parkingAmount?: number | null;
  otherAmount?: number | null;
  pphAmount?: number | null;
  notes?: string | null;
}

/**
 * Tampilan ringkas isi invoice yang konsisten dengan halaman Pendapatan:
 * nomor invoice tebal, deskripsi, rincian biaya tambahan, dan catatan.
 */
export default function ForecastInvoiceContent({ view }: { view: ForecastInvoiceDetailView }) {
  const bits: string[] = [];
  if ((view.tollAmount ?? 0) > 0) bits.push(`Toll ${formatCurrency(view.tollAmount ?? 0)}`);
  if ((view.parkingAmount ?? 0) > 0) bits.push(`Parkir ${formatCurrency(view.parkingAmount ?? 0)}`);
  if ((view.otherAmount ?? 0) > 0) bits.push(`Lain ${formatCurrency(view.otherAmount ?? 0)}`);
  if ((view.pphAmount ?? 0) > 0) bits.push(`PPh ${formatCurrency(view.pphAmount ?? 0)}`);

  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-foreground" title={view.invoiceNo}>
        {view.invoiceNo}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground whitespace-pre-line break-words">
        {view.description?.trim() || "—"}
      </p>
      {view.clientLabel && (
        <p className="text-[10px] font-medium text-foreground/80">
          {view.clientLabel}
          {view.clientContact && view.clientContact !== view.clientLabel && (
            <span className="font-normal text-muted-foreground"> — {view.clientContact}</span>
          )}
        </p>
      )}
      {bits.length > 0 && (
        <p className="text-[10px] text-muted-foreground">{bits.join(" • ")}</p>
      )}
      {view.notes && (
        <p className="text-[10px] italic text-muted-foreground break-words">
          Catatan: {view.notes}
        </p>
      )}
    </div>
  );
}
