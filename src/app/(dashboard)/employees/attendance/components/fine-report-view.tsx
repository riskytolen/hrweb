"use client";

import { useMemo, useState } from "react";
import {
  Search, ChevronLeft, ChevronRight, CalendarDays, Filter, Download, FileText,
  AlertTriangle, Clock, TrendingDown,
} from "lucide-react";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import Pagination from "@/components/ui/Pagination";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { SUMMARY_PAGE_SIZE } from "../lib/attendance-constants";
import { getSummaryPeriodRange, getSummaryCurrentPeriodKey } from "../lib/attendance-helpers";
import { useFineReportData, computeFineReportSummary } from "../lib/hooks/use-fine-report-data";
import { useDropdown } from "../lib/hooks/use-click-outside";
import type { EmployeeLite } from "../lib/attendance-types";

type SortKey = "tanggal" | "nama" | "denda";

type FineReportViewProps = {
  employees: EmployeeLite[];
};

export function FineReportView({ employees }: FineReportViewProps) {
  const [dateMode, setDateMode] = useState<"periode" | "custom">("periode");
  const [periodKey, setPeriodKey] = useState(getSummaryCurrentPeriodKey);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("tanggal");
  const [filterType, setFilterType] = useState<"semua" | "telat" | "alpha">("semua");
  const [page, setPage] = useState(1);

  const period = useMemo(
    () => dateMode === "periode"
      ? getSummaryPeriodRange(periodKey)
      : { start: customStart, end: customEnd, label: customStart && customEnd ? `${customStart} – ${customEnd}` : "Pilih tanggal" },
    [dateMode, periodKey, customStart, customEnd],
  );

  const dateLabel = useMemo(() => {
    if (!period.start || !period.end) return "";
    const s = new Date(period.start + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    const e = new Date(period.end + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    return `${s} – ${e}`;
  }, [period.start, period.end]);

  const { items, loading } = useFineReportData(period, employees);
  const summary = useMemo(() => computeFineReportSummary(items), [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = items.filter((r) =>
      r.employeeNama.toLowerCase().includes(q) || r.divisionNama.toLowerCase().includes(q),
    );
    if (filterType === "telat") rows = rows.filter((r) => r.status === "Terlambat" || r.status === "Telat");
    else if (filterType === "alpha") rows = rows.filter((r) => r.status === "Alpha");
    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case "tanggal": return a.tanggal.localeCompare(b.tanggal) || a.employeeNama.localeCompare(b.employeeNama);
        case "nama": return a.employeeNama.localeCompare(b.employeeNama) || a.tanggal.localeCompare(b.tanggal);
        case "denda": return b.denda - a.denda;
        default: return 0;
      }
    });
    return rows;
  }, [items, search, sortBy, filterType]);

  const filteredSummary = useMemo(() => computeFineReportSummary(filtered), [filtered]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * SUMMARY_PAGE_SIZE, page * SUMMARY_PAGE_SIZE),
    [filtered, page],
  );

  const exportMenu = useDropdown();

  const navigatePeriod = (dir: -1 | 1) => {
    if (dateMode !== "periode") return;
    const [y, m] = periodKey.split("-").map(Number);
    const next = new Date(y, m - 1 + dir, 1);
    setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setPage(1);
  };

  const formatDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

  const statusLabel = (status: string, durasi: number) => {
    if (status === "Alpha") return "Alpha";
    if (status === "Terlambat" || status === "Telat") return durasi ? `Telat (${durasi}m)` : "Telat";
    return status;
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const headers = ["#", "Tanggal", "Pegawai", "Divisi", "Status", "Durasi Telat", "Denda", "Catatan", "Manual"];
    const rows: string[] = [headers.join(",")];
    filtered.forEach((r, i) => {
      rows.push([
        i + 1,
        r.tanggal,
        `"${r.employeeNama}"`,
        `"${r.divisionNama}"`,
        statusLabel(r.status, r.durasi_telat),
        r.durasi_telat || "",
        r.denda,
        `"${(r.catatan || "").replace(/"/g, '""')}"`,
        r.is_manual ? "Ya" : "Tidak",
      ].join(","));
    });
    rows.push(["", "", "", "", "TOTAL", "", filteredSummary.totalDenda, "", ""].join(","));
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Report_Denda_${period.start}_${period.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    exportMenu.close();
  };

  const handleExportPDF = async () => {
    if (filtered.length === 0) return;
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Report Denda Absensi", pw / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${period.label}`, pw / 2, 21, { align: "center" });
    doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, pw / 2, 27, { align: "center" });
    doc.text(
      `Total Denda: ${formatCurrency(filteredSummary.totalDenda)} | Telat: ${formatCurrency(filteredSummary.totalDendaTelat)} (${filteredSummary.kejadianTelat}x) | Alpha: ${formatCurrency(filteredSummary.totalDendaAlpha)} (${filteredSummary.kejadianAlpha}x)`,
      pw / 2, 33, { align: "center" },
    );
    const body = filtered.map((r, i) => [
      i + 1,
      r.tanggal,
      r.employeeNama,
      r.divisionNama,
      statusLabel(r.status, r.durasi_telat),
      r.durasi_telat || "-",
      formatCurrency(r.denda),
    ]);
    body.push(["", "", "", "", "TOTAL", `${filteredSummary.totalKejadian}x`, formatCurrency(filteredSummary.totalDenda)]);
    autoTable(doc, {
      startY: 39,
      head: [["#", "Tanggal", "Pegawai", "Divisi", "Status", "Durasi", "Denda"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [239, 68, 68], fontSize: 8, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { halign: "center", cellWidth: 8 },
        1: { cellWidth: 24 },
        5: { halign: "center", cellWidth: 16 },
        6: { halign: "right", cellWidth: 28 },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.row.index === body.length - 1) {
          data.cell.styles.fillColor = [254, 226, 226];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    doc.save(`Report_Denda_${period.start}_${period.end}.pdf`);
    exportMenu.close();
  };

  return (
    <div className="space-y-4">
      {/* ─── Toolbar ─── */}
      <div className="bg-card rounded-2xl border border-border p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
            <button onClick={() => setDateMode("periode")}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                dateMode === "periode" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <CalendarDays className="w-3 h-3" />Periode
            </button>
            <button onClick={() => setDateMode("custom")}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                dateMode === "custom" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <Filter className="w-3 h-3" />Custom
            </button>
          </div>

          {dateMode === "periode" ? (
            <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
              <button onClick={() => navigatePeriod(-1)} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="px-2.5 py-1 text-center min-w-[180px]">
                <p className="text-[11px] font-bold text-foreground">{period.label}</p>
              </div>
              <button onClick={() => navigatePeriod(1)} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0">
              <DatePicker value={customStart} onChange={(v) => { setCustomStart(v); setPage(1); }} placeholder="Dari" />
              <span className="text-xs text-muted-foreground">–</span>
              <DatePicker value={customEnd} onChange={(v) => { setCustomEnd(v); setPage(1); }} placeholder="Sampai" />
            </div>
          )}

          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" placeholder="Cari nama atau divisi..." value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>

          <div ref={exportMenu.ref} className="relative flex-shrink-0">
            <Button variant="outline" size="sm" icon={Download} onClick={exportMenu.toggle} disabled={filtered.length === 0}>
              Export <ChevronRight className="w-3 h-3 ml-0.5" />
            </Button>
            {exportMenu.open && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-card rounded-xl border border-border shadow-xl z-10 overflow-hidden animate-scale-in">
                <button onClick={handleExportPDF} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                  <FileText className="w-3.5 h-3.5 text-danger" />Export PDF
                </button>
                <button onClick={handleExportCSV} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors border-t border-border">
                  <FileText className="w-3.5 h-3.5 text-success" />Export CSV
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── Filter chips ─── */}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {([
            { key: "semua" as const, label: "Semua", icon: AlertTriangle, count: summary.totalKejadian },
            { key: "telat" as const, label: "Telat", icon: Clock, count: summary.kejadianTelat },
            { key: "alpha" as const, label: "Alpha", icon: TrendingDown, count: summary.kejadianAlpha },
          ]).map((opt) => {
            const Icon = opt.icon;
            const isActive = filterType === opt.key;
            return (
              <button key={opt.key} onClick={() => { setFilterType(opt.key); setPage(1); }}
                className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  isActive ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted")}>
                <Icon className="w-3 h-3" />
                <span>{opt.label}</span>
                <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded", isActive ? "bg-primary/15" : "bg-muted")}>
                  {loading ? "-" : opt.count}
                </span>
              </button>
            );
          })}
          <div className="h-4 w-px bg-border" />
          {([
            { key: "tanggal" as const, label: "Urut Tanggal" },
            { key: "nama" as const, label: "Urut Nama" },
            { key: "denda" as const, label: "Denda Terbesar" },
          ]).map((opt) => {
            const isActive = sortBy === opt.key;
            return (
              <button key={opt.key} onClick={() => setSortBy(opt.key)}
                className={cn("px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  isActive ? "bg-warning/10 text-warning ring-1 ring-warning/20" : "text-muted-foreground hover:bg-muted")}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Summary cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Denda</p>
          <p className="text-xl font-bold text-danger mt-1">{loading ? "-" : formatCurrency(filteredSummary.totalDenda)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{dateLabel || "pilih periode"}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Denda Telat</p>
          <p className="text-xl font-bold text-warning mt-1">{loading ? "-" : formatCurrency(filteredSummary.totalDendaTelat)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{filteredSummary.kejadianTelat} kejadian</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Denda Alpha</p>
          <p className="text-xl font-bold text-rose-500 mt-1">{loading ? "-" : formatCurrency(filteredSummary.totalDendaAlpha)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{filteredSummary.kejadianAlpha} kejadian</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Kejadian</p>
          <p className="text-xl font-bold text-foreground mt-1">{loading ? "-" : filteredSummary.totalKejadian}</p>
          <p className="text-[10px] text-muted-foreground mt-1">records dengan denda &gt; 0</p>
        </div>
      </div>

      {/* ─── Detail table ─── */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-32">Tanggal</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Divisi</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-32">Status</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Durasi</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-32">Denda</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Catatan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={8} cols={8} /> : paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                    {items.length === 0 ? "Tidak ada denda di periode ini" : "Tidak ada data cocok dengan filter"}
                  </td>
                </tr>
              ) : paged.map((row, idx) => {
                const isAlpha = row.status === "Alpha";
                const isTelat = row.status === "Terlambat" || row.status === "Telat";
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3 text-xs text-muted-foreground">{(page - 1) * SUMMARY_PAGE_SIZE + idx + 1}</td>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-foreground tabular-nums">{formatDate(row.tanggal)}</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm font-semibold text-foreground">{row.employeeNama}</p>
                      {row.is_manual && (
                        <span className="inline-flex items-center text-[9px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded mt-0.5">Manual</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md" style={{ backgroundColor: `${row.divisionColor}15`, color: row.divisionColor }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.divisionColor }} />
                        {row.divisionNama}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-1 rounded-md",
                        isAlpha ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                          : isTelat ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                      )}>
                        {statusLabel(row.status, row.durasi_telat)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center text-sm">
                      {row.durasi_telat > 0
                        ? <span className="font-semibold text-warning">{row.durasi_telat} mnt</span>
                        : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="text-sm font-bold text-danger tabular-nums">{formatCurrency(row.denda)}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground max-w-[180px] truncate">{row.catatan || <span className="italic">-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && !loading && (
              <tfoot>
                <tr className="border-t-2 border-border bg-danger/5 font-semibold">
                  <td className="px-5 py-3 text-xs" colSpan={5}>
                    <span className="font-bold text-foreground">TOTAL</span>
                    <span className="text-muted-foreground ml-2">({filtered.length} kejadian)</span>
                  </td>
                  <td className="px-5 py-3 text-center text-xs text-muted-foreground">-</td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-sm font-bold text-danger tabular-nums">{formatCurrency(filteredSummary.totalDenda)}</span>
                  </td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={SUMMARY_PAGE_SIZE} onPageChange={setPage} />
      </div>
    </div>
  );
}
