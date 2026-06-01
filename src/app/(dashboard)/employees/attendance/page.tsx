"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ClipboardCheck, Plus, Search, Pencil, Trash2, X, Check, CircleCheckBig, AlertTriangle,
  ChevronLeft, ChevronRight, ChevronUp, Download, FileText, ChevronDown, Clock, User,
  CalendarOff, ArrowRightLeft, UserCheck, LayoutList, CalendarDays, Calendar, Eye,
  BarChart3, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Filter, Trophy, Users,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase, type DbAttendanceRecord } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type EmployeeLite = { id: string; nama: string; status: string; tanggal_bergabung: string | null; tanggal_keluar: string | null };
type OffDayEntry = { employee_id: string; day_of_week: number };
type OverrideEntry = { id: number; employee_id: string; tanggal: string; type: "libur" | "masuk"; catatan: string | null };
type DivisionLite = { id: number; nama: string; color: string };
type ScheduleLite = { division_id: number; jam_masuk: string; toleransi_menit: number; awal_absen_menit: number };
type PenaltyLite = { division_id: number; denda_per_menit: number; batas_menit: number; denda_maksimum: number; denda_alpha: number };
type AttendanceRow = DbAttendanceRecord & {
  employeeNama?: string;
  divisionNama?: string;
  divisionColor?: string;
};

const PAGE_SIZE = 15;
const SUMMARY_PAGE_SIZE = 15;
const SUMMARY_CUT_OFF_DAY = 8;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

function getSummaryPeriodRange(periodKey: string): { start: string; end: string; label: string } {
  const [year, month] = periodKey.split("-").map(Number);
  const startDate = new Date(year, month - 1, SUMMARY_CUT_OFF_DAY);
  const endDate = new Date(year, month, SUMMARY_CUT_OFF_DAY - 1);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  const label = `${SUMMARY_CUT_OFF_DAY} ${startDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })} – ${SUMMARY_CUT_OFF_DAY - 1} ${endDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
  return { start, end, label };
}

function getSummaryCurrentPeriodKey(): string {
  const now = new Date();
  if (now.getDate() < SUMMARY_CUT_OFF_DAY) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_OPTIONS = [
  { value: "Hadir", label: "Hadir", color: "#10b981" },
  { value: "Terlambat", label: "Terlambat", color: "#f59e0b" },
  { value: "Izin", label: "Izin", color: "#3b82f6" },
  { value: "Sakit", label: "Sakit", color: "#ef4444" },
  { value: "Alpha", label: "Alpha", color: "#6b7280" },
  { value: "Libur", label: "Libur", color: "#8b5cf6" },
  { value: "Cuti", label: "Cuti", color: "#8b5cf6" },
];

// Status yang tidak perlu jam masuk
const NO_JAM_STATUSES = ["Izin", "Sakit", "Alpha", "Libur", "Cuti"];

// Status yang bisa dipilih manual di form input (Izin/Sakit/Cuti lewat pengajuan)
const MANUAL_SPECIAL = ["Alpha"];
const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MIN_DATE = "2026-05-08"; // Tanggal mulai sistem HRM

type PublicHoliday = {
  id: number;
  nama: string;
  tanggal: string;
  tanggal_selesai: string | null;
  kategori: "Nasional" | "Cuti Bersama" | "Spesial";
  catatan: string | null;
  berlaku_untuk: "semua" | "divisi" | "pegawai";
  divisi_ids: number[] | null;
  pegawai_ids: string[] | null;
  created_at: string;
};

const HOLIDAY_COLORS: Record<string, string> = {
  Nasional: "#3b82f6",
  "Cuti Bersama": "#f59e0b",
  Spesial: "#8b5cf6",
};

/** Get local date string YYYY-MM-DD (timezone safe) */
function localDateStr(d?: Date): string {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Add/subtract days from YYYY-MM-DD string (timezone safe) */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const result = localDateStr(dt);
  // Clamp: tidak bisa mundur sebelum MIN_DATE
  if (result < MIN_DATE) return MIN_DATE;
  return result;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function computeLateness(jamMasuk: string, scheduleJamMasuk: string, toleransi: number): { status: "Hadir" | "Terlambat"; durasi: number } {
  const actual = timeToMinutes(jamMasuk);
  const scheduled = timeToMinutes(scheduleJamMasuk);
  const diff = actual - scheduled;
  if (diff <= toleransi) return { status: "Hadir", durasi: 0 };
  return { status: "Terlambat", durasi: diff - toleransi };
}

/** Hitung denda: Rp per menit jika telat <= batas, flat denda_maksimum jika > batas */
function computeDenda(durasiTelat: number, penalty: PenaltyLite | undefined): number {
  if (durasiTelat <= 0) return 0;
  const dendaPerMenit = penalty?.denda_per_menit ?? 3000;
  const batasMenit = penalty?.batas_menit ?? 20;
  const dendaMaksimum = penalty?.denda_maksimum ?? 60000;
  if (durasiTelat > batasMenit) return dendaMaksimum;
  return durasiTelat * dendaPerMenit;
}

/** Format jam HH:MM dari total menit (0–1439) */
function minutesToTime(total: number): string {
  const safe = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Batas telat = jam_masuk_jadwal + toleransi_menit (HH:MM). NULL kalau jadwal kosong. */
function getDeadlineTime(scheduleJamMasuk: string | null | undefined, toleransi: number | null | undefined): string | null {
  if (!scheduleJamMasuk) return null;
  const base = timeToMinutes(scheduleJamMasuk.slice(0, 5));
  return minutesToTime(base + (toleransi ?? 0));
}

/** Hitung denda alpha */
function computeDendaAlpha(penalty: PenaltyLite | undefined): number {
  return penalty?.denda_alpha ?? 100000;
}

export default function AttendancePage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("attendance");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"tabel" | "kalender" | "ringkasan">("tabel");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Semua");

  const [dateFilter, setDateFilter] = useState(() => localDateStr());

  // Kalender state (periode 8 bulan ini - 7 bulan berikutnya)
  const calcCalPeriodKey = useCallback((refDate?: string) => {
    const ref = refDate || localDateStr();
    const [y, m, d] = ref.split("-").map(Number);
    if (d < 8) {
      const prev = new Date(y, m - 2, 1);
      return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    }
    return `${y}-${String(m).padStart(2, "0")}`;
  }, []);
  const [calPeriodKey, setCalPeriodKey] = useState(() => calcCalPeriodKey());
  const [calRecords, setCalRecords] = useState<AttendanceRow[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calSearch, setCalSearch] = useState("");

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [divisions, setDivisions] = useState<DivisionLite[]>([]);
  const [schedules, setSchedules] = useState<ScheduleLite[]>([]);
  const [penalties, setPenalties] = useState<PenaltyLite[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [offDays, setOffDays] = useState<OffDayEntry[]>([]);
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
  const [publicHolidays, setPublicHolidays] = useState<PublicHoliday[]>([]);

  // ─── Add/Edit Form ───
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const ALASAN_MANUAL_OPTIONS = [
    "Lupa ID Card",
    "HP Rusak/Mati",
    "Aplikasi Error",
    "Tidak Ada Sinyal",
    "ID Card Hilang",
    "Baterai HP Habis",
    "Lainnya",
  ];
  const [form, setForm] = useState({
    employee_id: "", division_id: 0, tanggal: "", jam_masuk: "",
    specialStatus: "" as "" | "Izin" | "Sakit" | "Alpha" | "Cuti" | "Libur", catatan: "",
    alasan_manual: "",
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formExistingEmpIds, setFormExistingEmpIds] = useState<Set<string>>(new Set());

  // Off day setting modal
  const [showOffDay, setShowOffDay] = useState(false);
  const [offDaySearch, setOffDaySearch] = useState("");
  const [offDaySaving, setOffDaySaving] = useState(false);
  const [offDayLocal, setOffDayLocal] = useState<Map<string, Set<number>>>(new Map());
  const [offDayProgress, setOffDayProgress] = useState<{ step: number; total: number; label: string } | null>(null);
  const [offDayTab, setOffDayTab] = useState<"mingguan" | "custom" | "libur">("mingguan");
  // Holiday form state
  const [holidayForm, setHolidayForm] = useState({
    nama: "", tanggal: "", tanggal_selesai: "", kategori: "Nasional" as PublicHoliday["kategori"],
    catatan: "", berlaku_untuk: "semua" as "semua" | "divisi" | "pegawai",
    divisi_ids: [] as number[], pegawai_ids: [] as string[],
  });
  const [holidayEmpSearch, setHolidayEmpSearch] = useState("");
  // List filter & pagination
  const [holidayListSearch, setHolidayListSearch] = useState("");
  const [holidayKategoriFilter, setHolidayKategoriFilter] = useState<"Semua" | PublicHoliday["kategori"]>("Semua");
  const [holidayListPage, setHolidayListPage] = useState(1);
  const HOLIDAY_PAGE_SIZE = 10;
  // Detail modal
  const [detailHoliday, setDetailHoliday] = useState<PublicHoliday | null>(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [detailPage, setDetailPage] = useState(1);
  const DETAIL_PAGE_SIZE = 15;
  const [editingHolidayId, setEditingHolidayId] = useState<number | null>(null);
  const [holidaySaving, setHolidaySaving] = useState(false);
  const [holidayError, setHolidayError] = useState("");
  // Custom override form
  const [overrideEmpId, setOverrideEmpId] = useState("");
  const [overrideTanggal, setOverrideTanggal] = useState("");
  const [overrideType, setOverrideType] = useState<"libur" | "masuk">("libur");
  const [overrideCatatan, setOverrideCatatan] = useState("");
  const [overrideSaving, setOverrideSaving] = useState(false);

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; nama: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Export
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Toast
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => { return () => { if (toastTimer.current) clearTimeout(toastTimer.current); }; }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExportMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (showForm || showOffDay || viewMode === "kalender") document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm, showOffDay, viewMode]);

  // ─── Fetch ───
  const fetchEmployees = async () => {
    // Include pegawai Aktif + pegawai Tidak Aktif yang punya tanggal_keluar >= MIN_DATE.
    // Pegawai Tidak Aktif tanpa tanggal_keluar (data lama) di-skip — admin perlu backfill manual
    // kalau mereka memang relevan untuk periode aktif.
    const { data } = await supabase
      .from("pegawai")
      .select("id, nama, status, tanggal_bergabung, tanggal_keluar")
      .or(`status.eq.Aktif,and(status.eq.Tidak Aktif,tanggal_keluar.gte.${MIN_DATE})`)
      .order("nama");
    if (data) setEmployees(data);
  };
  const fetchDivisions = async () => {
    const { data } = await supabase.from("divisions").select("id, nama, color").eq("status", "Aktif").order("nama");
    if (data) setDivisions(data);
  };
  const fetchSchedules = async () => {
    const { data } = await supabase.from("division_schedules").select("division_id, jam_masuk, toleransi_menit, awal_absen_menit").eq("status", "Aktif");
    if (data) setSchedules(data);
  };
  const fetchPenalties = async () => {
    const { data } = await supabase.from("attendance_penalty_rates").select("division_id, denda_per_menit, batas_menit, denda_maksimum, denda_alpha").eq("status", "Aktif");
    if (data) setPenalties(data);
  };

  const fetchOffDays = async () => {
    const { data } = await supabase.from("employee_off_days").select("employee_id, day_of_week");
    if (data) setOffDays(data);
  };
  const fetchOverrides = async () => {
    const { data } = await supabase.from("employee_leave_overrides").select("*").order("tanggal", { ascending: false });
    if (data) setOverrides(data);
  };
  const fetchPublicHolidays = async () => {
    const { data } = await supabase.from("public_holidays").select("*").order("tanggal", { ascending: true });
    if (data) setPublicHolidays(data);
  };

  const fetchRecords = useCallback(async () => {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("*, pegawai(nama), divisions(nama, color)")
      .eq("tanggal", dateFilter)
      .order("jam_masuk", { ascending: true });
    if (error) { showToast("error", "Gagal Memuat Data", error.message); return; }
    if (data) {
      const mapped = data.map((d) => ({
        ...d,
        employeeNama: d.pegawai?.nama || d.employee_id,
        divisionNama: d.divisions?.nama || "-",
        divisionColor: d.divisions?.color || "#3b82f6",
      })) as AttendanceRow[];
      setRecords(mapped);
    }
  }, [dateFilter, showToast]);

  // Hitung range periode 8-7 (timezone safe)
  const getCalPeriod = useCallback((key: string) => {
    const [y, m] = key.split("-").map(Number);
    const start = `${y}-${String(m).padStart(2, "0")}-08`;
    const endDt = new Date(y, m, 7); // 7 bulan berikutnya
    const end = `${endDt.getFullYear()}-${String(endDt.getMonth() + 1).padStart(2, "0")}-${String(endDt.getDate()).padStart(2, "0")}`;
    const startLabel = new Date(y, m - 1, 8).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    const endLabel = endDt.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    const label = `8 ${startLabel} – 7 ${endLabel}`;
    return { start, end, label };
  }, []);

  // Fetch kalender data (periode 8-7) — paginated agar tidak terpotong default limit 1000
  const fetchCalendar = useCallback(async () => {
    setCalLoading(true);
    const { start, end } = getCalPeriod(calPeriodKey);

    const PAGE_SIZE = 1000;
    let allData: any[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*, pegawai(nama), divisions(nama, color)")
        .gte("tanggal", start)
        .lte("tanggal", end)
        .order("tanggal", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error || !data) break;
      allData = allData.concat(data);
      hasMore = data.length === PAGE_SIZE;
      from += PAGE_SIZE;
    }

    setCalRecords(allData.map((d) => ({
      ...d,
      employeeNama: d.pegawai?.nama || d.employee_id,
      divisionNama: d.divisions?.nama || "-",
      divisionColor: d.divisions?.color || "#3b82f6",
    })) as AttendanceRow[]);
    setCalLoading(false);
  }, [calPeriodKey, getCalPeriod]);

  // Auto-generate record "Libur" untuk pegawai yang libur di tanggal ini
  // + Hapus record Libur auto-generated yang sudah tidak valid (jadwal berubah)
  const autoGenerateLibur = useCallback(async () => {
    if (!dateFilter || employees.length === 0) return;

    // Hari apa tanggal ini (0=Minggu, 6=Sabtu)
    const [y, m, d] = dateFilter.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    // Fetch off days & overrides
    const { data: allOffDays } = await supabase.from("employee_off_days").select("employee_id, day_of_week");
    const { data: dayOverrides } = await supabase.from("employee_leave_overrides").select("employee_id, type").eq("tanggal", dateFilter);

    const offDayMap = new Map<string, Set<number>>();
    allOffDays?.forEach((od) => {
      if (!offDayMap.has(od.employee_id)) offDayMap.set(od.employee_id, new Set());
      offDayMap.get(od.employee_id)!.add(od.day_of_week);
    });

    const overrideMap = new Map<string, string>();
    dayOverrides?.forEach((ov) => overrideMap.set(ov.employee_id, ov.type));

    // Cek SEMUA public holidays yang aktif di tanggal ini (bisa overlap)
    const holidaysForDate = publicHolidays.filter(
      (h) => dateFilter >= h.tanggal && (h.tanggal_selesai ? dateFilter <= h.tanggal_selesai : dateFilter === h.tanggal)
    );

    // Fetch existing records untuk tanggal ini (termasuk id, status, catatan untuk deteksi stale)
    const { data: existingRecs } = await supabase
      .from("attendance_records")
      .select("id, employee_id, status, catatan")
      .eq("tanggal", dateFilter);

    const existingMap = new Map<string, { id: number; status: string; catatan: string | null }>();
    existingRecs?.forEach((r) => existingMap.set(r.employee_id, { id: r.id, status: r.status, catatan: r.catatan }));

    // Cek setiap pegawai: buat Libur baru ATAU hapus Libur yang sudah salah
    const liburInserts: { employee_id: string; division_id: null; tanggal: string; jam_masuk: string; schedule_jam_masuk: string; toleransi_menit: number; status: string; durasi_telat: number; denda: number; catatan: string }[] = [];
    const staleLiburIds: number[] = [];

    for (const emp of employees) {
      // Skip pegawai yang belum bergabung di tanggal ini
      if (emp.tanggal_bergabung && dateFilter < emp.tanggal_bergabung) continue;
      // Skip pegawai yang sudah keluar sebelum tanggal ini
      if (emp.tanggal_keluar && dateFilter > emp.tanggal_keluar) continue;

      const override = overrideMap.get(emp.id);
      const empOffDays = offDayMap.get(emp.id);

      // Cari holiday yang berlaku untuk pegawai ini (berlaku_untuk='semua' ATAU pegawai ada di pegawai_ids)
      const applicableHoliday = holidaysForDate.find((h) =>
        h.berlaku_untuk === "semua" ||
        (h.berlaku_untuk === "pegawai" && h.pegawai_ids?.includes(emp.id))
      );

      // Priority: override > public holiday > off day mingguan
      const isMasukOverride = override === "masuk";
      const isOverrideLibur = override === "libur";
      const isPublicHoliday = !!applicableHoliday;
      const isWeeklyOff = !override && !isPublicHoliday && empOffDays?.has(dow);

      const shouldBeLibur = (isOverrideLibur || isPublicHoliday || isWeeklyOff) && !isMasukOverride;
      const holidayNama = applicableHoliday ? applicableHoliday.nama : null;

      const existing = existingMap.get(emp.id);

      if (shouldBeLibur && !existing) {
        // Seharusnya libur tapi belum ada record → insert
        liburInserts.push({
          employee_id: emp.id,
          division_id: null,
          tanggal: dateFilter,
          jam_masuk: "00:00",
          schedule_jam_masuk: "00:00",
          toleransi_menit: 0,
          status: "Libur",
          durasi_telat: 0,
          denda: 0,
          catatan: holidayNama ? `Libur nasional: ${holidayNama}` : "Hari libur",
        });
      } else if (!shouldBeLibur && existing && existing.status === "Libur" && (existing.catatan === "Hari libur" || existing.catatan?.startsWith("Libur nasional:"))) {
        // Seharusnya TIDAK libur tapi ada record auto-generated "Libur" → hapus (jadwal sudah berubah)
        staleLiburIds.push(existing.id);
      }
    }

    let changed = false;

    // Hapus record Libur yang sudah tidak valid
    if (staleLiburIds.length > 0) {
      await supabase.from("attendance_records").delete().in("id", staleLiburIds);
      changed = true;
    }

    // Insert record Libur baru
    if (liburInserts.length > 0) {
      await supabase.from("attendance_records").upsert(liburInserts, {
        onConflict: "employee_id,tanggal",
        ignoreDuplicates: true,
      });
      changed = true;
    }

    if (changed) {
      await fetchRecords();
      if (viewMode === "kalender") fetchCalendar();
    }
  }, [dateFilter, employees, fetchRecords, viewMode, fetchCalendar, publicHolidays]);

  // Auto-generate record "Alpha" untuk pegawai yang seharusnya kerja tapi tidak ada record
  // Hanya untuk tanggal SEBELUM hari ini (bukan hari ini — pegawai masih bisa datang)
  const autoGenerateAlpha = useCallback(async () => {
    if (!dateFilter || employees.length === 0) return;

    // Hanya generate Alpha untuk tanggal yang sudah lewat
    const today = localDateStr();
    if (dateFilter >= today) return;

    const [y, m, d] = dateFilter.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    // Fetch off days & overrides
    const { data: allOffDays } = await supabase.from("employee_off_days").select("employee_id, day_of_week");
    const { data: dayOverrides } = await supabase.from("employee_leave_overrides").select("employee_id, type").eq("tanggal", dateFilter);

    // Fetch approved leaves
    const { data: approvedLeaves } = await supabase
      .from("leave_requests")
      .select("employee_id, jenis, alasan")
      .eq("status", "Disetujui")
      .lte("tanggal_mulai", dateFilter)
      .gte("tanggal_selesai", dateFilter);

    const offDayMap = new Map<string, Set<number>>();
    allOffDays?.forEach((od) => {
      if (!offDayMap.has(od.employee_id)) offDayMap.set(od.employee_id, new Set());
      offDayMap.get(od.employee_id)!.add(od.day_of_week);
    });

    const overrideMap = new Map<string, string>();
    dayOverrides?.forEach((ov) => overrideMap.set(ov.employee_id, ov.type));

    const leaveMap = new Map<string, { jenis: string, alasan: string }>();
    approvedLeaves?.forEach((l) => leaveMap.set(l.employee_id, { jenis: l.jenis, alasan: l.alasan || "" }));

    // Fetch existing records
    const { data: existingRecs } = await supabase
      .from("attendance_records")
      .select("employee_id")
      .eq("tanggal", dateFilter);
    const existingSet = new Set(existingRecs?.map((r) => r.employee_id) || []);

    // Cari pegawai yang seharusnya kerja tapi TIDAK ada record
    const alphaInserts: { employee_id: string; division_id: null; tanggal: string; jam_masuk: string; schedule_jam_masuk: string; toleransi_menit: number; status: string; durasi_telat: number; denda: number; catatan: string }[] = [];

    for (const emp of employees) {
      if (existingSet.has(emp.id)) continue; // sudah ada record

      // Skip pegawai yang belum bergabung di tanggal ini (mis. masih Training, baru Aktif kemarin)
      if (emp.tanggal_bergabung && dateFilter < emp.tanggal_bergabung) continue;
      // Skip pegawai yang sudah keluar sebelum tanggal ini
      if (emp.tanggal_keluar && dateFilter > emp.tanggal_keluar) continue;

      const override = overrideMap.get(emp.id);
      const empOffDays = offDayMap.get(emp.id);
      const isLibur = override === "libur" || (!override && empOffDays?.has(dow));
      const isMasukOverride = override === "masuk";
      const shouldBeLibur = isLibur && !isMasukOverride;

      const leave = leaveMap.get(emp.id);

      if (leave) {
        // Sedang cuti/izin/sakit, tidak perlu Alpha
        alphaInserts.push({
          employee_id: emp.id,
          division_id: null,
          tanggal: dateFilter,
          jam_masuk: "00:00",
          schedule_jam_masuk: "00:00",
          toleransi_menit: 0,
          status: leave.jenis,
          durasi_telat: 0,
          denda: 0,
          catatan: `${leave.jenis} otomatis — sudah disetujui`,
        });
      } else if (!shouldBeLibur) {
        // Seharusnya kerja tapi tidak ada record → Alpha
        const dendaAlpha = penalties.length > 0 ? (penalties[0]?.denda_alpha ?? 100000) : 100000;
        alphaInserts.push({
          employee_id: emp.id,
          division_id: null,
          tanggal: dateFilter,
          jam_masuk: "00:00",
          schedule_jam_masuk: "00:00",
          toleransi_menit: 0,
          status: "Alpha",
          durasi_telat: 0,
          denda: dendaAlpha,
          catatan: "Alpha otomatis — tidak ada record kehadiran",
        });
      }
    }

    if (alphaInserts.length > 0) {
      await supabase.from("attendance_records").upsert(alphaInserts, {
        onConflict: "employee_id,tanggal",
        ignoreDuplicates: true,
      });
      await fetchRecords();
      if (viewMode === "kalender") fetchCalendar();
    }
  }, [dateFilter, employees, penalties, fetchRecords, viewMode, fetchCalendar]);

  // Sync calPeriodKey saat user berpindah ke mode kalender
  useEffect(() => {
    if (viewMode === "kalender") {
      setCalPeriodKey(calcCalPeriodKey());
    }
  }, [viewMode, calcCalPeriodKey]);

  // Fetch data kalender saat periode atau mode berubah
  useEffect(() => {
    if (viewMode === "kalender") fetchCalendar();
  }, [calPeriodKey, viewMode, fetchCalendar]);

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchDivisions(), fetchSchedules(), fetchPenalties(), fetchOffDays(), fetchOverrides(), fetchPublicHolidays(), fetchRecords()]).then(() => setLoading(false));
  }, []);

  // Saat dateFilter berubah: fetch records → auto-generate libur → auto-generate alpha
  useEffect(() => {
    fetchRecords().then(async () => {
      if (employees.length > 0) {
        await autoGenerateLibur();
        await autoGenerateAlpha();
      }
    });
  }, [dateFilter]);

  // Setelah employees loaded pertama kali
  useEffect(() => {
    if (!loading && employees.length > 0) {
      autoGenerateLibur().then(() => autoGenerateAlpha());
    }
  }, [loading]);

  // ─── Summary ───
  const statusCounts: Record<string, number> = { Hadir: 0, Terlambat: 0, Izin: 0, Sakit: 0, Alpha: 0, Libur: 0, Cuti: 0 };
  records.forEach((r) => { if (r.status in statusCounts) statusCounts[r.status]++; });
  const totalDenda = records.reduce((s, r) => s + r.denda, 0);

  // ─── Ringkasan (per-employee summary across date range) ───
  type SummaryRow = {
    employee_id: string;
    nama: string;
    status: string;
    divisionId: number;
    divisionNama: string;
    divisionColor: string;
    hadir: number;
    telat: number;
    izin: number;
    sakit: number;
    alpha: number;
    libur: number;
    cuti: number;
    total: number;
  };

  const [summaryDateMode, setSummaryDateMode] = useState<"periode" | "custom">("periode");
  const [summaryPeriodKey, setSummaryPeriodKey] = useState(getSummaryCurrentPeriodKey);
  const [summaryCustomStart, setSummaryCustomStart] = useState("");
  const [summaryCustomEnd, setSummaryCustomEnd] = useState("");
  const [summarySearch, setSummarySearch] = useState("");
  const [summaryPage, setSummaryPage] = useState(1);
  const [summarySortBy, setSummarySortBy] = useState<"nama" | "hadir" | "alpha" | "telat" | "total">("nama");
  const [summaryData, setSummaryData] = useState<SummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryExportMenu, setSummaryExportMenu] = useState(false);
  const summaryExportRef = useRef<HTMLDivElement>(null);

  const summaryPeriod = useMemo(() =>
    summaryDateMode === "periode"
      ? getSummaryPeriodRange(summaryPeriodKey)
      : { start: summaryCustomStart, end: summaryCustomEnd, label: summaryCustomStart && summaryCustomEnd ? `${summaryCustomStart} – ${summaryCustomEnd}` : "Pilih tanggal" },
    [summaryDateMode, summaryPeriodKey, summaryCustomStart, summaryCustomEnd]);

  const summaryDateLabel = useMemo(() => {
    if (!summaryPeriod.start || !summaryPeriod.end) return "";
    const s = new Date(summaryPeriod.start + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    const e = new Date(summaryPeriod.end + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    return `${s} – ${e}`;
  }, [summaryPeriod.start, summaryPeriod.end]);

  const fetchSummary = useCallback(async () => {
    if (!summaryPeriod.start || !summaryPeriod.end) {
      setSummaryData([]);
      return;
    }
    setSummaryLoading(true);
    const PAGE = 1000;
    let allData: any[] = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("employee_id, status, division_id, divisions(nama, color)")
        .gte("tanggal", summaryPeriod.start)
        .lte("tanggal", summaryPeriod.end)
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      allData = allData.concat(data);
      hasMore = data.length === PAGE;
      from += PAGE;
    }

    const map = new Map<string, SummaryRow>();
    allData.forEach((d) => {
      let row = map.get(d.employee_id);
      if (!row) {
        const emp = employees.find((e) => e.id === d.employee_id);
        row = {
          employee_id: d.employee_id,
          nama: emp?.nama || d.employee_id,
          status: emp?.status || "Aktif",
          divisionId: d.division_id || 0,
          divisionNama: d.divisions?.nama || "-",
          divisionColor: d.divisions?.color || "#6b7280",
          hadir: 0, telat: 0, izin: 0, sakit: 0, alpha: 0, libur: 0, cuti: 0, total: 0,
        };
        map.set(d.employee_id, row);
      }
      switch (d.status) {
        case "Hadir": row.hadir++; break;
        case "Terlambat": row.telat++; row.hadir++; break;
        case "Izin": row.izin++; break;
        case "Sakit": row.sakit++; break;
        case "Alpha": row.alpha++; break;
        case "Libur": row.libur++; break;
        case "Cuti": row.cuti++; break;
      }
    });

    const rows = Array.from(map.values()).map((r) => ({ ...r, total: r.hadir + r.izin + r.sakit + r.alpha + r.libur + r.cuti }));
    setSummaryData(rows);
    setSummaryLoading(false);
  }, [summaryPeriod.start, summaryPeriod.end, employees]);

  useEffect(() => {
    if (viewMode === "ringkasan") fetchSummary();
  }, [viewMode, fetchSummary]);

  useEffect(() => {
    setSummaryPage(1);
  }, [summarySearch, summarySortBy]);

  const summaryFiltered = useMemo(() => {
    const q = summarySearch.toLowerCase();
    let rows = summaryData.filter((r) =>
      r.nama.toLowerCase().includes(q) || r.divisionNama.toLowerCase().includes(q)
    );
    rows.sort((a, b) => {
      switch (summarySortBy) {
        case "hadir": return b.hadir - a.hadir || a.nama.localeCompare(b.nama);
        case "alpha": return b.alpha - a.alpha || a.nama.localeCompare(b.nama);
        case "telat": return b.telat - a.telat || a.nama.localeCompare(b.nama);
        case "total": return b.total - a.total || a.nama.localeCompare(b.nama);
        default: return a.nama.localeCompare(b.nama);
      }
    });
    return rows;
  }, [summaryData, summarySearch, summarySortBy]);

  const summaryPaged = useMemo(
    () => summaryFiltered.slice((summaryPage - 1) * SUMMARY_PAGE_SIZE, summaryPage * SUMMARY_PAGE_SIZE),
    [summaryFiltered, summaryPage]
  );

  const summaryTotals = useMemo(() => {
    const t = { hadir: 0, telat: 0, izin: 0, sakit: 0, alpha: 0, libur: 0, cuti: 0, total: 0 };
    summaryFiltered.forEach((r) => { t.hadir += r.hadir; t.telat += r.telat; t.izin += r.izin; t.sakit += r.sakit; t.alpha += r.alpha; t.libur += r.libur; t.cuti += r.cuti; t.total += r.total; });
    return t;
  }, [summaryFiltered]);

  const exportSummaryCSV = () => {
    if (summaryFiltered.length === 0) return;
    const headers = ["#", "Pegawai", "Status", "Divisi", "Hadir", "Telat", "Izin", "Sakit", "Alpha", "Libur", "Cuti", "Total"];
    const rows: string[] = [headers.join(",")];
    summaryFiltered.forEach((r, i) => {
      rows.push([
        i + 1, `"${r.nama}"`, r.status, `"${r.divisionNama}"`,
        r.hadir, r.telat, r.izin, r.sakit, r.alpha, r.libur, r.cuti, r.total,
      ].join(","));
    });
    rows.push(["", `"TOTAL (${summaryFiltered.length} pegawai)"`, "", "", summaryTotals.hadir, summaryTotals.telat, summaryTotals.izin, summaryTotals.sakit, summaryTotals.alpha, summaryTotals.libur, summaryTotals.cuti, summaryTotals.total].join(","));
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Ringkasan_Absensi_${summaryPeriod.start}_${summaryPeriod.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setSummaryExportMenu(false);
  };

  const exportSummaryPDF = async () => {
    if (summaryFiltered.length === 0) return;
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Ringkasan Absensi Pegawai", pw / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Periode: ${summaryPeriod.label}`, pw / 2, 21, { align: "center" });
    doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, pw / 2, 27, { align: "center" });
    const body = summaryFiltered.map((r, i) => [
      i + 1, r.nama, r.divisionNama, r.hadir, r.telat, r.izin, r.sakit, r.alpha, r.libur, r.cuti, r.total,
    ]);
    body.push(["TOTAL", "", `(${summaryFiltered.length} pegawai)`, summaryTotals.hadir, summaryTotals.telat, summaryTotals.izin, summaryTotals.sakit, summaryTotals.alpha, summaryTotals.libur, summaryTotals.cuti, summaryTotals.total]);
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
    doc.save(`Ringkasan_Absensi_${summaryPeriod.start}_${summaryPeriod.end}.pdf`);
    setSummaryExportMenu(false);
  };

  const navigateSummaryPeriod = (dir: -1 | 1) => {
    if (summaryDateMode !== "periode") return;
    const [y, m] = summaryPeriodKey.split("-").map(Number);
    const next = new Date(y, m - 1 + dir, 1);
    setSummaryPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setSummaryPage(1);
  };

  const summaryHeaderStats = useMemo(() => {
    const empCount = summaryFiltered.length;
    const totalRecords = summaryTotals.total;
    const avgHadir = empCount > 0 ? Math.round(summaryTotals.hadir / empCount) : 0;
    return { empCount, totalRecords, avgHadir };
  }, [summaryFiltered, summaryTotals]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (summaryExportRef.current && !summaryExportRef.current.contains(e.target as Node)) setSummaryExportMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ─── Filter ───
  const filtered = records.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = (r.employeeNama || "").toLowerCase().includes(q) || (r.divisionNama || "").toLowerCase().includes(q);
    const matchStatus = filterStatus === "Semua" || r.status === filterStatus;
    return matchSearch && matchStatus;
  });
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ─── Form: live preview ───
  const isSpecial = NO_JAM_STATUSES.includes(form.specialStatus);
  const formSchedule = useMemo(() => schedules.find((s) => s.division_id === form.division_id), [schedules, form.division_id]);
  const formPenalty = useMemo(() => penalties.find((p) => p.division_id === form.division_id), [penalties, form.division_id]);

  const formPreview = useMemo(() => {
    if (isSpecial) {
      const denda = form.specialStatus === "Alpha" ? computeDendaAlpha(formPenalty) : 0;
      return { status: form.specialStatus as string, durasi: 0, denda };
    }
    if (!form.jam_masuk || !formSchedule) return null;
    const result = computeLateness(form.jam_masuk, formSchedule.jam_masuk, formSchedule.toleransi_menit);
    const denda = computeDenda(result.durasi, formPenalty);
    return { status: result.status, durasi: result.durasi, denda };
  }, [form.jam_masuk, form.specialStatus, formSchedule, formPenalty, isSpecial]);

  const previewColor = formPreview ? (STATUS_OPTIONS.find((s) => s.value === formPreview.status)?.color || "#6b7280") : "#6b7280";

  // ─── Fetch existing absen for form date ───
  const fetchFormExisting = useCallback(async (tanggal: string) => {
    if (!tanggal) { setFormExistingEmpIds(new Set()); return; }
    const { data } = await supabase.from("attendance_records").select("employee_id").eq("tanggal", tanggal);
    setFormExistingEmpIds(new Set(data?.map((d) => d.employee_id) || []));
  }, []);

  // ─── Open Add ───
  const openAdd = () => {
    setForm({ employee_id: "", division_id: 0, tanggal: dateFilter, jam_masuk: "", specialStatus: "", catatan: "", alasan_manual: "" });
    setFormError("");
    setEditingId(null);
    fetchFormExisting(dateFilter);
    setShowForm(true);
  };

  // ─── Open Edit ───
  const openEdit = (row: AttendanceRow) => {
    const isSpec = NO_JAM_STATUSES.includes(row.status);
    setForm({
      employee_id: row.employee_id,
      division_id: row.division_id,
      tanggal: row.tanggal,
      jam_masuk: isSpec ? "" : row.jam_masuk.slice(0, 5),
      specialStatus: isSpec ? row.status as "Izin" | "Sakit" | "Alpha" | "Cuti" | "Libur" : "",
      catatan: row.catatan || "",
      alasan_manual: (row as any).alasan_manual || "",
    });
    setFormError("");
    setEditingId(row.id);
    setShowForm(true);
  };

  // ─── Save ───
  const handleSave = async () => {
    setFormError("");

    // Validation
    if (!form.employee_id) { setFormError("Pilih pegawai terlebih dahulu."); return; }
    if (!form.division_id) { setFormError("Pilih divisi terlebih dahulu."); return; }
    if (!form.tanggal) { setFormError("Pilih tanggal terlebih dahulu."); return; }
    if (!isSpecial && !form.jam_masuk) { setFormError("Isi jam masuk atau pilih status Alpha."); return; }
    if (!form.alasan_manual) { setFormError("Pilih alasan input manual."); return; }

    // Cek apakah tanggal absen sebelum tanggal_bergabung atau setelah tanggal_keluar
    if (!editingId && form.employee_id && form.tanggal) {
      const emp = employees.find((e) => e.id === form.employee_id);
      if (emp?.tanggal_bergabung && form.tanggal < emp.tanggal_bergabung) {
        const tglBergabung = new Date(emp.tanggal_bergabung + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        setFormError(`${emp.nama} baru bergabung tanggal ${tglBergabung}. Tanggal absen harus pada atau setelah tanggal bergabung.`);
        return;
      }
      if (emp?.tanggal_keluar && form.tanggal > emp.tanggal_keluar) {
        const tglKeluar = new Date(emp.tanggal_keluar + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        setFormError(`${emp.nama} sudah tidak aktif sejak ${tglKeluar}. Tanggal absen harus pada atau sebelum tanggal terakhir aktif.`);
        return;
      }
    }

    // Cek apakah pegawai libur di tanggal ini
    if (!editingId && form.employee_id && form.tanggal) {
      const [fy, fm, fd] = form.tanggal.split("-").map(Number);
      const formDow = new Date(Date.UTC(fy, fm - 1, fd)).getUTCDay();
      const empOff = offDays.filter(od => od.employee_id === form.employee_id);
      const empOverride = overrides.find(ov => ov.employee_id === form.employee_id && ov.tanggal === form.tanggal);
      const isLibur = empOverride?.type === "libur" || (!empOverride && empOff.some(od => od.day_of_week === formDow));
      if (isLibur) {
        setFormError("Pegawai ini libur di tanggal tersebut. Tidak perlu input absen.");
        return;
      }
    }

    // Cek duplikat sebelum insert (hanya mode tambah)
    if (!editingId) {
      const { data: existing } = await supabase
        .from("attendance_records")
        .select("id")
        .eq("employee_id", form.employee_id)
        .eq("tanggal", form.tanggal)
        .limit(1);
      if (existing && existing.length > 0) {
        const empNama = employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id;
        setFormError(`${empNama} sudah memiliki data absen di tanggal ${form.tanggal}.`);
        return;
      }
    }

    setFormSaving(true);

    // Refresh session sebelum insert. Jika JWT expired tanpa diketahui,
    // trigger DB akan menganggap user tidak terotentikasi dan mengoverride
    // jam_masuk ke server time. Cek session aktif dulu.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setFormError("Sesi login Anda berakhir. Silakan login ulang sebelum menyimpan absensi.");
      setFormSaving(false);
      return;
    }
    // Refresh token jika hampir kadaluarsa (Supabase auto-refresh, tapi belt-and-suspender)
    const expiresAt = sessionData.session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt - nowSec < 120) {
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        setFormError("Gagal memperbarui sesi login. Silakan login ulang.");
        setFormSaving(false);
        return;
      }
    }

    const sched = schedules.find((s) => s.division_id === form.division_id);
    const penalty = penalties.find((p) => p.division_id === form.division_id);
    const schedJamMasuk = sched?.jam_masuk || "08:00";
    const toleransi = sched?.toleransi_menit || 0;

    let status = "";
    let durasi = 0;
    let denda = 0;

    if (isSpecial) {
      status = form.specialStatus;
      if (status === "Alpha") denda = computeDendaAlpha(penalty);
    } else {
      const result = computeLateness(form.jam_masuk, schedJamMasuk, toleransi);
      status = result.status;
      durasi = result.durasi;
      denda = computeDenda(durasi, penalty);
    }

    const payload = {
      employee_id: form.employee_id,
      division_id: form.division_id,
      tanggal: form.tanggal,
      jam_masuk: isSpecial ? schedJamMasuk : form.jam_masuk,
      schedule_jam_masuk: schedJamMasuk,
      toleransi_menit: toleransi,
      status,
      durasi_telat: durasi,
      denda,
      catatan: form.catatan || null,
      is_manual: true,
      alasan_manual: form.alasan_manual || null,
    };

    try {
      if (editingId) {
        const oldRecord = records.find((r) => r.id === editingId);
        const { error } = await supabase.from("attendance_records").update(payload).eq("id", editingId);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        const empNama = employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id;
        await logAudit({
          supabase,
          action: "update",
          entityType: "attendance_records",
          entityId: editingId,
          entityLabel: `Absensi ${empNama} (${form.tanggal})`,
          oldData: oldRecord ? { ...oldRecord } as unknown as Record<string, unknown> : null,
          newData: { ...payload } as Record<string, unknown>,
          metadata: { alasan_manual: form.alasan_manual || null, is_manual: true },
        });
        showToast("success", "Data Diperbarui", "Data absen berhasil diperbarui.");
      } else {
        const { data: inserted, error } = await supabase
          .from("attendance_records")
          .insert(payload)
          .select("id, jam_masuk, status, durasi_telat")
          .single();
        if (error) {
          if (error.message.includes("duplicate") || error.message.includes("unique")) {
            setFormError("Pegawai ini sudah memiliki data absen di tanggal tersebut.");
          } else {
            setFormError(error.message);
          }
          setFormSaving(false);
          return;
        }
        // Verifikasi server tidak override (artinya trigger DB merubah data form
        // karena auth.uid() / role admin tidak terdeteksi). Ini lapisan deteksi
        // kedua: kalau sampai sini berbeda, refresh halaman dan info ke user.
        if (inserted && payload.jam_masuk && inserted.jam_masuk) {
          const formJam = String(payload.jam_masuk).slice(0, 5);
          const dbJam = String(inserted.jam_masuk).slice(0, 5);
          if (formJam !== dbJam) {
            // Hapus record yang sudah ter-override agar tidak menjadi data salah,
            // lalu beri tahu admin.
            await supabase.from("attendance_records").delete().eq("id", inserted.id);
            setFormError(
              `Sesi login bermasalah: server mengubah jam menjadi ${dbJam} (form: ${formJam}). ` +
                `Data tidak disimpan. Silakan logout dan login ulang sebagai Admin, kemudian coba lagi.`
            );
            setFormSaving(false);
            return;
          }
        }
        showToast("success", "Absensi Disimpan", `Data absen ${employees.find((e) => e.id === form.employee_id)?.nama || ""} berhasil disimpan.`);
        await logAudit({
          supabase,
          action: "manual_input",
          entityType: "attendance_records",
          entityId: inserted?.id,
          entityLabel: `Absensi ${employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id} (${form.tanggal})`,
          newData: { ...payload, id: inserted?.id } as Record<string, unknown>,
          metadata: { alasan_manual: form.alasan_manual || null, is_manual: true },
        });
      }
      setShowForm(false);
      setDateFilter(form.tanggal);
      await fetchRecords();
      if (viewMode === "kalender") fetchCalendar();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setFormSaving(false);
    }
  };

  // ─── Delete ───
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const oldRecord = records.find((r) => r.id === deleteConfirm.id);
    const { error } = await supabase.from("attendance_records").delete().eq("id", deleteConfirm.id);
    if (error) showToast("error", "Gagal Menghapus", error.message);
    else {
      await logAudit({
        supabase,
        action: "delete",
        entityType: "attendance_records",
        entityId: deleteConfirm.id,
        entityLabel: `Absensi ${deleteConfirm.nama}`,
        oldData: oldRecord ? { ...oldRecord } as unknown as Record<string, unknown> : null,
      });
      showToast("success", "Data Dihapus", "Data absen berhasil dihapus.");
      setRecords((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
      if (viewMode === "kalender") fetchCalendar();
    }
    setDeleting(false);
    setDeleteConfirm(null);
  };

  // ─── Off Day Modal ───
  const openOffDay = () => {
    const map = new Map<string, Set<number>>();
    employees.forEach((e) => map.set(e.id, new Set()));
    offDays.forEach((od) => {
      if (map.has(od.employee_id)) map.get(od.employee_id)!.add(od.day_of_week);
    });
    setOffDayLocal(map);
    setOffDaySearch("");
    setShowOffDay(true);
  };

  const toggleOffDay = (empId: string, day: number) => {
    setOffDayLocal((prev) => {
      const next = new Map(prev);
      const days = new Set(next.get(empId) || []);
      if (days.has(day)) days.delete(day); else days.add(day);
      next.set(empId, days);
      return next;
    });
  };

  // Sinkronisasi attendance_records saat jadwal libur mingguan berubah.
  // PENTING: cutoff today — data historis (< today) tidak disentuh.
  const syncWeeklyOffDays = async (
    diff: { added: { empId: string; dow: number }[]; removed: { empId: string; dow: number }[] }
  ): Promise<{ inserted: number; updated: number; deleted: number }> => {
    let inserted = 0, updated = 0, deleted = 0;
    const today = localDateStr();
    const periodEnd = getCalPeriod(calPeriodKey).end;

    // Kumpulkan tanggal yang affected per pegawai (>= today, sampai periodEnd)
    type Cell = { empId: string; tanggal: string; type: "add" | "remove" };
    const cells: Cell[] = [];
    const addAll = (emp: string, dow: number, type: "add" | "remove") => {
      for (let cur = today; cur <= periodEnd; cur = addDays(cur, 1)) {
        const [y, m, d] = cur.split("-").map(Number);
        const cellDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (cellDow === dow) cells.push({ empId: emp, tanggal: cur, type });
      }
    };
    diff.added.forEach((d) => addAll(d.empId, d.dow, "add"));
    diff.removed.forEach((d) => addAll(d.empId, d.dow, "remove"));

    if (cells.length === 0) return { inserted, updated, deleted };

    // Fetch semua existing record untuk affected (empId, tanggal)
    const empIds = [...new Set(cells.map((c) => c.empId))];
    const dates = [...new Set(cells.map((c) => c.tanggal))];
    const { data: existing } = await supabase
      .from("attendance_records")
      .select("id, employee_id, tanggal, status, catatan, is_manual")
      .in("employee_id", empIds)
      .in("tanggal", dates);
    const existingMap = new Map<string, { id: number; status: string; catatan: string | null; is_manual: boolean }>();
    (existing || []).forEach((r) => existingMap.set(`${r.employee_id}|${r.tanggal}`, r));

    // Fetch override custom & public holiday di rentang
    const { data: ovs } = await supabase
      .from("employee_leave_overrides")
      .select("employee_id, tanggal, type")
      .in("employee_id", empIds)
      .in("tanggal", dates);
    const ovMap = new Map<string, string>();
    (ovs || []).forEach((o) => ovMap.set(`${o.employee_id}|${o.tanggal}`, o.type));

    const isPublicHolidayDate = (empId: string, tanggal: string): boolean => {
      return publicHolidays.some((h) => {
        if (tanggal < h.tanggal) return false;
        const endDate = h.tanggal_selesai || h.tanggal;
        if (tanggal > endDate) return false;
        if (h.berlaku_untuk === "semua") return true;
        if (h.berlaku_untuk === "pegawai" && h.pegawai_ids?.includes(empId)) return true;
        return false;
      });
    };

    const inserts: { employee_id: string; division_id: null; tanggal: string; jam_masuk: string; schedule_jam_masuk: string; toleransi_menit: number; status: string; durasi_telat: number; denda: number; catatan: string; is_manual: boolean }[] = [];
    const updateAlphaToLiburIds: number[] = [];
    const deleteIds: number[] = [];

    for (const cell of cells) {
      const key = `${cell.empId}|${cell.tanggal}`;
      const ex = existingMap.get(key);
      const ov = ovMap.get(key);

      if (cell.type === "add") {
        // Hari kerja → off. Override "masuk" tetap menang (skip libur).
        if (ov === "masuk") continue;
        if (!ex) {
          inserts.push({
            employee_id: cell.empId, division_id: null, tanggal: cell.tanggal,
            jam_masuk: "00:00", schedule_jam_masuk: "00:00", toleransi_menit: 0,
            status: "Libur", durasi_telat: 0, denda: 0,
            catatan: "Hari libur", is_manual: false,
          });
        } else {
          if (ex.is_manual) continue;
          if (["Hadir", "Terlambat", "Izin", "Sakit", "Cuti"].includes(ex.status)) continue;
          if (ex.status === "Alpha" && (ex.catatan || "").startsWith("Alpha otomatis")) {
            updateAlphaToLiburIds.push(ex.id);
          }
        }
      } else {
        // Off → kerja. Hapus Libur generic auto-generated, kecuali ada public holiday / override "libur".
        if (ov === "libur") continue;
        if (isPublicHolidayDate(cell.empId, cell.tanggal)) continue;
        if (!ex) continue;
        if (ex.is_manual) continue;
        if (ex.status === "Libur" && ex.catatan === "Hari libur") {
          deleteIds.push(ex.id);
        }
      }
    }

    if (inserts.length > 0) {
      const { data: ins } = await supabase
        .from("attendance_records")
        .upsert(inserts, { onConflict: "employee_id,tanggal", ignoreDuplicates: true })
        .select("id");
      inserted = ins?.length || 0;
    }
    if (updateAlphaToLiburIds.length > 0) {
      await supabase
        .from("attendance_records")
        .update({ status: "Libur", denda: 0, durasi_telat: 0, catatan: "Hari libur", jam_masuk: "00:00", schedule_jam_masuk: "00:00", toleransi_menit: 0 })
        .in("id", updateAlphaToLiburIds);
      updated = updateAlphaToLiburIds.length;
    }
    if (deleteIds.length > 0) {
      await supabase.from("attendance_records").delete().in("id", deleteIds);
      deleted = deleteIds.length;
    }

    return { inserted, updated, deleted };
  };

  const handleSaveOffDays = async () => {
    setOffDaySaving(true);

    // Hitung diff antara state DB (offDays) dan state lokal (offDayLocal)
    const oldMap = new Map<string, Set<number>>();
    offDays.forEach((od) => {
      if (!oldMap.has(od.employee_id)) oldMap.set(od.employee_id, new Set());
      oldMap.get(od.employee_id)!.add(od.day_of_week);
    });

    const added: { empId: string; dow: number }[] = [];
    const removed: { empId: string; dow: number }[] = [];
    for (const emp of employees) {
      const oldSet = oldMap.get(emp.id) || new Set<number>();
      const newSet = offDayLocal.get(emp.id) || new Set<number>();
      for (const d of newSet) if (!oldSet.has(d)) added.push({ empId: emp.id, dow: d });
      for (const d of oldSet) if (!newSet.has(d)) removed.push({ empId: emp.id, dow: d });
    }

    const totalDays = Array.from(offDayLocal.values()).reduce((s, days) => s + days.size, 0);

    try {
      // Step 1: Apply diff ke employee_off_days (granular, bukan delete-all)
      setOffDayProgress({ step: 1, total: 3, label: `Memperbarui ${added.length + removed.length} perubahan jadwal...` });

      // DELETE per (empId, dow) yang dihapus
      for (const r of removed) {
        await supabase.from("employee_off_days").delete()
          .eq("employee_id", r.empId).eq("day_of_week", r.dow);
      }
      // INSERT per (empId, dow) yang ditambah
      if (added.length > 0) {
        const insertPayload = added.map((a) => ({ employee_id: a.empId, day_of_week: a.dow }));
        const { error: insError } = await supabase.from("employee_off_days").insert(insertPayload);
        if (insError) throw insError;
      }

      // Step 2: Sync attendance_records (cutoff today, hanya untuk perubahan)
      setOffDayProgress({ step: 2, total: 3, label: "Menyinkronkan absensi..." });
      const syncResult = await syncWeeklyOffDays({ added, removed });

      // Step 3: Refresh state + audit log
      setOffDayProgress({ step: 3, total: 3, label: "Memperbarui data..." });
      await Promise.all([fetchOffDays(), fetchRecords()]);
      if (viewMode === "kalender") fetchCalendar();

      // Audit log: hanya kalau ada perubahan jadwal atau attendance
      if (added.length > 0 || removed.length > 0) {
        await logAudit({
          supabase,
          action: "update",
          entityType: "attendance_records",
          entityLabel: `Pergantian jadwal libur mingguan (${added.length} ditambah, ${removed.length} dihapus)`,
          metadata: {
            cutoff_date: localDateStr(),
            days_added: added.length,
            days_removed: removed.length,
            attendance_inserted: syncResult.inserted,
            attendance_updated: syncResult.updated,
            attendance_deleted: syncResult.deleted,
          },
        });
      }

      setShowOffDay(false);
      const summary = (added.length === 0 && removed.length === 0)
        ? `${totalDays} hari libur, tidak ada perubahan.`
        : `${syncResult.inserted} baru, ${syncResult.updated} diubah, ${syncResult.deleted} dihapus (mulai hari ini).`;
      showToast("success", "Jadwal Libur Disimpan", summary);
    } catch (err) {
      showToast("error", "Gagal Menyimpan", err instanceof Error ? err.message : "Terjadi kesalahan.");
      await fetchOffDays();
    } finally {
      setOffDaySaving(false);
      setOffDayProgress(null);
    }
  };

  // ─── Custom Override Handlers ───
  const handleAddOverride = async () => {
    if (!overrideEmpId || !overrideTanggal) return;
    setOverrideSaving(true);
    const { error } = await supabase.from("employee_leave_overrides").upsert({
      employee_id: overrideEmpId,
      tanggal: overrideTanggal,
      type: overrideType,
      catatan: overrideCatatan || null,
    }, { onConflict: "employee_id,tanggal" });
    if (error) {
      showToast("error", "Gagal", error.message);
    } else {
      showToast("success", overrideType === "libur" ? "Libur Ditambahkan" : "Masuk Ditambahkan",
        `${employees.find((e) => e.id === overrideEmpId)?.nama || ""} — ${overrideTanggal}`);
      setOverrideEmpId("");
      setOverrideTanggal("");
      setOverrideCatatan("");
      await fetchOverrides();
    }
    setOverrideSaving(false);
  };

  const handleDeleteOverride = async (id: number) => {
    await supabase.from("employee_leave_overrides").delete().eq("id", id);
    setOverrides((prev) => prev.filter((o) => o.id !== id));
    showToast("success", "Override Dihapus");
  };

  // ─── Public Holiday: Backfill helpers ───
  // Hitung daftar tanggal di rentang [start, end]
  const getDateRange = (start: string, end: string | null): string[] => {
    const dates: string[] = [];
    const endDate = end || start;
    const [sy, sm, sd] = start.split("-").map(Number);
    const [ey, em, ed] = endDate.split("-").map(Number);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    for (let ms = startMs; ms <= endMs; ms += 86400000) {
      const dt = new Date(ms);
      dates.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`);
    }
    return dates;
  };

  // Tentukan pegawai yang terdampak holiday
  const getAffectedEmployeeIds = (h: { berlaku_untuk: string; pegawai_ids: string[] | null }): string[] => {
    if (h.berlaku_untuk === "semua") return employees.map((e) => e.id);
    if (h.berlaku_untuk === "pegawai") return h.pegawai_ids || [];
    return [];
  };

  // Cek apakah catatan record termasuk auto-generated (boleh di-overwrite)
  const isAutoGeneratedCatatan = (catatan: string | null): boolean => {
    if (!catatan) return false;
    return catatan === "Hari libur" || catatan.startsWith("Libur nasional:") || catatan.startsWith("Alpha otomatis");
  };

  // Sinkronisasi attendance saat holiday di-save (insert/edit)
  const syncHolidayAttendance = async (
    newHoliday: { nama: string; tanggal: string; tanggal_selesai: string | null; berlaku_untuk: string; pegawai_ids: string[] | null },
    oldHoliday: PublicHoliday | null,
  ): Promise<{ inserted: number; updated: number; deleted: number }> => {
    let inserted = 0, updated = 0, deleted = 0;

    const newDates = getDateRange(newHoliday.tanggal, newHoliday.tanggal_selesai);
    const newEmpIds = getAffectedEmployeeIds(newHoliday);
    const newSet = new Set<string>();
    newDates.forEach((d) => newEmpIds.forEach((eid) => newSet.add(`${eid}|${d}`)));

    const oldDates = oldHoliday ? getDateRange(oldHoliday.tanggal, oldHoliday.tanggal_selesai) : [];
    const oldEmpIds = oldHoliday ? getAffectedEmployeeIds(oldHoliday) : [];
    const oldSet = new Set<string>();
    oldDates.forEach((d) => oldEmpIds.forEach((eid) => oldSet.add(`${eid}|${d}`)));

    // Set yang dihapus dari scope (oldHoliday tapi bukan newHoliday) → revert Libur stale
    const toRevert: { empId: string; tanggal: string }[] = [];
    oldSet.forEach((key) => {
      if (!newSet.has(key)) {
        const [empId, tanggal] = key.split("|");
        toRevert.push({ empId, tanggal });
      }
    });

    // Revert: hapus record Libur dengan catatan "Libur nasional: {oldNama}"
    if (toRevert.length > 0 && oldHoliday) {
      const revertEmpIds = [...new Set(toRevert.map((r) => r.empId))];
      const revertDates = [...new Set(toRevert.map((r) => r.tanggal))];
      const { data: toDelete } = await supabase
        .from("attendance_records")
        .select("id, employee_id, tanggal, catatan")
        .in("employee_id", revertEmpIds)
        .in("tanggal", revertDates)
        .eq("status", "Libur");
      const idsToDelete = (toDelete || [])
        .filter((r) => {
          if (!toRevert.some((rv) => rv.empId === r.employee_id && rv.tanggal === r.tanggal)) return false;
          return r.catatan === `Libur nasional: ${oldHoliday.nama}` || r.catatan === "Hari libur";
        })
        .map((r) => r.id);
      if (idsToDelete.length > 0) {
        await supabase.from("attendance_records").delete().in("id", idsToDelete);
        deleted += idsToDelete.length;
      }
    }

    // Apply: INSERT atau UPDATE untuk setiap (empId, tanggal) di newSet
    if (newSet.size > 0) {
      const { data: existing } = await supabase
        .from("attendance_records")
        .select("id, employee_id, tanggal, status, catatan, is_manual")
        .in("employee_id", newEmpIds)
        .in("tanggal", newDates);
      const existingMap = new Map<string, { id: number; status: string; catatan: string | null; is_manual: boolean }>();
      (existing || []).forEach((r) => existingMap.set(`${r.employee_id}|${r.tanggal}`, r));

      const inserts: { employee_id: string; division_id: null; tanggal: string; jam_masuk: string; schedule_jam_masuk: string; toleransi_menit: number; status: string; durasi_telat: number; denda: number; catatan: string; is_manual: boolean }[] = [];
      const updateIds: { id: number; catatan: string }[] = [];
      const newCatatan = `Libur nasional: ${newHoliday.nama}`;

      for (const key of newSet) {
        const [empId, tanggal] = key.split("|");
        // Skip pegawai yang belum bergabung / sudah keluar
        const emp = employees.find((e) => e.id === empId);
        if (!emp) continue;
        if (emp.tanggal_bergabung && tanggal < emp.tanggal_bergabung) continue;
        if (emp.tanggal_keluar && tanggal > emp.tanggal_keluar) continue;

        const ex = existingMap.get(key);
        if (!ex) {
          // INSERT baru
          inserts.push({
            employee_id: empId, division_id: null, tanggal,
            jam_masuk: "00:00", schedule_jam_masuk: "00:00", toleransi_menit: 0,
            status: "Libur", durasi_telat: 0, denda: 0,
            catatan: newCatatan, is_manual: false,
          });
        } else {
          // SKIP kalau record manual atau status non-auto (Hadir/Terlambat/Izin/Sakit/Cuti)
          if (ex.is_manual) continue;
          if (["Hadir", "Terlambat", "Izin", "Sakit", "Cuti"].includes(ex.status)) continue;
          // UPDATE Alpha auto → Libur, atau update catatan Libur lama
          if (ex.status === "Alpha" && isAutoGeneratedCatatan(ex.catatan)) {
            updateIds.push({ id: ex.id, catatan: newCatatan });
          } else if (ex.status === "Libur" && isAutoGeneratedCatatan(ex.catatan) && ex.catatan !== newCatatan) {
            updateIds.push({ id: ex.id, catatan: newCatatan });
          }
        }
      }

      if (inserts.length > 0) {
        const { data: ins } = await supabase
          .from("attendance_records")
          .upsert(inserts, { onConflict: "employee_id,tanggal", ignoreDuplicates: true })
          .select("id");
        inserted += ins?.length || 0;
      }
      if (updateIds.length > 0) {
        // Update batch: status=Libur, denda=0, catatan baru
        for (const u of updateIds) {
          await supabase
            .from("attendance_records")
            .update({ status: "Libur", denda: 0, durasi_telat: 0, catatan: u.catatan, jam_masuk: "00:00", schedule_jam_masuk: "00:00", toleransi_menit: 0 })
            .eq("id", u.id);
        }
        updated += updateIds.length;
      }
    }

    return { inserted, updated, deleted };
  };

  // Hapus efek holiday saat di-delete
  const revertHolidayAttendance = async (h: PublicHoliday): Promise<{ deleted: number }> => {
    const dates = getDateRange(h.tanggal, h.tanggal_selesai);
    const empIds = getAffectedEmployeeIds(h);
    if (dates.length === 0 || empIds.length === 0) return { deleted: 0 };

    const { data } = await supabase
      .from("attendance_records")
      .select("id, catatan")
      .in("employee_id", empIds)
      .in("tanggal", dates)
      .eq("status", "Libur");
    const idsToDelete = (data || [])
      .filter((r) => r.catatan === `Libur nasional: ${h.nama}`)
      .map((r) => r.id);
    if (idsToDelete.length > 0) {
      await supabase.from("attendance_records").delete().in("id", idsToDelete);
    }
    return { deleted: idsToDelete.length };
  };

  // ─── Public Holiday CRUD ───
  const resetHolidayForm = () => {
    setHolidayForm({ nama: "", tanggal: "", tanggal_selesai: "", kategori: "Nasional", catatan: "", berlaku_untuk: "semua", divisi_ids: [], pegawai_ids: [] });
    setEditingHolidayId(null);
    setHolidayError("");
    setHolidayEmpSearch("");
  };
  const handleSaveHoliday = async () => {
    setHolidayError("");
    setHolidaySaving(true);
    if (!holidayForm.nama || !holidayForm.tanggal) {
      setHolidayError("Nama dan tanggal harus diisi.");
      setHolidaySaving(false);
      return;
    }
    if (holidayForm.berlaku_untuk === "pegawai" && holidayForm.pegawai_ids.length === 0) {
      setHolidayError("Pilih minimal 1 pegawai.");
      setHolidaySaving(false);
      return;
    }
    const payload = {
      nama: holidayForm.nama, tanggal: holidayForm.tanggal,
      tanggal_selesai: holidayForm.tanggal_selesai || null,
      kategori: holidayForm.kategori, catatan: holidayForm.catatan || null,
      berlaku_untuk: holidayForm.berlaku_untuk, divisi_ids: null,
      pegawai_ids: holidayForm.berlaku_untuk === "pegawai" ? holidayForm.pegawai_ids : null,
    };

    const oldHoliday = editingHolidayId ? publicHolidays.find((h) => h.id === editingHolidayId) || null : null;
    let savedId = editingHolidayId;
    if (editingHolidayId) {
      const { error } = await supabase.from("public_holidays").update(payload).eq("id", editingHolidayId);
      if (error) { setHolidayError(error.message); setHolidaySaving(false); return; }
    } else {
      const { data, error } = await supabase.from("public_holidays").insert(payload).select("id").single();
      if (error) { setHolidayError(error.message); setHolidaySaving(false); return; }
      savedId = data?.id || null;
    }

    // Sync attendance records di rentang tanggal libur
    const result = await syncHolidayAttendance(payload, oldHoliday);

    // Audit log
    if (savedId) {
      const rangeLabel = payload.tanggal_selesai && payload.tanggal_selesai !== payload.tanggal
        ? `${payload.tanggal} s/d ${payload.tanggal_selesai}` : payload.tanggal;
      await logAudit({
        supabase,
        action: editingHolidayId ? "update" : "create",
        entityType: "attendance_records",
        entityId: String(savedId),
        entityLabel: `Sinkronisasi libur: ${payload.nama} (${rangeLabel})`,
        metadata: { holiday_id: savedId, holiday_nama: payload.nama, inserted: result.inserted, updated: result.updated, deleted: result.deleted },
      });
    }

    const summary = `${result.inserted} baru, ${result.updated} diubah, ${result.deleted} dihapus`;
    showToast("success", editingHolidayId ? "Hari Libur Diperbarui" : "Hari Libur Ditambahkan", summary);

    resetHolidayForm();
    await Promise.all([fetchPublicHolidays(), fetchRecords()]);
    if (viewMode === "kalender") fetchCalendar();
    setHolidaySaving(false);
  };
  const handleEditHoliday = (h: PublicHoliday) => {
    setHolidayForm({ nama: h.nama, tanggal: h.tanggal, tanggal_selesai: h.tanggal_selesai || "", kategori: h.kategori, catatan: h.catatan || "", berlaku_untuk: h.berlaku_untuk, divisi_ids: h.divisi_ids || [], pegawai_ids: h.pegawai_ids || [] });
    setEditingHolidayId(h.id);
    setHolidayError("");
    setHolidayEmpSearch("");
  };
  const handleDeleteHoliday = async (id: number) => {
    const target = publicHolidays.find((h) => h.id === id);
    const { error } = await supabase.from("public_holidays").delete().eq("id", id);
    if (error) { showToast("error", "Gagal", error.message); return; }

    let revertResult = { deleted: 0 };
    if (target) {
      revertResult = await revertHolidayAttendance(target);
      const rangeLabel = target.tanggal_selesai && target.tanggal_selesai !== target.tanggal
        ? `${target.tanggal} s/d ${target.tanggal_selesai}` : target.tanggal;
      await logAudit({
        supabase,
        action: "delete",
        entityType: "attendance_records",
        entityId: String(id),
        entityLabel: `Hapus sinkronisasi libur: ${target.nama} (${rangeLabel})`,
        metadata: { holiday_id: id, holiday_nama: target.nama, deleted: revertResult.deleted },
      });
    }

    showToast("success", "Hari Libur Dihapus", `${revertResult.deleted} record absensi dihapus`);
    await Promise.all([fetchPublicHolidays(), fetchRecords()]);
    if (viewMode === "kalender") fetchCalendar();
  };

  // ─── Export CSV ───
  const exportCSV = () => {
    const headers = ["Tanggal", "Pegawai", "Divisi", "Jam Masuk", "Jadwal", "Status", "Telat (menit)", "Denda", "Catatan"];
    const csvRows = [headers.join(",")];
    filtered.forEach((r) => {
      const showJam = !NO_JAM_STATUSES.includes(r.status);
      csvRows.push([
        r.tanggal, `"${r.employeeNama}"`, `"${r.divisionNama}"`,
        showJam ? r.jam_masuk.slice(0, 5) : "-", showJam ? r.schedule_jam_masuk.slice(0, 5) : "-", r.status,
        r.durasi_telat, r.denda, `"${r.catatan || ""}"`,
      ].join(","));
    });
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Absensi_${dateFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  // ─── Export PDF ───
  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Absensi Pegawai", pw / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Tanggal: ${dateFilter}`, pw / 2, 21, { align: "center" });
    const tableData = filtered.map((r, i) => {
      const showJam = !NO_JAM_STATUSES.includes(r.status);
      return [
        i + 1, r.employeeNama || "-", r.divisionNama || "-",
        showJam ? r.jam_masuk.slice(0, 5) : "-", showJam ? r.schedule_jam_masuk.slice(0, 5) : "-",
        r.status, r.durasi_telat > 0 ? `${r.durasi_telat} mnt` : "-",
        r.denda > 0 ? formatCurrency(r.denda) : "-", r.catatan || "-",
      ];
    });
    autoTable(doc, {
      startY: 28,
      head: [["#", "Pegawai", "Divisi", "Masuk", "Jadwal", "Status", "Telat", "Denda", "Catatan"]],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { halign: "center", cellWidth: 8 }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center" }, 6: { halign: "center" }, 7: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });
    doc.save(`Absensi_${dateFilter}.pdf`);
    setShowExportMenu(false);
  };

  return (
    <RouteGuard permission="attendance">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Absensi Pegawai"
        description="Pantau kehadiran harian pegawai"
        icon={ClipboardCheck}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon={CalendarOff} onClick={openOffDay}>Atur Libur</Button>
            <div ref={exportRef} className="relative">
              <Button variant="outline" size="sm" icon={Download} onClick={() => setShowExportMenu(!showExportMenu)} disabled={records.length === 0}>
                Export <ChevronDown className="w-3 h-3 ml-0.5" />
              </Button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-44 bg-card rounded-xl border border-border shadow-xl z-10 overflow-hidden animate-scale-in">
                  <button onClick={exportPDF} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                    <FileText className="w-3.5 h-3.5 text-danger" />Export PDF
                  </button>
                  <button onClick={exportCSV} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors border-t border-border">
                    <FileText className="w-3.5 h-3.5 text-success" />Export CSV
                  </button>
                </div>
              )}
            </div>
            {canInput && <Button icon={Plus} size="sm" onClick={openAdd}>Input Absen</Button>}
          </div>
        }
      />

      {/* Toast */}
      {toast.show && (
        <Portal>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
            <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]", toast.type === "error" ? "border-danger/20" : "border-success/20")}>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
                {toast.type === "error" ? <AlertTriangle className="w-5 h-5 text-danger" /> : <CircleCheckBig className="w-5 h-5 text-success" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{toast.title}</p>
                {toast.message && <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>}
              </div>
              <button onClick={() => setToast({ show: false, title: "", message: "", type: "success" })} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </Portal>
      )}

      {/* View toggle + toolbar */}
      <div className="flex items-center gap-1 bg-muted rounded-xl p-1 w-fit">
        <button onClick={() => setViewMode("tabel")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
            viewMode === "tabel" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          <LayoutList className="w-3.5 h-3.5" />Tabel
        </button>
        <button onClick={() => setViewMode("kalender")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
            viewMode === "kalender" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          <CalendarDays className="w-3.5 h-3.5" />Kalender
        </button>
        <button onClick={() => setViewMode("ringkasan")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
            viewMode === "ringkasan" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          <BarChart3 className="w-3.5 h-3.5" />Ringkasan
        </button>
      </div>

      {viewMode === "tabel" && (<>
      <div className="bg-card rounded-2xl border border-border p-3">
        {/* Row 1: Date navigator + search + tutup absen */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
            <button onClick={() => { setDateFilter(addDays(dateFilter, -1)); setPage(1); }}
              disabled={dateFilter <= MIN_DATE}
              className={`p-1.5 rounded-lg transition-colors ${dateFilter <= MIN_DATE ? "opacity-30 cursor-not-allowed" : "hover:bg-card text-muted-foreground hover:text-foreground"}`}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="px-2 py-1 text-center min-w-[170px]">
              <p className="text-[11px] font-bold text-foreground">
                {new Date(dateFilter + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
            <button onClick={() => { setDateFilter(addDays(dateFilter, 1)); setPage(1); }}
              className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" placeholder="Cari nama atau divisi..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>

        </div>
        {/* Row 2: Status filter pills + info badges */}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {[
            { label: "Semua", value: records.length, color: "#6b7280" },
            ...STATUS_OPTIONS.map((s) => ({ label: s.label, value: statusCounts[s.value], color: s.color })),
          ].map((stat) => {
            const isActive = filterStatus === stat.label;
            return (
              <button key={stat.label} onClick={() => { setFilterStatus(stat.label); setPage(1); }}
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
          {/* Denda badge */}
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

      {/* Table */}
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
                const sc = STATUS_OPTIONS.find((s) => s.value === row.status);
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-foreground">{row.employeeNama}</p>
                      {(row as any).is_manual && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded mt-0.5">
                          Manual{(row as any).alasan_manual ? `: ${(row as any).alasan_manual}` : ""}
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
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${sc?.color}20`, color: sc?.color }}>{row.status}</span>
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
                        {canEdit && <button onClick={() => openEdit(row)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                        {canEdit && <button onClick={() => setDeleteConfirm({ id: row.id, nama: `${row.employeeNama} (${row.tanggal})` })} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
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
      </>)}

      {/* ═══ KALENDER VIEW ═══ */}
      {viewMode === "kalender" && (() => {
        const calPeriod = getCalPeriod(calPeriodKey);

        // Generate array tanggal dari 8 bulan ini s/d 7 bulan berikutnya (timezone safe)
        const calDates: { dateStr: string; day: number; dow: number; monthLabel: string }[] = [];
        const [sy, sm, sd] = calPeriod.start.split("-").map(Number);
        const [ey, em, ed] = calPeriod.end.split("-").map(Number);
        const startMs = Date.UTC(sy, sm - 1, sd);
        const endMs = Date.UTC(ey, em - 1, ed);
        for (let ms = startMs; ms <= endMs; ms += 86400000) {
          const dt = new Date(ms);
          const dateStr = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
          calDates.push({
            dateStr,
            day: dt.getUTCDate(),
            dow: dt.getUTCDay(),
            monthLabel: new Date(dt.getUTCFullYear(), dt.getUTCMonth()).toLocaleDateString("id-ID", { month: "short" }),
          });
        }

        // Semua pegawai aktif
        const calEmps = employees
          .map(e => ({ id: e.id, nama: e.nama }))
          .filter(e => !calSearch || e.nama.toLowerCase().includes(calSearch.toLowerCase()));

        // Map: employee_id -> dateStr -> status
        const calMap = new Map<string, Map<string, { status: string; color: string }>>();
        calRecords.forEach(r => {
          if (!calMap.has(r.employee_id)) calMap.set(r.employee_id, new Map());
          const sc = STATUS_OPTIONS.find(s => s.value === r.status);
          calMap.get(r.employee_id)!.set(r.tanggal, { status: r.status, color: sc?.color || "#6b7280" });
        });

        const todayStr = localDateStr();

        // Hitung statistik untuk header
        const totalEntries = calRecords.length;
        const statusBreakdown = new Map<string, { count: number; color: string }>();
        calRecords.forEach(r => {
          const sc = STATUS_OPTIONS.find(s => s.value === r.status);
          const existing = statusBreakdown.get(r.status);
          if (existing) existing.count++;
          else statusBreakdown.set(r.status, { count: 1, color: sc?.color || "#6b7280" });
        });

        return (
          <Portal>
            <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
              {/* ── Header ── */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-gradient-to-r from-card via-card to-primary/[0.03]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20 flex-shrink-0">
                    <CalendarDays className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-foreground">Kalender Absensi</h2>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                      <span><strong className="text-foreground">{calEmps.length}</strong> pegawai</span>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span><strong className="text-foreground">{totalEntries}</strong> entri</span>
                      {Array.from(statusBreakdown.entries()).map(([nama, { count, color }]) => (
                        <span key={nama} className="inline-flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                          <strong style={{ color }}>{count}</strong> {nama.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-56">
                    <Search className="w-3.5 h-3.5 text-muted-foreground" />
                    <input type="text" placeholder="Cari pegawai..." value={calSearch} onChange={(e) => setCalSearch(e.target.value)}
                      className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
                  </div>
                  <div className="flex items-center bg-muted rounded-xl p-1">
                    <button onClick={() => {
                      const [py, pm] = calPeriodKey.split("-").map(Number);
                      const prev = new Date(py, pm - 2, 1);
                      setCalPeriodKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
                    }} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                    <span className="text-xs font-bold text-foreground px-3 min-w-[220px] text-center">{calPeriod.label}</span>
                    <button onClick={() => {
                      const [ny, nm] = calPeriodKey.split("-").map(Number);
                      const next = new Date(ny, nm, 1);
                      setCalPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
                    }} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <button onClick={() => setViewMode("tabel")} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-3.5 h-3.5" />Tutup
                  </button>
                </div>
              </div>

              {/* ── Matrix table ── */}
              <div className="flex-1 overflow-auto bg-background">
                {calLoading ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Memuat data...</div>
                ) : calEmps.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Tidak ada pegawai sesuai pencarian.</div>
                ) : (
                  <table className="border-collapse w-max min-w-full">
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th className="sticky left-0 z-30 bg-card border-b-2 border-r-2 border-border px-4 py-3 text-left min-w-[180px] shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Pegawai</span>
                        </th>
                        {calDates.map((d, i) => {
                          const isWeekend = d.dow === 0 || d.dow === 6;
                          const isToday = d.dateStr === todayStr;
                          const isNewMonth = i === 0 || d.day === 1;
                          return (
                            <th key={d.dateStr} className={cn(
                              "border-b-2 border-r border-border px-1 py-2 text-center min-w-[44px]",
                              isNewMonth && "border-l-2 border-l-primary/30",
                              isToday ? "bg-primary text-white" : isWeekend ? "bg-danger-light text-danger" : "bg-card text-muted-foreground"
                            )}>
                              {isNewMonth && (
                                <div className={cn("text-[8px] font-bold uppercase tracking-wider mb-0.5", isToday ? "text-white/70" : "text-primary/60")}>
                                  {d.monthLabel}
                                </div>
                              )}
                              <div className="text-xs font-bold">{d.day}</div>
                              <div className={cn("text-[9px] font-normal mt-0.5", isToday ? "text-white/80" : "")}>
                                {["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"][d.dow]}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {calEmps.map((emp, idx) => {
                        const empMap = calMap.get(emp.id);
                        const isOdd = idx % 2 === 1;
                        return (
                          <tr key={emp.id} className="group">
                            <td className={cn("sticky left-0 z-10 px-4 py-2.5 text-xs font-semibold text-foreground border-r-2 border-b border-border truncate max-w-[180px] shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)] group-hover:brightness-95",
                              isOdd ? "bg-muted" : "bg-card")}>
                              {emp.nama}
                            </td>
                            {calDates.map(d => {
                              const entry = empMap?.get(d.dateStr);
                              const isWeekend = d.dow === 0 || d.dow === 6;
                              const isToday = d.dateStr === todayStr;
                              const isNewMonth = d.day === 1;
                              return (
                                <td key={d.dateStr} className={cn("border-b border-r border-border px-1 py-2 text-center align-middle",
                                  isNewMonth && "border-l-2 border-l-primary/30",
                                  isToday ? "bg-primary-light" : isWeekend ? "bg-danger-light" : isOdd ? "bg-muted" : "bg-card",
                                  "group-hover:brightness-95")}>
                                  {entry ? (
                                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold text-white"
                                      style={{ backgroundColor: entry.color }}
                                      title={`${emp.nama} — ${entry.status} (${d.dateStr})`}>
                                      {entry.status.charAt(0)}
                                    </span>
                                  ) : (
                                    <span className="inline-block w-7 h-7 rounded-md text-[10px] text-muted-foreground/30 leading-7">—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ── Footer legend ── */}
              <div className="flex items-center gap-4 px-5 py-2.5 border-t border-border bg-card flex-wrap">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Legenda:</span>
                {STATUS_OPTIONS.map(s => (
                  <div key={s.value} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md text-[9px] font-bold text-white" style={{ backgroundColor: s.color }}>{s.label.charAt(0)}</span>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Portal>
        );
      })()}

      {/* ═══ ADD/EDIT FORM MODAL ═══ */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !formSaving && setShowForm(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              {/* Header with gradient */}
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !formSaving && setShowForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                    {editingId ? <Pencil className="w-5 h-5 text-white" /> : <ClipboardCheck className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{editingId ? "Edit Data Absen" : "Input Absen Pegawai"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {editingId ? "Perbarui data kehadiran" : "Catat kehadiran pegawai"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Form body */}
              <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
                {formError && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{formError}
                  </div>
                )}

                {/* Pegawai */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Pegawai <span className="text-danger">*</span></label>
                  {editingId ? (
                    <div className="px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-foreground">
                      {employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id}
                    </div>
                  ) : (
                    <>
                      <Select
                        value={form.employee_id}
                        onChange={(val) => { setForm({ ...form, employee_id: val }); setFormError(""); }}
                        options={employees.filter((e) => !formExistingEmpIds.has(e.id)).map((e) => ({ value: e.id, label: e.nama }))}
                        placeholder="Pilih pegawai"
                        searchable
                      />
                      {formExistingEmpIds.size > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1">{formExistingEmpIds.size} pegawai sudah absen di tanggal ini</p>
                      )}
                    </>
                  )}
                </div>

                {/* Divisi + Tanggal */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Divisi <span className="text-danger">*</span></label>
                    <Select
                      value={String(form.division_id || "")}
                      onChange={(val) => { setForm({ ...form, division_id: parseInt(val) || 0 }); setFormError(""); }}
                      options={divisions.map((d) => ({ value: String(d.id), label: d.nama }))}
                      placeholder="Pilih divisi"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal <span className="text-danger">*</span></label>
                    <DatePicker value={form.tanggal} onChange={(val) => { setForm({ ...form, tanggal: val, employee_id: "" }); if (!editingId) fetchFormExisting(val); }} placeholder="Pilih tanggal" minDate={MIN_DATE} />
                  </div>
                </div>

                {/* Status khusus (Izin/Sakit/Alpha) */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-2 block">Keterangan Tidak Hadir</label>
                  <div className="flex items-center gap-2">
                    {(["Alpha"] as const).map((s) => {
                      const sc = STATUS_OPTIONS.find((o) => o.value === s)!;
                      const active = form.specialStatus === s;
                      return (
                        <button key={s} type="button"
                          onClick={() => setForm({ ...form, specialStatus: active ? "" : s, jam_masuk: active ? form.jam_masuk : "" })}
                          className={cn(
                            "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border-2",
                            active
                              ? "shadow-md"
                              : "border-border bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/50"
                          )}
                          style={active ? { borderColor: sc.color, backgroundColor: `${sc.color}15`, color: sc.color, boxShadow: `0 4px 12px ${sc.color}20` } : undefined}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                  {isSpecial && (
                    <p className="text-[10px] text-muted-foreground mt-1.5">Jam masuk tidak diperlukan untuk status {form.specialStatus}</p>
                  )}
                </div>

                {/* Jam Masuk */}
                {!isSpecial && (() => {
                  const [hh, mm] = (form.jam_masuk || "").split(":").map((v) => parseInt(v) || 0);
                  const hasTime = !!form.jam_masuk;
                  const setTime = (h: number, m: number) => {
                    const ch = Math.max(0, Math.min(23, h));
                    const cm = Math.max(0, Math.min(59, m));
                    const val = `${String(ch).padStart(2, "0")}:${String(cm).padStart(2, "0")}`;
                    setForm({ ...form, jam_masuk: val });
                    setFormError("");
                  };
                  const presets = formSchedule
                    ? [formSchedule.jam_masuk.slice(0, 5), ...[5, 10, 15, 30].map((d) => {
                        const base = timeToMinutes(formSchedule.jam_masuk);
                        const t = base + d;
                        return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
                      })]
                    : ["07:00", "07:30", "08:00", "08:15", "08:30"];

                  return (
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-2 block">Jam Masuk <span className="text-danger">*</span></label>

                      {/* Time display */}
                      <div className="flex items-center justify-center gap-1 mb-3">
                        {/* Hour */}
                        <div className="flex flex-col items-center gap-1">
                          <button type="button" onClick={() => setTime(hh + 1, mm)}
                            className="w-8 h-5 rounded-md bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <div className={cn(
                            "w-16 h-14 rounded-xl flex items-center justify-center text-2xl font-extrabold tracking-wider transition-all",
                            hasTime ? "bg-primary/10 text-primary border-2 border-primary/20" : "bg-muted/50 text-muted-foreground/40 border-2 border-dashed border-border"
                          )}>
                            {hasTime ? String(hh).padStart(2, "0") : "--"}
                          </div>
                          <button type="button" onClick={() => setTime(hh - 1, mm)}
                            className="w-8 h-5 rounded-md bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Separator */}
                        <div className="flex flex-col items-center gap-1.5 px-1 pt-1">
                          <div className={cn("w-1.5 h-1.5 rounded-full", hasTime ? "bg-primary" : "bg-muted-foreground/30")} />
                          <div className={cn("w-1.5 h-1.5 rounded-full", hasTime ? "bg-primary" : "bg-muted-foreground/30")} />
                        </div>

                        {/* Minute */}
                        <div className="flex flex-col items-center gap-1">
                          <button type="button" onClick={() => setTime(hh, mm + 1)}
                            className="w-8 h-5 rounded-md bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <div className={cn(
                            "w-16 h-14 rounded-xl flex items-center justify-center text-2xl font-extrabold tracking-wider transition-all",
                            hasTime ? "bg-primary/10 text-primary border-2 border-primary/20" : "bg-muted/50 text-muted-foreground/40 border-2 border-dashed border-border"
                          )}>
                            {hasTime ? String(mm).padStart(2, "0") : "--"}
                          </div>
                          <button type="button" onClick={() => setTime(hh, mm - 1)}
                            className="w-8 h-5 rounded-md bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Quick presets */}
                      <div className="flex items-center gap-1.5 justify-center">
                        {presets.map((t) => {
                          const isActive = form.jam_masuk === t;
                          return (
                            <button key={t} type="button" onClick={() => { setForm({ ...form, jam_masuk: t }); setFormError(""); }}
                              className={cn(
                                "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                                isActive
                                  ? "bg-primary text-white shadow-sm shadow-primary/25"
                                  : "bg-muted/60 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                              )}>
                              {t}
                            </button>
                          );
                        })}
                      </div>

                      {/* Schedule info */}
                      {formSchedule && (
                        <div className="flex items-center justify-center gap-2 mt-3">
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-lg">
                            <Clock className="w-3 h-3" />
                            Jadwal <strong className="text-foreground">{formSchedule.jam_masuk.slice(0, 5)}</strong>
                          </div>
                          {formSchedule.toleransi_menit > 0 && (
                            <div className="text-[10px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-lg">
                              Toleransi <strong className="text-foreground">{formSchedule.toleransi_menit} mnt</strong>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Live Preview */}
                {formPreview && (
                  <div className="rounded-xl border-2 p-4 transition-all" style={{ borderColor: `${previewColor}30`, backgroundColor: `${previewColor}08` }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${previewColor}20` }}>
                          <span className="text-sm font-extrabold" style={{ color: previewColor }}>
                            {formPreview.status === "Hadir" ? <Check className="w-4.5 h-4.5" /> : formPreview.status.charAt(0)}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-bold" style={{ color: previewColor }}>{formPreview.status}</p>
                          {formPreview.durasi > 0 && (
                            <p className="text-[10px] text-muted-foreground">Terlambat {formPreview.durasi} menit</p>
                          )}
                        </div>
                      </div>
                      {formPreview.denda > 0 && (
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground">Denda</p>
                          <p className="text-sm font-bold text-danger">{formatCurrency(formPreview.denda)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Alasan Input Manual */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Alasan Input Manual <span className="text-danger">*</span></label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {ALASAN_MANUAL_OPTIONS.map((alasan) => (
                      <button key={alasan} type="button" onClick={() => setForm({ ...form, alasan_manual: alasan })}
                        className={cn("px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                          form.alasan_manual === alasan
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        )}>
                        {alasan}
                      </button>
                    ))}
                  </div>
                  {form.alasan_manual === "Lainnya" && (
                    <input type="text" placeholder="Tulis alasan lainnya..." value={form.catatan}
                      onChange={(e) => setForm({ ...form, catatan: e.target.value })} className={inputClass} />
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">Wajib dipilih karena absen diinput manual (bukan dari aplikasi)</p>
                </div>

                {/* Catatan */}
                {form.alasan_manual !== "Lainnya" && (
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                  <input type="text" placeholder="Keterangan tambahan..." value={form.catatan}
                    onChange={(e) => setForm({ ...form, catatan: e.target.value })} className={inputClass} />
                </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                <Button size="sm" icon={editingId ? Check : Plus} onClick={handleSave} disabled={formSaving}>
                  {formSaving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Simpan Absen"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ DELETE CONFIRM ═══ */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-danger" /></div>
                <h3 className="text-base font-bold text-foreground">Hapus Data Absen?</h3>
                <p className="text-sm text-muted-foreground mt-2">Data <span className="font-semibold text-foreground">&ldquo;{deleteConfirm.nama}&rdquo;</span> akan dihapus permanen.</p>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                <Button variant="danger" size="sm" icon={Trash2} className="flex-1" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Menghapus..." : "Hapus"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ ATUR LIBUR MODAL ═══ */}
      {showOffDay && (
        <Portal>
          <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-gradient-to-r from-card via-card to-violet-500/[0.03] flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-violet-500/70 flex items-center justify-center shadow-sm shadow-violet-500/20">
                  <CalendarOff className="w-4.5 h-4.5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Atur Hari Libur</h2>
                  <p className="text-[10px] text-muted-foreground">Jadwal mingguan & custom per tanggal</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Tab toggle */}
                <div className="flex items-center bg-muted rounded-xl p-0.5">
                  <button onClick={() => setOffDayTab("mingguan")}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                      offDayTab === "mingguan" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <CalendarOff className="w-3 h-3" />Mingguan
                  </button>
                  <button onClick={() => setOffDayTab("custom")}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                      offDayTab === "custom" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <ArrowRightLeft className="w-3 h-3" />Custom
                    {overrides.length > 0 && <span className="text-[9px] font-bold bg-violet-500/10 text-violet-500 px-1.5 py-0.5 rounded">{overrides.length}</span>}
                  </button>
                  <button onClick={() => { setOffDayTab("libur"); resetHolidayForm(); }}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                      offDayTab === "libur" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <Calendar className="w-3 h-3" />Hari Libur
                    {publicHolidays.length > 0 && <span className="text-[9px] font-bold bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded">{publicHolidays.length}</span>}
                  </button>
                </div>
                <button onClick={() => setShowOffDay(false)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />Tutup
                </button>
              </div>
            </div>

            {/* Subheader: search (mingguan) or info (custom) */}
            {offDayTab === "mingguan" && (
              <div className="px-5 py-2 border-b border-border bg-card flex items-center gap-3">
                <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 max-w-sm">
                  <Search className="w-3.5 h-3.5 text-muted-foreground" />
                  <input type="text" placeholder="Cari pegawai..." value={offDaySearch} onChange={(e) => setOffDaySearch(e.target.value)}
                    className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/50 text-foreground" />
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span><strong className="text-foreground">{employees.length}</strong> pegawai</span>
                  <span className="w-1 h-1 rounded-full bg-border" />
                  <span><strong className="text-violet-500">{Array.from(offDayLocal.values()).reduce((s, days) => s + days.size, 0)}</strong> hari libur</span>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {offDayTab === "mingguan" ? (
                /* ── Tab Mingguan ── */
                <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "180px" }} />
                    {DAY_SHORT.map((_, i) => <col key={i} />)}
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-card">
                      <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-3 border-b-2 border-r border-border">Pegawai</th>
                      {DAY_SHORT.map((d, i) => (
                        <th key={i} className={cn("text-center text-[10px] font-bold uppercase tracking-wider py-3 border-b-2 border-r border-border last:border-r-0",
                          i === 0 ? "text-danger/70 bg-danger/[0.03]" : i === 6 ? "text-warning/70 bg-warning/[0.03]" : "text-muted-foreground")}>{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees
                      .filter((e) => e.nama.toLowerCase().includes(offDaySearch.toLowerCase()))
                      .map((emp, empIdx) => {
                        const empDays = offDayLocal.get(emp.id) || new Set<number>();
                        const offCount = empDays.size;
                        return (
                          <tr key={emp.id} className={cn("transition-colors", empIdx % 2 === 0 ? "bg-card" : "bg-muted/[0.04]", "hover:bg-violet-500/[0.03]")}>
                            <td className="px-3 py-2 border-b border-r border-border">
                              <div className="flex items-center gap-2">
                                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
                                  offCount > 0 ? "bg-gradient-to-br from-violet-500 to-violet-600 shadow-sm shadow-violet-500/20" : "bg-primary/10")}>
                                  <User className={cn("w-3.5 h-3.5", offCount > 0 ? "text-white" : "text-primary/60")} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-semibold text-foreground truncate">{emp.nama}</p>
                                  <p className={cn("text-[9px]", offCount > 0 ? "text-violet-500" : "text-muted-foreground/30")}>
                                    {offCount > 0 ? `${offCount} hari libur` : "Tidak ada libur"}
                                  </p>
                                </div>
                              </div>
                            </td>
                            {DAY_SHORT.map((_, dayIdx) => {
                              const isOff = empDays.has(dayIdx);
                              const isSunday = dayIdx === 0;
                              const isSaturday = dayIdx === 6;
                              return (
                                <td key={dayIdx} className={cn(
                                  "py-2 text-center border-b border-r border-border last:border-r-0",
                                  isSunday ? "bg-danger/[0.02]" : isSaturday ? "bg-warning/[0.02]" : ""
                                )}>
                                  <button type="button" onClick={() => toggleOffDay(emp.id, dayIdx)}
                                    className={cn(
                                      "w-10 h-9 rounded-lg text-[10px] font-extrabold transition-all mx-auto block",
                                      isOff
                                        ? "bg-gradient-to-b from-violet-500 to-violet-600 text-white shadow-md shadow-violet-500/25 hover:shadow-lg hover:shadow-violet-500/30 scale-105"
                                        : "bg-muted/40 text-muted-foreground/15 hover:bg-violet-500/10 hover:text-violet-500 hover:scale-105"
                                    )}>
                                    {isOff ? "OFF" : "•"}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ) : offDayTab === "custom" ? (
                /* ── Tab Custom Tanggal ── */
                <div className="p-5 space-y-5">
                  {/* Form tambah */}
                  <div className="rounded-2xl border-2 border-dashed border-violet-500/20 bg-gradient-to-br from-violet-500/[0.03] to-transparent p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                        <Plus className="w-3.5 h-3.5 text-violet-500" />
                      </div>
                      <p className="text-xs font-bold text-foreground">Tambah Tukar Libur / Masuk Backup</p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Pegawai</label>
                        <Select value={overrideEmpId} onChange={setOverrideEmpId}
                          options={employees.map((e) => ({ value: e.id, label: e.nama }))} placeholder="Pilih pegawai" searchable />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Tanggal</label>
                        <DatePicker value={overrideTanggal} onChange={setOverrideTanggal} placeholder="Pilih tanggal" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Catatan</label>
                        <input type="text" placeholder="Opsional..." value={overrideCatatan}
                          onChange={(e) => setOverrideCatatan(e.target.value)}
                          className="w-full text-xs px-3 py-2.5 rounded-xl border border-border bg-muted/30 outline-none focus:border-primary text-foreground placeholder:text-muted-foreground/50" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setOverrideType("libur")}
                          className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border-2",
                            overrideType === "libur"
                              ? "border-violet-500 bg-violet-500/10 text-violet-500 shadow-sm shadow-violet-500/10"
                              : "border-border bg-card text-muted-foreground hover:border-violet-500/30")}>
                          <CalendarOff className="w-3.5 h-3.5" />
                          Tukar Libur
                        </button>
                        <button type="button" onClick={() => setOverrideType("masuk")}
                          className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border-2",
                            overrideType === "masuk"
                              ? "border-success bg-success/10 text-success shadow-sm shadow-success/10"
                              : "border-border bg-card text-muted-foreground hover:border-success/30")}>
                          <UserCheck className="w-3.5 h-3.5" />
                          Masuk Backup
                        </button>
                      </div>
                      <Button size="sm" icon={Plus} onClick={handleAddOverride} disabled={overrideSaving || !overrideEmpId || !overrideTanggal}>
                        {overrideSaving ? "Menyimpan..." : "Tambah"}
                      </Button>
                    </div>
                  </div>

                  {/* List overrides */}
                  {overrides.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <ArrowRightLeft className="w-10 h-10 text-muted-foreground/15 mb-3" />
                      <p className="text-sm text-muted-foreground">Belum ada tukar libur atau masuk backup</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Gunakan form di atas untuk menambahkan</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {overrides.map((o) => {
                        const empNama = employees.find((e) => e.id === o.employee_id)?.nama || o.employee_id;
                        const isLibur = o.type === "libur";
                        return (
                          <div key={o.id} className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors hover:bg-muted/30",
                            isLibur ? "border-violet-500/15 bg-violet-500/[0.02]" : "border-success/15 bg-success/[0.02]")}>
                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                              isLibur ? "bg-violet-500/10" : "bg-success/10")}>
                              {isLibur ? <CalendarOff className="w-3.5 h-3.5 text-violet-500" /> : <UserCheck className="w-3.5 h-3.5 text-success" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-semibold text-foreground">{empNama}</p>
                                <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-md",
                                  isLibur ? "bg-violet-500/10 text-violet-500" : "bg-success/10 text-success")}>
                                  {isLibur ? "Tukar Libur" : "Masuk Backup"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-[10px] text-muted-foreground">
                                  {new Date(o.tanggal + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                </p>
                                {o.catatan && (
                                  <>
                                    <span className="w-1 h-1 rounded-full bg-border" />
                                    <p className="text-[10px] text-muted-foreground/70">{o.catatan}</p>
                                  </>
                                )}
                              </div>
                            </div>
                            <button onClick={() => handleDeleteOverride(o.id)}
                              className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground/40 hover:text-danger transition-colors flex-shrink-0">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* ── Tab Hari Libur ── */
                <div className="p-5 space-y-5">
                  {/* Form tambah/edit */}
                  <div className="rounded-2xl border-2 border-dashed border-blue-500/20 bg-gradient-to-br from-blue-500/[0.03] to-transparent p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <Plus className="w-3.5 h-3.5 text-blue-500" />
                      </div>
                      <p className="text-xs font-bold text-foreground">{editingHolidayId ? "Edit Hari Libur" : "Tambah Hari Libur Nasional"}</p>
                    </div>
                    {holidayError && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-danger/10 text-danger text-xs font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" />{holidayError}
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Nama Hari Libur</label>
                      <input type="text" placeholder="Misal: Idul Fitri 1448 H, Natal 2026..." value={holidayForm.nama}
                        onChange={(e) => setHolidayForm({ ...holidayForm, nama: e.target.value })}
                        className="w-full text-xs px-3 py-2.5 rounded-xl border border-border bg-muted/30 outline-none focus:border-primary text-foreground placeholder:text-muted-foreground/50" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Tanggal Mulai</label>
                        <DatePicker value={holidayForm.tanggal} onChange={(val) => setHolidayForm({ ...holidayForm, tanggal: val })} placeholder="Pilih tanggal" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Tanggal Selesai <span className="text-muted-foreground/50 font-normal">(opsional)</span></label>
                        <DatePicker value={holidayForm.tanggal_selesai} onChange={(val) => setHolidayForm({ ...holidayForm, tanggal_selesai: val })} placeholder="Sama dengan mulai" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Kategori</label>
                      <div className="flex items-center gap-2">
                        {(["Nasional", "Cuti Bersama", "Spesial"] as const).map((k) => (
                          <button key={k} type="button" onClick={() => setHolidayForm({ ...holidayForm, kategori: k })}
                            className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border-2",
                              holidayForm.kategori === k ? "border-blue-500 bg-blue-500/10 text-blue-500" : "border-border bg-card text-muted-foreground hover:border-blue-500/30")}>
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: HOLIDAY_COLORS[k] }} />{k}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Catatan <span className="text-muted-foreground/50 font-normal">(opsional)</span></label>
                      <input type="text" placeholder="Keterangan tambahan..." value={holidayForm.catatan}
                        onChange={(e) => setHolidayForm({ ...holidayForm, catatan: e.target.value })}
                        className="w-full text-xs px-3 py-2.5 rounded-xl border border-border bg-muted/30 outline-none focus:border-primary text-foreground placeholder:text-muted-foreground/50" />
                    </div>
                    {/* Berlaku Untuk */}
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Berlaku Untuk</label>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setHolidayForm({ ...holidayForm, berlaku_untuk: "semua", pegawai_ids: [] })}
                          className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border-2",
                            holidayForm.berlaku_untuk === "semua" ? "border-success bg-success/10 text-success" : "border-border bg-card text-muted-foreground hover:border-success/30")}>
                          <UserCheck className="w-3.5 h-3.5" />
                          Semua Pegawai
                        </button>
                        <button type="button" onClick={() => setHolidayForm({ ...holidayForm, berlaku_untuk: "pegawai" })}
                          className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border-2",
                            holidayForm.berlaku_untuk === "pegawai" ? "border-orange-500 bg-orange-500/10 text-orange-500" : "border-border bg-card text-muted-foreground hover:border-orange-500/30")}>
                          <User className="w-3.5 h-3.5" />
                          Pilih Pegawai
                          {holidayForm.berlaku_untuk === "pegawai" && holidayForm.pegawai_ids.length > 0 && (
                            <span className="text-[9px] font-bold bg-orange-500/20 text-orange-600 px-1.5 py-0.5 rounded">{holidayForm.pegawai_ids.length}</span>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Multi-select pegawai (hanya saat berlaku_untuk = pegawai) */}
                    {holidayForm.berlaku_untuk === "pegawai" && (
                      <div className="rounded-xl border-2 border-orange-500/15 bg-orange-500/[0.02] p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2 bg-card rounded-lg px-3 py-1.5 flex-1 border border-border">
                            <Search className="w-3 h-3 text-muted-foreground" />
                            <input type="text" placeholder="Cari pegawai..." value={holidayEmpSearch}
                              onChange={(e) => setHolidayEmpSearch(e.target.value)}
                              className="bg-transparent text-[11px] outline-none w-full text-foreground placeholder:text-muted-foreground/50" />
                          </div>
                          <button type="button" onClick={() => setHolidayForm({ ...holidayForm, pegawai_ids: employees.map((e) => e.id) })}
                            className="text-[10px] font-bold text-orange-500 hover:text-orange-600 px-2 py-1 rounded">Pilih Semua</button>
                          <button type="button" onClick={() => setHolidayForm({ ...holidayForm, pegawai_ids: [] })}
                            className="text-[10px] font-bold text-muted-foreground hover:text-foreground px-2 py-1 rounded">Hapus Semua</button>
                        </div>
                        <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                          {employees
                            .filter((e) => e.nama.toLowerCase().includes(holidayEmpSearch.toLowerCase()))
                            .map((e) => {
                              const checked = holidayForm.pegawai_ids.includes(e.id);
                              return (
                                <label key={e.id}
                                  className={cn("flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors",
                                    checked ? "bg-orange-500/10" : "hover:bg-muted/50")}>
                                  <input type="checkbox" checked={checked}
                                    onChange={(ev) => {
                                      if (ev.target.checked) {
                                        setHolidayForm({ ...holidayForm, pegawai_ids: [...holidayForm.pegawai_ids, e.id] });
                                      } else {
                                        setHolidayForm({ ...holidayForm, pegawai_ids: holidayForm.pegawai_ids.filter((id) => id !== e.id) });
                                      }
                                    }}
                                    className="w-3.5 h-3.5 rounded accent-orange-500 cursor-pointer" />
                                  <span className="text-[11px] font-medium text-foreground flex-1">{e.nama}</span>
                                </label>
                              );
                            })}
                          {employees.filter((e) => e.nama.toLowerCase().includes(holidayEmpSearch.toLowerCase())).length === 0 && (
                            <p className="text-[10px] text-muted-foreground/50 text-center py-3">Tidak ditemukan</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between pt-1.5 border-t border-orange-500/10">
                          <span className="text-[10px] text-muted-foreground">
                            <strong className="text-orange-500">{holidayForm.pegawai_ids.length}</strong> dari {employees.length} pegawai dipilih
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        {editingHolidayId && <Button variant="outline" size="sm" onClick={resetHolidayForm}>Batal Edit</Button>}
                        <Button size="sm" icon={editingHolidayId ? Check : Plus} onClick={handleSaveHoliday} disabled={holidaySaving || !holidayForm.nama || !holidayForm.tanggal}>
                          {holidaySaving ? "Menyimpan..." : editingHolidayId ? "Simpan" : "Tambah"}
                        </Button>
                      </div>
                    </div>
                  </div>
                  {/* List holidays */}
                  {publicHolidays.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <Calendar className="w-10 h-10 text-muted-foreground/15 mb-3" />
                      <p className="text-sm text-muted-foreground">Belum ada hari libur nasional</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Gunakan form di atas untuk menambahkan</p>
                    </div>
                  ) : (() => {
                    const filtered = publicHolidays.filter((h) => {
                      if (holidayKategoriFilter !== "Semua" && h.kategori !== holidayKategoriFilter) return false;
                      if (holidayListSearch) {
                        const q = holidayListSearch.toLowerCase();
                        if (!h.nama.toLowerCase().includes(q) && !(h.catatan || "").toLowerCase().includes(q)) return false;
                      }
                      return true;
                    });
                    const total = filtered.length;
                    const totalPages = Math.max(1, Math.ceil(total / HOLIDAY_PAGE_SIZE));
                    const safePage = Math.min(holidayListPage, totalPages);
                    const paged = filtered.slice((safePage - 1) * HOLIDAY_PAGE_SIZE, safePage * HOLIDAY_PAGE_SIZE);

                    return (
                      <div className="space-y-3">
                        {/* Search + Filter */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-2 bg-muted/40 rounded-xl px-3 py-2 flex-1 min-w-[200px]">
                            <Search className="w-3.5 h-3.5 text-muted-foreground" />
                            <input type="text" placeholder="Cari nama hari libur..." value={holidayListSearch}
                              onChange={(e) => { setHolidayListSearch(e.target.value); setHolidayListPage(1); }}
                              className="bg-transparent text-xs outline-none w-full text-foreground placeholder:text-muted-foreground/50" />
                            {holidayListSearch && (
                              <button onClick={() => setHolidayListSearch("")} className="text-muted-foreground hover:text-foreground">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center bg-muted/40 rounded-xl p-1">
                            {(["Semua", "Nasional", "Cuti Bersama", "Spesial"] as const).map((k) => (
                              <button key={k} onClick={() => { setHolidayKategoriFilter(k); setHolidayListPage(1); }}
                                className={cn("px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                  holidayKategoriFilter === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                                {k}
                              </button>
                            ))}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            <strong className="text-foreground">{total}</strong> dari {publicHolidays.length}
                          </span>
                        </div>

                        {/* List */}
                        {paged.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-10">
                            <Search className="w-8 h-8 text-muted-foreground/15 mb-2" />
                            <p className="text-xs text-muted-foreground">Tidak ditemukan hari libur sesuai filter</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {paged.map((h) => (
                              <div key={h.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-blue-500/10 bg-blue-500/[0.02] transition-colors hover:bg-muted/30">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-500/10">
                                  <Calendar className="w-3.5 h-3.5 text-blue-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-xs font-semibold text-foreground">{h.nama}</p>
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${HOLIDAY_COLORS[h.kategori]}15`, color: HOLIDAY_COLORS[h.kategori] }}>{h.kategori}</span>
                                    {h.berlaku_untuk === "semua" ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-success/10 text-success">
                                        <UserCheck className="w-2.5 h-2.5" />Semua pegawai
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-orange-500/10 text-orange-500">
                                        <User className="w-2.5 h-2.5" />{h.pegawai_ids?.length || 0} pegawai
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <p className="text-[10px] text-muted-foreground">
                                      {new Date(h.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                                      {h.tanggal_selesai && h.tanggal_selesai !== h.tanggal && (
                                        <>{" — "}{new Date(h.tanggal_selesai + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</>
                                      )}
                                    </p>
                                    {h.catatan && (
                                      <>
                                        <span className="w-1 h-1 rounded-full bg-border" />
                                        <p className="text-[10px] text-muted-foreground/70">{h.catatan}</p>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button onClick={() => { setDetailHoliday(h); setDetailSearch(""); setDetailPage(1); }}
                                    className="p-1.5 rounded-lg hover:bg-blue-500/10 text-muted-foreground/40 hover:text-blue-500 transition-colors"
                                    title="Lihat detail pegawai libur">
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleEditHoliday(h)}
                                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleDeleteHoliday(h.id)}
                                    className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground/40 hover:text-danger transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
                          <Pagination currentPage={safePage} totalItems={total} pageSize={HOLIDAY_PAGE_SIZE} onPageChange={setHolidayListPage} />
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Footer (hanya untuk tab mingguan) */}
            {offDayTab === "mingguan" && (
              <div className="px-5 py-3 border-t border-border bg-card flex-shrink-0">
                {offDayProgress ? (
                  <div className="space-y-2.5 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
                        <span className="text-xs font-semibold text-foreground">{offDayProgress.label}</span>
                      </div>
                      <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                        {offDayProgress.step}/{offDayProgress.total}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-primary transition-all duration-500 ease-out"
                        style={{ width: `${(offDayProgress.step / offDayProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowOffDay(false)} disabled={offDaySaving}>Batal</Button>
                    <Button size="sm" icon={Check} onClick={handleSaveOffDays} disabled={offDaySaving}>Simpan Jadwal</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Portal>
      )}

      {/* ═══ DETAIL HARI LIBUR MODAL ═══ */}
      {detailHoliday && (() => {
        const h = detailHoliday;
        const dates = getDateRange(h.tanggal, h.tanggal_selesai);
        const empIds = getAffectedEmployeeIds(h);
        const affectedEmps = employees
          .filter((e) => empIds.includes(e.id))
          .filter((e) => !detailSearch || e.nama.toLowerCase().includes(detailSearch.toLowerCase()));
        const rangeLabel = h.tanggal_selesai && h.tanggal_selesai !== h.tanggal
          ? `${new Date(h.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} - ${new Date(h.tanggal_selesai + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`
          : new Date(h.tanggal + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

        return (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDetailHoliday(null)} />
              <div className="relative w-full max-w-xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-border">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${HOLIDAY_COLORS[h.kategori]}15` }}>
                      <Calendar className="w-5 h-5" style={{ color: HOLIDAY_COLORS[h.kategori] }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-foreground truncate">{h.nama}</h3>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ backgroundColor: `${HOLIDAY_COLORS[h.kategori]}15`, color: HOLIDAY_COLORS[h.kategori] }}>{h.kategori}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{rangeLabel}</p>
                      {h.catatan && <p className="text-[10px] text-muted-foreground/70 mt-1 italic">&quot;{h.catatan}&quot;</p>}
                    </div>
                  </div>
                  <button onClick={() => setDetailHoliday(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 p-4 bg-muted/20 border-b border-border">
                  <div className="rounded-xl bg-card border border-border p-3 text-center">
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Pegawai</p>
                    <p className="text-lg font-bold text-foreground mt-0.5">{empIds.length}</p>
                  </div>
                  <div className="rounded-xl bg-card border border-border p-3 text-center">
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Hari</p>
                    <p className="text-lg font-bold text-foreground mt-0.5">{dates.length}</p>
                  </div>
                  <div className="rounded-xl bg-card border border-border p-3 text-center">
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Berlaku</p>
                    <p className="text-[11px] font-bold mt-1" style={{ color: h.berlaku_untuk === "semua" ? "#10b981" : "#f59e0b" }}>
                      {h.berlaku_untuk === "semua" ? "Semua" : "Pilihan"}
                    </p>
                  </div>
                </div>

                {/* Search */}
                <div className="px-5 pt-4 pb-3 border-b border-border">
                  <div className="flex items-center gap-2 bg-muted/40 rounded-xl px-3 py-2">
                    <Search className="w-3.5 h-3.5 text-muted-foreground" />
                    <input type="text" placeholder="Cari pegawai..." value={detailSearch}
                      onChange={(e) => { setDetailSearch(e.target.value); setDetailPage(1); }}
                      className="bg-transparent text-xs outline-none w-full text-foreground placeholder:text-muted-foreground/50" />
                    {detailSearch && (
                      <button onClick={() => setDetailSearch("")} className="text-muted-foreground hover:text-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* List pegawai */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {affectedEmps.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10">
                      <User className="w-8 h-8 text-muted-foreground/20 mb-2" />
                      <p className="text-xs text-muted-foreground">{detailSearch ? "Tidak ada pegawai cocok" : "Belum ada pegawai"}</p>
                    </div>
                  ) : (() => {
                    const totalDetail = affectedEmps.length;
                    const totalPagesDetail = Math.max(1, Math.ceil(totalDetail / DETAIL_PAGE_SIZE));
                    const safeDetailPage = Math.min(detailPage, totalPagesDetail);
                    const pagedEmps = affectedEmps.slice((safeDetailPage - 1) * DETAIL_PAGE_SIZE, safeDetailPage * DETAIL_PAGE_SIZE);
                    return (
                      <>
                        <div className="space-y-1.5">
                          {pagedEmps.map((emp, idx) => {
                            const globalIdx = (safeDetailPage - 1) * DETAIL_PAGE_SIZE + idx + 1;
                            return (
                              <div key={emp.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                  <span className="text-[10px] font-bold text-primary">{globalIdx}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-foreground truncate">{emp.nama}</p>
                                  <p className="text-[10px] text-muted-foreground">{emp.id}</p>
                                </div>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 flex-shrink-0">
                                  Libur
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {totalPagesDetail > 1 && (
                          <div className="mt-3">
                            <Pagination currentPage={safeDetailPage} totalItems={totalDetail} pageSize={DETAIL_PAGE_SIZE} onPageChange={setDetailPage} />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20">
                  <p className="text-[10px] text-muted-foreground">
                    {affectedEmps.length === empIds.length
                      ? `Menampilkan ${empIds.length} pegawai`
                      : `${affectedEmps.length} dari ${empIds.length} pegawai`}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setDetailHoliday(null)}>Tutup</Button>
                </div>
              </div>
            </div>
          </Portal>
        );
      })()}

      {/* ═══ RINGKASAN VIEW (per-employee summary) ═══ */}
      {viewMode === "ringkasan" && (
        <div className="space-y-4">
          {/* Toolbar: period navigator + date range + sort + export */}
          <div className="bg-card rounded-2xl border border-border p-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
                <button onClick={() => setSummaryDateMode("periode")}
                  className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                    summaryDateMode === "periode" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <CalendarDays className="w-3 h-3" />Periode
                </button>
                <button onClick={() => setSummaryDateMode("custom")}
                  className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                    summaryDateMode === "custom" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <Filter className="w-3 h-3" />Custom
                </button>
              </div>

              {summaryDateMode === "periode" ? (
                <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
                  <button onClick={() => navigateSummaryPeriod(-1)} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <div className="px-2.5 py-1 text-center min-w-[180px]">
                    <p className="text-[11px] font-bold text-foreground">{summaryPeriod.label}</p>
                  </div>
                  <button onClick={() => navigateSummaryPeriod(1)} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <DatePicker value={summaryCustomStart} onChange={(v) => { setSummaryCustomStart(v); setSummaryPage(1); }} placeholder="Dari" />
                  <span className="text-xs text-muted-foreground">–</span>
                  <DatePicker value={summaryCustomEnd} onChange={(v) => { setSummaryCustomEnd(v); setSummaryPage(1); }} placeholder="Sampai" />
                </div>
              )}

              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Cari nama atau divisi..." value={summarySearch}
                  onChange={(e) => setSummarySearch(e.target.value)}
                  className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
              </div>

              <div ref={summaryExportRef} className="relative flex-shrink-0">
                <Button variant="outline" size="sm" icon={Download} onClick={() => setSummaryExportMenu(!summaryExportMenu)} disabled={summaryFiltered.length === 0}>
                  Export <ChevronDown className="w-3 h-3 ml-0.5" />
                </Button>
                {summaryExportMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-44 bg-card rounded-xl border border-border shadow-xl z-10 overflow-hidden animate-scale-in">
                    <button onClick={exportSummaryPDF} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                      <FileText className="w-3.5 h-3.5 text-danger" />Export PDF
                    </button>
                    <button onClick={exportSummaryCSV} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors border-t border-border">
                      <FileText className="w-3.5 h-3.5 text-success" />Export CSV
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Sort pills */}
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              {([
                { key: "nama", label: "Nama", icon: Users },
                { key: "hadir", label: "Hadir Terbanyak", icon: TrendingUp },
                { key: "alpha", label: "Alpha Terbanyak", icon: TrendingDown },
                { key: "telat", label: "Telat Terbanyak", icon: Clock },
                { key: "total", label: "Total Record", icon: BarChart3 },
              ] as const).map((opt) => {
                const Icon = opt.icon;
                const isActive = summarySortBy === opt.key;
                return (
                  <button key={opt.key} onClick={() => setSummarySortBy(opt.key)}
                    className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                      isActive ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted")}>
                    <Icon className="w-3 h-3" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stats header */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-card rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pegawai</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{summaryLoading ? "-" : summaryHeaderStats.empCount}</p>
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
                  <p className="text-2xl font-bold text-foreground mt-1">{summaryLoading ? "-" : summaryHeaderStats.totalRecords}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">{summaryDateLabel || "pilih periode"}</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Rata-rata Hadir</p>
                  <p className="text-2xl font-bold text-foreground mt-1">{summaryLoading ? "-" : summaryHeaderStats.avgHadir}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-success" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">hari per pegawai</p>
            </div>
          </div>

          {/* Tabel ringkasan */}
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
                  {summaryLoading ? (
                    <SkeletonTable rows={8} cols={11} />
                  ) : summaryPaged.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-12 text-sm text-muted-foreground">
                        {summaryData.length === 0
                          ? "Tidak ada data absensi di periode ini"
                          : "Tidak ada pegawai cocok dengan pencarian"}
                      </td>
                    </tr>
                  ) : summaryPaged.map((row, idx) => {
                    const sc = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.color || "#6b7280";
                    return (
                      <tr key={row.employee_id} className="hover:bg-muted/30">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{(summaryPage - 1) * SUMMARY_PAGE_SIZE + idx + 1}</td>
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
                        <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: sc("Hadir") }}>{row.hadir}</td>
                        <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: sc("Terlambat") }}>{row.telat}</td>
                        <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: sc("Izin") }}>{row.izin}</td>
                        <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: sc("Sakit") }}>{row.sakit}</td>
                        <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: sc("Alpha") }}>{row.alpha}</td>
                        <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: sc("Libur") }}>{row.libur}</td>
                        <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: sc("Cuti") }}>{row.cuti}</td>
                        <td className="px-5 py-3 text-center">
                          <span className="text-sm font-bold text-foreground bg-muted px-2 py-1 rounded-md">{row.total}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {summaryFiltered.length > 0 && !summaryLoading && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                      <td className="px-5 py-3 text-xs" colSpan={3}>
                        <span className="font-bold text-foreground">TOTAL</span>
                        <span className="text-muted-foreground ml-2">({summaryFiltered.length} pegawai)</span>
                      </td>
                      <td className="px-5 py-3 text-center text-sm font-bold text-success">{summaryTotals.hadir}</td>
                      <td className="px-5 py-3 text-center text-sm font-bold text-warning">{summaryTotals.telat}</td>
                      <td className="px-5 py-3 text-center text-sm font-bold text-blue-500">{summaryTotals.izin}</td>
                      <td className="px-5 py-3 text-center text-sm font-bold text-danger">{summaryTotals.sakit}</td>
                      <td className="px-5 py-3 text-center text-sm font-bold text-muted-foreground">{summaryTotals.alpha}</td>
                      <td className="px-5 py-3 text-center text-sm font-bold text-violet-500">{summaryTotals.libur}</td>
                      <td className="px-5 py-3 text-center text-sm font-bold text-violet-500">{summaryTotals.cuti}</td>
                      <td className="px-5 py-3 text-center">
                        <span className="text-sm font-bold text-foreground bg-card px-2 py-1 rounded-md border border-border">{summaryTotals.total}</span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pagination currentPage={summaryPage} totalItems={summaryFiltered.length} pageSize={SUMMARY_PAGE_SIZE} onPageChange={setSummaryPage} />
          </div>

          {/* Info footer */}
          <div className="bg-muted/30 rounded-xl border border-border/50 p-3">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Catatan:</strong> Data dihitung dari seluruh record absensi (termasuk auto-generated Libur &amp; Alpha) di periode terpilih. Pegawai tanpa record absensi di periode ini tidak ditampilkan. Hadir = total hari hadir tepat waktu; Telat = hari hadir tapi terlambat. Total = jumlah seluruh record (Hadir + Izin + Sakit + Alpha + Libur + Cuti).
            </p>
          </div>
        </div>
      )}


    </div>
    </RouteGuard>
  );
}
