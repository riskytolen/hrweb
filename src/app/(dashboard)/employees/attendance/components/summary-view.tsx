"use client";

import { useMemo, useState } from "react";
import {
  Search, ChevronLeft, ChevronRight, CalendarDays, Filter, Download, FileText,
  Users, Clock, BarChart3, TrendingUp, TrendingDown, Trophy,
} from "lucide-react";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import Pagination from "@/components/ui/Pagination";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import {
  SUMMARY_PAGE_SIZE,
} from "../lib/attendance-constants";
import { STATUS_OPTIONS } from "../lib/attendance-status";
import { getSummaryPeriodRange, getSummaryCurrentPeriodKey } from "../lib/attendance-helpers";
import { useSummaryData } from "../lib/hooks/use-summary-data";
import { useDropdown } from "../lib/hooks/use-click-outside";
import type { EmployeeLite, SummaryRow } from "../lib/attendance-types";

type SortKey = "nama" | "hadir" | "alpha" | "telat" | "total";

const SORT_OPTIONS: { key: SortKey; label: string; icon: typeof Users }[] = [
  { key: "nama", label: "Nama", icon: Users },
  { key: "hadir", label: "Hadir Terbanyak", icon: TrendingUp },
  { key: "alpha", label: "Alpha Terbanyak", icon: TrendingDown },
  { key: "telat", label: "Telat Terbanyak", icon: Clock },
  { key: "total", label: "Total Record", icon: BarChart3 },
];

type SummaryViewProps = {
  employees: EmployeeLite[];
};

export function SummaryView({ employees }: SummaryViewProps) {
  const [dateMode, setDateMode] = useState<"periode" | "custom">("periode");
  const [periodKey, setPeriodKey] = useState(getSummaryCurrentPeriodKey);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("nama");
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

  const { rows: data, loading } = useSummaryData(period, employees);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows: SummaryRow[] = data.filter((r) =>
      r.nama.toLowerCase().includes(q) || r.divisionNama.toLowerCase().includes(q),
    );
    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case "nama": return a.nama.localeCompare(b.nama);
        case "hadir": return b.hadir - a.hadir;
        case "alpha": return b.alpha - a.alpha;
        case "telat": return b.telat - a.telat;
        case "total": return b.total - a.total;
        default: return 0;
      }
    });
    return rows;
  }, [data, search, sortBy]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * SUMMARY_PAGE_SIZE, page * SUMMARY_PAGE_SIZE),
    [filtered, page],
  );

  const totals = useMemo(() => {
    const t = { hadir: 0, telat: 0, izin: 0, sakit: 0, alpha: 0, libur: 0, cuti: 0, total: 0 };
    filtered.forEach((r) => { t.hadir += r.hadir; t.telat += r.telat; t.izin += r.izin; t.sakit += r.sakit; t.alpha += r.alpha; t.libur += r.libur; t.cuti += r.cuti; t.total += r.total; });
    return t;
  }, [filtered]);

  const headerStats = useMemo(() => {
    const empCount = filtered.length;
    const totalRecords = totals.total;
    const avgHadir = empCount > 0 ? Math.round(totals.hadir / empCount) : 0;
    return { empCount, totalRecords, avgHadir };
  }, [filtered, totals]);

  const exportMenu = useDropdown();

  const navigatePeriod = (dir: -1 | 1) => {
    if (dateMode !== "periode") return;
    const [y, m] = periodKey.split("-").map(Number);
    const next = new Date(y, m - 1 + dir, 1);
    setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setPage(1);
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const headers = ["#", "Pegawai", "Status", "Divisi", "Hadir", "Telat", "Izin", "Sakit", "Alpha", "Libur", "Cuti", "Total"];
    const rows: string[] = [headers.join(",")];
    filtered.forEach((r, i) => {
      rows.push([
        i + 1, `"${r.nama}"`, r.status, `"${r.divisionNama}"`,
        r.hadir, r.telat, r.izin, r.sakit, r.alpha, r.libur, r.cuti, r.total,
      ].join(","));
    });
    rows.push(["", `"TOTAL (${filtered.length} pegawai)"`, "", "", totals.hadir, totals.telat, totals.izin, totals.sakit, totals.alpha, totals.libur, totals.cuti, totals.total].join(","));
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Ringkasan_Absensi_${period.start}_${period.end}.csv`;
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
    doc.text("Ringkasan Absensi Pegawai", pw / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${period.label}`, pw / 2, 21, { align: "center" });
    doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, pw / 2, 27, { align: "center" });
    const body = filtered.map((r, i) => [
      i + 1, r.nama, r.divisionNama, r.hadir, r.telat, r.izin, r.sakit, r.alpha, r.libur, r.cuti, r.total,
    ]);
    body.push(["TOTAL", "", `(${filtered.length} pegawai)`, totals.hadir, totals.telat, totals.izin, totals.sakit, totals.alpha, totals.libur, totals.cuti, totals.total]);
    autoTable(doc, {
      startY: 33,
      head: [["#", "Pegawai", "Divisi", "Hadir", "Telat", "Izin", "Sakit", "Alpha", "Libur", "Cuti", "Total"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { halign: "center", cellWidth: 8 }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center" }, 6: { halign: "center" }, 7: { halign: "center" }, 8: { halign: "center" }, 9: { halign: "center" }, 10: { halign: "center" } },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.row.index === body.length - 1) {
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    doc.save(`Ringkasan_Absensi_${period.start}_${period.end}.pdf`);
    exportMenu.close();
  };

  const statusColor = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.color || "#6b7280";

  return (
    <div className="space-y-4">
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
              onChange={(e) => setSearch(e.target.value)}
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
          {SORT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = sortBy === opt.key;
            return (
              <button key={opt.key} onClick={() => setSortBy(opt.key)}
                className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  isActive ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted")}>
                <Icon className="w-3 h-3" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pegawai</p>
              <p className="text-2xl font-bold text-foreground mt-1">{loading ? "-" : headerStats.empCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">pegawai dengan data absensi</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Record</p>
              <p className="text-2xl font-bold text-foreground mt-1">{loading ? "-" : headerStats.totalRecords}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-blue-500" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">{dateLabel || "pilih periode"}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Rata-rata Hadir</p>
              <p className="text-2xl font-bold text-foreground mt-1">{loading ? "-" : headerStats.avgHadir}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-success" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">hari per pegawai</p>
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
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Hadir</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Telat</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Izin</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Sakit</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Alpha</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Libur</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Cuti</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <SkeletonTable rows={8} cols={11} />
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-sm text-muted-foreground">
                    {data.length === 0
                      ? "Tidak ada data absensi di periode ini"
                      : "Tidak ada pegawai cocok dengan pencarian"}
                  </td>
                </tr>
              ) : paged.map((row, idx) => (
                <tr key={row.employee_id} className="hover:bg-muted/30">
                  <td className="px-5 py-3 text-xs text-muted-foreground">{(page - 1) * SUMMARY_PAGE_SIZE + idx + 1}</td>
                  <td className="px-5 py-3">
                    <p className="text-sm font-semibold text-foreground">{row.nama}</p>
                    {row.status === "Tidak Aktif" && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded mt-0.5">
                        Tidak Aktif
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md" style={{ backgroundColor: `${row.divisionColor}15`, color: row.divisionColor }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.divisionColor }} />
                      {row.divisionNama}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: statusColor("Hadir") }}>{row.hadir}</td>
                  <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: statusColor("Terlambat") }}>{row.telat}</td>
                  <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: statusColor("Izin") }}>{row.izin}</td>
                  <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: statusColor("Sakit") }}>{row.sakit}</td>
                  <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: statusColor("Alpha") }}>{row.alpha}</td>
                  <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: statusColor("Libur") }}>{row.libur}</td>
                  <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: statusColor("Cuti") }}>{row.cuti}</td>
                  <td className="px-5 py-3 text-center">
                    <span className="text-sm font-bold text-foreground bg-muted px-2 py-1 rounded-md">{row.total}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && !loading && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-5 py-3 text-xs" colSpan={3}>
                    <span className="font-bold text-foreground">TOTAL</span>
                    <span className="text-muted-foreground ml-2">({filtered.length} pegawai)</span>
                  </td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-success">{totals.hadir}</td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-warning">{totals.telat}</td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-blue-500">{totals.izin}</td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-danger">{totals.sakit}</td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-muted-foreground">{totals.alpha}</td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-violet-500">{totals.libur}</td>
                  <td className="px-5 py-3 text-center text-sm font-bold text-violet-500">{totals.cuti}</td>
                  <td className="px-5 py-3 text-center">
                    <span className="text-sm font-bold text-foreground bg-card px-2 py-1 rounded-md border border-border">{totals.total}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={SUMMARY_PAGE_SIZE} onPageChange={setPage} />
      </div>

      <div className="bg-muted/30 rounded-xl border border-border/50 p-3">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Catatan:</strong> Data dihitung dari seluruh record absensi (termasuk auto-generated Libur &amp; Alpha) di periode terpilih. Pegawai tanpa record absensi di periode ini tidak ditampilkan. Hadir = total hari hadir tepat waktu; Telat = hari hadir tapi terlambat. Total = jumlah seluruh record (Hadir + Izin + Sakit + Alpha + Libur + Cuti).
        </p>
      </div>
    </div>
  );
}
