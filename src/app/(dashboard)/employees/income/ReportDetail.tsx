"use client";

import { Fragment, useState, useEffect, useCallback, useRef } from "react";
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
  Filter,
  Check,
  CheckCheck,
  RotateCcw,
  ClipboardList,
} from "lucide-react";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import Portal from "@/components/ui/Portal";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn, formatCurrency, formatNumber, localDateStr } from "@/lib/utils";
import { supabase, type DbAttendanceRecord, type DbDeliveryPoint, type NonActivePeriod } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

type DeliveryQueryRow = DbDeliveryPoint & {
  pegawai?: { nama: string | null; tanggal_bergabung: string | null; tanggal_keluar: string | null; non_active_periods: NonActivePeriod[] | null } | null;
  delivery_zones?: { nama: string | null; color: string | null } | null;
  delivery_statuses?: { nama: string | null; kode?: string | null; color: string | null } | null;
};
type QueryError = { message: string };

type ZoneLite = { id: number; nama: string; color: string };
type StatusLite = { id: number; nama: string; kode: string; color: string };

type AttendanceLiteRow = {
  employee_id: string;
  status: DbAttendanceRecord["status"];
  pegawai?: { nama: string | null }[] | null;
};

type ReportDailyDetail = {
  tanggal: string;
  jumlah_titik: number;
  total_pendapatan: number;
  status_nama?: string;
  status_color?: string;
  catatan?: string | null;
};

type ReportRow = {
  employee_id: string;
  employee_nama: string;
  zone_id: number;
  zone_nama: string;
  zone_color: string;
  role: "Driver" | "Helper";
  total_titik: number;
  total_pendapatan: number;
  jumlah_hari: number;
  status_summary: { nama: string; color: string; count: number }[];
  daily_details: ReportDailyDetail[];
};

type ZoneGroup = {
  zone_id: number;
  zone_nama: string;
  zone_color: string;
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

type RingkasanRow = {
  employee_id: string;
  employee_nama: string;
  total_titik: number;
  total_pendapatan: number;
};

type StatusAbsensiRow = {
  employee_id: string;
  employee_nama: string;
  total_titik: number;
  total_pendapatan: number;
  attendance_counts: Record<string, number>;
  delivery_counts: Record<string, number>;
};

/** Status absensi yang ditampilkan di laporan Status & Absensi (urutan tampilan). */
const ABSENSI_STATUSES: readonly { nama: string; color: string }[] = [
  { nama: "Alpha", color: "#6b7280" },
  { nama: "Izin", color: "#3b82f6" },
  { nama: "Cuti", color: "#8b5cf6" },
  { nama: "Sakit", color: "#ef4444" },
] as const;

interface ReportDetailProps {
  show: boolean;
  onClose: () => void;
  zones: ZoneLite[];
  dStatuses: StatusLite[];
}

const CUT_OFF_DAY = 8; // Periode mulai tanggal 8
const DELIVERY_SELECT = "*, pegawai(nama, tanggal_bergabung, tanggal_keluar, non_active_periods), delivery_zones(nama, color), delivery_statuses(nama, kode, color)";
const DELIVERY_FETCH_CHUNK_SIZE = 1000;
const ATTENDANCE_FETCH_CHUNK_SIZE = 1000;

async function fetchAttendanceStatusesInRange(start: string, end: string): Promise<{ data: AttendanceLiteRow[]; error: QueryError | null }> {
  const rows: AttendanceLiteRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("employee_id, status, pegawai(nama)")
      .gte("tanggal", start)
      .lte("tanggal", end)
      .order("tanggal", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + ATTENDANCE_FETCH_CHUNK_SIZE - 1);

    if (error) return { data: rows, error };

    const pageRows = (data || []) as AttendanceLiteRow[];
    rows.push(...pageRows);

    if (pageRows.length < ATTENDANCE_FETCH_CHUNK_SIZE) break;
    from += ATTENDANCE_FETCH_CHUNK_SIZE;
  }

  return { data: rows, error: null };
}

async function fetchDeliveryRowsInRange(start: string, end: string): Promise<{ data: DeliveryQueryRow[]; error: QueryError | null }> {
  const rows: DeliveryQueryRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("delivery_points")
      .select(DELIVERY_SELECT)
      .gte("tanggal", start)
      .lte("tanggal", end)
      .order("tanggal", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + DELIVERY_FETCH_CHUNK_SIZE - 1);

    if (error) return { data: rows, error };

    const pageRows = (data || []) as DeliveryQueryRow[];
    rows.push(...pageRows);

    if (pageRows.length < DELIVERY_FETCH_CHUNK_SIZE) break;
    from += DELIVERY_FETCH_CHUNK_SIZE;
  }

  return { data: rows, error: null };
}

function getPeriodRange(periodKey: string): { start: string; end: string; label: string } {
  const [year, month] = periodKey.split("-").map(Number);
  // Periode: tgl 8 bulan ini → tgl 7 bulan berikutnya
  const startDate = new Date(year, month - 1, CUT_OFF_DAY);
  const endDate = new Date(year, month, CUT_OFF_DAY - 1); // tgl 7 bulan berikutnya
  const start = localDateStr(startDate);
  const end = localDateStr(endDate);
  const label = `${CUT_OFF_DAY} ${startDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })} – ${CUT_OFF_DAY - 1} ${endDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
  return { start, end, label };
}

function getCurrentPeriodKey(): string {
  const now = new Date();
  // Jika hari ini < tgl 8, berarti masih periode bulan lalu
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

function isInNonActivePeriod(dateStr: string, periods: NonActivePeriod[] | null | undefined): boolean {
  if (!periods || periods.length === 0) return false;
  return periods.some((p) => dateStr >= p.from && dateStr <= p.to);
}

function isPegawaiActiveOnDate(
  emp: { tanggal_bergabung?: string | null; tanggal_keluar?: string | null; non_active_periods?: NonActivePeriod[] | null } | null | undefined,
  dateStr: string,
): boolean {
  if (!emp) return true;
  if (emp.tanggal_bergabung && dateStr < emp.tanggal_bergabung) return false;
  if (emp.tanggal_keluar && dateStr >= emp.tanggal_keluar) return false;
  return !isInNonActivePeriod(dateStr, emp.non_active_periods);
}

export default function ReportDetail({ show, onClose, zones, dStatuses }: ReportDetailProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [dateMode, setDateMode] = useState<"periode" | "custom">("periode");
  const [reportTab, setReportTab] = useState<"zona" | "pegawai" | "ringkasan" | "statusabsensi">("zona");

  // Periode mode state
  const [periodKey, setPeriodKey] = useState(getCurrentPeriodKey);

  // Custom mode state
  const [customStart, setCustomStart] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const now = new Date();
    return localDateStr(now);
  });

  // Computed effective dates
  const effectiveDates = dateMode === "periode"
    ? getPeriodRange(periodKey)
    : { start: customStart, end: customEnd, label: "" };
  const startDate = effectiveDates.start;
  const endDate = effectiveDates.end;

  const [search, setSearch] = useState("");
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [zoneGroups, setZoneGroups] = useState<ZoneGroup[]>([]);
  const [employeeGroups, setEmployeeGroups] = useState<EmployeeGroup[]>([]);
  const [ringkasanRows, setRingkasanRows] = useState<RingkasanRow[]>([]);
  const [statusRows, setStatusRows] = useState<StatusAbsensiRow[]>([]);
  const [deliveryStatusColumns, setDeliveryStatusColumns] = useState<{ nama: string; color: string }[]>([]);
  const [expandedDailyKey, setExpandedDailyKey] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [showEmployeeFilter, setShowEmployeeFilter] = useState(false);
  const [draftEmployeeIds, setDraftEmployeeIds] = useState<string[]>([]);
  const [employeeFilterSearch, setEmployeeFilterSearch] = useState("");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  // Grand totals (from all rows, tab-independent)
  const grandTotalTitik = reportRows.reduce((s, r) => s + r.total_titik, 0);
  const grandTotalPendapatan = reportRows.reduce((s, r) => s + r.total_pendapatan, 0);
  const grandTotalPegawai = new Set(reportRows.map((r) => r.employee_id)).size;
  const grandTotalZona = new Set(reportRows.map((r) => r.zone_id)).size;

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

    const [deliveryRes, attendanceRes] = await Promise.all([
      fetchDeliveryRowsInRange(s, e),
      fetchAttendanceStatusesInRange(s, e),
    ]);

    if (deliveryRes.error) {
      setLoading(false);
      return;
    }

    processData(deliveryRes.data, attendanceRes.error ? null : attendanceRes.data);
    setLoading(false);
  }, [dateMode, periodKey, customStart, customEnd]);

  useEffect(() => {
    if (show) fetchReport();
  }, [show, fetchReport]);

  // ─── Load saved employee filter preference ───
  useEffect(() => {
    if (!show || !user) return;
    setPreferencesLoaded(false);
    (async () => {
      const { data } = await supabase
        .from("user_ui_preferences")
        .select("value")
        .eq("user_id", user.id)
        .eq("preference_key", "employees.income.summary.employee_filter")
        .maybeSingle();
      if (data?.value && Array.isArray((data.value as Record<string, unknown>).employeeIds)) {
        setSelectedEmployeeIds((data.value as Record<string, string[]>).employeeIds);
      }
      setPreferencesLoaded(true);
    })();
  }, [show, user]);

  // ─── Save employee filter preference when applied ───
  const saveEmployeeFilter = useCallback(async (ids: string[]) => {
    if (!user) return;
    setPreferencesSaving(true);
    const value = ids.length > 0 ? { employeeIds: ids } : {};
    await supabase
      .from("user_ui_preferences")
      .upsert(
        { user_id: user.id, preference_key: "employees.income.summary.employee_filter", value },
        { onConflict: "user_id, preference_key" },
      );
    setPreferencesSaving(false);
  }, [user]);

  // Close filter popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowEmployeeFilter(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ─── Process raw data into ReportRow[], then group both ways ───
  const processData = (data: DeliveryQueryRow[], attendanceRows: AttendanceLiteRow[] | null) => {
    // Hanya proses baris yang pegawainya aktif pada tanggal tersebut
    const activeData = data.filter((d) => isPegawaiActiveOnDate(d.pegawai, d.tanggal));
    const map = new Map<string, {
      employee_id: string;
      employee_nama: string;
      zone_id: number;
      zone_nama: string;
      zone_color: string;
      role: "Driver" | "Helper";
      total_titik: number;
      total_pendapatan: number;
      dates: Set<string>;
      statuses: Map<string, { nama: string; color: string; count: number }>;
      daily_details: ReportDailyDetail[];
    }>();

    activeData.forEach((d) => {
      const zNama = d.delivery_zones?.nama || "-";
      const zColor = d.delivery_zones?.color || "#3b82f6";
      const empNama = d.pegawai?.nama || d.employee_nama || d.employee_id || "?";
      const empId = d.employee_id || "unknown";
      const zId = d.zone_id;
      const role = d.role;

      const key = `${zId}-${empId}-${role}`;
      if (!map.has(key)) {
        map.set(key, {
          employee_id: empId,
          employee_nama: empNama,
          zone_id: zId,
          zone_nama: zNama,
          zone_color: zColor,
          role,
          total_titik: 0,
          total_pendapatan: 0,
          dates: new Set(),
          statuses: new Map(),
          daily_details: [],
        });
      }

      const entry = map.get(key)!;
      entry.total_titik += d.jumlah_titik;
      entry.total_pendapatan += d.total;
      entry.dates.add(d.tanggal);

      const statusNama = d.delivery_statuses?.nama;
      const statusColor = d.delivery_statuses?.color;
      entry.daily_details.push({
        tanggal: d.tanggal,
        jumlah_titik: d.jumlah_titik,
        total_pendapatan: d.total,
        status_nama: statusNama || undefined,
        status_color: statusColor || undefined,
        catatan: d.catatan || null,
      });
      if (statusNama) {
        const existing = entry.statuses.get(statusNama);
        if (existing) existing.count++;
        else entry.statuses.set(statusNama, { nama: statusNama, color: statusColor || "#6b7280", count: 1 });
      }
    });

    const rows: ReportRow[] = Array.from(map.values()).map((v) => ({
      employee_id: v.employee_id,
      employee_nama: v.employee_nama,
      zone_id: v.zone_id,
      zone_nama: v.zone_nama,
      zone_color: v.zone_color,
      role: v.role,
      total_titik: v.total_titik,
      total_pendapatan: v.total_pendapatan,
      jumlah_hari: v.dates.size,
      status_summary: Array.from(v.statuses.values()),
      daily_details: v.daily_details.sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    }));

    setReportRows(rows);

    // ── Group by Nama Titik ──
    const zoneMap = new Map<number, ZoneGroup>();
    rows.forEach((r) => {
      if (!zoneMap.has(r.zone_id)) {
        zoneMap.set(r.zone_id, {
          zone_id: r.zone_id,
          zone_nama: r.zone_nama,
          zone_color: r.zone_color,
          rows: [],
          subtotal_titik: 0,
          subtotal_pendapatan: 0,
        });
      }
      const group = zoneMap.get(r.zone_id)!;
      group.rows.push(r);
      group.subtotal_titik += r.total_titik;
      group.subtotal_pendapatan += r.total_pendapatan;
    });
    const zGroups = Array.from(zoneMap.values()).sort((a, b) => a.zone_nama.localeCompare(b.zone_nama));
    zGroups.forEach((g) => g.rows.sort((a, b) => a.employee_nama.localeCompare(b.employee_nama)));
    setZoneGroups(zGroups);

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
    eGroups.forEach((g) => g.rows.sort((a, b) => a.zone_nama.localeCompare(b.zone_nama)));
    setEmployeeGroups(eGroups);

    // ── Ringkasan: aggregate by employee (ignore zone & role) ──
    const ringkasanMap = new Map<string, RingkasanRow>();
    activeData.forEach((d) => {
      const empId = d.employee_id || "unknown";
      const empNama = d.pegawai?.nama || d.employee_nama || empId || "?";
      if (!ringkasanMap.has(empId)) {
        ringkasanMap.set(empId, { employee_id: empId, employee_nama: empNama, total_titik: 0, total_pendapatan: 0 });
      }
      const entry = ringkasanMap.get(empId)!;
      entry.total_titik += d.jumlah_titik;
      entry.total_pendapatan += d.total;
    });
    const rRows = Array.from(ringkasanMap.values())
      .sort((a, b) => b.total_pendapatan - a.total_pendapatan || b.total_titik - a.total_titik || a.employee_nama.localeCompare(b.employee_nama));
    setRingkasanRows(rRows);
    setExpandedDailyKey(null);
    buildStatusAbsensi(rows, attendanceRows);
  };

  // ─── Status & Absensi: agregasi per pegawai (riwayat titik ∪ absensi) ───
  const buildStatusAbsensi = (rows: ReportRow[], attendanceRows: AttendanceLiteRow[] | null) => {
    const map = new Map<string, StatusAbsensiRow>();
    rows.forEach((r) => {
      if (!map.has(r.employee_id)) {
        map.set(r.employee_id, {
          employee_id: r.employee_id,
          employee_nama: r.employee_nama,
          total_titik: 0,
          total_pendapatan: 0,
          attendance_counts: {},
          delivery_counts: {},
        });
      }
      const entry = map.get(r.employee_id)!;
      entry.total_titik += r.total_titik;
      entry.total_pendapatan += r.total_pendapatan;
      r.status_summary.forEach((s) => {
        entry.delivery_counts[s.nama] = (entry.delivery_counts[s.nama] || 0) + s.count;
      });
    });

    if (attendanceRows) {
      attendanceRows.forEach((a) => {
        if (!map.has(a.employee_id)) {
          map.set(a.employee_id, {
            employee_id: a.employee_id,
            employee_nama: a.pegawai?.[0]?.nama || a.employee_id || "?",
            total_titik: 0,
            total_pendapatan: 0,
            attendance_counts: {},
            delivery_counts: {},
          });
        }
        const entry = map.get(a.employee_id)!;
        entry.attendance_counts[a.status] = (entry.attendance_counts[a.status] || 0) + 1;
      });
    }

    const saRows = Array.from(map.values()).sort(
      (a, b) => b.total_pendapatan - a.total_pendapatan || b.total_titik - a.total_titik || a.employee_nama.localeCompare(b.employee_nama),
    );
    setStatusRows(saRows);

    // Kolom status titik dinamis: status aktif dulu, lalu status lain yang muncul di data
    const cols: { nama: string; color: string }[] = [];
    const seen = new Set<string>();
    dStatuses.forEach((s) => {
      if (!seen.has(s.nama)) { seen.add(s.nama); cols.push({ nama: s.nama, color: s.color }); }
    });
    rows.forEach((r) =>
      r.status_summary.forEach((s) => {
        if (!seen.has(s.nama)) { seen.add(s.nama); cols.push({ nama: s.nama, color: s.color }); }
      }),
    );
    setDeliveryStatusColumns(cols);
  };

  // ─── Filtered data (search) ───
  const filteredZoneGroups = zoneGroups
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
        r.zone_nama.toLowerCase().includes(search.toLowerCase()) ||
        r.role.toLowerCase().includes(search.toLowerCase()) ||
        g.employee_nama.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((g) => g.rows.length > 0);

  const filteredRingkasanRows = ringkasanRows.filter((r) => {
    if (selectedEmployeeIds.length > 0 && !selectedEmployeeIds.includes(r.employee_id)) return false;
    return r.employee_nama.toLowerCase().includes(search.toLowerCase());
  });

  const filteredStatusRows = statusRows.filter((r) => {
    if (selectedEmployeeIds.length > 0 && !selectedEmployeeIds.includes(r.employee_id)) return false;
    return (
      r.employee_nama.toLowerCase().includes(search.toLowerCase()) ||
      r.employee_id.toLowerCase().includes(search.toLowerCase())
    );
  });

  const filterSourceRows = reportTab === "ringkasan" ? ringkasanRows : statusRows;

  const filteredStatusTotalTitik = filteredStatusRows.reduce((s, r) => s + r.total_titik, 0);
  const filteredStatusTotalPendapatan = filteredStatusRows.reduce((s, r) => s + r.total_pendapatan, 0);

  const filteredTotalTitik = reportTab === "zona"
    ? filteredZoneGroups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.total_titik, 0), 0)
    : reportTab === "pegawai"
    ? filteredEmpGroups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.total_titik, 0), 0)
    : filteredRingkasanRows.reduce((s, r) => s + r.total_titik, 0);
  const filteredTotalPendapatan = reportTab === "zona"
    ? filteredZoneGroups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.total_pendapatan, 0), 0)
    : reportTab === "pegawai"
    ? filteredEmpGroups.reduce((s, g) => s + g.rows.reduce((ss, r) => ss + r.total_pendapatan, 0), 0)
    : filteredRingkasanRows.reduce((s, r) => s + r.total_pendapatan, 0);

  const hasData = reportTab === "zona" ? filteredZoneGroups.length > 0
    : reportTab === "pegawai" ? filteredEmpGroups.length > 0
    : reportTab === "ringkasan" ? filteredRingkasanRows.length > 0
    : filteredStatusRows.length > 0;

  // ─── Totals untuk summary cards & grand total (per tab aktif) ───
  const displayedTotalTitik = reportTab === "ringkasan" ? filteredTotalTitik
    : reportTab === "statusabsensi" ? filteredStatusTotalTitik
    : (search ? filteredTotalTitik : grandTotalTitik);
  const displayedTotalPendapatan = reportTab === "ringkasan" ? filteredTotalPendapatan
    : reportTab === "statusabsensi" ? filteredStatusTotalPendapatan
    : (search ? filteredTotalPendapatan : grandTotalPendapatan);

  // ─── Period text for export ───
  const periodeText = dateMode === "periode"
    ? effectiveDates.label
    : `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;

  // ─── Export CSV ───
  const exportCSV = () => {
    if (reportTab === "zona") exportCSVZona();
    else if (reportTab === "pegawai") exportCSVPegawai();
    else if (reportTab === "ringkasan") exportCSVRingkasan();
    else exportCSVStatusAbsensi();
  };

  const exportCSVZona = () => {
    const headers = ["Nama Titik", "Pegawai", "Posisi", "Total Titik", "Total Pendapatan", "Jumlah Hari", "Status"];
    const csvRows = [headers.join(",")];

    filteredZoneGroups.forEach((g) => {
      g.rows.forEach((r) => {
        const statusStr = r.status_summary.map((s) => `${s.nama}(${s.count})`).join(" ");
        csvRows.push([
          `"${g.zone_nama}"`, `"${r.employee_nama}"`, r.role,
          r.total_titik, r.total_pendapatan, r.jumlah_hari, `"${statusStr}"`,
        ].join(","));
      });
      csvRows.push([
        `"Subtotal ${g.zone_nama}"`, "", "",
        g.rows.reduce((s, r) => s + r.total_titik, 0),
        g.rows.reduce((s, r) => s + r.total_pendapatan, 0), "", "",
      ].join(","));
    });
    csvRows.push([`"GRAND TOTAL"`, "", "", filteredTotalTitik, filteredTotalPendapatan, "", ""].join(","));

    downloadCSV(csvRows, `Rekap_Titik_PerNamaTitik_${startDate}_${endDate}.csv`);
  };

  const exportCSVPegawai = () => {
    const headers = ["Pegawai", "Nama Titik", "Posisi", "Total Titik", "Total Pendapatan", "Jumlah Hari", "Status"];
    const csvRows = [headers.join(",")];

    filteredEmpGroups.forEach((g) => {
      g.rows.forEach((r) => {
        const statusStr = r.status_summary.map((s) => `${s.nama}(${s.count})`).join(" ");
        csvRows.push([
          `"${g.employee_nama}"`, `"${r.zone_nama}"`, r.role,
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

  const exportCSVRingkasan = () => {
    const headers = ["Nama Pegawai", "Total Titik", "Total Pendapatan"];
    const csvRows = [headers.join(",")];

    filteredRingkasanRows.forEach((r) => {
      csvRows.push([`"${r.employee_nama}"`, r.total_titik, r.total_pendapatan].join(","));
    });
    csvRows.push([`"TOTAL"`, filteredRingkasanRows.reduce((s, r) => s + r.total_titik, 0), filteredRingkasanRows.reduce((s, r) => s + r.total_pendapatan, 0)].join(","));

    downloadCSV(csvRows, `Rekap_Titik_Ringkasan_${startDate}_${endDate}.csv`);
  };

  const exportCSVStatusAbsensi = () => {
    const headers = [
      "ID Pegawai", "Pegawai",
      ...ABSENSI_STATUSES.map((s) => s.nama),
      ...deliveryStatusColumns.map((c) => c.nama),
      "Total Titik", "Total Pendapatan",
    ];
    const csvRows = [headers.join(",")];

    filteredStatusRows.forEach((r) => {
      csvRows.push([
        `"${r.employee_id}"`, `"${r.employee_nama}"`,
        ...ABSENSI_STATUSES.map((s) => r.attendance_counts[s.nama] || 0),
        ...deliveryStatusColumns.map((c) => r.delivery_counts[c.nama] || 0),
        r.total_titik, r.total_pendapatan,
      ].join(","));
    });
    csvRows.push([
      `"GRAND TOTAL"`, "",
      ...ABSENSI_STATUSES.map((s) => filteredStatusRows.reduce((sum, r) => sum + (r.attendance_counts[s.nama] || 0), 0)),
      ...deliveryStatusColumns.map((c) => filteredStatusRows.reduce((sum, r) => sum + (r.delivery_counts[c.nama] || 0), 0)),
      filteredStatusTotalTitik, filteredStatusTotalPendapatan,
    ].join(","));

    downloadCSV(csvRows, `Rekap_Status_Absensi_${startDate}_${endDate}.csv`);
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
    if (reportTab === "zona") await exportPDFZona();
    else if (reportTab === "pegawai") await exportPDFPegawai();
    else if (reportTab === "ringkasan") await exportPDFRingkasan();
    else await exportPDFStatusAbsensi();
  };

  const exportPDFZona = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Rekap Titik Per Nama Titik", pageWidth / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${periodeText}`, pageWidth / 2, 21, { align: "center" });

    let startY = 28;

    filteredZoneGroups.forEach((g) => {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`Nama Titik: ${g.zone_nama}`, 14, startY);
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

    doc.save(`Rekap_Titik_PerNamaTitik_${startDate}_${endDate}.pdf`);
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
        idx + 1, r.zone_nama, r.role,
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
        head: [["#", "Nama Titik", "Posisi", "Total Titik", "Total Pendapatan", "Hari Kerja", "Status"]],
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

  const exportPDFRingkasan = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Ringkasan Titik Pegawai", pageWidth / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${periodeText}`, pageWidth / 2, 21, { align: "center" });

    const tableData = filteredRingkasanRows.map((r, idx) => [
      idx + 1, r.employee_nama, formatNumber(r.total_titik), formatCurrency(r.total_pendapatan),
    ]);
    tableData.push([
      "", "TOTAL",
      formatNumber(filteredRingkasanRows.reduce((s, r) => s + r.total_titik, 0)),
      formatCurrency(filteredRingkasanRows.reduce((s, r) => s + r.total_pendapatan, 0)),
    ]);

    autoTable(doc, {
      startY: 28,
      head: [["#", "Pegawai", "Total Titik", "Total Pendapatan"]],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [16, 185, 129], fontSize: 9, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { halign: "center", cellWidth: 10 },
        2: { halign: "right", cellWidth: 30 },
        3: { halign: "right", cellWidth: 45 },
      },
      didParseCell: (data) => {
        if (data.row.index === tableData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [243, 244, 246];
        }
      },
      margin: { left: 14, right: 14 },
    });

    doc.save(`Rekap_Titik_Ringkasan_${startDate}_${endDate}.pdf`);
    setShowExportMenu(false);
  };

  const exportPDFStatusAbsensi = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Status & Absensi Pegawai", pageWidth / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${periodeText}`, pageWidth / 2, 21, { align: "center" });

    const headRow1: { content: string; rowSpan?: number; colSpan?: number; styles?: { halign?: "left" | "center" | "right" } }[] = [
      { content: "#", rowSpan: 2, styles: { halign: "center" } },
      { content: "ID Pegawai", rowSpan: 2 },
      { content: "Pegawai", rowSpan: 2 },
      { content: "Jumlah Absensi (hari)", colSpan: ABSENSI_STATUSES.length, styles: { halign: "center" } },
      { content: "Status Rekap Titik (hari)", colSpan: deliveryStatusColumns.length, styles: { halign: "center" } },
      { content: "Total Titik", rowSpan: 2, styles: { halign: "right" } },
      { content: "Total Pendapatan", rowSpan: 2, styles: { halign: "right" } },
    ];
    const headRow2: { content: string; styles: { halign?: "left" | "center" | "right" } }[] = [
      ...ABSENSI_STATUSES.map((s) => ({ content: s.nama, styles: { halign: "center" as const } })),
      ...deliveryStatusColumns.map((c) => ({ content: c.nama, styles: { halign: "center" as const } })),
    ];

    const tableData = filteredStatusRows.map((r, idx) => [
      String(idx + 1), r.employee_id, r.employee_nama,
      ...ABSENSI_STATUSES.map((s) => String(r.attendance_counts[s.nama] || 0)),
      ...deliveryStatusColumns.map((c) => String(r.delivery_counts[c.nama] || 0)),
      formatNumber(r.total_titik), formatCurrency(r.total_pendapatan),
    ]);
    tableData.push([
      "", "GRAND", "TOTAL",
      ...ABSENSI_STATUSES.map((s) => String(filteredStatusRows.reduce((sum, r) => sum + (r.attendance_counts[s.nama] || 0), 0))),
      ...deliveryStatusColumns.map((c) => String(filteredStatusRows.reduce((sum, r) => sum + (r.delivery_counts[c.nama] || 0), 0))),
      formatNumber(filteredStatusTotalTitik), formatCurrency(filteredStatusTotalPendapatan),
    ]);

    autoTable(doc, {
      startY: 28,
      head: [headRow1, headRow2],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [139, 92, 246], fontSize: 7, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        0: { halign: "center", cellWidth: 8 },
        4: { halign: "center", cellWidth: 12 },
      },
      didParseCell: (data) => {
        if (data.row.index === tableData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [243, 244, 246];
        }
      },
      margin: { left: 10, right: 10 },
    });

    doc.save(`Rekap_Status_Absensi_${startDate}_${endDate}.pdf`);
    setShowExportMenu(false);
  };

  if (!show) return null;

  return (
    <Portal>
      <style>{`
        @media (max-width: 639px) {
          .mobile-zoom-inner { width: 100%; zoom: 0.5; }
          .mobile-zoom-inner .break-words { overflow-wrap: break-word; word-break: break-word; }
        }
      `}</style>
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
                {reportTab === "zona" ? "Rekap titik per nama titik" : reportTab === "pegawai" ? "Rekap titik per pegawai" : reportTab === "ringkasan" ? "Ringkasan total per pegawai" : "Rekap jumlah absensi & status titik per pegawai"} dalam periode tertentu
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
        <div className="px-3 sm:px-5 py-3 border-b border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Report tab toggle */}
            <div className="flex items-center bg-muted rounded-xl p-0.5">
              <button
                onClick={() => setReportTab("zona")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                  reportTab === "zona"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Hash className="w-3 h-3" />
                <span className="hidden xs:inline">Per </span>Nama Titik
              </button>
              <button
                onClick={() => setReportTab("pegawai")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                  reportTab === "pegawai"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <User className="w-3 h-3" />
                <span className="hidden xs:inline">Per </span>Pegawai
              </button>
              <button
                onClick={() => setReportTab("ringkasan")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                  reportTab === "ringkasan"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <TrendingUp className="w-3 h-3" />
                Ringkasan
              </button>
              <button
                onClick={() => setReportTab("statusabsensi")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                  reportTab === "statusabsensi"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ClipboardList className="w-3 h-3" />
                <span className="hidden xs:inline">Status &amp; </span>Absensi
              </button>
            </div>

            <div className="h-6 w-px bg-border hidden sm:block" />

            {/* Date mode toggle */}
            <div className="flex items-center bg-muted rounded-xl p-0.5">
              <button
                onClick={() => setDateMode("periode")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
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
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
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
              <div className="flex items-center gap-1 bg-muted rounded-xl p-1 w-full sm:w-auto">
                <button
                  onClick={() => {
                    const [y, m] = periodKey.split("-").map(Number);
                    const prev = new Date(y, m - 2, 1);
                    setPeriodKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
                  }}
                  className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="px-3 py-1 text-center flex-1 sm:min-w-[240px]">
                  <p className="text-xs font-bold text-foreground">{effectiveDates.label}</p>
                </div>
                <button
                  onClick={() => {
                    const [y, m] = periodKey.split("-").map(Number);
                    const next = new Date(y, m, 1);
                    setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
                  }}
                  className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Custom mode: date pickers */}
            {dateMode === "custom" && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Dari</span>
                </div>
                <div className="w-full sm:w-44">
                  <DatePicker value={customStart} onChange={setCustomStart} placeholder="Tanggal mulai" />
                </div>
                <span className="text-xs text-muted-foreground hidden sm:inline">s/d</span>
                <div className="w-full sm:w-44">
                  <DatePicker value={customEnd} onChange={setCustomEnd} placeholder="Tanggal akhir" />
                </div>
              </div>
            )}

            <div className="h-6 w-px bg-border hidden sm:block" />

            {/* Employee filter (Ringkasan & Status Absensi) */}
            {(reportTab === "ringkasan" || reportTab === "statusabsensi") && (
              <div ref={filterRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setDraftEmployeeIds([...selectedEmployeeIds]);
                    setEmployeeFilterSearch("");
                    setShowEmployeeFilter(!showEmployeeFilter);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap border",
                    selectedEmployeeIds.length > 0
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted text-muted-foreground border-border hover:text-foreground"
                  )}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">
                    {selectedEmployeeIds.length > 0 ? `${selectedEmployeeIds.length} pegawai` : "Semua Pegawai"}
                  </span>
                </button>

                {showEmployeeFilter && (
                  <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-72 sm:w-80 bg-card rounded-xl border border-border shadow-xl z-20 overflow-hidden animate-scale-in">
                    <div className="p-3 border-b border-border">
                      <div className="flex items-center gap-2 bg-muted rounded-lg px-2.5 py-1.5">
                        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <input
                          type="text"
                          placeholder="Cari pegawai..."
                          value={employeeFilterSearch}
                          onChange={(e) => setEmployeeFilterSearch(e.target.value)}
                          className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/50 text-foreground"
                        />
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-border/50">
                      {filterSourceRows
                        .filter((r) => r.employee_nama.toLowerCase().includes(employeeFilterSearch.toLowerCase()))
                        .map((r) => (
                          <label
                            key={r.employee_id}
                            className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={draftEmployeeIds.includes(r.employee_id)}
                              onChange={() => {
                                setDraftEmployeeIds((prev) =>
                                  prev.includes(r.employee_id)
                                    ? prev.filter((id) => id !== r.employee_id)
                                    : [...prev, r.employee_id]
                                );
                              }}
                              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                            />
                            <span className="text-xs font-medium text-foreground break-words min-w-0 flex-1">{r.employee_nama}</span>
                          </label>
                        ))}
                      {filterSourceRows.filter((r) => r.employee_nama.toLowerCase().includes(employeeFilterSearch.toLowerCase())).length === 0 && (
                        <div className="px-3.5 py-6 text-center text-xs text-muted-foreground">
                          Tidak ada pegawai yang cocok
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 p-3 border-t border-border bg-muted/20">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftEmployeeIds([]);
                          setEmployeeFilterSearch("");
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reset
                      </button>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setShowEmployeeFilter(false);
                          }}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setSelectedEmployeeIds(draftEmployeeIds);
                            await saveEmployeeFilter(draftEmployeeIds);
                            setShowEmployeeFilter(false);
                          }}
                          disabled={preferencesSaving}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {preferencesSaving ? "Menyimpan..." : "Terapkan"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Search */}
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[150px] sm:min-w-[200px] max-w-full sm:max-w-[320px] w-full sm:w-auto">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                placeholder={reportTab === "zona" ? "Cari pegawai..." : reportTab === "pegawai" ? "Cari pegawai atau nama titik..." : reportTab === "ringkasan" ? "Cari pegawai..." : "Cari pegawai..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/50 text-foreground"
              />
            </div>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="hidden sm:block px-3 sm:px-5 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto pb-1 sm:pb-0">
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-border">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Wallet className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Total Pendapatan</p>
                <p className="text-sm font-bold text-foreground">{loading ? "..." : formatCurrency(displayedTotalPendapatan)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-border">
              <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-success" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Total Titik</p>
                <p className="text-sm font-bold text-foreground">{loading ? "..." : formatNumber(displayedTotalTitik)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-border">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Pegawai</p>
                <p className="text-sm font-bold text-foreground">{loading ? "..." : reportTab === "statusabsensi" ? statusRows.length : grandTotalPegawai}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-border">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-medium">Nama Titik</p>
                <p className="text-sm font-bold text-foreground">{loading ? "..." : grandTotalZona}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Report Content ── */}
        <div className="flex-1 overflow-auto px-2 sm:px-5 py-4">
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
              <p className="text-sm text-muted-foreground">
                {(reportTab === "ringkasan" || reportTab === "statusabsensi") && selectedEmployeeIds.length > 0
                  ? "Tidak ada data yang cocok dengan filter pegawai"
                  : "Tidak ada data untuk periode ini"}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">Coba ubah rentang tanggal atau kata kunci pencarian</p>
            </div>
          ) : reportTab === "zona" ? (
            /* ═══ TAB: PER NAMA TITIK ═══ */
            <div className="space-y-6">
              {filteredZoneGroups.map((group) => (
                <div key={group.zone_id} className="bg-card rounded-2xl border border-border overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-2 sm:px-5 py-2 sm:py-3 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.zone_color }} />
                      <h3 className="text-sm font-bold text-foreground">{group.zone_nama}</h3>
                      <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-medium whitespace-nowrap">
                        {group.rows.length} pegawai
                      </span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs">
                      <span className="text-muted-foreground whitespace-nowrap">
                        Titik: <strong className="text-foreground">{formatNumber(group.rows.reduce((s, r) => s + r.total_titik, 0))}</strong>
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        Pendapatan: <strong className="text-foreground">{formatCurrency(group.rows.reduce((s, r) => s + r.total_pendapatan, 0))}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="overflow-hidden sm:overflow-x-auto">
                    <div className="mobile-zoom-inner">
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
                            <td className="px-5 py-3"><p className="text-sm font-semibold text-foreground break-words">{row.employee_nama}</p></td>
                            <td className="px-5 py-3 text-center">
                              <span className={cn("text-[10px] font-bold px-2.5 py-1 rounded-lg",
                                row.role === "Driver" ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" : "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400"
                              )}>{row.role}</span>
                            </td>
                            <td className="px-5 py-3 text-right text-sm font-bold text-foreground">{formatNumber(row.total_titik)}</td>
                            <td className="px-5 py-3 text-right text-sm font-semibold text-foreground">{formatCurrency(row.total_pendapatan)}</td>
                            <td className="px-5 py-3 text-center text-sm text-foreground">{row.jumlah_hari}</td>
                            <td className="px-5 py-3 break-words">
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
                            <span className="text-xs font-bold text-muted-foreground">Subtotal {group.zone_nama}</span>
                          </td>
                          <td className="px-5 py-2.5 text-right text-sm font-bold text-primary">{formatNumber(group.rows.reduce((s, r) => s + r.total_titik, 0))}</td>
                          <td className="px-5 py-2.5 text-right text-sm font-bold text-primary">{formatCurrency(group.rows.reduce((s, r) => s + r.total_pendapatan, 0))}</td>
                          <td className="px-5 py-2.5" colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
              ))}

              {/* Grand Total */}
              <GrandTotalCard
                totalTitik={search ? filteredTotalTitik : grandTotalTitik}
                totalPendapatan={search ? filteredTotalPendapatan : grandTotalPendapatan}
              />
            </div>
          ) : reportTab === "pegawai" ? (
            /* ═══ TAB: PER PEGAWAI ═══ */
            <div className="space-y-6">
              {filteredEmpGroups.map((group) => (
                <div key={group.employee_id} className="bg-card rounded-2xl border border-border overflow-hidden">
                  {/* Employee Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-2 sm:px-5 py-2 sm:py-3 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <h3 className="text-sm font-bold text-foreground">{group.employee_nama}</h3>
                      <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-medium whitespace-nowrap">
                        {group.rows.length} nama titik
                      </span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs">
                      <span className="text-muted-foreground whitespace-nowrap">
                        Titik: <strong className="text-foreground">{formatNumber(group.subtotal_titik)}</strong>
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        Pendapatan: <strong className="text-foreground">{formatCurrency(group.subtotal_pendapatan)}</strong>
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        Hari: <strong className="text-foreground">{group.total_hari}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-hidden sm:overflow-x-auto">
                    <div className="mobile-zoom-inner">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-10">#</th>
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Nama Titik</th>
                          <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-24">Posisi</th>
                          <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-28">Total Titik</th>
                          <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-36">Total Pendapatan</th>
                          <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-24">Hari Kerja</th>
                          <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-36">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {group.rows.map((row, idx) => {
                          const dailyKey = `${group.employee_id}-${row.zone_id}-${row.role}`;
                          const isExpanded = expandedDailyKey === dailyKey;

                          return (
                            <Fragment key={`${row.zone_id}-${row.role}`}>
                              <tr className="hover:bg-muted/30 transition-colors">
                                <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                                <td className="px-5 py-3">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedDailyKey(isExpanded ? null : dailyKey)}
                                    className="flex items-center gap-2 rounded-lg text-left text-sm font-semibold text-foreground hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    aria-expanded={isExpanded}
                                  >
                                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.zone_color }} />
                                    <span className="break-words">{row.zone_nama}</span>
                                    <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-180 text-primary")} />
                                  </button>
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
                              {isExpanded && (
                                <tr className="bg-primary/[0.03]">
                                  <td colSpan={7} className="px-5 py-3">
                                    <div className="rounded-xl border border-border bg-card overflow-hidden animate-fade-in">
                                      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/20">
                                        <div className="flex items-center gap-2">
                                          <Calendar className="w-3.5 h-3.5 text-primary" />
                                          <p className="text-xs font-bold text-foreground">Detail tanggal {row.zone_nama}</p>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">{row.daily_details.length} hari</p>
                                      </div>
                                      <div className="sm:overflow-x-auto">
                                        <table className="w-full">
                                          <thead>
                                            <tr className="border-b border-border/70 bg-muted/10">
                                              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2">Tanggal</th>
                                              <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-24">Titik</th>
                                              <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-36">Pendapatan</th>
                                              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-32">Status</th>
                                              <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2">Catatan</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-border/50">
                                            {row.daily_details.map((detail, detailIdx) => (
                                              <tr key={`${detail.tanggal}-${detailIdx}`}>
                                                <td className="px-4 py-2 text-xs font-medium text-foreground break-words">{formatDisplayDate(detail.tanggal)}</td>
                                                <td className="px-4 py-2 text-right text-xs font-bold text-foreground whitespace-nowrap">{formatNumber(detail.jumlah_titik)}</td>
                                                <td className="px-4 py-2 text-right text-xs font-semibold text-foreground whitespace-nowrap">{formatCurrency(detail.total_pendapatan)}</td>
                                                <td className="px-4 py-2 break-words">
                                                  {detail.status_nama ? (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${detail.status_color || "#6b7280"}20`, color: detail.status_color || "#6b7280" }}>
                                                      {detail.status_nama}
                                                    </span>
                                                  ) : <span className="text-xs text-muted-foreground italic">-</span>}
                                                </td>
                                                <td className="px-4 py-2 text-xs text-muted-foreground break-words">{detail.catatan || <span className="italic">-</span>}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
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
                </div>
              ))}

              {/* Grand Total */}
              <GrandTotalCard
                totalTitik={search ? filteredTotalTitik : grandTotalTitik}
                totalPendapatan={search ? filteredTotalPendapatan : grandTotalPendapatan}
              />
            </div>
          ) : reportTab === "ringkasan" ? (
            /* ═══ TAB: RINGKASAN ═══ */
            <div className="space-y-4">
              <div className="bg-card rounded-2xl border border-border overflow-hidden">
                <div className="overflow-hidden sm:overflow-x-auto">
                  <div className="mobile-zoom-inner">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-10">#</th>
                        <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Pegawai</th>
                        <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-28">Total Titik</th>
                        <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-44">Total Pendapatan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {filteredRingkasanRows.map((row, idx) => (
                        <tr key={row.employee_id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-5 py-3"><p className="text-sm font-semibold text-foreground">{row.employee_nama}</p></td>
                          <td className="px-5 py-3 text-right text-sm font-bold text-foreground tabular-nums">{formatNumber(row.total_titik)}</td>
                          <td className="px-5 py-3 text-right text-sm font-semibold text-foreground tabular-nums">{formatCurrency(row.total_pendapatan)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>

              {/* Grand Total */}
              <GrandTotalCard
                totalTitik={filteredTotalTitik}
                totalPendapatan={filteredTotalPendapatan}
              />
            </div>
          ) : (
            /* ═══ TAB: STATUS & ABSENSI ═══ */
            <div className="space-y-4">
              <div className="bg-card rounded-2xl border border-border overflow-hidden">
                <div className="overflow-hidden sm:overflow-x-auto">
                  <div className="mobile-zoom-inner">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          <th rowSpan={2} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-10">#</th>
                          <th rowSpan={2} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">ID Pegawai</th>
                          <th rowSpan={2} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Pegawai</th>
                          <th colSpan={ABSENSI_STATUSES.length} className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2.5 border-l border-border">
                            Jumlah Absensi (hari)
                          </th>
                          <th colSpan={deliveryStatusColumns.length} className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2.5 border-l border-border">
                            Status Rekap Titik (hari)
                          </th>
                          <th rowSpan={2} className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-28 whitespace-nowrap">Total Titik</th>
                          <th rowSpan={2} className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-36 whitespace-nowrap">Total Pendapatan</th>
                        </tr>
                        <tr className="border-b border-border bg-muted/20">
                          {ABSENSI_STATUSES.map((s) => (
                            <th key={s.nama} className="text-center text-[10px] font-bold px-3 py-2 border-l border-border" style={{ color: s.color }}>
                              {s.nama}
                            </th>
                          ))}
                          {deliveryStatusColumns.map((c) => (
                            <th key={c.nama} className="text-center text-[10px] font-bold px-3 py-2 border-l border-border" style={{ color: c.color }}>
                              {c.nama}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {filteredStatusRows.map((row, idx) => (
                          <tr key={row.employee_id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="px-3 py-3 text-xs text-muted-foreground font-mono break-all">{row.employee_id}</td>
                            <td className="px-5 py-3"><p className="text-sm font-semibold text-foreground break-words whitespace-nowrap">{row.employee_nama}</p></td>
                            {ABSENSI_STATUSES.map((s) => {
                              const c = row.attendance_counts[s.nama] || 0;
                              return (
                                <td key={s.nama} className="px-3 py-3 text-center text-sm tabular-nums" style={c > 0 ? { color: s.color, fontWeight: 700 } : undefined}>
                                  {c > 0 ? c : <span className="text-muted-foreground/40">-</span>}
                                </td>
                              );
                            })}
                            {deliveryStatusColumns.map((c) => {
                              const n = row.delivery_counts[c.nama] || 0;
                              return (
                                <td key={c.nama} className="px-3 py-3 text-center text-sm tabular-nums" style={n > 0 ? { color: c.color, fontWeight: 700 } : undefined}>
                                  {n > 0 ? n : <span className="text-muted-foreground/40">-</span>}
                                </td>
                              );
                            })}
                            <td className="px-5 py-3 text-right text-sm font-bold text-foreground tabular-nums">{formatNumber(row.total_titik)}</td>
                            <td className="px-5 py-3 text-right text-sm font-semibold text-foreground tabular-nums">{formatCurrency(row.total_pendapatan)}</td>
                          </tr>
                        ))}
                        <tr className="bg-muted/40 font-semibold">
                          <td className="px-5 py-2.5" colSpan={3}>
                            <span className="text-xs font-bold text-muted-foreground">Total</span>
                          </td>
                          {ABSENSI_STATUSES.map((s) => {
                            const c = filteredStatusRows.reduce((sum, r) => sum + (r.attendance_counts[s.nama] || 0), 0);
                            return (
                              <td key={`t-${s.nama}`} className="px-3 py-2.5 text-center text-sm font-bold tabular-nums" style={{ color: s.color }}>
                                {c > 0 ? c : <span className="text-muted-foreground/40">-</span>}
                              </td>
                            );
                          })}
                          {deliveryStatusColumns.map((c) => {
                            const n = filteredStatusRows.reduce((sum, r) => sum + (r.delivery_counts[c.nama] || 0), 0);
                            return (
                              <td key={`t-${c.nama}`} className="px-3 py-2.5 text-center text-sm font-bold tabular-nums" style={{ color: c.color }}>
                                {n > 0 ? n : <span className="text-muted-foreground/40">-</span>}
                              </td>
                            );
                          })}
                          <td className="px-5 py-2.5 text-right text-sm font-bold text-primary tabular-nums">{formatNumber(filteredStatusTotalTitik)}</td>
                          <td className="px-5 py-2.5 text-right text-sm font-bold text-primary tabular-nums">{formatCurrency(filteredStatusTotalPendapatan)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Grand Total */}
              <GrandTotalCard
                totalTitik={filteredStatusTotalTitik}
                totalPendapatan={filteredStatusTotalPendapatan}
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 sm:px-5 py-3 sm:py-4 gap-2 sm:gap-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
          </div>
          <span className="text-xs sm:text-sm font-bold text-foreground">Grand Total</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-6">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground font-medium">Total Titik</p>
            <p className="text-sm sm:text-lg font-bold text-primary">{formatNumber(totalTitik)}</p>
          </div>
          <div className="h-6 sm:h-8 w-px bg-border" />
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground font-medium">Total Pendapatan</p>
            <p className="text-sm sm:text-lg font-bold text-primary">{formatCurrency(totalPendapatan)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
