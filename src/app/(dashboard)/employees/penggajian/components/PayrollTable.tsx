"use client";

import { cn } from "@/lib/utils";
import PayrollRow from "./PayrollRow";
import type { PayrollRow as RowData } from "@/lib/payroll-v2/types";
import EmptyState from "./EmptyState";
import { Inbox } from "lucide-react";

export default function PayrollTable({
  rows,
  selectedIds,
  onSelectAll,
  onSelectToggle,
  onDetail,
  onEdit,
  isProratedMap,
  prorataInfoMap,
  emptyTitle,
  emptyDescription,
  emptyAction,
  showEditAction = true,
}: {
  rows: RowData[];
  selectedIds: Set<number>;
  onSelectAll: (checked: boolean) => void;
  onSelectToggle: (id: number) => void;
  onDetail: (row: RowData) => void;
  onEdit?: (row: RowData) => void;
  isProratedMap: Map<number, boolean>;
  prorataInfoMap: Map<number, { hariEfektif: number; hariTotal: number }>;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
  showEditAction?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const selectableRows = rows.filter((r) => r.status !== "FINAL");
  const allSelected =
    selectableRows.length > 0 && selectableRows.every((r) => selectedIds.has(r.id));
  const someSelected = selectableRows.some((r) => selectedIds.has(r.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 text-center w-12">
              <input
                type="checkbox"
                className="rounded border-muted-foreground/30 text-primary cursor-pointer w-4 h-4"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && someSelected;
                }}
                onChange={(e) => onSelectAll(e.target.checked)}
                aria-label="Pilih semua"
              />
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Pegawai
            </th>
            <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Gapok
            </th>
            <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Titik
            </th>
            <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Lembur
            </th>
            <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Pot. Absen
            </th>
            <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Netto
            </th>
            <th className="px-4 py-3 text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-20">
              Aksi
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PayrollRow
              key={row.id}
              row={row}
              isProrated={isProratedMap.get(row.id) ?? false}
              prorataInfo={prorataInfoMap.get(row.id)}
              selected={selectedIds.has(row.id)}
              onSelectToggle={() => onSelectToggle(row.id)}
              onDetail={() => onDetail(row)}
              onEdit={onEdit ? () => onEdit(row) : undefined}
              showEditAction={showEditAction}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
