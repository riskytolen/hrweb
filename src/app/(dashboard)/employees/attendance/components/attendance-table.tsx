"use client";

import { ChevronLeft, ChevronRight, Search, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import Pagination from "@/components/ui/Pagination";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { MIN_DATE, PAGE_SIZE } from "../lib/attendance-constants";
import { NO_JAM_STATUSES, STATUS_OPTIONS, type StatusOption } from "../lib/attendance-status";
import { addDays, getDeadlineTime } from "../lib/attendance-helpers";
import { ExportMenuButton } from "./export-menu-button";
import type { AttendanceRow } from "../lib/attendance-types";

type AttendanceTableProps = {
  records: AttendanceRow[];
  dateFilter: string;
  loading: boolean;
  canEdit: boolean;
  page: number;
  setPage: (p: number) => void;
  search: string;
  setSearch: (v: string) => void;
  filterStatus: string;
  setFilterStatus: (s: string) => void;
  filtered: AttendanceRow[];
  paged: AttendanceRow[];
  statusCounts: Record<string, number>;
  totalDenda: number;
  hasRecords: boolean;
  exportMenu: { open: boolean; ref: React.RefObject<HTMLDivElement | null>; toggle: () => void };
  onExportPDF: () => void;
  onExportCSV: () => void;
  onDateChange: (v: string) => void;
  onEdit: (row: AttendanceRow) => void;
  onDelete: (row: AttendanceRow) => void;
};

export function AttendanceTable({
  records,
  dateFilter,
  loading,
  canEdit,
  page,
  setPage,
  search,
  setSearch,
  filterStatus,
  setFilterStatus,
  filtered,
  paged,
  statusCounts,
  totalDenda,
  hasRecords,
  exportMenu,
  onExportPDF,
  onExportCSV,
  onDateChange,
  onEdit,
  onDelete,
}: AttendanceTableProps) {
  const sc = (status: string): StatusOption | undefined => STATUS_OPTIONS.find((s) => s.value === status);
  const statusAllOption = { label: "Semua", value: records.length, color: "#6b7280" };

  return (
    <>
      <div className="bg-card rounded-2xl border border-border p-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
            <button onClick={() => { onDateChange(addDays(dateFilter, -1)); setPage(1); }}
              disabled={dateFilter <= MIN_DATE}
              className={`p-1.5 rounded-lg transition-colors ${dateFilter <= MIN_DATE ? "opacity-30 cursor-not-allowed" : "hover:bg-card text-muted-foreground hover:text-foreground"}`}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="px-2 py-1 text-center min-w-[170px]">
              <p className="text-[11px] font-bold text-foreground">
                {new Date(dateFilter + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
            <button onClick={() => { onDateChange(addDays(dateFilter, 1)); setPage(1); }}
              className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" placeholder="Cari nama atau divisi..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>
          <ExportMenuButton
            menuRef={exportMenu.ref}
            open={exportMenu.open}
            onToggle={exportMenu.toggle}
            onExportPDF={onExportPDF}
            onExportCSV={onExportCSV}
            disabled={!hasRecords}
          />
        </div>

        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {[statusAllOption, ...STATUS_OPTIONS.map((s) => ({ label: s.label, value: statusCounts[s.value], color: s.color }))].map((stat) => {
            const isActive = filterStatus === stat.label;
            return (
              <button key={stat.label} onClick={() => setFilterStatus(stat.label)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  isActive ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted"
                )}>
                {stat.label !== "Semua" && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: stat.color }} />}
                <span>{stat.label}</span>
                <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded", isActive ? "bg-primary/15" : "bg-muted")}
                  style={!isActive && stat.label !== "Semua" ? { color: stat.color } : undefined}>
                  {loading ? "-" : stat.value}
                </span>
              </button>
            );
          })}
          {totalDenda > 0 && !loading && (
            <>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-warning/10 text-[11px]">
                <AlertTriangle className="w-3 h-3 text-warning" />
                <span className="text-muted-foreground">Denda:</span>
                <span className="font-bold text-warning">{formatCurrency(totalDenda)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Divisi</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Jam Masuk</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Batas Telat</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Jam Pulang</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Status</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Telat</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Denda</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Catatan</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={6} cols={11} /> : paged.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data absen</td></tr>
              ) : paged.map((row, idx) => {
                const statusColor = sc(row.status);
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-foreground">{row.employeeNama}</p>
                      {(row as AttendanceRow & { is_manual?: boolean }).is_manual && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded mt-0.5">
                          Manual{(row as AttendanceRow & { alasan_manual?: string }).alasan_manual ? `: ${(row as AttendanceRow & { alasan_manual?: string }).alasan_manual}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md" style={{ backgroundColor: `${row.divisionColor}15`, color: row.divisionColor }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.divisionColor }} />
                        {row.divisionNama}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center text-sm">
                      {NO_JAM_STATUSES.includes(row.status)
                        ? <span className="text-muted-foreground italic">-</span>
                        : <span className="font-semibold text-foreground">{row.jam_masuk.slice(0, 5)}</span>}
                    </td>
                    <td className="px-5 py-3.5 text-center text-xs">
                      {NO_JAM_STATUSES.includes(row.status) ? (
                        <span className="text-muted-foreground italic">-</span>
                      ) : (() => {
                        const deadline = getDeadlineTime(row.schedule_jam_masuk, row.toleransi_menit);
                        if (!deadline) return <span className="text-muted-foreground italic">-</span>;
                        return (
                          <div className="flex flex-col items-center leading-tight">
                            <span className="font-semibold text-foreground text-sm">{deadline}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {row.schedule_jam_masuk.slice(0, 5)} +{row.toleransi_menit}m
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-3.5 text-center text-xs">
                      {NO_JAM_STATUSES.includes(row.status)
                        ? <span className="text-muted-foreground italic">-</span>
                        : row.jam_pulang
                          ? (
                            <div className="flex flex-col items-center">
                              <span className="font-semibold text-foreground text-sm">{row.jam_pulang.slice(0, 5)}</span>
                              {row.status_pulang === "Cepat" && (
                                <span className="text-[9px] font-bold text-warning">Cepat</span>
                              )}
                            </div>
                          )
                          : row.schedule_jam_pulang
                            ? (
                              <span className="text-[10px] font-bold text-danger bg-danger-light px-1.5 py-0.5 rounded">
                                {row.status_pulang === "Lupa Pulang" ? "Lupa Pulang" : "Belum"}
                              </span>
                            )
                            : <span className="text-muted-foreground italic">-</span>}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${statusColor?.color}20`, color: statusColor?.color }}>{row.status}</span>
                    </td>
                    <td className="px-5 py-3.5 text-center text-sm">
                      {row.durasi_telat > 0 ? <span className="font-semibold text-warning">{row.durasi_telat} mnt</span> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm">
                      {row.denda > 0 ? <span className="font-semibold text-danger">{formatCurrency(row.denda)}</span> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground max-w-[150px] truncate">{row.catatan || <span className="italic">-</span>}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-center gap-1">
                        {canEdit && <button onClick={() => onEdit(row)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                        {canEdit && <button onClick={() => onDelete(row)} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>
    </>
  );
}
