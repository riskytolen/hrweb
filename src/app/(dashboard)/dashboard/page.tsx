"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  CalendarCheck2,
  MapPin,
  Wallet,
  TrendingUp,
  TrendingDown,
  Clock,
  CalendarDays,
  Scale,
  UserPlus,
  ArrowRight,
  Activity,
  Award,
  Sparkles,
  Trophy,
  Medal,
  type LucideIcon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { cn, formatCurrency, formatNumber, getInitials } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { entityLabel } from "@/lib/audit";
import {
  computePerformance,
  computeDailyRankPoints,
  assignGrades,
  comparePerformanceBest,
  getGradeColor,
  DIVISION_RANK_POINTS,
  type AttendanceLite,
  type SpDocLite,
  type PerformanceResult,
} from "@/lib/performance";

// ─── Types ───
interface KpiData {
  pegawaiAktif: number;
  pegawaiTraining: number;
  pegawaiTotal: number;
  hadirHariIni: number;
  pegawaiKerjaHariIni: number; // total pegawai yang seharusnya hadir hari ini (Aktif + Training - Libur - Cuti)
  titikPeriode: number;
  pendapatanPeriode: number;
  titikPeriodeLalu: number;
  pendapatanPeriodeLalu: number;
}

interface TrendPoint {
  tanggal: string;
  label: string; // "8 Mei"
  pendapatan: number;
  titik: number;
}

interface ZoneStat {
  zone_nama: string;
  total_titik: number;
  total_pendapatan: number;
  color: string;
}

interface PendingItem {
  type: "leave" | "overtime" | "legal";
  count: number;
  href: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

interface RecruitmentStat {
  status: "Lamaran Masuk" | "Terpilih" | "Training" | "Diterima" | "Ditolak";
  count: number;
}

interface AuditLite {
  id: number;
  action: string;
  entity_type: string;
  entity_label: string | null;
  user_nama: string | null;
  created_at: string;
}

interface TopPerformer {
  employee_id: string;
  nama: string;
  jabatanNama: string;
  totalPoint: number;
  pointHarian: number;
  grade: "A" | "B" | "C" | "D" | "E" | "-";
  hadir: number;
  telat: number;
  alpha: number;
  manualCount: number;
  spCount: number;
  totalPenalti: number;
  eligible: boolean;
  divisionId: number | null;
  divisionNama: string | null;
  hasDivisionOverride: boolean;
}

// ─── Period helpers (cut-off tgl 8) ───
const CUT_OFF_DAY = 8;

function getActivePeriod(): { start: string; end: string; label: string } {
  const now = new Date();
  const baseMonth = now.getDate() < CUT_OFF_DAY ? now.getMonth() - 1 : now.getMonth();
  const startDate = new Date(now.getFullYear(), baseMonth, CUT_OFF_DAY);
  const endDate = new Date(now.getFullYear(), baseMonth + 1, CUT_OFF_DAY - 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtId = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  return { start: fmt(startDate), end: fmt(endDate), label: `${fmtId(startDate)} – ${fmtId(endDate)}` };
}

function getPreviousPeriod(): { start: string; end: string } {
  const now = new Date();
  const baseMonth = now.getDate() < CUT_OFF_DAY ? now.getMonth() - 2 : now.getMonth() - 1;
  const startDate = new Date(now.getFullYear(), baseMonth, CUT_OFF_DAY);
  const endDate = new Date(now.getFullYear(), baseMonth + 1, CUT_OFF_DAY - 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(startDate), end: fmt(endDate) };
}

function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(dateStr).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function actionVerb(action: string): string {
  const map: Record<string, string> = {
    create: "Menambah",
    update: "Mengubah",
    delete: "Menghapus",
    approve: "Menyetujui",
    reject: "Menolak",
    generate: "Generate",
    manual_input: "Input manual",
    status_change: "Ubah status",
  };
  return map[action] ?? action;
}

// ─── Main page ───
export default function DashboardPage() {
  const { profile } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [zones, setZones] = useState<ZoneStat[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [statusDist, setStatusDist] = useState<{ status: string; count: number; color: string }[]>([]);
  const [recruitment, setRecruitment] = useState<RecruitmentStat[]>([]);
  const [recent, setRecent] = useState<AuditLite[]>([]);
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);

  const period = useMemo(() => getActivePeriod(), []);
  const prev = useMemo(() => getPreviousPeriod(), []);
  const today = useMemo(() => todayStr(), []);

  // Live clock — update tiap menit
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const fetchAll = useCallback(async () => {
    // 1. KPI: pegawai counts
    const pegawaiPromise = supabase
      .from("pegawai")
      .select("status", { count: "exact" });

    // 2. Attendance hari ini
    const attendancePromise = supabase
      .from("attendance_records")
      .select("status, employee_id")
      .eq("tanggal", today);

    // 3. Delivery points periode aktif
    const deliveriesPromise = supabase
      .from("delivery_points")
      .select("tanggal, jumlah_titik, total, zone_id, delivery_zones(nama, color)")
      .gte("tanggal", period.start)
      .lte("tanggal", period.end);

    // 4. Delivery points periode lalu (untuk perbandingan)
    const prevDeliveriesPromise = supabase
      .from("delivery_points")
      .select("jumlah_titik, total")
      .gte("tanggal", prev.start)
      .lte("tanggal", prev.end);

    // 5. Pending approvals
    const leavePending = supabase
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "Menunggu");
    const overtimePending = supabase
      .from("overtime_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "Menunggu");
    const legalPending = supabase
      .from("legal_documents")
      .select("id", { count: "exact", head: true })
      .eq("status_approval", "Menunggu");

    // 6. Recruitment pipeline
    const recruitmentPromise = supabase
      .from("recruitments")
      .select("status");

    // 7. Recent audit logs
    const auditPromise = supabase
      .from("audit_logs")
      .select("id, action, entity_type, entity_label, user_nama, created_at")
      .order("created_at", { ascending: false })
      .limit(8);

    // 8a. Daftar divisi (untuk tampilkan nama di Top Performers + lookup override)
    const divisionsPromise = supabase
      .from("divisions")
      .select("id, nama");

    // 8b. Top performers — pegawai aktif + attendance periode + SP aktif
    const empPerfPromise = supabase
      .from("pegawai")
      .select("id, nama, jabatan_id, status, tanggal_bergabung, jabatan:jabatan_id(nama)")
      .eq("status", "Aktif");
    const attPerfPromise = supabase
      .from("attendance_records")
      .select("employee_id, tanggal, status, durasi_telat, is_manual, jam_masuk, schedule_jam_masuk, division_id")
      .gte("tanggal", period.start)
      .lte("tanggal", period.end);
    const spPerfPromise = supabase
      .from("legal_documents")
      .select("employee_id, kategori, tingkat_sp, status")
      .eq("kategori", "SP")
      .eq("status", "Aktif")
      .lte("tanggal_terbit", period.end);

    const [
      pegRes,
      attRes,
      delRes,
      prevDelRes,
      leaveRes,
      otRes,
      legalRes,
      recRes,
      auditRes,
      divisionsRes,
      empPerfRes,
      attPerfRes,
      spPerfRes,
    ] = await Promise.all([
      pegawaiPromise,
      attendancePromise,
      deliveriesPromise,
      prevDeliveriesPromise,
      leavePending,
      overtimePending,
      legalPending,
      recruitmentPromise,
      auditPromise,
      divisionsPromise,
      empPerfPromise,
      attPerfPromise,
      spPerfPromise,
    ]);

    // ─── Process pegawai stats ───
    const pegStatuses = (pegRes.data ?? []) as { status: string }[];
    const pegawaiAktif = pegStatuses.filter((p) => p.status === "Aktif").length;
    const pegawaiTraining = pegStatuses.filter((p) => p.status === "Training").length;
    const pegawaiTotal = pegStatuses.length;
    const pegawaiTidakAktif = pegStatuses.filter((p) => p.status === "Tidak Aktif").length;
    const pegawaiCuti = pegStatuses.filter((p) => p.status === "Cuti").length;

    // ─── Process attendance hari ini ───
    const attRows = (attRes.data ?? []) as { status: string; employee_id: string }[];
    const hadirHariIni = new Set(
      attRows.filter((r) => r.status === "Hadir" || r.status === "Terlambat").map((r) => r.employee_id),
    ).size;
    // Pegawai kerja hari ini = total Aktif + Training (kasar). Lebih akurat butuh employee_off_days, tapi cukup untuk ratio dashboard.
    const pegawaiKerjaHariIni = pegawaiAktif + pegawaiTraining;

    // ─── Process delivery periode aktif ───
    type DeliveryRow = {
      tanggal: string;
      jumlah_titik: number;
      total: number;
      zone_id: number;
      delivery_zones: { nama: string; color: string } | null;
    };
    const delRows = (delRes.data ?? []) as unknown as DeliveryRow[];
    const titikPeriode = delRows.reduce((s, r) => s + r.jumlah_titik, 0);
    const pendapatanPeriode = delRows.reduce((s, r) => s + r.total, 0);

    // ─── Trend: group by tanggal (full periode 30 hari) ───
    const trendMap = new Map<string, { titik: number; pendapatan: number }>();
    delRows.forEach((r) => {
      const cur = trendMap.get(r.tanggal) ?? { titik: 0, pendapatan: 0 };
      cur.titik += r.jumlah_titik;
      cur.pendapatan += r.total;
      trendMap.set(r.tanggal, cur);
    });
    // Generate semua tanggal di periode supaya line chart kontinyu
    const trendPoints: TrendPoint[] = [];
    const startD = new Date(period.start);
    const endD = new Date(period.end);
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const data = trendMap.get(ds) ?? { titik: 0, pendapatan: 0 };
      trendPoints.push({
        tanggal: ds,
        label: d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
        pendapatan: data.pendapatan,
        titik: data.titik,
      });
    }

    // ─── Top zona ───
    const zoneMap = new Map<number, ZoneStat>();
    delRows.forEach((r) => {
      if (!r.delivery_zones) return;
      const cur = zoneMap.get(r.zone_id) ?? {
        zone_nama: r.delivery_zones.nama,
        total_titik: 0,
        total_pendapatan: 0,
        color: r.delivery_zones.color || "#3b82f6",
      };
      cur.total_titik += r.jumlah_titik;
      cur.total_pendapatan += r.total;
      zoneMap.set(r.zone_id, cur);
    });
    const topZones = Array.from(zoneMap.values())
      .sort((a, b) => b.total_pendapatan - a.total_pendapatan)
      .slice(0, 5);

    // ─── Periode lalu ───
    const prevDel = (prevDelRes.data ?? []) as { jumlah_titik: number; total: number }[];
    const titikPeriodeLalu = prevDel.reduce((s, r) => s + r.jumlah_titik, 0);
    const pendapatanPeriodeLalu = prevDel.reduce((s, r) => s + r.total, 0);

    // ─── Pending approvals ───
    const pendingItems: PendingItem[] = [
      {
        type: "leave",
        count: leaveRes.count ?? 0,
        href: "/employees/leave",
        label: "Cuti & Izin",
        icon: CalendarDays,
        color: "#3b82f6",
      },
      {
        type: "overtime",
        count: otRes.count ?? 0,
        href: "/employees/overtime",
        label: "Lembur",
        icon: Clock,
        color: "#f59e0b",
      },
      {
        type: "legal",
        count: legalRes.count ?? 0,
        href: "/employees/legal",
        label: "Legal & Administrasi",
        icon: Scale,
        color: "#8b5cf6",
      },
    ];

    // ─── Recruitment pipeline ───
    const recRows = (recRes.data ?? []) as { status: RecruitmentStat["status"] }[];
    const recCounts = new Map<RecruitmentStat["status"], number>();
    recRows.forEach((r) => recCounts.set(r.status, (recCounts.get(r.status) ?? 0) + 1));
    const recArr: RecruitmentStat[] = (
      ["Lamaran Masuk", "Terpilih", "Training", "Diterima", "Ditolak"] as RecruitmentStat["status"][]
    ).map((s) => ({ status: s, count: recCounts.get(s) ?? 0 }));

    // ─── Status distribusi pegawai ───
    const statusArr = [
      { status: "Aktif", count: pegawaiAktif, color: "#10b981" },
      { status: "Training", count: pegawaiTraining, color: "#f59e0b" },
      { status: "Cuti", count: pegawaiCuti, color: "#3b82f6" },
      { status: "Tidak Aktif", count: pegawaiTidakAktif, color: "#94a3b8" },
    ].filter((s) => s.count > 0);

    // ─── Audit logs ───
    const auditRows = (auditRes.data ?? []) as AuditLite[];

    // ─── Top Performers (kinerja terbaik periode aktif) ───
    type EmpPerfRow = {
      id: string;
      nama: string;
      tanggal_bergabung: string | null;
      jabatan: { nama: string } | null;
    };
    type PerfWithIdentity = PerformanceResult & {
      employee_id: string;
      nama: string;
      jabatanNama: string;
    };
    const empsPerf = (empPerfRes.data ?? []) as unknown as EmpPerfRow[];
    const attPerf = (attPerfRes.data ?? []) as AttendanceLite[];
    const spPerf = (spPerfRes.data ?? []) as SpDocLite[];

    // Map division_id → nama (untuk ditampilkan di top performer)
    const divisionMap = new Map<number, string>();
    ((divisionsRes.data ?? []) as { id: number; nama: string }[]).forEach((d) => divisionMap.set(d.id, d.nama));

    // Map employee_id → division_id (ambil yang paling sering muncul di attendance periode)
    const empDivisionCount = new Map<string, Map<number, number>>();
    attPerf.forEach((a) => {
      if (a.division_id == null) return;
      if (!empDivisionCount.has(a.employee_id)) empDivisionCount.set(a.employee_id, new Map());
      const m = empDivisionCount.get(a.employee_id)!;
      m.set(a.division_id, (m.get(a.division_id) ?? 0) + 1);
    });
    const empDominantDivision = new Map<string, number>();
    empDivisionCount.forEach((counts, empId) => {
      let bestId = 0;
      let bestCount = 0;
      counts.forEach((c, id) => {
        if (c > bestCount) { bestCount = c; bestId = id; }
      });
      if (bestId > 0) empDominantDivision.set(empId, bestId);
    });

    const periodEnd = period.end;

    // Hitung ranking point harian sekali untuk semua pegawai
    const dailyRankPoints = computeDailyRankPoints(attPerf);

    // Bangun PerformanceResult[] lengkap supaya bisa assignGrades (persentil)
    const perfRows: PerfWithIdentity[] = empsPerf.map((e) => {
      const b = computePerformance(e.id, attPerf, spPerf, e.tanggal_bergabung, periodEnd, dailyRankPoints);
      return {
        ...b,
        employee_id: e.id,
        nama: e.nama,
        jabatanNama: e.jabatan?.nama ?? "-",
      };
    });
    assignGrades(perfRows, (r) => r.totalPoint);

    const topPerformersData: TopPerformer[] = perfRows
      .map((b) => {
        const divId = empDominantDivision.get(b.employee_id) ?? null;
        return {
          employee_id: b.employee_id,
          nama: b.nama,
          jabatanNama: b.jabatanNama,
          totalPoint: b.totalPoint,
          pointHarian: b.pointHarian,
          grade: b.grade,
          hadir: b.hadir,
          telat: b.telat,
          alpha: b.alpha,
          manualCount: b.manualCount,
          spCount: b.spCount,
          totalPenalti: b.totalPenalti,
          eligible: b.eligible,
          divisionId: divId,
          divisionNama: divId ? divisionMap.get(divId) ?? null : null,
          hasDivisionOverride: divId != null && divId in DIVISION_RANK_POINTS,
        };
      })
      // Skip pegawai yang belum eligible atau tidak punya data sama sekali
      .filter((p) => p.eligible && p.hadir > 0)
      .sort(comparePerformanceBest)
      .slice(0, 5);

    setKpi({
      pegawaiAktif,
      pegawaiTraining,
      pegawaiTotal,
      hadirHariIni,
      pegawaiKerjaHariIni,
      titikPeriode,
      pendapatanPeriode,
      titikPeriodeLalu,
      pendapatanPeriodeLalu,
    });
    setTrend(trendPoints);
    setZones(topZones);
    setPending(pendingItems);
    setStatusDist(statusArr);
    setRecruitment(recArr);
    setRecent(auditRows);
    setTopPerformers(topPerformersData);
    setLoading(false);
  }, [period.start, period.end, prev.start, prev.end, today]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const totalPending = pending.reduce((s, p) => s + p.count, 0);
  const pendapatanGrowth = useMemo(() => {
    if (!kpi || kpi.pendapatanPeriodeLalu === 0) return null;
    return ((kpi.pendapatanPeriode - kpi.pendapatanPeriodeLalu) / kpi.pendapatanPeriodeLalu) * 100;
  }, [kpi]);
  const titikGrowth = useMemo(() => {
    if (!kpi || kpi.titikPeriodeLalu === 0) return null;
    return ((kpi.titikPeriode - kpi.titikPeriodeLalu) / kpi.titikPeriodeLalu) * 100;
  }, [kpi]);
  const hadirRatio = useMemo(() => {
    if (!kpi || kpi.pegawaiKerjaHariIni === 0) return 0;
    return (kpi.hadirHariIni / kpi.pegawaiKerjaHariIni) * 100;
  }, [kpi]);

  const namaUser = profile?.nama ?? "Admin";
  const initials = getInitials(namaUser);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ─── Hero / Greeting ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/[0.08] via-card to-card p-6">
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 blur-3xl pointer-events-none" />
        <div className="absolute top-3 right-3">
          <Sparkles className="w-5 h-5 text-primary/40" />
        </div>
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-lg shadow-primary/20">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground font-medium">{greeting()},</p>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground truncate">{namaUser}</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              {" · "}
              <span className="tabular-nums">
                {now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </p>
          </div>
          {totalPending > 0 && (
            <Link
              href={pending.find((p) => p.count > 0)?.href ?? "/employees/leave"}
              className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 hover:bg-warning/15 transition-colors"
            >
              <span className="relative flex w-2 h-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-warning" />
              </span>
              <span className="text-xs font-semibold text-warning">{totalPending} approval menunggu</span>
              <ArrowRight className="w-3.5 h-3.5 text-warning" />
            </Link>
          )}
        </div>
      </div>

      {/* ─── KPI Cards (4 kolom) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          loading={loading}
          icon={Users}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          label="Pegawai Aktif"
          value={kpi ? formatNumber(kpi.pegawaiAktif) : "-"}
          sublabel={kpi ? `+ ${kpi.pegawaiTraining} training · ${kpi.pegawaiTotal} total` : undefined}
        />
        <KpiCard
          loading={loading}
          icon={CalendarCheck2}
          iconColor="text-blue-600"
          iconBg="bg-blue-50 dark:bg-blue-500/10"
          label="Hadir Hari Ini"
          value={kpi ? formatNumber(kpi.hadirHariIni) : "-"}
          sublabel={kpi ? `dari ${kpi.pegawaiKerjaHariIni} · ${hadirRatio.toFixed(0)}%` : undefined}
          progress={kpi ? Math.min(100, hadirRatio) : undefined}
          progressColor="bg-blue-500"
        />
        <KpiCard
          loading={loading}
          icon={MapPin}
          iconColor="text-violet-600"
          iconBg="bg-violet-50 dark:bg-violet-500/10"
          label="Titik Periode"
          value={kpi ? formatNumber(kpi.titikPeriode) : "-"}
          sublabel="Periode aktif"
          delta={titikGrowth}
        />
        <KpiCard
          loading={loading}
          icon={Wallet}
          iconColor="text-amber-600"
          iconBg="bg-amber-50 dark:bg-amber-500/10"
          label="Pendapatan Periode"
          value={kpi ? formatCurrency(kpi.pendapatanPeriode) : "-"}
          sublabel="Periode aktif"
          delta={pendapatanGrowth}
          accent
        />
      </div>

      {/* ─── Row 2: Trend (2/3) + Pending (1/3) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend chart */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Tren Pendapatan Harian</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">{period.label}</p>
            </div>
            <Link
              href="/employees/income"
              className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              Lihat detail <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <Skeleton className="w-full h-[260px] rounded-xl" />
          ) : trend.length === 0 ? (
            <EmptyState message="Belum ada data pendapatan di periode ini." />
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.15)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "rgb(100 116 139)" }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "rgb(100 116 139)" }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                    tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}jt` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}rb` : `${v}`)}
                  />
                  <RTooltip
                    cursor={{ stroke: "rgba(99,102,241,0.3)", strokeWidth: 1 }}
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.75rem",
                      fontSize: "11px",
                      padding: "8px 10px",
                    }}
                    labelStyle={{ fontSize: "10px", color: "var(--color-muted-foreground)", marginBottom: 4 }}
                    formatter={(value, name) => {
                      const v = typeof value === "number" ? value : Number(value ?? 0);
                      if (name === "pendapatan") return [formatCurrency(v), "Pendapatan"];
                      return [formatNumber(v), "Titik"];
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="pendapatan"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#grad-rev)"
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Pending approvals */}
        <div className="bg-card rounded-2xl border border-border p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Approval Menunggu</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Perlu tindak lanjut</p>
            </div>
            {totalPending > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-warning/10 text-warning">
                {totalPending}
              </span>
            )}
          </div>

          <div className="space-y-2 flex-1">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="w-full h-14 rounded-xl" />)
            ) : totalPending === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center mb-2">
                  <CalendarCheck2 className="w-5 h-5 text-success" />
                </div>
                <p className="text-xs font-semibold text-foreground">Semua sudah diproses</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Tidak ada approval pending.</p>
              </div>
            ) : (
              pending.map((p) => (
                <Link
                  key={p.type}
                  href={p.href}
                  className={cn(
                    "group flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors",
                    p.count > 0
                      ? "border-border hover:border-primary/40 hover:bg-muted/40"
                      : "border-border/50 opacity-60",
                  )}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${p.color}15`, color: p.color }}
                  >
                    <p.icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{p.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {p.count > 0 ? `${p.count} menunggu approval` : "Tidak ada"}
                    </p>
                  </div>
                  {p.count > 0 && (
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                  )}
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── Row 3: Top Zona + Status Pegawai + Rekrutmen ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top zona */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Top Nama Titik</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Berdasarkan pendapatan</p>
            </div>
            <Link
              href="/employees/income"
              className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              Detail <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <Skeleton className="w-full h-[220px] rounded-xl" />
          ) : zones.length === 0 ? (
            <EmptyState message="Belum ada data titik di periode ini." />
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={zones} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.15)" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "rgb(100 116 139)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}jt` : `${(v / 1_000).toFixed(0)}rb`)}
                  />
                  <YAxis
                    type="category"
                    dataKey="zone_nama"
                    tick={{ fontSize: 10, fill: "rgb(100 116 139)" }}
                    tickLine={false}
                    axisLine={false}
                    width={100}
                  />
                  <RTooltip
                    cursor={{ fill: "rgba(99,102,241,0.06)" }}
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.75rem",
                      fontSize: "11px",
                      padding: "8px 10px",
                    }}
                    formatter={(value, _name, item) => {
                      const v = typeof value === "number" ? value : Number(value ?? 0);
                      const itemPayload = (item as { payload?: ZoneStat })?.payload;
                      const titik = itemPayload?.total_titik ?? 0;
                      return [
                        <div key="v">
                          <div>{formatCurrency(v)}</div>
                          <div className="text-[10px] text-muted-foreground">{formatNumber(titik)} titik</div>
                        </div>,
                        "",
                      ];
                    }}
                  />
                  <Bar dataKey="total_pendapatan" radius={[0, 6, 6, 0]}>
                    {zones.map((z, idx) => (
                      <Cell key={idx} fill={z.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Status pegawai (donut) */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Status Pegawai</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Komposisi tenaga kerja</p>
            </div>
            <Link
              href="/employees"
              className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              Detail <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <Skeleton className="w-full h-[220px] rounded-xl" />
          ) : statusDist.length === 0 ? (
            <EmptyState message="Belum ada data pegawai." />
          ) : (
            <div className="grid grid-cols-2 gap-3 items-center">
              <div className="h-[170px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDist}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={64}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {statusDist.map((s, idx) => (
                        <Cell key={idx} fill={s.color} />
                      ))}
                    </Pie>
                    <RTooltip
                      contentStyle={{
                        backgroundColor: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "0.75rem",
                        fontSize: "11px",
                        padding: "6px 10px",
                      }}
                      formatter={(value) => {
                        const v = typeof value === "number" ? value : Number(value ?? 0);
                        return [formatNumber(v), "Pegawai"];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-[10px] text-muted-foreground">Total</p>
                  <p className="text-xl font-bold text-foreground">
                    {kpi ? formatNumber(kpi.pegawaiTotal) : "-"}
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                {statusDist.map((s) => (
                  <div key={s.status} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-muted-foreground truncate">{s.status}</span>
                    </span>
                    <span className="font-bold text-foreground tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Rekrutmen pipeline */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Pipeline Rekrutmen</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Per status</p>
            </div>
            <Link
              href="/employees/recruitment"
              className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              Detail <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="w-full h-9 rounded-lg" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {recruitment.map((r) => {
                const colorMap: Record<RecruitmentStat["status"], string> = {
                  "Lamaran Masuk": "#3b82f6",
                  "Terpilih": "#8b5cf6",
                  "Training": "#f59e0b",
                  "Diterima": "#10b981",
                  "Ditolak": "#94a3b8",
                };
                const total = recruitment.reduce((s, x) => s + x.count, 0);
                const pct = total > 0 ? (r.count / total) * 100 : 0;
                return (
                  <div key={r.status}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-muted-foreground">{r.status}</span>
                      <span className="font-bold text-foreground tabular-nums">{r.count}</span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: colorMap[r.status] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Row 4: Quick Actions + Recent Activity ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick actions */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <h3 className="text-sm font-bold text-foreground mb-4">Aksi Cepat</h3>
          <div className="grid grid-cols-2 gap-2">
            <QuickAction href="/employees/attendance" label="Absensi" icon={CalendarCheck2} color="#3b82f6" />
            <QuickAction href="/employees/income" label="Input Titik" icon={MapPin} color="#8b5cf6" />
            <QuickAction href="/employees/payroll" label="Penggajian" icon={Wallet} color="#f59e0b" />
            <QuickAction href="/employees/recruitment" label="Rekrutmen" icon={UserPlus} color="#10b981" />
            <QuickAction href="/employees/performance" label="Kinerja" icon={Award} color="#ec4899" />
            <QuickAction href="/employees/legal" label="Legal" icon={Scale} color="#6366f1" />
          </div>
        </div>

        {/* Recent activity */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Aktivitas Terbaru</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Audit log sistem</p>
            </div>
            <Link
              href="/settings/audit-logs"
              className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              Semua <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="w-full h-10 rounded-lg" />)}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState message="Belum ada aktivitas." />
          ) : (
            <ul className="space-y-3">
              {recent.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary-light flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                    {getInitials(a.user_nama || "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-foreground leading-snug">
                      <span className="font-semibold">{a.user_nama || "Sistem"}</span>{" "}
                      <span className="text-muted-foreground">{actionVerb(a.action).toLowerCase()}</span>{" "}
                      <span className="font-medium">{entityLabel(a.entity_type)}</span>
                      {a.entity_label && (
                        <>
                          {" "}
                          <span className="text-muted-foreground">·</span>{" "}
                          <span className="text-muted-foreground italic truncate">{a.entity_label}</span>
                        </>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{relativeTime(a.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ─── Row 5: Pegawai Terbaik ─── */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {/* Header */}
        <div className="relative px-5 py-4 border-b border-border bg-gradient-to-r from-amber-500/[0.06] via-card to-card">
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-amber-400/10 blur-3xl pointer-events-none" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-md shadow-amber-500/30 flex-shrink-0">
                <Trophy className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-foreground">Pegawai Terbaik</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Berdasarkan skor kinerja periode aktif</p>
              </div>
            </div>
            <Link
              href="/employees/performance"
              className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1 flex-shrink-0"
            >
              Lihat semua <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Body */}
        <div className="p-5">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="w-full h-14 rounded-xl" />)}
            </div>
          ) : topPerformers.length === 0 ? (
            <EmptyState message="Belum ada data kinerja di periode ini." />
          ) : (
            <ul className="space-y-2">
              {topPerformers.map((p, idx) => {
                const gradeColor = getGradeColor(p.grade);
                const totalIncident = p.alpha + p.telat + p.manualCount + p.spCount;
                const rankIcon =
                  idx === 0 ? <Trophy className="w-3.5 h-3.5 text-amber-500" />
                  : idx === 1 ? <Medal className="w-3.5 h-3.5 text-slate-400" />
                  : idx === 2 ? <Medal className="w-3.5 h-3.5 text-amber-700" />
                  : null;
                const rankBg =
                  idx === 0 ? "from-amber-400/15 to-orange-400/10 border-amber-400/30"
                  : idx === 1 ? "from-slate-300/15 to-slate-400/10 border-slate-400/25"
                  : idx === 2 ? "from-amber-700/15 to-amber-800/10 border-amber-700/30"
                  : "from-transparent to-transparent border-border";

                return (
                  <li
                    key={p.employee_id}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-gradient-to-r transition-colors hover:bg-muted/30",
                      rankBg,
                    )}
                  >
                    {/* Rank */}
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-card border border-border flex-shrink-0">
                      {rankIcon ?? (
                        <span className="text-[11px] font-bold text-muted-foreground">#{idx + 1}</span>
                      )}
                    </div>

                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0">
                      {getInitials(p.nama)}
                    </div>

                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{p.nama}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {p.jabatanNama}
                        {p.divisionNama && (
                          <>
                            <span className="mx-1 opacity-50">·</span>
                            <span className={cn(p.hasDivisionOverride && "text-primary font-semibold")}>
                              {p.divisionNama}
                            </span>
                            {p.hasDivisionOverride && (
                              <Sparkles className="w-2.5 h-2.5 inline-block ml-0.5 text-primary -mt-0.5" aria-label="Divisi dengan slot reward lebih besar" />
                            )}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Mini stats — hidden di mobile */}
                    <div className="hidden md:flex items-center gap-3 text-[10px] text-muted-foreground">
                      <Stat label="Hadir" value={String(p.hadir)} />
                      <span className="w-px h-4 bg-border" />
                      <Stat label="Insiden" value={String(totalIncident)} accent={totalIncident > 0 ? "warning" : undefined} />
                      <span className="w-px h-4 bg-border" />
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-success tabular-nums">
                        +{p.pointHarian}
                      </span>
                      {p.totalPenalti > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600 bg-rose-500/10 px-1.5 py-0.5 rounded-md tabular-nums">
                          −{p.totalPenalti}
                        </span>
                      )}
                    </div>

                    {/* Point + Grade */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Point</p>
                        <p className="text-base font-bold text-foreground tabular-nums leading-none mt-0.5">{p.totalPoint}<span className="text-[10px] text-muted-foreground font-medium ml-0.5">pt</span></p>
                      </div>
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                        style={{ backgroundColor: gradeColor }}
                      >
                        {p.grade}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ───
interface KpiCardProps {
  loading: boolean;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
  progress?: number;
  progressColor?: string;
  accent?: boolean;
}

function KpiCard({ loading, icon: Icon, iconColor, iconBg, label, value, sublabel, delta, progress, progressColor, accent }: KpiCardProps) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl border bg-card p-5 transition-all hover:shadow-md hover:-translate-y-0.5",
      accent ? "border-primary/30" : "border-border",
    )}>
      {accent && (
        <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
      )}
      <div className="flex items-start justify-between mb-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", iconBg)}>
          <Icon className={cn("w-5 h-5", iconColor)} />
        </div>
        {typeof delta === "number" && (
          <span className={cn(
            "inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md",
            delta >= 0
              ? "text-success bg-success/10"
              : "text-danger bg-danger/10",
          )}>
            {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
      {loading ? (
        <Skeleton className="h-8 w-24 mt-1 rounded-md" />
      ) : (
        <p className="text-2xl font-bold text-foreground mt-0.5 tabular-nums truncate">{value}</p>
      )}
      {sublabel && !loading && (
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sublabel}</p>
      )}
      {typeof progress === "number" && !loading && (
        <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700", progressColor ?? "bg-primary")}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function QuickAction({ href, label, icon: Icon, color }: { href: string; label: string; icon: LucideIcon; color: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border hover:border-primary/40 hover:bg-muted/40 transition-all"
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
        style={{ backgroundColor: `${color}15`, color }}
      >
        <Icon className="w-4 h-4" />
      </div>
      <span className="text-[12px] font-semibold text-foreground truncate">{label}</span>
    </Link>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-2">
        <Activity className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "warning" | "success" }) {
  return (
    <div className="text-center">
      <p className="text-[9px] uppercase tracking-wider font-semibold">{label}</p>
      <p className={cn(
        "text-[12px] font-bold tabular-nums leading-none mt-0.5",
        accent === "warning" ? "text-warning" : accent === "success" ? "text-success" : "text-foreground",
      )}>
        {value}
      </p>
    </div>
  );
}
