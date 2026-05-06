"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Award, Search, ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
  Users, Clock, AlertTriangle, XCircle, CalendarCheck, Minus,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

// ─── Types ───
type EmployeeLite = { id: string; nama: string; jabatan_id: number | null; status: string };
type AttendanceRecord = { employee_id: string; tanggal: string; status: string; durasi_telat: number };
type LegalDoc = { employee_id: string; kategori: string; tingkat_sp: string | null; status: string; tanggal_terbit: string };

type PerformanceRow = {
  employee_id: string;
  nama: string;
  totalHariKerja: number;
  hadir: number;
  telat: number;
  totalMenitTelat: number;
  alpha: number;
  izin: number;
  sakit: number;
  cuti: number;
  spCount: number;
  sp1: number;
  sp2: number;
  sp3: number;
  skorKehadiran: number;
  skorKeterlambatan: number;
  skorAlpha: number;
  skorSP: number;
  skorTotal: number;
  grade: string;
};

// ─── Constants ───
const PAGE_SIZE = 10;
const CUT_OFF_DAY = 8;

// Bobot pengurangan poin
const PENALTY = {
  ALPHA_PER_HARI: 5,       // -5 poin per alpha
  TELAT_PER_KEJADIAN: 1,   // -1 poin per kejadian telat
  TELAT_PER_30_MENIT: 1,   // -1 poin tambahan per 30 menit telat
  SP1: 10,                  // -10 poin per SP-1
  SP2: 20,                  // -20 poin per SP-2
  SP3: 40,                  // -40 poin per SP-3
};

function getGrade(skor: number): string {
  if (skor >= 90) return "A";
  if (skor >= 80) return "B";
  if (skor >= 70) return "C";
  if (skor >= 60) return "D";
  return "E";
}

function getGradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#10b981";
    case "B": return "#3b82f6";
    case "C": return "#f59e0b";
    case "D": return "#f97316";
    case "E": return "#ef4444";
    default: return "#6b7280";
  }
}

function getPeriodRange(periodKey: string): { start: string; end: string; label: string } {
  const [year, month] = periodKey.split("-").map(Number);
  const startDate = new Date(year, month - 1, CUT_OFF_DAY);
  const endDate = new Date(year, month, CUT_OFF_DAY - 1);
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  const label = `${CUT_OFF_DAY} ${startDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })} – ${CUT_OFF_DAY - 1} ${endDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
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

export default function PerformancePage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("performance");

  const [loading, setLoading] = useState(true);
  const [periodKey, setPeriodKey] = useState(getCurrentPeriodKey);
  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState("Semua");
  const [page, setPage] = useState(1);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [performanceData, setPerformanceData] = useState<PerformanceRow[]>([]);

  const period = getPeriodRange(periodKey);

  // Fetch
  const fetchData = useCallback(async () => {
    setLoading(true);

    // Fetch employees
    const { data: empData } = await supabase.from("pegawai").select("id, nama, jabatan_id, status").in("status", ["Aktif", "Training"]).order("nama");
    const emps: EmployeeLite[] = empData || [];
    setEmployees(emps);

    // Fetch attendance records for period
    const { data: attData } = await supabase
      .from("attendance_records")
      .select("employee_id, tanggal, status, durasi_telat")
      .gte("tanggal", period.start)
      .lte("tanggal", period.end);
    const attendance: AttendanceRecord[] = attData || [];

    // Fetch active SP documents
    const { data: spData } = await supabase
      .from("legal_documents")
      .select("employee_id, kategori, tingkat_sp, status, tanggal_terbit")
      .eq("kategori", "SP")
      .eq("status", "Aktif");
    const spDocs: LegalDoc[] = spData || [];

    // Calculate performance per employee
    const rows: PerformanceRow[] = emps.map((emp) => {
      const empAtt = attendance.filter((a) => a.employee_id === emp.id);
      const empSP = spDocs.filter((s) => s.employee_id === emp.id);

      // Hitung hari kerja dalam periode (approx 30 hari - libur)
      const totalHariKerja = empAtt.length || 0;
      const hadir = empAtt.filter((a) => a.status === "Hadir" || a.status === "Terlambat").length;
      const telat = empAtt.filter((a) => a.status === "Terlambat").length;
      const totalMenitTelat = empAtt.filter((a) => a.status === "Terlambat").reduce((s, a) => s + (a.durasi_telat || 0), 0);
      const alpha = empAtt.filter((a) => a.status === "Alpha").length;
      const izin = empAtt.filter((a) => a.status === "Izin").length;
      const sakit = empAtt.filter((a) => a.status === "Sakit").length;
      const cuti = empAtt.filter((a) => a.status === "Cuti").length;

      const sp1 = empSP.filter((s) => s.tingkat_sp === "SP-1").length;
      const sp2 = empSP.filter((s) => s.tingkat_sp === "SP-2").length;
      const sp3 = empSP.filter((s) => s.tingkat_sp === "SP-3").length;
      const spCount = sp1 + sp2 + sp3;

      // Hitung skor (mulai dari 100)
      let skor = 100;

      // Pengurangan kehadiran: jika ada hari kerja tapi tidak hadir (selain izin/sakit/cuti)
      const skorKehadiran = totalHariKerja > 0 ? Math.round((hadir / totalHariKerja) * 100) : 100;

      // Pengurangan alpha
      const penaltyAlpha = alpha * PENALTY.ALPHA_PER_HARI;

      // Pengurangan keterlambatan
      const penaltyTelat = (telat * PENALTY.TELAT_PER_KEJADIAN) + (Math.floor(totalMenitTelat / 30) * PENALTY.TELAT_PER_30_MENIT);

      // Pengurangan SP
      const penaltySP = (sp1 * PENALTY.SP1) + (sp2 * PENALTY.SP2) + (sp3 * PENALTY.SP3);

      skor = skor - penaltyAlpha - penaltyTelat - penaltySP;
      skor = Math.max(0, Math.min(100, skor));

      return {
        employee_id: emp.id,
        nama: emp.nama,
        totalHariKerja,
        hadir,
        telat,
        totalMenitTelat,
        alpha,
        izin,
        sakit,
        cuti,
        spCount,
        sp1, sp2, sp3,
        skorKehadiran,
        skorKeterlambatan: Math.max(0, 100 - penaltyTelat),
        skorAlpha: Math.max(0, 100 - penaltyAlpha),
        skorSP: Math.max(0, 100 - penaltySP),
        skorTotal: skor,
        grade: getGrade(skor),
      };
    });

    // Sort by skor descending
    rows.sort((a, b) => b.skorTotal - a.skorTotal);
    setPerformanceData(rows);
    setLoading(false);
  }, [period.start, period.end]);

  useEffect(() => { fetchData(); }, [periodKey]);

  // Filter
  const filtered = performanceData.filter((r) => {
    const matchSearch = r.nama.toLowerCase().includes(search.toLowerCase());
    const matchGrade = filterGrade === "Semua" || r.grade === filterGrade;
    return matchSearch && matchGrade;
  });
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Summary stats
  const avgSkor = performanceData.length > 0 ? Math.round(performanceData.reduce((s, r) => s + r.skorTotal, 0) / performanceData.length) : 0;
  const totalAlpha = performanceData.reduce((s, r) => s + r.alpha, 0);
  const totalTelat = performanceData.reduce((s, r) => s + r.telat, 0);
  const totalSP = performanceData.reduce((s, r) => s + r.spCount, 0);
  const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  performanceData.forEach((r) => { if (r.grade in gradeDistribution) gradeDistribution[r.grade as keyof typeof gradeDistribution]++; });

  return (
    <RouteGuard permission="performance">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Kinerja Pegawai"
        description="Penilaian performa berdasarkan kehadiran, keterlambatan, alpha, dan surat peringatan"
        icon={Award}
      />

      {/* Period Navigator */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const [y, m] = periodKey.split("-").map(Number);
              const prev = new Date(y, m - 2, 1);
              setPeriodKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
              setPage(1);
            }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><ChevronLeft className="w-4 h-4" /></button>
            <div className="text-center min-w-[240px]">
              <p className="text-sm font-bold text-foreground">{period.label}</p>
              <p className="text-[10px] text-muted-foreground">Periode Penilaian</p>
            </div>
            <button onClick={() => {
              const [y, m] = periodKey.split("-").map(Number);
              const next = new Date(y, m, 1);
              setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
              setPage(1);
            }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-56">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" placeholder="Cari pegawai..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Award className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">Rata-rata Skor</p>
              <p className="text-lg font-bold text-foreground">{loading ? "-" : avgSkor}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">Total Pegawai</p>
              <p className="text-lg font-bold text-foreground">{loading ? "-" : performanceData.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">Total Telat</p>
              <p className="text-lg font-bold text-warning">{loading ? "-" : totalTelat}x</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">Total Alpha</p>
              <p className="text-lg font-bold text-danger">{loading ? "-" : totalAlpha}x</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">Total SP Aktif</p>
              <p className="text-lg font-bold text-danger">{loading ? "-" : totalSP}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Grade Distribution */}
      {!loading && (
        <div className="bg-card rounded-2xl border border-border p-5">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-4">Distribusi Grade</h3>
          <div className="flex items-end gap-3 h-24">
            {(["A", "B", "C", "D", "E"] as const).map((grade) => {
              const count = gradeDistribution[grade];
              const maxCount = Math.max(...Object.values(gradeDistribution), 1);
              const height = (count / maxCount) * 100;
              const color = getGradeColor(grade);
              return (
                <div key={grade} className="flex-1 flex flex-col items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground">{count}</span>
                  <div className="w-full rounded-t-lg transition-all duration-500" style={{ height: `${Math.max(height, 8)}%`, backgroundColor: `${color}30` }}>
                    <div className="w-full h-full rounded-t-lg" style={{ backgroundColor: color, opacity: 0.7 }} />
                  </div>
                  <span className="text-[10px] font-bold" style={{ color }}>{grade}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-border">
            {(["A", "B", "C", "D", "E"] as const).map((grade) => (
              <div key={grade} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: getGradeColor(grade) }} />
                <span>{grade} ({grade === "A" ? "≥90" : grade === "B" ? "80-89" : grade === "C" ? "70-79" : grade === "D" ? "60-69" : "<60"})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Grade */}
      <div className="flex items-center gap-2 flex-wrap">
        {["Semua", "A", "B", "C", "D", "E"].map((g) => {
          const isActive = filterGrade === g;
          return (
            <button key={g} onClick={() => { setFilterGrade(g); setPage(1); }}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                isActive ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted")}>
              {g === "Semua" ? "Semua" : `Grade ${g}`}
              {g !== "Semua" && <span className="ml-1 text-[9px] opacity-70">({gradeDistribution[g as keyof typeof gradeDistribution]})</span>}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-10">#</th>
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Pegawai</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-16">Hadir</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-16">Telat</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-16">Alpha</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-16">Izin</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-16">Sakit</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-14">SP</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-20">Skor</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-16">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={8} cols={10} /> : paged.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data kinerja</td></tr>
              ) : paged.map((row, idx) => {
                const rank = filtered.indexOf(row) + 1;
                const gradeColor = getGradeColor(row.grade);
                return (
                  <tr key={row.employee_id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{rank}</td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">{row.nama}</p>
                      <p className="text-[10px] text-muted-foreground">{row.totalHariKerja} hari kerja</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-success">{row.hadir}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.telat > 0 ? (
                        <div>
                          <span className="text-sm font-semibold text-warning">{row.telat}x</span>
                          <p className="text-[9px] text-muted-foreground">{row.totalMenitTelat}m</p>
                        </div>
                      ) : <span className="text-sm text-muted-foreground">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.alpha > 0 ? (
                        <span className="text-sm font-semibold text-danger">{row.alpha}x</span>
                      ) : <span className="text-sm text-muted-foreground">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.izin > 0 ? (
                        <span className="text-sm font-semibold text-blue-500">{row.izin}</span>
                      ) : <span className="text-sm text-muted-foreground">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.sakit > 0 ? (
                        <span className="text-sm font-semibold text-orange-500">{row.sakit}</span>
                      ) : <span className="text-sm text-muted-foreground">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.spCount > 0 ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-danger/10 text-danger">{row.spCount}</span>
                      ) : <span className="text-sm text-muted-foreground">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${row.skorTotal}%`, backgroundColor: gradeColor }} />
                        </div>
                        <span className="text-xs font-bold text-foreground">{row.skorTotal}</span>
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

      {/* Scoring Info */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">Sistem Penilaian</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-muted/30 rounded-xl p-3 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-danger" />
              <p className="text-xs font-bold text-foreground">Alpha</p>
            </div>
            <p className="text-[10px] text-muted-foreground">-{PENALTY.ALPHA_PER_HARI} poin per hari alpha</p>
          </div>
          <div className="bg-muted/30 rounded-xl p-3 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-warning" />
              <p className="text-xs font-bold text-foreground">Keterlambatan</p>
            </div>
            <p className="text-[10px] text-muted-foreground">-{PENALTY.TELAT_PER_KEJADIAN} poin per kejadian, -{PENALTY.TELAT_PER_30_MENIT} poin per 30 menit</p>
          </div>
          <div className="bg-muted/30 rounded-xl p-3 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-danger" />
              <p className="text-xs font-bold text-foreground">Surat Peringatan</p>
            </div>
            <p className="text-[10px] text-muted-foreground">SP-1: -{PENALTY.SP1}, SP-2: -{PENALTY.SP2}, SP-3: -{PENALTY.SP3} poin</p>
          </div>
          <div className="bg-muted/30 rounded-xl p-3 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-4 h-4 text-primary" />
              <p className="text-xs font-bold text-foreground">Skor Awal</p>
            </div>
            <p className="text-[10px] text-muted-foreground">100 poin (dikurangi pelanggaran)</p>
          </div>
        </div>
      </div>
    </div>
    </RouteGuard>
  );
}
