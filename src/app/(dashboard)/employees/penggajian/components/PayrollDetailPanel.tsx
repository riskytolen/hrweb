"use client";

import { X, Coins, TrendingUp, TrendingDown, Wallet, Calendar, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Portal from "@/components/ui/Portal";
import { formatDate, formatRupiah } from "@/lib/payroll-v2/formatter";
import type { PayrollRow as RowData, PotonganAbsen, LemburDetail } from "@/lib/payroll-v2/types";
import StatusBadge from "./StatusBadge";
import BreakdownAbsen from "./BreakdownAbsen";
import BreakdownLembur from "./BreakdownLembur";

export default function PayrollDetailPanel({
  open,
  onClose,
  row,
  absenDetail,
  lemburDetail,
  prorataInfo,
}: {
  open: boolean;
  onClose: () => void;
  row: RowData | null;
  absenDetail: PotonganAbsen[];
  lemburDetail: LemburDetail[];
  prorataInfo?: { hariEfektif: number; hariTotal: number; isProrated: boolean };
}) {
  if (!row) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex justify-end">
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
          onClick={onClose}
        />
        <div className="relative bg-card w-full max-w-lg h-full overflow-y-auto shadow-2xl animate-slide-in-right">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge status={row.status} />
                <span className="text-xs text-muted-foreground">v{row.version}</span>
              </div>
              <h2 className="text-base font-bold text-foreground">{row.employeeName}</h2>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {row.divisi}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
              aria-label="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-5">
            {/* Netto highlight */}
            <div className="bg-gradient-to-br from-primary to-primary/80 rounded-2xl p-5 text-white">
              <p className="text-xs font-semibold opacity-80">Take-Home Pay</p>
              <p className="text-3xl font-bold mt-1 tabular-nums">
                {formatRupiah(row.netto)}
              </p>
              <p className="text-[11px] opacity-70 mt-1">
                Periode {row.periode}
                {row.lockedAt && ` · difinalkan ${formatDate(row.lockedAt)}`}
              </p>
            </div>

            {/* Pendapatan */}
            <section>
              <div className="flex items-center gap-2 mb-2.5">
                <TrendingUp className="w-4 h-4 text-success" />
                <h3 className="text-sm font-bold text-foreground">Pendapatan</h3>
              </div>
              <div className="space-y-1.5">
                <RowItem label="Gaji Pokok" value={row.gajiPokok} />
                {prorataInfo?.isProrated && (
                  <div className="ml-2 mt-1 mb-2 text-[11px] text-orange-600 bg-orange-50 dark:bg-orange-900/20 rounded-lg px-2 py-1.5 border border-orange-200/50">
                    Prorata {prorataInfo.hariEfektif}/{prorataInfo.hariTotal} hari kalender →{" "}
                    <strong>Gapok final: {formatRupiah(row.gajiPokok)}</strong>
                  </div>
                )}
                <RowItem label="Pendapatan Titik" value={row.pendapatanTitik} />
                <RowItem label="Lembur" value={row.lembur} />
                <RowItem label="Total Pendapatan" value={row.totalPendapatan} bold />
              </div>
            </section>

            {/* Lembur Breakdown */}
            {lemburDetail.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-sm font-bold text-foreground">Detail Lembur</h3>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {lemburDetail.length} pengajuan
                  </span>
                </div>
                <BreakdownLembur detail={lemburDetail} total={row.lembur} />
              </section>
            )}

            {/* Potongan */}
            <section>
              <div className="flex items-center gap-2 mb-2.5">
                <TrendingDown className="w-4 h-4 text-danger" />
                <h3 className="text-sm font-bold text-foreground">Potongan</h3>
              </div>
              <div className="space-y-1.5">
                <RowItem label="Potongan Absen" value={row.potonganAbsen} danger />
                <RowItem label="Total Potongan" value={row.totalPotongan} bold />
              </div>
            </section>

            {/* Absen Breakdown */}
            {absenDetail.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-rose-600" />
                    <h3 className="text-sm font-bold text-foreground">Detail Absen</h3>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {absenDetail.length} catatan
                  </span>
                </div>
                <BreakdownAbsen detail={absenDetail} total={row.potonganAbsen} />
              </section>
            )}

            {/* Audit */}
            <section className="pt-4 border-t border-border space-y-1.5 text-[11px] text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Diperbarui</span>
                <span>{formatDate(row.updatedAt)}</span>
              </div>
              {row.reviewedAt && (
                <div className="flex items-center justify-between">
                  <span>Di-review</span>
                  <span>{formatDate(row.reviewedAt)}</span>
                </div>
              )}
              {row.lockedAt && (
                <div className="flex items-center justify-between">
                  <span>Difinalkan</span>
                  <span>{formatDate(row.lockedAt)}</span>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function RowItem({
  label,
  value,
  bold,
  danger,
}: {
  label: string;
  value: number;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn("text-muted-foreground", bold && "font-semibold text-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          danger && value > 0 ? "text-rose-600 font-semibold" : "text-foreground",
          bold && "font-bold",
        )}
      >
        {danger && value > 0 ? "−" : ""}
        {formatRupiah(value)}
      </span>
    </div>
  );
}
