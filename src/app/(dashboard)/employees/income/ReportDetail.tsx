"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText,
  X,
  Download,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Calendar,
  TrendingUp,
  Users,
  User,
  Hash,
  Wallet,
} from "lucide-react";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import Portal from "@/components/ui/Portal";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { supabase, type DbDeliveryPoint } from "@/lib/supabase";

type DivisionLite = { id: number; nama: string; color: string };
type StatusLite = { id: number; nama: string; kode: string; color: string };

type ReportRow = {
  employee_id: string;
  employee_nama: string;
  division_id: number;
  division_nama: string;
  division_color: string;
  role: "Driver" | "Helper";
  total_titik: number;
  total_pendapatan: number;
  jumlah_hari: number;
  status_summary: { nama: string; color: string; count: number }[];
};

type DivisionGroup = {
  division_id: number;
  division_nama: string;
  division_color: string;
  rows: ReportRow[];
  subtotal_titik: number;
  subtotal_pendapatan: number;
};

type EmployeeGroup = {
  employee_id: string;
  employee_nama: string;
  rows: ReportRow[];
  subtotal_titik: number;
  subtotal_pendapatan: number;
  total_hari: number;
};

interface ReportDetailProps {
  show: boolean;
  onClose: () => void;
  divisions: DivisionLite[];
  dStatuses: StatusLite[];
}

const CUT_OFF_DAY = 7;

function getPeriodRange(periodKey: string): { start: string; end: string; label: string } {
  const [year, month] = periodKey.split("-").map(Number);
  const startDate = new Date(year, month - 1, CUT_OFF_DAY);
  const endDate = new Date(year, month, CUT_OFF_DAY + 1);
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  const label = `${CUT_OFF_DAY} ${startDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })} – ${CUT_OFF_DAY + 1} ${endDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
  return { start, end, label };
}

function getCurrentPeriodKey(): string {
  const now = new Date();
  if (now.getDate() < CUT_OFF_DAY) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

export default function ReportDetail({ show, onClose, divisions, dStatuses }: ReportDetailProps) {
  const [loading, setLoading] = useState(false);
  const [dateMode, setDateMode] = useState<"periode" | "custom">("periode");
  const [reportTab, setReportTab] = useState<"divisi" | "pegawai">("divisi");

  // Periode mode state
  const [periodKey, setPeriodKey] = useState(getCurrentPeriodKey);

  // Custom mode state
  const [customStart, setCustomStart] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });

  // Computed effective dates
  const effectiveDates = dateMode === "periode"
    ? getPeriodRange(periodKey)
    : { start: customStart, end: customEnd, label: "" };
  const startDate = effectiveDates.start;
  const endDate = effectiveDates.end;

  const [search, setSearch] = useState("");
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [divisionGroups, setDivisionGroups] = useState<DivisionGroup[]>([]);
  const [employeeGroups, setEmployeeGroups] = useState<EmployeeGroup[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Grand totals (from all rows, tab-independent)
  const grandTotalTitik = reportRows.reduce((s, r) => s + r.total_titik, 0);
  const grandTotalPendapatan = reportRows.reduce((s, r) => s + r.total_pendapatan, 0);
  const grandTotalPegawai = new Set(reportRows.map((r) => r.employee_id)).size;
  const grandTotalDivisi = new Set(reportRows.map((r) => r.division_id)).size;

  // Close export menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchReport = useCallback(async () => {
    const s = dateMode === "periode" ? getPeriodRange(periodKey).start : customStart;
    const e = dateMode === "periode" ? getPeriodRange(periodKey).end : customEnd;
    if (!s || !e) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("delivery_points")
      .select("*, pegawai(nama), divisions(nama, color), delivery_statuses(nama, kode, color)")
      .gte("tanggal", s)
      .lte("tanggal", e)
      .order("tanggal", { ascending: true });

    if (error) {
      setLoading(false);
      return;
    }

    processData(data || []);
    setLoading(false);
  }, [dateMode, periodKey, customStart, customEnd]);

  useEffect(() => {
    if (show) fetchReport();
  }, [show, fetchReport]);

  // ─── Process raw data into ReportRow[], then group both ways ───
  const processData = (data: DbDeliveryPoint[]) => {
    const map = new Map<string, {
      employee_id: string;
      employee_nama: string;
      division_id: number;
      division_nama: string;
      division_color: string;
      role: "Driver" | "Helper";
      total_titik: number;
      total_pendapatan: number;
      dates: Set<string>;
      statuses: Map<string, { nama: string; color: string; count: number }>;
    }>();

    data.forEach((d) => {
      const divNama = d.divisions?.nama || "-";
      const divColor = d.divisions?.color || "#3b82f6";
      const empNama = d.pegawai?.nama || d.employee_nama || d.employee_id || "?";
      const empId = d.employee_id || "unknown";
      const divId = d.division_id;
      const role = d.role;

      const key = `${divId}-${empId}-${role}`;
      if (!map.has(key)) {
        map.set(key, {
          employee_id: empId,
          employee_nama: empNama,
          division_id: divId,
          division_nama: divNama,
          division_color: divColor,
          role,
          total_titik: 0,
          total_pendapatan: 0,
          dates: new Set(),
          statuses: new Map(),
        });
      }

      const entry = map.get(key)!;
      entry.total_titik += d.jumlah_titik;
      entry.total_pendapatan += d.total;
      entry.dates.add(d.tanggal);

      const statusNama = d.delivery_statuses?.nama;
      const statusColor = d.delivery_statuses?.color;
      if (statusNama) {
        const existing = entry.statuses.get(statusNama);
        if (existing) existing.count++;
        else entry.statuses.set(statusNama, { nama: statusNama, color: statusColor || "#6b7280", count: 1 });
      }
    });

    const rows: ReportRow[] = Array.from(map.values()).map((v) => ({
      employee_id: v.employee_id,
      employee_nama: v.employee_nama,
      division_id: v.division_id,
      division_nama: v.division_nama,
      division_color: v.division_color,
      role: v.role,
      total_titik: v.total_titik,
      total_pendapatan: v.total_pendapatan,
      jumlah_hari: v.dates.size,
      status_summary: Array.from(v.statuses.values()),
    }));

    setReportRows(rows);

    // ── Group by Division ──
    const divMap = new Map<number, DivisionGroup>();
    rows.forEach((r) => {
      if (!divMap.has(r.division_id)) {
        divMap.set(r.division_id, {
          division_id: r.division_id,
          division_nama: r.division_nama,
          division_color: r.division_color,
          rows: [],
          subtotal_titik: 0,
          subtotal_pendapatan: 0,
        });
      }
      const group = divMap.get(r.division_id)!;
      group.rows.push(r);
      group.subtotal_titik += r.total_titik;
      group.subtotal_pendapatan += r.total_pendapatan;
    });
    const dGroups = Array.from(divMap.values()).sort((a, b) => a.division_nama.localeCompare(b.division_nama));
    dGroups.forEach((g) => g.rows.sort((a, b) => a.employee_nama.localeCompare(b.employee_nama)));
    setDivisionGroups(dGroups);

    // ── Group by Employee ──
    const empMap = new Map<string, EmployeeGroup>();
    rows.forEach((r) => {
      if (!empMap.has(r.employee_id)) {
        empMap.set(r.employee_id, {
          employee_id: r.employee_id,
          employee_nama: r.employee_nama,
          rows: [],
          subtotal_titik: 0,
          subtotal_pendapatan: 0,
          total_hari: 0,
        });
      }
      const group = empMap.get(r.employee_id)!;
      group.rows.push(r);
      group.subtotal_titik += r.total_titik;
      group.subtotal_pendapatan += r.total_pendapatan;
      group.total_hari += r.jumlah_hari;
    });
    const eGroups = Array.from(empMap.values()).sort((a, b) => a.employee_nama.localeCompare(b.employee_nama));
    eGroups.forEach((g) => g.rows.sort((a, b) => a.division_nama.localeCompare(b.division_nama)));
    setEmployeeGroups(eGroups);
  };

  // ─── Filtered data (search) ───
  const filteredDivGroups = divisionGroups
    .map((g) => ({
      ...g,
      rows: g.rows.filter((r) =>
        r.employee_nama.toLowerCase().includes(search.toLowerCase()) ||
        r.role.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((g) => g.rows.length > 0);

  const filteredEmpGroups = employeeGroups
    .map((g) => ({
      ...g,
      rows: g.rows.filter((r) =>
        r.division_nama.toLowerCase().includes(search.toLowerCase()) ||
        r.role.toLowerCase().includes(search.toLowerCase()) ||
        g.employee_nama.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((g) => g.rows.length > 0);

  const filteredTotalTitik = reportTab === "divisi"
    ? filteredDivGroups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.total_titik, 0), 0)
    : filteredEmpGroups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.total_titik, 0), 0);
  const filteredTotalPendapatan = reportTab === "divisi"
    ? filteredDivGroups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.total_pendapatan, 0), 0)
    : filteredEmpGroups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.total_pendapatan, 0), 0);

  const hasData = reportTab === "divisi" ? filteredDivGroups.length > 0 : filteredEmpGroups.length > 0;

  // ─── Period text for export ───
  const periodeText = dateMode === "periode"
    ? effectiveDates.label
    : `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;

  // ─── Export CSV ───
  const exportCSV = () => {
    if (reportTab === "divisi") exportCSVDivisi();
    else exportCSVPegawai();
  };

  const exportCSVDivisi = () => {
    const headers = ["Divisi", "Pegawai", "Posisi", "Total Titik", "Total Pendapatan", "Jumlah Hari", "Status"];
    const csvRows = [headers.join(",")];

    filteredDivGroups.forEach((g) => {
      g.rows.forEach((r) => {
        const statusStr = r.status_summary.map((s) => `${s.nama}(${s.count})`).join(" ");
        csvRows.push([
          `"${g.division_nama}"`, `"${r.employee_nama}"`, r.role,
          r.total_titik, r.total_pendapatan, r.jumlah_hari, `"${statusStr}"`,
        ].join(","));
      });
      csvRows.push([
        `"Subtotal ${g.division_nama}"`, "", "",
        g.rows.reduce((s, r) => s + r.total_titik, 0),
        g.rows.reduce((s, r) => s + r.total_pendapatan, 0), "", "",
      ].join(","));
    });
    csvRows.push([`"GRAND TOTAL"`, "", "", filteredTotalTitik, filteredTotalPendapatan, "", ""].join(","));

    downloadCSV(csvRows, `Rekap_Titik_PerDivisi_${startDate}_${endDate}.csv`);
  };

  const exportCSVPegawai = () => {
    const headers = ["Pegawai", "Divisi", "Posisi", "Total Titik", "Total Pendapatan", "Jumlah Hari", "Status"];
    const csvRows = [headers.join(",")];

    filteredEmpGroups.forEach((g) => {
      g.rows.forEach((r) => {
        const statusStr = r.status_summary.map((s) => `${s.nama}(${s.count})`).join(" ");
        csvRows.push([
          `"${g.employee_nama}"`, `"${r.division_nama}"`, r.role,
          r.total_titik, r.total_pendapatan, r.jumlah_hari, `"${statusStr}"`,
        ].join(","));
      });
      csvRows.push([
        `"Subtotal ${g.employee_nama}"`, "", "",
        g.subtotal_titik, g.subtotal_pendapatan, g.total_hari, "",
      ].join(","));
    });
    csvRows.push([`"GRAND TOTAL"`, "", "", filteredTotalTitik, filteredTotalPendapatan, "", ""].join(","));

    downloadCSV(csvRows, `Rekap_Titik_PerPegawai_${startDate}_${endDate}.csv`);
  };

  const downloadCSV = (csvRows: string[], filename: string) => {
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  // ─── Export PDF ───
  const exportPDF = async () => {
    if (reportTab === "divisi") await exportPDFDivisi();
    else await exportPDFPegawai();
  };

  const exportPDFDivisi = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Rekap Titik Per Divisi", pageWidth / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${periodeText}`, pageWidth / 2, 21, { align: "center" });

    let startY = 28;

    filteredDivGroups.forEach((g) => {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`Divisi: ${g.division_nama}`, 14, startY);
      startY += 2;

      const tableData = g.rows.map((r, idx) => [
        idx + 1, r.employee_nama, r.role,
        formatNumber(r.total_titik), formatCurrency(r.total_pendapatan),
        r.jumlah_hari, r.status_summary.map((s) => `${s.nama}(${s.count})`).join(", ") || "-",
      ]);
      tableData.push([
        "", "Subtotal", "",
        formatNumber(g.rows.reduce((s, r) => s + r.total_titik, 0)),
        formatCurrency(g.rows.reduce((s, r) => s + r.total_pendapatan, 0)), "", "",
      ]);

      autoTable(doc, {
        startY,
        head: [["#", "Pegawai", "Posisi", "Total Titik", "Total Pendapatan", "Hari Kerja", "Status"]],
        body: tableData,
        theme: "grid",
        headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: "bold", halign: "center" },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { halign: "center", cellWidth: 10 },
          2: { halign: "center", cellWidth: 20 },
          3: { halign: "right", cellWidth: 25 },
          4: { halign: "right", cellWidth: 35 },
          5: { halign: "center", cellWidth: 20 },
        },
        didParseCell: (data) => {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [243, 244, 246];
          }
        },
        margin: { left: 14, right: 14 },
      });

      startY = ((doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? startY + 32) + 8;
    });

    if (startY > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); startY = 15; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Grand Total: ${formatNumber(filteredTotalTitik)} titik | ${formatCurrency(filteredTotalPendapatan)}`, 14, startY);

    doc.save(`Rekap_Titik_PerDivisi_${startDate}_${endDate}.pdf`);
    setShowExportMenu(false);
  };

  const exportPDFPegawai = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Rekap Titik Per Pegawai", pageWidth / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${periodeText}`, pageWidth / 2, 21, { align: "center" });

    let startY = 28;

    filteredEmpGroups.forEach((g) => {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`Pegawai: ${g.employee_nama}`, 14, startY);
      startY += 2;

      const tableData = g.rows.map((r, idx) => [
        idx + 1, r.division_nama, r.role,
        formatNumber(r.total_titik), formatCurrency(r.total_pendapatan),
        r.jumlah_hari, r.status_summary.map((s) => `${s.nama}(${s.count})`).join(", ") || "-",
      ]);
      tableData.push([
        "", "Subtotal", "",
        formatNumber(g.subtotal_titik), formatCurrency(g.subtotal_pendapatan),
        g.total_hari, "",
      ]);

      autoTable(doc, {
        startY,
        head: [["#", "Divisi", "Posisi", "Total Titik", "Total Pendapatan", "Hari Kerja", "Status"]],
        body: tableData,
        theme: "grid",
        headStyles: { fillColor: [99, 102, 241], fontSize: 8, fontStyle: "bold", halign: "center" },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { halign: "center", cellWidth: 10 },
          2: { halign: "center", cellWidth: 20 },
          3: { halign: "right", cellWidth: 25 },
          4: { halign: "right", cellWidth: 35 },
          5: { halign: "center", cellWidth: 20 },
        },
        didParseCell: (data) => {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [243, 244, 246];
          }
        },
        margin: { left: 14, right: 14 },
      });

      startY = ((doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? startY + 32) + 8;
    });

    if (startY > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); startY = 15; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Grand Total: ${formatNumber(filteredTotalTitik)} titik | ${formatCurrency(filteredTotalPendapatan)}`, 14, startY);

    doc.save(`Rekap_Titik_PerPegawai_${startDate}_${endDate}.pdf`);
    setShowExportMenu(false);
  };

  if (!show) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-gradient-to-r from-card via-card to-primary/[0.03]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20">
              <FileText className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Laporan Detail Rekap Titik</h2>
              <p className="text-[10px] text-muted-foreground">
                {reportTab === "divisi" ? "Rekap titik per divisi" : "Rekap titik per pegawai"} dalam periode tertentu
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Export dropdown */}
            <div ref={exportRef} className="relative">
              <Button
                variant="outline"
                size="sm"
                icon={Download}
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={loading || !hasData}
              >
                Export
                <ChevronDown className="w-3 h-3 ml-0.5" />
              </Button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-44 bg-card rounded-xl border border-border shadow-xl z-10 overflow-hidden animate-scale-in">
                  <button
                    onClick={exportPDF}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-danger" />
                    Export PDF
                  </button>
                  <button
                    onClick={exportCSV}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors border-t border-border"
                  >
                    <FileText className="w-3.5 h-3.5 text-success" />
                    Export CSV
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />Tutup
            </button>
          </div>
        </div>

        {/* ── Filter Bar ── */}
        <div className="px-5 py-3 border-b border-border bg-card">
          <div className="flex flex-wrap items-center gap-3">
            {/* Report tab toggle */}
            <div className="flex items-center bg-muted rounded-xl p-0.5">
              <button
                onClick={() => setReportTab("divisi")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  reportTab === "divisi"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Hash className="w-3 h-3" />
                Per Divisi
              </button>
              <button
                onClick={() => setReportTab("pegawai")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  reportTab === "pegawai"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <User className="w-3 h-3" />
                Per Pegawai
              </button>
            </div>

            <div className="h-6 w-px bg-border" />

            {/* Date mode toggle */}
            <div className="flex items-center bg-muted rounded-xl p-0.5">
              <button
                onClick={() => setDateMode("periode")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  dateMode === "periode"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Periode
              </button>
              <button
                onClick={() => setDateMode("custom")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  dateMode === "custom"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Custom
              </button>
            </div>

            {/* Periode mode: navigator */}
            {dateMode === "periode" && (
              <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
                <button
                  onClick={() => {
                    const [y, m] = periodKey.split("-").map(Number);
                    const prev = new Date(y, m - 2, 1);
                    setPeriodKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
                  }}
                  className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="px-3 py-1 text-center min-w-[240px]">
                  <p className="text-xs font-bold text-foreground">{effectiveDates.label}</p>
                </div>
                <button
                  onClick={() => {
                    const [y, m] = periodKey.split("-").map(Number);
                    const next = new Date(y, m, 1);
                    setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
                  }}
                  className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Custom mode: date pickers */}
            {dateMode === "custom" && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                  <Calendar className="w-3.5 h-3.5" />
                  Dari
                </div>
                <div className="w-44">
                  <DatePicker value={customStart} onChange={setCustomStart} placeholder="Tanggal mulai" />
                </div>
                <span className="text-xs text-muted-foreground">s/d</span>
                <div className="w-44">
                  <DatePicker value={customEnd} onChange={setCustomEnd} placeholder="Tanggal akhir" />
                </div>
              </div>
            )}

            <div className="h-6 w-px bg-border" />

            {/* Search */}
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[200px] max-w-[320px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={reportTab === "divisi" ? "Cari pegawai..." : "Cari pegawai atau divisi..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/50 text-foreground"
              />
            </div>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-border">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Wallet className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Total Pendapatan</p>
                <p className="text-sm font-bold text-foreground">{loading ? "..." : formatCurrency(search ? filteredTotalPendapatan : grandTotalPendapatan)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-border">
              <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-success" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Total Titik</p>
                <p className="text-sm font-bold text-foreground">{loading ? "..." : formatNumber(search ? filteredTotalTitik : grandTotalTitik)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-border">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Pegawai</p>
                <p className="text-sm font-bold text-foreground">{loading ? "..." : grandTotalPegawai}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-border">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Divisi</p>
                <p className="text-sm font-bold text-foreground">{loading ? "..." : grandTotalDivisi}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Report Content ── */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="space-y-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-6 w-40 rounded-lg" />
                  <Skeleton className="h-48 w-full rounded-xl" />
                </div>
              ))}
            </div>
          ) : !hasData ? (
            <div className="flex flex-col items-center justify-center py-24">
              <FileText className="w-12 h-12 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">Tidak ada data untuk periode ini</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Coba ubah rentang tanggal atau kata kunci pencarian</p>
            </div>
          ) : reportTab === "divisi" ? (
            /* ═══ TAB: PER DIVISI ═══ */
            <div className="space-y-6">
              {filteredDivGroups.map((group) => (
                <div key={group.division_id} className="bg-card rounded-2xl border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.division_color }} />
                      <h3 className="text-sm font-bold text-foreground">{group.division_nama}</h3>
                      <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-medium">
                        {group.rows.length} pegawai
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-muted-foreground">
                        Titik: <strong className="text-foreground">{formatNumber(group.rows.reduce((s, r) => s + r.total_titik, 0))}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        Pendapatan: <strong className="text-foreground">{formatCurrency(group.rows.reduce((s, r) => s + r.total_pendapatan, 0))}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-10">#</th>
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Pegawai</th>
                          <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-24">Posisi</th>
                          <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-28">Total Titik</th>
                          <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-36">Total Pendapatan</th>
                          <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-24">Hari Kerja</th>
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-36">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {group.rows.map((row, idx) => (
                          <tr key={`${row.employee_id}-${row.role}`} className="hover:bg-muted/30 transition-colors">
                            <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="px-5 py-3"><p className="text-sm font-semibold text-foreground">{row.employee_nama}</p></td>
                            <td className="px-5 py-3 text-center">
                              <span className={cn("text-[10px] font-bold px-2.5 py-1 rounded-lg",
                                row.role === "Driver" ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" : "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400"
                              )}>{row.role}</span>
                            </td>
                            <td className="px-5 py-3 text-right text-sm font-bold text-foreground">{formatNumber(row.total_titik)}</td>
                            <td className="px-5 py-3 text-right text-sm font-semibold text-foreground">{formatCurrency(row.total_pendapatan)}</td>
                            <td className="px-5 py-3 text-center text-sm text-foreground">{row.jumlah_hari}</td>
                            <td className="px-5 py-3">
                              {row.status_summary.length > 0 ? (
                                <div className="flex items-center gap-1 flex-wrap">
                                  {row.status_summary.map((s) => (
                                    <span key={s.nama} className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${s.color}20`, color: s.color }}>
                                      {s.nama} ({s.count})
                                    </span>
                                  ))}
                                </div>
                              ) : <span className="text-xs text-muted-foreground italic">-</span>}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-muted/40 font-semibold">
                          <td className="px-5 py-2.5" colSpan={3}>
                            <span className="text-xs font-bold text-muted-foreground">Subtotal {group.division_nama}</span>
                          </td>
                          <td className="px-5 py-2.5 text-right text-sm font-bold text-primary">{formatNumber(group.rows.reduce((s, r) => s + r.total_titik, 0))}</td>
                          <td className="px-5 py-2.5 text-right text-sm font-bold text-primary">{formatCurrency(group.rows.reduce((s, r) => s + r.total_pendapatan, 0))}</td>
                          <td className="px-5 py-2.5" colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Grand Total */}
              <GrandTotalCard
                totalTitik={search ? filteredTotalTitik : grandTotalTitik}
                totalPendapatan={search ? filteredTotalPendapatan : grandTotalPendapatan}
              />
            </div>
          ) : (
            /* ═══ TAB: PER PEGAWAI ═══ */
            <div className="space-y-6">
              {filteredEmpGroups.map((group) => (
                <div key={group.employee_id} className="bg-card rounded-2xl border border-border overflow-hidden">
                  {/* Employee Header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <h3 className="text-sm font-bold text-foreground">{group.employee_nama}</h3>
                      <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-medium">
                        {group.rows.length} divisi
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-muted-foreground">
                        Titik: <strong className="text-foreground">{formatNumber(group.subtotal_titik)}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        Pendapatan: <strong className="text-foreground">{formatCurrency(group.subtotal_pendapatan)}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        Hari: <strong className="text-foreground">{group.total_hari}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-10">#</th>
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Divisi</th>
                          <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-24">Posisi</th>
                          <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-28">Total Titik</th>
                          <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-36">Total Pendapatan</th>
                          <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-24">Hari Kerja</th>
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-36">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {group.rows.map((row, idx) => (
                          <tr key={`${row.division_id}-${row.role}`} className="hover:bg-muted/30 transition-colors">
                            <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.division_color }} />
                                <p className="text-sm font-semibold text-foreground">{row.division_nama}</p>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-center">
                              <span className={cn("text-[10px] font-bold px-2.5 py-1 rounded-lg",
                                row.role === "Driver" ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" : "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400"
                              )}>{row.role}</span>
                            </td>
                            <td className="px-5 py-3 text-right text-sm font-bold text-foreground">{formatNumber(row.total_titik)}</td>
                            <td className="px-5 py-3 text-right text-sm font-semibold text-foreground">{formatCurrency(row.total_pendapatan)}</td>
                            <td className="px-5 py-3 text-center text-sm text-foreground">{row.jumlah_hari}</td>
                            <td className="px-5 py-3">
                              {row.status_summary.length > 0 ? (
                                <div className="flex items-center gap-1 flex-wrap">
                                  {row.status_summary.map((s) => (
                                    <span key={s.nama} className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${s.color}20`, color: s.color }}>
                                      {s.nama} ({s.count})
                                    </span>
                                  ))}
                                </div>
                              ) : <span className="text-xs text-muted-foreground italic">-</span>}
                            </td>
                          </tr>
                        ))}
                        {/* Subtotal row */}
                        <tr className="bg-muted/40 font-semibold">
                          <td className="px-5 py-2.5" colSpan={3}>
                            <span className="text-xs font-bold text-muted-foreground">Subtotal {group.employee_nama}</span>
                          </td>
                          <td className="px-5 py-2.5 text-right text-sm font-bold text-primary">{formatNumber(group.subtotal_titik)}</td>
                          <td className="px-5 py-2.5 text-right text-sm font-bold text-primary">{formatCurrency(group.subtotal_pendapatan)}</td>
                          <td className="px-5 py-2.5 text-center text-sm font-bold text-primary">{group.total_hari}</td>
                          <td className="px-5 py-2.5"></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Grand Total */}
              <GrandTotalCard
                totalTitik={search ? filteredTotalTitik : grandTotalTitik}
                totalPendapatan={search ? filteredTotalPendapatan : grandTotalPendapatan}
              />
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

// ─── Grand Total Card (shared) ───
function GrandTotalCard({ totalTitik, totalPendapatan }: { totalTitik: number; totalPendapatan: number }) {
  return (
    <div className="bg-card rounded-2xl border-2 border-primary/20 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-bold text-foreground">Grand Total</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground font-medium">Total Titik</p>
            <p className="text-lg font-bold text-primary">{formatNumber(totalTitik)}</p>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground font-medium">Total Pendapatan</p>
            <p className="text-lg font-bold text-primary">{formatCurrency(totalPendapatan)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
