"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Award, Search, ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
  Users, Clock, AlertTriangle, XCircle, CalendarCheck, Trophy,
  Download, ArrowUpRight, ArrowDownRight, Minus, FileText,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import Button from "@/components/ui/Button";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";
import {
  computePerformance,
  getGradeColor,
  PENALTY,
  SCORE_WEIGHT,
  type AttendanceLite,
  type SpDocLite,
} from "@/lib/performance";

// ─── Types ───
type EmployeeLite = {
  id: string;
  nama: string;
  jabatan_id: number | null;
  status: string;
  tanggal_bergabung: string | null;
  jabatan?: { nama: string } | null;
};

type PerformanceRow = {
  employee_id: string;
  nama: string;
  jabatanNama: string;
  status: string;
  tanggalBergabung: string | null;
  totalHariKerja: number;
  totalHariEfektif: number;
  hadir: number;
  telat: number;
  totalMenitTelat: number;
  alpha: number;
  manual: number;
  manualLeave: number;
  izin: number;
  sakit: number;
  cuti: number;
  spCount: number;
  sp1: number;
  sp2: number;
  sp3: number;
  skorKehadiran: number;
  skorDisiplin: number;
  penaltiTotal: number;
  skorTotal: number;
  grade: string;
};

// ─── Constants ───
const PAGE_SIZE = 10;
const CUT_OFF_DAY = 8;

function getPeriodRange(periodKey: string): { start: string; end: string; label: string; shortLabel: string } {
  const [year, month] = periodKey.split("-").map(Number);
  const startDate = new Date(year, month - 1, CUT_OFF_DAY);
  const endDate = new Date(year, month, CUT_OFF_DAY - 1);
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  const label = `${CUT_OFF_DAY} ${startDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })} – ${CUT_OFF_DAY - 1} ${endDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
  const shortLabel = startDate.toLocaleDateString("id-ID", { month: "short", year: "2-digit" });
  return { start, end, label, shortLabel };
}

function getCurrentPeriodKey(): string {
  const now = new Date();
  if (now.getDate() < CUT_OFF_DAY) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getPrevPeriodKey(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function PerformancePage() {
  // Reserved hook untuk future role-based feature
  useAuth();

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dateMode, setDateMode] = useState<"periode" | "custom">("periode");
  const [periodKey, setPeriodKey] = useState(getCurrentPeriodKey);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState("Semua");
  const [filterJabatan, setFilterJabatan] = useState("Semua");
  const [sortOrder, setSortOrder] = useState<"best" | "worst">("best");
  const [page, setPage] = useState(1);

  const [performanceData, setPerformanceData] = useState<PerformanceRow[]>([]);
  const [prevPerformanceData, setPrevPerformanceData] = useState<PerformanceRow[]>([]);

  // useMemo agar object reference stabil (mencegah infinite loop di fetchData)
  const period = useMemo(() =>
    dateMode === "periode"
      ? getPeriodRange(periodKey)
      : { start: customStart, end: customEnd, label: customStart && customEnd ? `${customStart} – ${customEnd}` : "Pilih tanggal", shortLabel: "Custom" },
    [dateMode, periodKey, customStart, customEnd]);
  const prevPeriod = useMemo(() =>
    dateMode === "periode" ? getPeriodRange(getPrevPeriodKey(periodKey)) : null,
    [dateMode, periodKey]);

  // Helper: hitung performance untuk satu range dataset.
  // Memakai shared util dari @/lib/performance supaya logic sama dengan dashboard.
  const computeRows = useCallback((emps: EmployeeLite[], attendance: AttendanceLite[], spDocs: SpDocLite[]): PerformanceRow[] => {
    return emps.map((emp) => {
      const breakdown = computePerformance(emp.id, attendance, spDocs);
      return {
        employee_id: emp.id,
        nama: emp.nama,
        jabatanNama: emp.jabatan?.nama ?? "-",
        status: emp.status,
        tanggalBergabung: emp.tanggal_bergabung,
        ...breakdown,
      };
    });
  }, []);

  // Fetch
  const fetchData = useCallback(async () => {
    setLoading(true);

    // Fetch employees + jabatan
    const { data: empData } = await supabase
      .from("pegawai")
      .select("id, nama, jabatan_id, status, tanggal_bergabung, jabatan:jabatan_id(nama)")
      .eq("status", "Aktif")
      .order("nama");
    const emps: EmployeeLite[] = (empData ?? []) as unknown as EmployeeLite[];

    // Current period attendance
    const { data: attData } = await supabase
      .from("attendance_records")
      .select("employee_id, tanggal, status, durasi_telat, is_manual")
      .gte("tanggal", period.start)
      .lte("tanggal", period.end);
    const attendance: AttendanceLite[] = attData || [];

    // Active SP
    const { data: spData } = await supabase
      .from("legal_documents")
      .select("employee_id, kategori, tingkat_sp, status, tanggal_terbit")
      .eq("kategori", "SP")
      .eq("status", "Aktif");
    const spDocs: SpDocLite[] = spData || [];

    const rows = computeRows(emps, attendance, spDocs);
    rows.sort((a, b) => b.skorTotal - a.skorTotal);
    setPerformanceData(rows);

    // Previous period for trend (hanya kalau mode periode)
    if (prevPeriod) {
      const { data: prevAttData } = await supabase
        .from("attendance_records")
        .select("employee_id, tanggal, status, durasi_telat, is_manual")
        .gte("tanggal", prevPeriod.start)
        .lte("tanggal", prevPeriod.end);
      const prevRows = computeRows(emps, prevAttData ?? [], spDocs);
      setPrevPerformanceData(prevRows);
    } else {
      setPrevPerformanceData([]);
    }

    setLoading(false);
  }, [period.start, period.end, prevPeriod, computeRows]);

  useEffect(() => {
    if (dateMode === "periode") fetchData();
    else if (customStart && customEnd) fetchData();
  }, [periodKey, dateMode, customStart, customEnd, fetchData]);

  // Filter, sort
  const filtered = useMemo(() => {
    return performanceData.filter((r) => {
      const matchSearch = r.nama.toLowerCase().includes(search.toLowerCase()) || r.employee_id.toLowerCase().includes(search.toLowerCase());
      const matchGrade = filterGrade === "Semua" || r.grade === filterGrade;
      const matchJabatan = filterJabatan === "Semua" || r.jabatanNama === filterJabatan;
      return matchSearch && matchGrade && matchJabatan;
    }).sort((a, b) => sortOrder === "best" ? b.skorTotal - a.skorTotal : a.skorTotal - b.skorTotal);
  }, [performanceData, search, filterGrade, filterJabatan, sortOrder]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Summary
  const avgSkor = performanceData.length > 0 ? Math.round(performanceData.reduce((s, r) => s + r.skorTotal, 0) / performanceData.length) : 0;
  const totalAlpha = performanceData.reduce((s, r) => s + r.alpha, 0);
  const totalTelat = performanceData.reduce((s, r) => s + r.telat, 0);
  const totalSP = performanceData.reduce((s, r) => s + r.spCount, 0);
  const totalIncident = totalAlpha + totalTelat + totalSP;
  const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  performanceData.forEach((r) => { if (r.grade in gradeDistribution) gradeDistribution[r.grade as keyof typeof gradeDistribution]++; });

  // Trend (current vs previous)
  const prevAvgSkor = prevPerformanceData.length > 0 ? Math.round(prevPerformanceData.reduce((s, r) => s + r.skorTotal, 0) / prevPerformanceData.length) : 0;
  const prevTotalIncident = prevPerformanceData.reduce((s, r) => s + r.alpha + r.telat + r.spCount, 0);
  const prevTotalSP = prevPerformanceData.reduce((s, r) => s + r.spCount, 0);

  const trendSkor = prevPerformanceData.length > 0 ? avgSkor - prevAvgSkor : 0;
  const trendIncident = prevPerformanceData.length > 0 ? totalIncident - prevTotalIncident : 0;
  const trendSP = prevPerformanceData.length > 0 ? totalSP - prevTotalSP : 0;

  // Insights: top 3 best & top 3 worst
  const topBest = useMemo(() => [...performanceData].sort((a, b) => b.skorTotal - a.skorTotal).slice(0, 3), [performanceData]);
  const topWorst = useMemo(() => [...performanceData].sort((a, b) => a.skorTotal - b.skorTotal).slice(0, 3), [performanceData]);

  // Unique jabatan untuk filter
  const uniqueJabatan = useMemo(() => {
    const set = new Set<string>();
    performanceData.forEach((r) => set.add(r.jabatanNama));
    return Array.from(set).sort();
  }, [performanceData]);

  // ─── Export PDF ───
  const exportPDF = useCallback(async () => {
    setExporting(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("LAPORAN KINERJA PEGAWAI", pageWidth / 2, 15, { align: "center" });

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Periode: ${period.label}`, pageWidth / 2, 22, { align: "center" });
      doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, pageWidth / 2, 28, { align: "center" });

      // Summary section
      let cursorY = 36;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("RINGKASAN", 14, cursorY);
      cursorY += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Rata-rata Skor: ${avgSkor}`, 14, cursorY); cursorY += 5;
      doc.text(`Total Pegawai Aktif: ${performanceData.length}`, 14, cursorY); cursorY += 5;
      doc.text(`Total Insiden (Alpha + Telat + SP): ${totalIncident}`, 14, cursorY); cursorY += 5;
      doc.text(`Total Surat Peringatan Aktif: ${totalSP}`, 14, cursorY); cursorY += 5;
      doc.text(`Distribusi: A=${gradeDistribution.A}, B=${gradeDistribution.B}, C=${gradeDistribution.C}, D=${gradeDistribution.D}, E=${gradeDistribution.E}`, 14, cursorY);
      cursorY += 8;

      // Table
      autoTable(doc, {
        startY: cursorY,
        head: [["#", "ID", "Nama", "Jabatan", "Status", "Tgl Bergabung", "Hari Kerja", "Hadir", "Telat", "Alpha", "Manual", "Izin", "Sakit", "SP", "Skor", "Grade"]],
        body: filtered.map((r, idx) => [
          idx + 1,
          r.employee_id,
          r.nama,
          r.jabatanNama,
          r.status,
          formatDate(r.tanggalBergabung),
          r.totalHariKerja,
          r.hadir,
          r.telat > 0 ? `${r.telat}x (${r.totalMenitTelat}m)` : "-",
          r.alpha > 0 ? `${r.alpha}x` : "-",
          r.manual > 0 ? `${r.manual}x` : "-",
          r.izin || "-",
          r.sakit || "-",
          r.spCount > 0 ? `${r.sp1}+${r.sp2}+${r.sp3}` : "-",
          r.skorTotal,
          r.grade,
        ]),
        theme: "striped",
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 7, halign: "center" },
        columnStyles: {
          0: { halign: "center" },
          6: { halign: "center" },
          7: { halign: "center" },
          8: { halign: "center" },
          9: { halign: "center" },
          10: { halign: "center" },
          11: { halign: "center" },
          12: { halign: "center" },
          13: { halign: "center" },
          14: { halign: "center" },
          15: { halign: "center", fontStyle: "bold" },
        },
      });

      // Footer info
      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY;
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(
        `Sistem Penilaian: Kehadiran (max ${SCORE_WEIGHT.KEHADIRAN}) = (Hadir/Hari Efektif) x ${SCORE_WEIGHT.KEHADIRAN}, ditambah Disiplin (max ${SCORE_WEIGHT.DISIPLIN}) = max(0, ${SCORE_WEIGHT.DISIPLIN} - penalti). ` +
        `Penalti: -${PENALTY.ALPHA_PER_HARI}/Alpha, -${PENALTY.TELAT_PER_KEJADIAN}/Telat & -${PENALTY.TELAT_PER_30_MENIT}/30 menit, -${PENALTY.MANUAL_HADIR}/Manual Hadir-Telat, -${PENALTY.MANUAL_LEAVE}/Manual Izin-Sakit-Cuti, -${PENALTY.SP1}/SP-1, -${PENALTY.SP2}/SP-2, -${PENALTY.SP3}/SP-3. ` +
        `Grade: A>=90, B 80-89, C 70-79, D 60-69, E<60.`,
        14, finalY + 8, { maxWidth: pageWidth - 28 },
      );

      const filename = `Laporan_Kinerja_${period.shortLabel.replace(/\s/g, "_")}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error("[Performance] PDF export failed:", err);
    } finally {
      setExporting(false);
    }
  }, [period, avgSkor, performanceData.length, totalIncident, totalSP, gradeDistribution, filtered]);

  return (
    <RouteGuard permission="performance">
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Kinerja Pegawai"
        description="Penilaian performa untuk audit & evaluasi periodik"
        icon={Award}
        actions={
          <Button
            size="sm"
            icon={Download}
            onClick={exportPDF}
            disabled={exporting || loading || performanceData.length === 0}
          >
            {exporting ? "Memproses..." : "Export PDF"}
          </Button>
        }
      />

      {/* ═══ Period Selector ═══ */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
            <button onClick={() => { setDateMode("periode"); setPage(1); }}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                dateMode === "periode" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Periode
            </button>
            <button onClick={() => { setDateMode("custom"); setPage(1); }}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                dateMode === "custom" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Custom
            </button>
          </div>

          {dateMode === "periode" ? (
            <div className="flex items-center gap-2">
              <button onClick={() => {
                const [y, m] = periodKey.split("-").map(Number);
                const prev = new Date(y, m - 2, 1);
                setPeriodKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
                setPage(1);
              }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><ChevronLeft className="w-4 h-4" /></button>
              <div className="text-center min-w-[260px]">
                <p className="text-sm font-bold text-foreground">{period.label}</p>
                <p className="text-[10px] text-muted-foreground">Periode penilaian (tgl 8 – tgl 7)</p>
              </div>
              <button onClick={() => {
                const [y, m] = periodKey.split("-").map(Number);
                const next = new Date(y, m, 1);
                setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
                setPage(1);
              }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><ChevronRight className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <input type="date" value={customStart} onChange={(e) => { setCustomStart(e.target.value); setPage(1); }}
                className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 text-foreground" />
              <span className="text-xs text-muted-foreground">–</span>
              <input type="date" value={customEnd} onChange={(e) => { setCustomEnd(e.target.value); setPage(1); }}
                className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 text-foreground" />
            </div>
          )}
        </div>
      </div>

      {/* ═══ Hero Metrics dengan Trend ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <_HeroCard
          icon={Award}
          label="Rata-rata Skor"
          value={loading ? "–" : String(avgSkor)}
          unit=""
          gradient="from-primary/15 via-primary/5 to-transparent"
          iconBg="bg-primary/15"
          iconColor="text-primary"
          trend={prevPerformanceData.length > 0 ? trendSkor : null}
          trendInverted={false}
          prevLabel={prevPeriod?.shortLabel}
        />
        <_HeroCard
          icon={Users}
          label="Total Pegawai Aktif"
          value={loading ? "–" : String(performanceData.length)}
          unit="orang"
          gradient="from-success/15 via-success/5 to-transparent"
          iconBg="bg-success/15"
          iconColor="text-success"
          trend={null}
          trendInverted={false}
        />
        <_HeroCard
          icon={AlertTriangle}
          label="Total Insiden"
          value={loading ? "–" : String(totalIncident)}
          unit="kejadian"
          gradient="from-warning/15 via-warning/5 to-transparent"
          iconBg="bg-warning/15"
          iconColor="text-warning"
          trend={prevPerformanceData.length > 0 ? trendIncident : null}
          trendInverted={true}
          prevLabel={prevPeriod?.shortLabel}
          breakdown={
            !loading
              ? `${totalAlpha} alpha • ${totalTelat} telat • ${totalSP} SP`
              : undefined
          }
        />
        <_HeroCard
          icon={XCircle}
          label="Surat Peringatan"
          value={loading ? "–" : String(totalSP)}
          unit="aktif"
          gradient="from-danger/15 via-danger/5 to-transparent"
          iconBg="bg-danger/15"
          iconColor="text-danger"
          trend={prevPerformanceData.length > 0 ? trendSP : null}
          trendInverted={true}
          prevLabel={prevPeriod?.shortLabel}
        />
      </div>

      {/* ═══ Insight: Top Best & Top Worst ═══ */}
      {!loading && performanceData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <_InsightCard
            title="Performance Teratas"
            subtitle="Pegawai dengan skor tertinggi"
            icon={Trophy}
            iconColor="text-success"
            iconBg="bg-success/10"
            rows={topBest}
            valueColor="text-success"
            ranks={["🥇", "🥈", "🥉"]}
          />
          <_InsightCard
            title="Perlu Perhatian"
            subtitle="Pegawai dengan skor terendah"
            icon={AlertTriangle}
            iconColor="text-danger"
            iconBg="bg-danger/10"
            rows={topWorst}
            valueColor="text-danger"
          />
        </div>
      )}

      {/* ═══ Distribusi Grade ═══ */}
      {!loading && performanceData.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Distribusi Grade</h3>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              {(["A", "B", "C", "D", "E"] as const).map((g) => (
                <div key={g} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getGradeColor(g) }} />
                  <span>{g} {g === "A" ? "≥90" : g === "B" ? "80-89" : g === "C" ? "70-79" : g === "D" ? "60-69" : "<60"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {(["A", "B", "C", "D", "E"] as const).map((grade) => {
              const count = gradeDistribution[grade];
              const pct = performanceData.length > 0 ? Math.round((count / performanceData.length) * 100) : 0;
              const color = getGradeColor(grade);
              return (
                <button key={grade} onClick={() => { setFilterGrade(filterGrade === grade ? "Semua" : grade); setPage(1); }}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all hover:scale-[1.02]",
                    filterGrade === grade ? "ring-2 ring-offset-1" : "border-border hover:border-foreground/20"
                  )}
                  style={filterGrade === grade ? { borderColor: color, ...({ "--tw-ring-color": color } as React.CSSProperties) } : undefined}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xl font-bold" style={{ color }}>{grade}</span>
                    <span className="text-xs font-bold text-foreground tabular-nums">{count}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mb-1.5">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  <p className="text-[9px] text-muted-foreground">{pct}% dari total</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Filter & Search ═══ */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 mb-3">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Cari nama atau ID pegawai..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            autoComplete="off" className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 bg-muted rounded-xl p-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground px-2 font-semibold uppercase tracking-wider">Jabatan:</span>
            <button onClick={() => { setFilterJabatan("Semua"); setPage(1); }}
              className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
                filterJabatan === "Semua" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              Semua
            </button>
            {uniqueJabatan.slice(0, 5).map((j) => (
              <button key={j} onClick={() => { setFilterJabatan(j); setPage(1); }}
                className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
                  filterJabatan === j ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {j}
              </button>
            ))}
            {uniqueJabatan.length > 5 && (
              <select value={uniqueJabatan.slice(0, 5).includes(filterJabatan) || filterJabatan === "Semua" ? "" : filterJabatan}
                onChange={(e) => { if (e.target.value) { setFilterJabatan(e.target.value); setPage(1); } }}
                className="text-[11px] px-2 py-1 rounded-md bg-transparent text-muted-foreground outline-none cursor-pointer">
                <option value="">+ Lainnya...</option>
                {uniqueJabatan.slice(5).map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
            <button onClick={() => { setSortOrder("best"); setPage(1); }}
              className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
                sortOrder === "best" ? "bg-card text-success shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <TrendingUp className="w-3 h-3" />Terbaik
            </button>
            <button onClick={() => { setSortOrder("worst"); setPage(1); }}
              className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
                sortOrder === "worst" ? "bg-card text-danger shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <TrendingDown className="w-3 h-3" />Terendah
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Tabel Pegawai dengan Kolom Audit ═══ */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-10">#</th>
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Pegawai</th>
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Jabatan</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Bergabung</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-14">Hadir</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-14">Telat</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-14">Alpha</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-14">Manual</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-14">SP</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-24">Skor</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-12">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={8} cols={11} /> : paged.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12 text-sm text-muted-foreground">Tidak ada data kinerja yang cocok dengan filter.</td></tr>
              ) : paged.map((row) => {
                const rank = filtered.indexOf(row) + 1;
                const gradeColor = getGradeColor(row.grade);
                return (
                  <tr key={row.employee_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{rank}</td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">{row.nama}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{row.employee_id} · {row.totalHariKerja} hari kerja</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-foreground">{row.jabatanNama}</p>
                      {row.status !== "Aktif" && (
                        <span className="text-[9px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                          {row.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <p className="text-[10px] text-muted-foreground tabular-nums">{formatDate(row.tanggalBergabung)}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-success tabular-nums">{row.hadir}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.telat > 0 ? (
                        <div>
                          <span className="text-sm font-semibold text-warning tabular-nums">{row.telat}x</span>
                          <p className="text-[9px] text-muted-foreground tabular-nums">{row.totalMenitTelat}m</p>
                        </div>
                      ) : <Minus className="w-3 h-3 text-muted-foreground/40 mx-auto" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.alpha > 0 ? (
                        <span className="text-sm font-semibold text-danger tabular-nums">{row.alpha}x</span>
                      ) : <Minus className="w-3 h-3 text-muted-foreground/40 mx-auto" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.manual > 0 ? (
                        <span className="text-sm font-semibold text-warning tabular-nums">{row.manual}x</span>
                      ) : <Minus className="w-3 h-3 text-muted-foreground/40 mx-auto" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.spCount > 0 ? (
                        <div className="inline-flex items-center gap-0.5">
                          {row.sp1 > 0 && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-warning/15 text-warning">{row.sp1}</span>}
                          {row.sp2 > 0 && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-orange-500/15 text-orange-500">{row.sp2}</span>}
                          {row.sp3 > 0 && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-danger/15 text-danger">{row.sp3}</span>}
                        </div>
                      ) : <Minus className="w-3 h-3 text-muted-foreground/40 mx-auto" />}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${row.skorTotal}%`, backgroundColor: gradeColor }} />
                        </div>
                        <span className="text-xs font-bold text-foreground tabular-nums w-6 text-right">{row.skorTotal}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-lg" style={{ backgroundColor: `${gradeColor}20`, color: gradeColor }}>
                        {row.grade}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      {/* ═══ Sistem Penilaian (collapsed footer) ═══ */}
      <details className="bg-card rounded-2xl border border-border overflow-hidden">
        <summary className="px-5 py-3 cursor-pointer hover:bg-muted/30 transition-colors flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">Sistem Penilaian</span>
          <span className="text-[10px] text-muted-foreground ml-auto">Klik untuk lihat detail</span>
        </summary>
        <div className="px-5 pb-5 space-y-4">
          {/* Komposisi skor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <_RuleCard
              icon={CalendarCheck}
              iconColor="text-success"
              title={`Kehadiran (max ${SCORE_WEIGHT.KEHADIRAN})`}
              desc="Hadir / hari efektif × 70. Libur tidak dihitung."
            />
            <_RuleCard
              icon={Award}
              iconColor="text-primary"
              title={`Disiplin (max ${SCORE_WEIGHT.DISIPLIN})`}
              desc="Mulai 30, dipotong oleh pelanggaran di bawah."
            />
          </div>

          {/* Penalti */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <_RuleCard
              icon={XCircle}
              iconColor="text-danger"
              title="Alpha"
              desc={`-${PENALTY.ALPHA_PER_HARI} poin per hari`}
            />
            <_RuleCard
              icon={Clock}
              iconColor="text-warning"
              title="Keterlambatan"
              desc={`-${PENALTY.TELAT_PER_KEJADIAN} per kejadian, -${PENALTY.TELAT_PER_30_MENIT} per 30 menit`}
            />
            <_RuleCard
              icon={CalendarCheck}
              iconColor="text-warning"
              title="Manual: Hadir / Telat"
              desc={`-${PENALTY.MANUAL_HADIR} poin per input manual`}
            />
            <_RuleCard
              icon={CalendarCheck}
              iconColor="text-amber-600"
              title="Manual: Izin / Sakit / Cuti"
              desc={`-${PENALTY.MANUAL_LEAVE} poin per input manual`}
            />
            <_RuleCard
              icon={AlertTriangle}
              iconColor="text-danger"
              title="Surat Peringatan"
              desc={`SP-1: -${PENALTY.SP1}, SP-2: -${PENALTY.SP2}, SP-3: -${PENALTY.SP3}`}
            />
            <_RuleCard
              icon={Award}
              iconColor="text-primary"
              title="Grade"
              desc="A ≥90 · B 80–89 · C 70–79 · D 60–69 · E <60"
            />
          </div>

          <p className="text-[10px] text-muted-foreground italic">
            Skor akhir = Kehadiran + max(0, 30 − total penalti). Pegawai tanpa data kehadiran di periode → skor 0.
          </p>
        </div>
      </details>
    </div>
    </RouteGuard>
  );
}

// ═════════════════════════════════════════════════════════
// COMPONENTS
// ═════════════════════════════════════════════════════════

function _HeroCard({
  icon: Icon, label, value, unit, gradient, iconBg, iconColor, trend, trendInverted, prevLabel, breakdown,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit: string;
  gradient: string;
  iconBg: string;
  iconColor: string;
  trend: number | null;
  trendInverted: boolean; // true: kenaikan = negatif (mis. insiden)
  prevLabel?: string;
  breakdown?: string;
}) {
  // Trend color: kalau trendInverted, kenaikan (positif) = merah, penurunan = hijau
  const isPositive = trend !== null && trend > 0;
  const isNegative = trend !== null && trend < 0;
  const isFlat = trend !== null && trend === 0;
  const isGood = trendInverted ? isNegative : isPositive;
  const isBad = trendInverted ? isPositive : isNegative;

  return (
    <div className={cn("relative bg-card rounded-2xl border border-border p-4 overflow-hidden")}>
      <div className={cn("absolute inset-0 bg-gradient-to-br pointer-events-none", gradient)} />
      <div className="relative">
        <div className="flex items-center justify-between mb-2.5">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", iconBg)}>
            <Icon className={cn("w-4 h-4", iconColor)} />
          </div>
          {trend !== null && (
            <div className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md",
              isFlat ? "bg-muted text-muted-foreground" : isGood ? "bg-success/10 text-success" : isBad ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground")}>
              {isFlat ? (
                <Minus className="w-2.5 h-2.5" />
              ) : isPositive ? (
                <ArrowUpRight className="w-2.5 h-2.5" />
              ) : (
                <ArrowDownRight className="w-2.5 h-2.5" />
              )}
              <span className="tabular-nums">{trend > 0 ? "+" : ""}{trend}</span>
            </div>
          )}
        </div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className="flex items-baseline gap-1.5 mt-1">
          <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
          {unit && <p className="text-xs text-muted-foreground font-medium">{unit}</p>}
        </div>
        {trend !== null && prevLabel && (
          <p className="text-[10px] text-muted-foreground mt-1">vs {prevLabel}</p>
        )}
        {breakdown && (
          <p className="text-[10px] text-muted-foreground mt-1.5 truncate">{breakdown}</p>
        )}
      </div>
    </div>
  );
}

function _InsightCard({
  title, subtitle, icon: Icon, iconColor, iconBg, rows, valueColor, ranks,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  rows: PerformanceRow[];
  valueColor: string;
  ranks?: string[];
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", iconBg)}>
          <Icon className={cn("w-4 h-4", iconColor)} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Tidak ada data.</p>
        ) : rows.map((r, idx) => {
          const gradeColor = getGradeColor(r.grade);
          return (
            <div key={r.employee_id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
              <span className="text-base w-6 text-center">{ranks?.[idx] ?? `#${idx + 1}`}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{r.nama}</p>
                <p className="text-[10px] text-muted-foreground truncate">{r.jabatanNama}</p>
              </div>
              <div className="text-right">
                <p className={cn("text-base font-bold tabular-nums", valueColor)}>{r.skorTotal}</p>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${gradeColor}20`, color: gradeColor }}>{r.grade}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function _RuleCard({ icon: Icon, iconColor, title, desc }: { icon: React.ComponentType<{ className?: string }>; iconColor: string; title: string; desc: string }) {
  return (
    <div className="bg-muted/30 rounded-xl p-3 border border-border">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={cn("w-4 h-4", iconColor)} />
        <p className="text-xs font-bold text-foreground">{title}</p>
      </div>
      <p className="text-[10px] text-muted-foreground">{desc}</p>
    </div>
  );
}
