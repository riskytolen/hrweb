"use client";

import { useMemo, useState, Fragment } from "react";
import {
  Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, CalendarDays, Filter, Download, FileText,
  Users, PenTool,
} from "lucide-react";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import Pagination from "@/components/ui/Pagination";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { STATUS_OPTIONS } from "../lib/attendance-status";
import { getSummaryPeriodRange, getSummaryCurrentPeriodKey } from "../lib/attendance-helpers";
import { useManualReportData } from "../lib/hooks/use-manual-report-data";
import { useDropdown } from "../lib/hooks/use-click-outside";
import type { EmployeeLite } from "../lib/attendance-types";

type SortKey = "nama" | "total";

const PAGE_SIZE = 100;

type ManualReportViewProps = {
  employees: EmployeeLite[];
};

export function ManualReportView({ employees }: ManualReportViewProps) {
  const [dateMode, setDateMode] = useState<"periode" | "custom">("periode");
  const [periodKey, setPeriodKey] = useState(getSummaryCurrentPeriodKey);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("total");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const period = useMemo(
    () => dateMode === "periode"
      ? getSummaryPeriodRange(periodKey)
      : { start: customStart, end: customEnd, label: customStart && customEnd ? `${customStart} – ${customEnd}` : "Pilih tanggal" },
    [dateMode, periodKey, customStart, customEnd],
  );

  const { groups, loading } = useManualReportData(period, employees);

  const totalManual = useMemo(() => groups.reduce((s, g) => s + g.total, 0), [groups]);
  const pegawaiTerdampak = groups.length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = groups.filter((g) =>
      g.employeeNama.toLowerCase().includes(q) || g.divisionNama.toLowerCase().includes(q),
    );
    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case "nama": return a.employeeNama.localeCompare(b.employeeNama);
        case "total": return b.total - a.total;
        default: return 0;
      }
    });
    return rows;
  }, [groups, search, sortBy]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const exportMenu = useDropdown();

  const navigatePeriod = (dir: -1 | 1) => {
    if (dateMode !== "periode") return;
    const [y, m] = periodKey.split("-").map(Number);
    const next = new Date(y, m - 1 + dir, 1);
    setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setPage(1);
    setExpandedId(null);
  };

  const statusColor = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.color || "#6b7280";

  const toggleExpand = (empId: string) => {
    setExpandedId((prev) => prev === empId ? null : empId);
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const rows: string[] = ["Pegawai,Divisi,Tanggal,Status,Jam Masuk,Durasi Telat,Alasan Manual,Catatan"];
    for (const g of filtered) {
      for (const it of g.items) {
        rows.push([
          `"${g.employeeNama}"`,
          `"${g.divisionNama}"`,
          it.tanggal,
          it.status,
          it.jam_masuk || "-",
          it.durasi_telat || "",
          `"${it.alasan_manual || ""}"`,
          `"${it.catatan || ""}"`,
        ].join(","));
      }
    }
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Report_Manual_${period.start}_${period.end}.csv`;
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
    doc.text("Report Absen Manual", pw / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${period.label}`, pw / 2, 21, { align: "center" });
    doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, pw / 2, 27, { align: "center" });
    const body: (string | number)[][] = [];
    for (const g of filtered) {
      body.push([g.employeeNama, g.divisionNama, "", "", "", ""]);
      for (const it of g.items) {
        body.push(["", it.tanggal, it.status, it.jam_masuk ? it.jam_masuk.slice(0, 5) : "-", it.durasi_telat || "", it.alasan_manual || ""]);
      }
    }
    autoTable(doc, {
      startY: 33,
      head: [["Pegawai", "Divisi", "Tanggal", "Status", "Jam Masuk", "Telat", "Alasan Manual"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [245, 158, 11], fontSize: 8, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 7 },
      margin: { left: 10, right: 10 },
    });
    doc.save(`Report_Manual_${period.start}_${period.end}.pdf`);
    exportMenu.close();
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-border p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
            <button onClick={() => setDateMode("periode")}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                dateMode === "periode" ? "bg-card text-warning shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <CalendarDays className="w-3 h-3" />Periode
            </button>
            <button onClick={() => setDateMode("custom")}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                dateMode === "custom" ? "bg-card text-warning shadow-sm" : "text-muted-foreground hover:text-foreground")}>
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
          <button onClick={() => setSortBy("nama")}
            className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
              sortBy === "nama" ? "bg-warning/10 text-warning ring-1 ring-warning/20" : "text-muted-foreground hover:bg-muted")}>
            <Users className="w-3 h-3" />Nama
          </button>
          <button onClick={() => setSortBy("total")}
            className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
              sortBy === "total" ? "bg-warning/10 text-warning ring-1 ring-warning/20" : "text-muted-foreground hover:bg-muted")}>
            <PenTool className="w-3 h-3" />Terbanyak Manual
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Manual</p>
              <p className="text-2xl font-bold text-foreground mt-1">{loading ? "-" : totalManual}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <PenTool className="w-5 h-5 text-warning" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">input absen manual oleh admin</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pegawai Terdampak</p>
              <p className="text-2xl font-bold text-foreground mt-1">{loading ? "-" : pegawaiTerdampak}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">pegawai dengan absen manual</p>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">Pegawai</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">Divisi</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-20">Total</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-14">H</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-14">T</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-14">I</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-14">S</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-14">A</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-14">C</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-14">L</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={5} cols={11} /> : paged.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-10 text-sm text-muted-foreground">Tidak ada absen manual di periode ini.</td></tr>
              ) : paged.map((g, idx) => {
                const isExpanded = expandedId === g.employee_id;
                return (
                  <Fragment key={g.employee_id}>
                    <tr>
                      <td className="px-4 py-3 text-sm font-semibold text-foreground cursor-pointer hover:text-warning transition-colors"
                        onClick={() => toggleExpand(g.employee_id)}>
                        <span className="inline-flex items-center gap-1.5">
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-warning" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                          {g.employeeNama}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md" style={{ backgroundColor: `${g.divisionColor}15`, color: g.divisionColor }}>
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.divisionColor }} />
                          {g.divisionNama}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-bold text-foreground">{g.total}</td>
                      <td className="px-3 py-3 text-center text-xs font-medium text-success">{g.hadir || "-"}</td>
                      <td className="px-3 py-3 text-center text-xs font-medium text-danger">{g.telat || "-"}</td>
                      <td className="px-3 py-3 text-center text-xs font-medium" style={{ color: statusColor("Izin") }}>{g.izin || "-"}</td>
                      <td className="px-3 py-3 text-center text-xs font-medium" style={{ color: statusColor("Sakit") }}>{g.sakit || "-"}</td>
                      <td className="px-3 py-3 text-center text-xs font-medium text-danger">{g.alpha || "-"}</td>
                      <td className="px-3 py-3 text-center text-xs font-medium" style={{ color: statusColor("Cuti") }}>{g.cuti || "-"}</td>
                      <td className="px-3 py-3 text-center text-xs font-medium" style={{ color: statusColor("Libur") }}>{g.libur || "-"}</td>
                      <td className="px-3 py-3 text-center">
                        {g.items.length > 0 && (
                          <button onClick={() => toggleExpand(g.employee_id)}
                            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`detail-${g.employee_id}`} className="bg-muted/30">
                        <td colSpan={11} className="px-0 py-0">
                          <div className="animate-slide-down">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-border/50 bg-muted/50">
                                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-2 w-28">Tanggal</th>
                                  <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2 w-20">Status</th>
                                  <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2 w-20">Jam</th>
                                  <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2 w-16">Telat</th>
                                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">Alasan Manual</th>
                                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">Catatan</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/30">
                                {g.items.map((it) => (
                                  <tr key={it.id} className="hover:bg-muted/30">
                                    <td className="px-4 py-2 text-xs text-foreground">
                                      {new Date(it.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                                        style={{ backgroundColor: statusColor(it.status) }}>
                                        {it.status}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-center text-xs text-foreground">{it.jam_masuk ? it.jam_masuk.slice(0, 5) : "-"}</td>
                                    <td className="px-3 py-2 text-center text-xs text-muted-foreground">{it.durasi_telat || "-"}</td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">{it.alasan_manual || "-"}</td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={it.catatan || ""}>{it.catatan || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="flex justify-center">
          <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
