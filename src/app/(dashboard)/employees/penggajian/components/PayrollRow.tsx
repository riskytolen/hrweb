"use client";

import { Eye, ChevronRight, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/payroll-v2/formatter";
import type { PayrollRow as RowData } from "@/lib/payroll-v2/types";
import StatusBadge from "./StatusBadge";
import ProrataBadge from "./ProrataBadge";
import Button from "@/components/ui/Button";

export default function PayrollRow({
  row,
  isProrated,
  prorataInfo,
  selected,
  onSelectToggle,
  onDetail,
  onEdit,
  showEditAction = true,
}: {
  row: RowData;
  isProrated: boolean;
  prorataInfo?: { hariEfektif: number; hariTotal: number };
  selected: boolean;
  onSelectToggle: () => void;
  onDetail: () => void;
  onEdit?: () => void;
  showEditAction?: boolean;
}) {
  const isLocked = row.status === "FINAL";
  return (
    <tr
      className={cn(
        "hover:bg-muted/30 transition-colors border-b border-border/50",
        selected && "bg-primary/5",
        isLocked && "bg-emerald-50/30 dark:bg-emerald-950/10",
      )}
    >
      <td className="px-4 py-3 text-center">
        <input
          type="checkbox"
          className="rounded border-muted-foreground/30 text-primary cursor-pointer w-4 h-4 disabled:opacity-30"
          checked={selected}
          onChange={onSelectToggle}
          disabled={isLocked}
          aria-label={`Pilih slip ${row.employeeName}`}
        />
      </td>
      <td className="px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{row.employeeName}</p>
        <p className="text-[11px] text-muted-foreground">{row.divisi}</p>
      </td>
      <td className="px-4 py-3 text-right">
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {formatRupiah(row.gajiPokok)}
        </p>
        {isProrated && prorataInfo && (
          <div className="mt-0.5 flex justify-end">
            <ProrataBadge hariEfektif={prorataInfo.hariEfektif} hariTotal={prorataInfo.hariTotal} />
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right text-sm text-foreground tabular-nums">
        {formatRupiah(row.pendapatanTitik)}
      </td>
      <td className="px-4 py-3 text-right text-sm text-foreground tabular-nums">
        {formatRupiah(row.lembur)}
      </td>
      <td className="px-4 py-3 text-right text-sm text-rose-600 tabular-nums">
        {row.potonganAbsen > 0 ? `−${formatRupiah(row.potonganAbsen)}` : "—"}
      </td>
      <td className="px-4 py-3 text-right">
        <p className="text-sm font-bold text-foreground tabular-nums">
          {formatRupiah(row.netto)}
        </p>
      </td>
      <td className="px-4 py-3 text-center">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {showEditAction && !isLocked && onEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"
              title="Edit cell"
              aria-label={`Edit ${row.employeeName}`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onDetail}
            className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"
            title="Lihat detail"
            aria-label={`Detail ${row.employeeName}`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
