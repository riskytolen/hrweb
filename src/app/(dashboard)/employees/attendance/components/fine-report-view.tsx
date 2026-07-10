"use client";

import { useMemo, useState, useCallback } from "react";
import {
  Search, ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Filter, Download, FileText,
  AlertTriangle, Clock, TrendingDown, Users,
} from "lucide-react";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import Portal from "@/components/ui/Portal";
import Pagination from "@/components/ui/Pagination";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { SUMMARY_PAGE_SIZE } from "../lib/attendance-constants";
import { getSummaryPeriodRange, getSummaryCurrentPeriodKey } from "../lib/attendance-helpers";
import { useFineReportData, computeFineReportSummary, type FineReportItem } from "../lib/hooks/use-fine-report-data";
import { useDropdown } from "../lib/hooks/use-click-outside";
import type { EmployeeLite } from "../lib/attendance-types";

type EmployeeFineGroup = {
  employee_id: string;
  employeeNama: string;
  divisionNama: string;
  divisionColor: string;
  dendaTelat: number;
  dendaAlpha: number;
  totalDenda: number;
  kejadianTelat: number;
  kejadianAlpha: number;
  totalKejadian: number;
  items: FineReportItem[];
};

type SortKey = "nama" | "denda" | "kejadian";

type FineReportViewProps = {
  employees: EmployeeLite[];
  canEdit?: boolean;
  showToast?: (type: "success" | "error", title: string, message?: string) => void;
};

export function FineReportView({ employees, canEdit, showToast }: FineReportViewProps) {
  const [dateMode, setDateMode] = useState<"periode" | "custom">("periode");
  const [periodKey, setPeriodKey] = useState(getSummaryCurrentPeriodKey);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("denda");
  const [filterType, setFilterType] = useState<"semua" | "telat" | "alpha">("semua");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nihilConfirm, setNihilConfirm] = useState<{
    group: EmployeeFineGroup;
    type: "telat" | "alpha" | "semua";
  } | null>(null);

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

  const { items, loading, reload } = useFineReportData(period, employees);
  const summary = useMemo(() => computeFineReportSummary(items), [items]);

  const groups = useMemo(() => {
    const map = new Map<string, EmployeeFineGroup>();
    for (const it of items) {
      let g = map.get(it.employee_id);
      if (!g) {
        g = {
          employee_id: it.employee_id,
          employeeNama: it.employeeNama,
          divisionNama: it.divisionNama,
          divisionColor: it.divisionColor,
          dendaTelat: 0, dendaAlpha: 0, totalDenda: 0,
          kejadianTelat: 0, kejadianAlpha: 0, totalKejadian: 0,
          items: [],
        };
        map.set(it.employee_id, g);
      }
      const isTelat = it.status === "Terlambat" || it.status === "Telat";
      const isAlpha = it.status === "Alpha";
      if (isTelat) { g.dendaTelat += it.denda; g.kejadianTelat++; }
      else if (isAlpha) { g.dendaAlpha += it.denda; g.kejadianAlpha++; }
      g.totalDenda += it.denda;
      g.totalKejadian++;
      g.items.push(it);
    }
    return Array.from(map.values());
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = groups.filter((g) =>
      g.employeeNama.toLowerCase().includes(q) || g.divisionNama.toLowerCase().includes(q),
    );
    if (filterType === "telat") rows = rows.filter((g) => g.kejadianTelat > 0);
    else if (filterType === "alpha") rows = rows.filter((g) => g.kejadianAlpha > 0);
    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case "nama": return a.employeeNama.localeCompare(b.employeeNama);
        case "denda": return b.totalDenda - a.totalDenda;
        case "kejadian": return b.totalKejadian - a.totalKejadian;
        default: return 0;
      }
    });
    return rows;
  }, [groups, search, sortBy, filterType]);

  const filteredSummary = useMemo(() => {
    let totalDenda = 0, dendaTelat = 0, dendaAlpha = 0, kejadianTelat = 0, kejadianAlpha = 0, totalKejadian = 0;
    for (const g of filtered) {
      totalDenda += g.totalDenda;
      dendaTelat += g.dendaTelat;
      dendaAlpha += g.dendaAlpha;
      kejadianTelat += g.kejadianTelat;
      kejadianAlpha += g.kejadianAlpha;
      totalKejadian += g.totalKejadian;
    }
    return { totalDenda, dendaTelat, dendaAlpha, kejadianTelat, kejadianAlpha, totalKejadian, pegawaiCount: filtered.length };
  }, [filtered]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * SUMMARY_PAGE_SIZE, page * SUMMARY_PAGE_SIZE),
    [filtered, page],
  );

  const exportMenu = useDropdown();

  const handleNihil = useCallback(async () => {
    if (!nihilConfirm || !canEdit || !showToast) return;
    const { group, type } = nihilConfirm;
    const itemsToUpdate = group.items.filter((it) => {
      if (type === "telat") return it.status === "Terlambat" || it.status === "Telat";
      if (type === "alpha") return it.status === "Alpha";
      return true;
    });
    if (itemsToUpdate.length === 0) { setNihilConfirm(null); return; }
    const ids = itemsToUpdate.map((it) => it.id);
    const totalDenda = itemsToUpdate.reduce((s, it) => s + it.denda, 0);
    try {
      const { error } = await supabase.from("attendance_records").update({ denda: 0 }).in("id", ids);
      if (error) throw error;
      await logAudit({
        supabase, action: "update", entityType: "attendance_records",
        entityId: group.employee_id,
        entityLabel: `Nihil denda ${type} ${group.employeeNama}`,
        metadata: {
          type, employee_id: group.employee_id, employee_nama: group.employeeNama,
          record_count: ids.length, total_denda_sebelum: totalDenda,
        },
      });
      showToast("success", "Denda Dinihilkan", `${group.employeeNama}: ${ids.length} record (Rp${formatCurrency(totalDenda)})`);
      setNihilConfirm(null);
      await reload();
    } catch (err) {
      showToast("error", "Gagal", err instanceof Error ? err.message : "Terjadi kesalahan.");
      setNihilConfirm(null);
    }
  }, [nihilConfirm, canEdit, showToast, reload]);

  const navigatePeriod = (dir: -1 | 1) => {
    if (dateMode !== "periode") return;
    const [y, m] = periodKey.split("-").map(Number);
    const next = new Date(y, m - 1 + dir, 1);
    setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setPage(1);
    setExpandedId(null);
  };

  const formatDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short" });

  const statusLabel = (status: string, durasi: number) => {
    if (status === "Alpha") return "Alpha";
    if (status === "Terlambat" || status === "Telat") return durasi ? `Telat (${durasi}m)` : "Telat";
    return status;
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const rows: string[] = ["Pegawai,Divisi,Tanggal,Status,Durasi Telat,Denda"];
    for (const g of filtered) {
      for (const it of g.items) {
        rows.push([
          `"${g.employeeNama}"`,
          `"${g.divisionNama}"`,
          it.tanggal,
          statusLabel(it.status, it.durasi_telat),
          it.durasi_telat || "",
          it.denda,
        ].join(","));
      }
      rows.push([`"${g.employeeNama} — SUBTOTAL"`, "", "", "", "", g.totalDenda].join(","));
    }
    rows.push(["GRAND TOTAL", "", "", "", "", filteredSummary.totalDenda].join(","));
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
    doc.text("Report Denda Absensi Per Pegawai", pw / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${period.label}`, pw / 2, 21, { align: "center" });
    doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, pw / 2, 27, { align: "center" });
    doc.text(
      `Total: ${formatCurrency(filteredSummary.totalDenda)} | Telat: ${formatCurrency(filteredSummary.dendaTelat)} (${filteredSummary.kejadianTelat}x) | Alpha: ${formatCurrency(filteredSummary.dendaAlpha)} (${filteredSummary.kejadianAlpha}x)`,
      pw / 2, 33, { align: "center" },
    );
    const body: (string | number)[][] = [];
    const subtotalRows: number[] = [];
    for (const g of filtered) {
      for (const it of g.items) {
        body.push([
          it.tanggal,
          g.employeeNama,
          g.divisionNama,
          statusLabel(it.status, it.durasi_telat),
          it.durasi_telat || "-",
          formatCurrency(it.denda),
        ]);
      }
      subtotalRows.push(body.length);
      body.push(["", `Subtotal ${g.employeeNama}`, "", `${g.totalKejadian}x`, "", formatCurrency(g.totalDenda)]);
    }
    subtotalRows.push(body.length);
    body.push(["", "GRAND TOTAL", "", `${filteredSummary.totalKejadian}x`, "", formatCurrency(filteredSummary.totalDenda)]);
    autoTable(doc, {
      startY: 39,
      head: [["Tanggal", "Pegawai", "Divisi", "Status", "Durasi", "Denda"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [239, 68, 68], fontSize: 8, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 22 },
        4: { halign: "center", cellWidth: 16 },
        5: { halign: "right", cellWidth: 28 },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (subtotalRows.includes(data.row.index)) {
          data.cell.styles.fillColor = data.row.index === body.length - 1 ? [254, 202, 202] : [241, 245, 249];
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
              onChange={(e) => { setSearch(e.target.value); setPage(1); setExpandedId(null); }}
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

        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {([
            { key: "semua" as const, label: "Semua", icon: AlertTriangle, count: groups.length },
            { key: "telat" as const, label: "Ada Telat", icon: Clock, count: groups.filter((g) => g.kejadianTelat > 0).length },
            { key: "alpha" as const, label: "Ada Alpha", icon: TrendingDown, count: groups.filter((g) => g.kejadianAlpha > 0).length },
          ]).map((opt) => {
            const Icon = opt.icon;
            const isActive = filterType === opt.key;
            return (
              <button key={opt.key} onClick={() => { setFilterType(opt.key); setPage(1); setExpandedId(null); }}
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
            { key: "denda" as const, label: "Denda Terbesar" },
            { key: "nama" as const, label: "Urut Nama" },
            { key: "kejadian" as const, label: "Kejadian Terbanyak" },
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
          <p className="text-xl font-bold text-warning mt-1">{loading ? "-" : formatCurrency(filteredSummary.dendaTelat)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{filteredSummary.kejadianTelat} kejadian</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Denda Alpha</p>
          <p className="text-xl font-bold text-rose-500 mt-1">{loading ? "-" : formatCurrency(filteredSummary.dendaAlpha)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{filteredSummary.kejadianAlpha} kejadian</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pegawai</p>
              <p className="text-xl font-bold text-foreground mt-1">{loading ? "-" : filteredSummary.pegawaiCount}</p>
            </div>
            <div className="ml-auto w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{filteredSummary.totalKejadian} total kejadian</p>
        </div>
      </div>

      {/* ─── Grouped table ─── */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Divisi</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Telat</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Alpha</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-36">Denda Telat</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-36">Denda Alpha</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-36">Total Denda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={8} cols={8} /> : paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                    {groups.length === 0 ? "Tidak ada denda di periode ini" : "Tidak ada pegawai cocok dengan filter"}
                  </td>
                </tr>
              ) : paged.map((g, idx) => {
                const isExpanded = expandedId === g.employee_id;
                return (
                  <tr key={g.employee_id} className="group">
                    <td colSpan={8} className="p-0">
                      {/* ── Main row ── */}
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : g.employee_id)}
                        className="w-full flex items-center hover:bg-muted/30 transition-colors"
                      >
                        <span className="px-5 py-3 text-xs text-muted-foreground w-12 text-left shrink-0">{(page - 1) * SUMMARY_PAGE_SIZE + idx + 1}</span>
                        <span className="px-5 py-3 flex-1 text-left min-w-0">
                          <span className="flex items-center gap-2">
                            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0", isExpanded && "rotate-180")} />
                            <span className="text-sm font-semibold text-foreground truncate">{g.employeeNama}</span>
                          </span>
                        </span>
                        <span className="px-5 py-3 text-left shrink-0">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md" style={{ backgroundColor: `${g.divisionColor}15`, color: g.divisionColor }}>
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.divisionColor }} />
                            {g.divisionNama}
                          </span>
                        </span>
                        <span className="px-5 py-3 w-28 text-center shrink-0">
                          {g.kejadianTelat > 0
                            ? <span className="text-sm font-semibold text-warning">{g.kejadianTelat}x</span>
                            : <span className="text-sm text-muted-foreground">-</span>}
                        </span>
                        <span className="px-5 py-3 w-28 text-center shrink-0">
                          {g.kejadianAlpha > 0
                            ? <span className="text-sm font-semibold text-rose-500">{g.kejadianAlpha}x</span>
                            : <span className="text-sm text-muted-foreground">-</span>}
                        </span>
                        <span className="px-5 py-3 w-36 text-right shrink-0">
                          {g.dendaTelat > 0
                            ? <span className="text-sm font-semibold text-warning tabular-nums">{formatCurrency(g.dendaTelat)}</span>
                            : <span className="text-sm text-muted-foreground">-</span>}
                        </span>
                        <span className="px-5 py-3 w-36 text-right shrink-0">
                          {g.dendaAlpha > 0
                            ? <span className="text-sm font-semibold text-rose-500 tabular-nums">{formatCurrency(g.dendaAlpha)}</span>
                            : <span className="text-sm text-muted-foreground">-</span>}
                        </span>
                        <span className="px-5 py-3 w-36 text-right shrink-0">
                          <span className="text-sm font-bold text-danger tabular-nums">{formatCurrency(g.totalDenda)}</span>
                        </span>
                      </button>

                      {/* ── Expanded detail ── */}
                      {isExpanded && (
                        <div className="border-t border-border/50 bg-muted/20">
                          <div className="px-8 py-2">
                            <table className="w-full">
                              <thead>
                                <tr className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                                  <th className="text-left py-1.5 px-2 w-36">Tanggal</th>
                                  <th className="text-center py-1.5 px-2 w-28">Status</th>
                                  <th className="text-center py-1.5 px-2 w-20">Durasi</th>
                                  <th className="text-right py-1.5 px-2 w-28">Denda</th>
                                  <th className="text-left py-1.5 px-2">Catatan</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/30">
                                {g.items.map((it) => {
                                  const isAlpha = it.status === "Alpha";
                                  const isTelat = it.status === "Terlambat" || it.status === "Telat";
                                  return (
                                    <tr key={it.id} className="hover:bg-muted/30">
                                      <td className="py-1.5 px-2 text-xs text-foreground tabular-nums">{formatDate(it.tanggal)}</td>
                                      <td className="py-1.5 px-2 text-center">
                                        <span className={cn(
                                          "text-[10px] font-bold px-1.5 py-0.5 rounded",
                                          isAlpha ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                                            : isTelat ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                                              : "bg-muted text-muted-foreground"
                                        )}>
                                          {statusLabel(it.status, it.durasi_telat)}
                                        </span>
                                      </td>
                                      <td className="py-1.5 px-2 text-center text-xs">
                                        {it.durasi_telat > 0
                                          ? <span className="font-semibold text-warning">{it.durasi_telat}m</span>
                                          : <span className="text-muted-foreground">-</span>}
                                      </td>
                                      <td className="py-1.5 px-2 text-right">
                                        <span className="text-xs font-bold text-danger tabular-nums">{formatCurrency(it.denda)}</span>
                                      </td>
                                      <td className="py-1.5 px-2 text-[10px] text-muted-foreground truncate max-w-[200px]">{it.catatan || "-"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {canEdit && (
                              <div className="flex items-center gap-2 mt-3 pb-1">
                                {g.kejadianTelat > 0 && (
                                  <button type="button" onClick={() => setNihilConfirm({ group: g, type: "telat" })}
                                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-warning/10 text-warning hover:bg-warning/20 transition-colors">
                                    Nihilkan Telat ({formatCurrency(g.dendaTelat)})
                                  </button>
                                )}
                                {g.kejadianAlpha > 0 && (
                                  <button type="button" onClick={() => setNihilConfirm({ group: g, type: "alpha" })}
                                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-colors">
                                    Nihilkan Alpha ({formatCurrency(g.dendaAlpha)})
                                  </button>
                                )}
                                {g.kejadianTelat > 0 && g.kejadianAlpha > 0 && (
                                  <button type="button" onClick={() => setNihilConfirm({ group: g, type: "semua" })}
                                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 transition-colors">
                                    Nihilkan Semua ({formatCurrency(g.totalDenda)})
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && !loading && (
              <tfoot>
                <tr className="border-t-2 border-border bg-danger/5 font-semibold">
                  <td className="px-5 py-3 text-xs" colSpan={3}>
                    <span className="font-bold text-foreground">TOTAL</span>
                    <span className="text-muted-foreground ml-2">({filtered.length} pegawai)</span>
                  </td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-warning">{filteredSummary.kejadianTelat}x</td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-rose-500">{filteredSummary.kejadianAlpha}x</td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-sm font-bold text-warning tabular-nums">{formatCurrency(filteredSummary.dendaTelat)}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-sm font-bold text-rose-500 tabular-nums">{formatCurrency(filteredSummary.dendaAlpha)}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-sm font-bold text-danger tabular-nums">{formatCurrency(filteredSummary.totalDenda)}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={SUMMARY_PAGE_SIZE} onPageChange={setPage} />
      </div>

      {nihilConfirm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setNihilConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-7 h-7 text-danger" />
                </div>
                <h3 className="text-base font-bold text-foreground">Nihilkan Denda?</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  {nihilConfirm.type === "telat" && `Denda Telat`}
                  {nihilConfirm.type === "alpha" && `Denda Alpha`}
                  {nihilConfirm.type === "semua" && `Semua Denda`}
                  {' '}untuk <span className="font-semibold text-foreground">{nihilConfirm.group.employeeNama}</span> akan dinolkan.
                </p>
                <div className="flex items-center justify-center gap-6 mt-4 text-xs text-muted-foreground">
                  <span>{nihilConfirm.type === "telat" ? nihilConfirm.group.kejadianTelat : nihilConfirm.type === "alpha" ? nihilConfirm.group.kejadianAlpha : nihilConfirm.group.totalKejadian} record</span>
                  <span className="font-semibold text-danger tabular-nums">
                    Rp{formatCurrency(
                      nihilConfirm.type === "telat" ? nihilConfirm.group.dendaTelat :
                      nihilConfirm.type === "alpha" ? nihilConfirm.group.dendaAlpha :
                      nihilConfirm.group.totalDenda
                    )}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setNihilConfirm(null)}>Batal</Button>
                <Button variant="danger" size="sm" className="flex-1" onClick={handleNihil}>
                  Ya, Nihilkan
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
