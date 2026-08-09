"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  CreditCard,
  Search,
  X,
  CircleCheckBig,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Users,
  FileText,
  FileSpreadsheet,
  Download,
  Trash2,
  Zap,
  DollarSign,
  TrendingDown,
  CheckCircle2,
  Clock,
  Save,
  History,
  Loader2,
  Pencil,
  Check,
  Banknote,
  FileCheck,
  RotateCcw,
  BarChart3,
  ShieldCheck,
  Lock,
  Maximize2,
  Copy,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase, type DbPayroll, type DbPegawai, type NonActivePeriod, type DbPayrollGroup, type DbPayrollEmployeeGroup } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";
import PayrollStepper, { type StepperStep } from "./components/PayrollStepper";
import BatchActionBar from "./components/BatchActionBar";
import ConfirmDialog from "./components/ConfirmDialog";
import EmptyState from "./components/EmptyState";
import StatusBadge, { type LegacyPayrollStatus } from "./components/StatusBadge";
import BreakdownAbsen, { type AbsenItem } from "./components/BreakdownAbsen";
import BreakdownLembur, { type LemburItem } from "./components/BreakdownLembur";
import WorksheetEditor from "./components/WorksheetEditor";
import WorksheetSheetFullscreen from "./components/WorksheetSheetFullscreen";
import { PENDAPATAN_FIELDS, POTONGAN_FIELDS, inputClass, parseCurrencyInput, formatInputCurrency, type FieldDef, type PayrollRow, type AbsenBreakdownItem, type LemburBreakdownItem } from "./constants";

// ─── Types ───
type EmployeeLite = { id: string; nama: string; status: string; jabatan?: { nama: string } | null; bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null; gaji_pokok?: number };

const GAPOK_PAGE_SIZE = 15;
const PAYROLL_PAGE_SIZE = 100;
const CUT_OFF_DAY = 7;
const SUPABASE_PAGE_SIZE = 1000;
const PAYROLL_PERIOD_STORAGE_KEY = "hrweb.payroll.periodKey";

/** Field input manual (bukan autorecomputed) yang boleh disalin antar periode. */
const MANUAL_INPUT_FIELDS: FieldDef[] = [
  ...PENDAPATAN_FIELDS.filter((f) => !f.readonly),
  ...POTONGAN_FIELDS.filter((f) => !f.readonly),
];

type SupabasePagedResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

async function fetchAllRanges<T>(
  buildQuery: (from: number, to: number) => PromiseLike<SupabasePagedResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw new Error(error.message || "Gagal mengambil data payroll.");
    rows.push(...(data || []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

// ─── Period helpers ───
function getPeriodRange(periodKey: string): { start: string; end: string; label: string } {
  const [year, month] = periodKey.split("-").map(Number);
  // Rentang: tgl 8 bulan sebelumnya s/d tgl 7 bulan ini
  const startDate = new Date(year, month - 2, 8);
  const endDate = new Date(year, month - 1, 7);
  
  // Format to YYYY-MM-DD
  // Use local dates to avoid timezone shift
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-08`;
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-07`;
  
  const label = `8 ${startDate.toLocaleDateString("id-ID", { month: "short", year: "numeric" })} \u2013 7 ${endDate.toLocaleDateString("id-ID", { month: "short", year: "numeric" })}`;
  return { start, end, label };
}

function getCurrentPeriodKey(): string {
  const now = new Date();
  // Jika sekarang sebelum tgl 8, maka masuk ke siklus cut-off yang berakhir tgl 7 bulan ini.
  // Period key kita set sebagai "YYYY-MM" dimana MM adalah bulan akhir cut-off (bulan ini)
  if (now.getDate() <= 7) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  // Jika tgl 8 ke atas, masuk ke siklus cut-off yang berakhir tgl 7 bulan DEPAN.
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function isValidPeriodKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.split("-")[1]);
  return month >= 1 && month <= 12;
}

function getInitialPayrollPeriodKey(): string {
  if (typeof window === "undefined") return getCurrentPeriodKey();
  try {
    const stored = window.localStorage.getItem(PAYROLL_PERIOD_STORAGE_KEY);
    return isValidPeriodKey(stored) ? stored : getCurrentPeriodKey();
  } catch {
    return getCurrentPeriodKey();
  }
}

function formatPeriodLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

// ─── Helper: cek apakah pegawai punya minimal 1 hari aktif dalam rentang ───
type ActiveCheckEmp = {
  tanggal_bergabung: string | null;
  tanggal_keluar: string | null;
  non_active_periods?: NonActivePeriod[] | null;
};
function hasActiveDayInPeriod(emp: ActiveCheckEmp, periodStart: string, periodEnd: string): boolean {
  if (emp.tanggal_bergabung && emp.tanggal_bergabung > periodEnd) return false;
  if (emp.tanggal_keluar && emp.tanggal_keluar <= periodStart) return false;
  if (emp.non_active_periods && emp.non_active_periods.length > 0) {
    const activeStart = emp.tanggal_bergabung && emp.tanggal_bergabung > periodStart ? emp.tanggal_bergabung : periodStart;
    const activeEnd = emp.tanggal_keluar && emp.tanggal_keluar <= periodEnd
      ? String(new Date(new Date(emp.tanggal_keluar).getTime() - 86400000).toISOString().slice(0, 10))
      : periodEnd;
    for (const nap of emp.non_active_periods) {
      if (nap.from <= activeStart && nap.to >= activeEnd) return false;
    }
  }
  return true;
}

// ─── Pendapatan & Potongan field definitions & currency helpers — see ./constants.ts ───

/** Pindahkan periode key "YYYY-MM" sebanyak `months` bulan (negatif = mundur). */
function shiftPeriodKey(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Ringkasan status payroll per periode, dipakai untuk validasi duplikat & urutan periode. */
type PeriodState = {
  total: number;
  worksheet: number;
  draft: number;
  final: number;
  duplicates: number;
  error: string | null;
};

async function fetchPeriodState(periode: string): Promise<PeriodState> {
  const { data, error } = await supabase
    .from("payrolls")
    .select("id, employee_id, status")
    .eq("periode", periode);
  if (error) return { total: 0, worksheet: 0, draft: 0, final: 0, duplicates: 0, error: error.message };
  const rows = data || [];
  const worksheet = rows.filter((r) => r.status === "Worksheet").length;
  const draft = rows.filter((r) => r.status === "Draft").length;
  const final = rows.filter((r) => r.status === "Final").length;
  const seen = new Map<string, number>();
  rows.forEach((r) => seen.set(r.employee_id, (seen.get(r.employee_id) || 0) + 1));
  const duplicates = rows.length - seen.size;
  return { total: rows.length, worksheet, draft, final, duplicates, error: null };
}

export default function PayrollPage() {
  const { user, getPermissionLevel, isSuperAdmin } = useAuth();
  const permLevel = getPermissionLevel("payroll");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  // ─── Tab state ───
  const [activeTab, setActiveTab] = useState<"slip" | "gapok">("slip");

  // ─── Core state ───
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [periodKey, setPeriodKey] = useState(getInitialPayrollPeriodKey);
  const period = getPeriodRange(periodKey);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollRow[]>([]);
  /** Map employee_id → sort_order (global, dari tabel payroll_employee_order) */
  const [payrollOrder, setPayrollOrder] = useState<Map<string, number>>(new Map());
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderSavedTick, setOrderSavedTick] = useState(0);
  /** Kelompok pegawai (payroll_groups, diurutkan sort_order) */
  const [groups, setGroups] = useState<DbPayrollGroup[]>([]);
  /** Map employee_id → group_id (payroll_employee_groups) */
  const [employeeGroups, setEmployeeGroups] = useState<Map<string, number>>(new Map());
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupSavedTick, setGroupSavedTick] = useState(0);

  // ─── Generate modal ───
  const [showGenerate, setShowGenerate] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState(getCurrentPeriodKey);
  const [generating, setGenerating] = useState(false);

  // ─── Detail slide-over ───
  const [showDetail, setShowDetail] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<PayrollRow | null>(null);
  const [editForm, setEditForm] = useState<Record<string, number>>({});
  const [editKeterangan, setEditKeterangan] = useState<Record<string, string>>({});
  const [editCatatan, setEditCatatan] = useState("");
  const [saving, setSaving] = useState(false);
  const detailRequestSeq = useRef(0);

  // ─── History ───
  const [history, setHistory] = useState<DbPayroll[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ─── Gapok tab state ───
  const [gapokSearch, setGapokSearch] = useState("");
  const [gapokPage, setGapokPage] = useState(1);
  const [gapokEditId, setGapokEditId] = useState<string | null>(null);
  const [gapokEditValue, setGapokEditValue] = useState("");
  const [gapokSaving, setGapokSaving] = useState(false);
  const [gapokStatusFilter, setGapokStatusFilter] = useState<"semua" | "Aktif" | "Tidak Aktif">("semua");
  const [gapokIsiFilter, setGapokIsiFilter] = useState<"semua" | "terisi" | "belum">("semua");

  // ─── Fullscreen sheet mode ───
  const [sheetMode, setSheetMode] = useState(false);

  // ─── Workflow state: Worksheet → Draft → Final ───
  const [activeMainTab, setActiveMainTab] = useState<"worksheet" | "draft" | "final" | "laporan">("worksheet");
  const [wsData, setWsData] = useState<Record<number, Record<string, number>>>({});
  const [wsKeterangan, setWsKeterangan] = useState<Record<number, Record<string, string>>>({});
  /** Map<payrollId, Set<fieldKey>> — track cell-level changes untuk highlight */
  const [wsChangedCells, setWsChangedCells] = useState<Map<number, Set<string>>>(new Map());
  const [wsSaving, setWsSaving] = useState(false);
  const [wsRefreshing, setWsRefreshing] = useState(false);
  const [wsExpandedId, setWsExpandedId] = useState<number | null>(null);
  /** Loading state untuk computeWorksheet (auto-recompute) */
  const [wsComputing, setWsComputing] = useState(false);
  /** Ref guard anti klik ganda / race condition saat hitung worksheet. */
  const wsComputingRef = useRef(false);
  /** Indikator validasi periode saat mencoba pindah ke periode berikutnya. */
  const [nextChecking, setNextChecking] = useState(false);
  /** Konfirmasi dialog: buat slip dari worksheet */
  const [buatSlipConfirm, setBuatSlipConfirm] = useState<{ ids: number[]; mode: "single" | "bulk" } | null>(null);
  /** Trigger reload data setelah action (worksheet/draft/final) */
  const [reloadKey, setReloadKey] = useState(0);
  /** Breakdown potongan absen per row di worksheet (lazy-fetch on expand) */
  const [wsAbsenBreakdown, setWsAbsenBreakdown] = useState<Record<number, { telat: number; alpha: number; lainnya: number; items: AbsenBreakdownItem[] } | null>>({});
  const [wsAbsenLoading, setWsAbsenLoading] = useState<Record<number, boolean>>({});
  /** Breakdown lembur per row di worksheet */
  const [wsLemburBreakdown, setWsLemburBreakdown] = useState<Record<number, { total: number; items: LemburBreakdownItem[] } | null>>({});
  const [wsLemburLoading, setWsLemburLoading] = useState<Record<number, boolean>>({});
  const [showBatchFill, setShowBatchFill] = useState(false);
  const [batchField, setBatchField] = useState("");
  const [batchValue, setBatchValue] = useState("");
  /** "semua" | "kosong" — preview filter untuk batch fill */
  const [batchFilter, setBatchFilter] = useState<"semua" | "kosong">("semua");

  // ─── Bulk Select & Actions ───
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkFinalConfirm, setBulkFinalConfirm] = useState(false);
  const [bulkDraftConfirm, setBulkDraftConfirm] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [singleFinalConfirm, setSingleFinalConfirm] = useState<PayrollRow | null>(null);
  const [computeWorksheetConfirm, setComputeWorksheetConfirm] = useState(false);
  /** Konfirmasi salin input manual dari periode sebelumnya */
  const [copyInputsConfirm, setCopyInputsConfirm] = useState(false);
  const [copyInputsBusy, setCopyInputsBusy] = useState(false);
  const copyInputsRef = useRef(false);

  // ─── Delete confirm ───
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; nama: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Toast ───
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAYROLL_PERIOD_STORAGE_KEY, periodKey);
    } catch {
      // Ignore storage errors (private mode/quota). Period fallback still works.
    }
  }, [periodKey]);

  // ─── Lock body scroll ───
  useEffect(() => {
    if (showGenerate || showDetail) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showGenerate, showDetail]);

  // ─── Fetch employees ───
  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from("pegawai")
      .select("id, nama, status, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening, gaji_pokok")
      .order("nama");
    if (error) { showToast("error", "Gagal Memuat Pegawai", error.message); return; }
    if (data) setEmployees(data.map((d: Record<string, unknown>) => ({
      id: d.id as string,
      nama: d.nama as string,
      status: d.status as string,
      jabatan: d.jabatan as { nama: string } | null,
      bank: d.bank as string | null,
      no_rekening: d.no_rekening as string | null,
      nama_rekening: d.nama_rekening as string | null,
      gaji_pokok: (d.gaji_pokok as number) || 0,
    })));
  };

  // ─── Fetch payroll order ───
  const fetchPayrollOrder = async () => {
    const { data, error } = await supabase
      .from("payroll_employee_order")
      .select("employee_id, sort_order")
      .order("sort_order", { ascending: true });
    if (error) { showToast("error", "Gagal Memuat Urutan", error.message); return; }
    if (data) setPayrollOrder(new Map((data as { employee_id: string; sort_order: number }[]).map((d) => [d.employee_id, d.sort_order])));
  };

  // ─── Fetch payroll groups ───
  const fetchPayrollGroups = async () => {
    const [gRes, mRes] = await Promise.all([
      supabase.from("payroll_groups").select("*").order("sort_order", { ascending: true }),
      supabase.from("payroll_employee_groups").select("employee_id, group_id"),
    ]);
    if (gRes.error) { showToast("error", "Gagal Memuat Kelompok", gRes.error.message); return; }
    if (mRes.error) { showToast("error", "Gagal Memuat Kelompok", mRes.error.message); return; }
    if (gRes.data) setGroups((gRes.data as DbPayrollGroup[]).filter((g) => g.status === "Aktif"));
    if (mRes.data) setEmployeeGroups(new Map((mRes.data as DbPayrollEmployeeGroup[]).map((m) => [m.employee_id, m.group_id])));
  };

  // ─── Fetch payrolls ───
  const fetchPayrolls = useCallback(async () => {
    const { data, error } = await supabase
      .from("payrolls")
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening, status)")
      .eq("periode", periodKey)
      .order("id", { ascending: true });
    if (error) { showToast("error", "Gagal Memuat Payroll", error.message); return; }
    if (data) {
      const mapped: PayrollRow[] = data.map((d: Record<string, unknown>) => {
        const peg = d.pegawai as Record<string, unknown> | null;
        return {
          ...d,
          pegawaiNama: (peg?.nama as string) || (d.employee_id as string) || "?",
          pegawaiJabatan: (peg?.jabatan as Record<string, unknown>)?.nama as string || "-",
        } as PayrollRow;
      });
      setPayrolls(mapped);
    }
  }, [periodKey, showToast]);

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchPayrolls(), fetchPayrollOrder(), fetchPayrollGroups()]).then(() => setLoading(false));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPayrolls().then(() => setLoading(false));
  }, [periodKey, fetchPayrolls, reloadKey]);

  // ─── Generate slip gaji ───
  const handleGenerate = async () => {
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin generate slip.");
      return;
    }
    setGenerating(true);
    const genPeriod = getPeriodRange(generatePeriod);

    try {
      // 1. Fetch pegawai relevan untuk periode ini:
      //    - Aktif (semua)
      //    - Tidak Aktif: tetap di-generate kalau masih ada data absen/delivery/lembur di
      //      periode (penghasilan yang belum dibayarkan), atau tanggal_keluar di dalam periode.
      const { data: allEmps, error: empErr } = await supabase
        .from("pegawai")
        .select("id, nama, gaji_pokok, tanggal_keluar, status, tanggal_bergabung, non_active_periods")
        .order("nama");
      if (empErr || !allEmps) {
        showToast("error", "Gagal Memuat Pegawai", (empErr as { message?: string } | null)?.message || "Unknown error");
        setGenerating(false);
        return;
      }
      // Filter di-JS: hanya pegawai yg punya minimal 1 hari aktif dalam rentang periode
      const activeEmps = (allEmps as { id: string; nama: string; status: string; gaji_pokok?: number; tanggal_keluar: string | null; tanggal_bergabung: string | null; non_active_periods: NonActivePeriod[] | null }[]).filter((e) => {
        if (!hasActiveDayInPeriod(e, genPeriod.start, genPeriod.end)) return false;
        return true;
      });


      // 2. Check existing payrolls for this period
      const { data: existing } = await supabase
        .from("payrolls")
        .select("employee_id")
        .eq("periode", generatePeriod);
      const existingSet = new Set((existing || []).map((e: { employee_id: string }) => e.employee_id));

      // 3. Filter employees that don't have a slip yet
      const newEmps = (activeEmps as { id: string; nama: string; status: string; gaji_pokok?: number; tanggal_keluar: string | null; tanggal_bergabung: string | null; non_active_periods: NonActivePeriod[] | null }[]).filter((e) => !existingSet.has(e.id));
      if (newEmps.length === 0) {
        showToast("error", "Tidak Ada Slip Baru", "Semua pegawai aktif sudah memiliki slip gaji untuk periode ini.");
        setGenerating(false);
        return;
      }

      // 4. Fetch delivery points totals for each employee in period
      const dpData = await fetchAllRanges<{ employee_id: string; total: number }>((from, to) =>
        supabase
          .from("delivery_points")
          .select("employee_id, total")
          .gte("tanggal", genPeriod.start)
          .lte("tanggal", genPeriod.end)
          .in("employee_id", newEmps.map((e) => e.id))
          .order("id", { ascending: true })
          .range(from, to)
      );

      const dpTotals = new Map<string, number>();
      dpData.forEach((d) => {
        dpTotals.set(d.employee_id, (dpTotals.get(d.employee_id) || 0) + d.total);
      });

      // 5. Fetch attendance denda totals for each employee in period
      const attData = await fetchAllRanges<{ employee_id: string; denda: number; tanggal: string; status: string }>((from, to) =>
        supabase
          .from("attendance_records")
          .select("employee_id, denda, tanggal, status")
          .gte("tanggal", genPeriod.start)
          .lte("tanggal", genPeriod.end)
          .in("employee_id", newEmps.map((e) => e.id))
          .order("id", { ascending: true })
          .range(from, to)
      );

      const dendaTotals = new Map<string, number>();
      attData.forEach((d) => {
        dendaTotals.set(d.employee_id, (dendaTotals.get(d.employee_id) || 0) + d.denda);
      });

      // 5b. Fetch lembur Disetujui per employee dalam periode
      const lemburData = await fetchAllRanges<{ employee_id: string; total_lembur: number | null }>((from, to) =>
        supabase
          .from("overtime_requests")
          .select("employee_id, total_lembur")
          .eq("status", "Disetujui")
          .gte("tanggal", genPeriod.start)
          .lte("tanggal", genPeriod.end)
          .in("employee_id", newEmps.map((e) => e.id))
          .order("id", { ascending: true })
          .range(from, to)
      );

      const lemburTotals = new Map<string, number>();
      lemburData.forEach((d) => {
        lemburTotals.set(d.employee_id, (lemburTotals.get(d.employee_id) || 0) + (d.total_lembur || 0));
      });

      // 5c. Fallback untuk Tidak Aktif tanpa tanggal_keluar: butuh catatan absen di periode
      const empsWithData = newEmps.filter((e) => {
        if (e.status !== "Tidak Aktif") return true;
        if (e.tanggal_keluar) return true; // sudah dicek hasActiveDayInPeriod
        // Tidak Aktif + NULL tanggal_keluar → hanya include kalau ada catatan absen
        const hariAdaCatatan = new Set(
          attData.filter((a) => a.employee_id === e.id).map((a) => a.tanggal)
        ).size;
        return hariAdaCatatan > 0;
      });
      const skippedNoAbsen = newEmps.length - empsWithData.length;
      if (empsWithData.length === 0) {
        showToast("error", "Tidak Ada Slip Baru", "Tidak ada pegawai dengan catatan kehadiran di periode ini.");
        setGenerating(false);
        return;
      }

      // 6. Build gaji_pokok lookup dari master pegawai.
      const gapokMap = new Map<string, number>();
      (activeEmps as { id: string; gaji_pokok?: number }[]).forEach((e) => {
        gapokMap.set(e.id, e.gaji_pokok || 0);
      });

      // 7. Build insert rows (exclude generated columns)
      const inserts = empsWithData.map((e) => {
        const gapok = gapokMap.get(e.id) || 0;

        return {
          employee_id: e.id,
          periode: generatePeriod,
          periode_mulai: genPeriod.start,
          periode_selesai: genPeriod.end,
          gaji_pokok: gapok,
          pendapatan_titik: dpTotals.get(e.id) || 0,
          extra_job: 0,
          uang_makan: 0,
          insentif: 0,
          tunjangan_jabatan: 0,
          transport: 0,
          tunjangan_lain: 0,
          tambahan_lain: 0,
          lembur: lemburTotals.get(e.id) || 0,
          koperasi: 0,
          pinjaman_perusahaan: 0,
          potongan_absen: dendaTotals.get(e.id) || 0,
          potongan_lain: 0,
          jht: 0,
          bpjs_kesehatan: 0,
          status: "Draft",
          catatan: null,
          extra_job_keterangan: null,
          insentif_keterangan: null,
          pinjaman_perusahaan_keterangan: null,
          potongan_lain_keterangan: null,
        };
      });

      // 8. Insert
      const { error: insertErr } = await supabase.from("payrolls").insert(inserts);
      if (insertErr) {
        showToast("error", "Gagal Generate", insertErr.message);
        setGenerating(false);
        return;
      }

      showToast(
        "success",
        "Generate Berhasil",
        skippedNoAbsen > 0
          ? `${inserts.length} slip gaji dibuat (${skippedNoAbsen} Tidak Aktif tanpa catatan absen dilewati).`
          : `${inserts.length} slip gaji berhasil dibuat untuk periode ${formatPeriodLabel(generatePeriod)}.`
      );
      // Audit log
      await logAudit({
        supabase,
        action: "generate",
        entityType: "payrolls",
        entityLabel: `Slip gaji periode ${formatPeriodLabel(generatePeriod)}`,
        metadata: {
          periode: generatePeriod,
          jumlah_slip: inserts.length,
          rentang: `${genPeriod.start} – ${genPeriod.end}`,
        },
      });
      setShowGenerate(false);

      // Refresh if same period
      if (generatePeriod === periodKey) {
        await fetchPayrolls();
      } else {
        setPeriodKey(generatePeriod);
      }
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Gagal generate slip gaji.");
    } finally {
      setGenerating(false);
    }
  };

  // ─── Open detail panel ───
  const [absenBreakdown, setAbsenBreakdown] = useState<{ telat: number; alpha: number; lainnya: number; items: AbsenBreakdownItem[] } | null>(null);
  const [lemburBreakdown, setLemburBreakdown] = useState<LemburBreakdownItem[] | null>(null);
  const [lemburBreakdownLoading, setLemburBreakdownLoading] = useState(false);
  const [absenBreakdownLoading, setAbsenBreakdownLoading] = useState(false);

  const openDetail = async (row: PayrollRow) => {
    const requestId = detailRequestSeq.current + 1;
    detailRequestSeq.current = requestId;
    setSelectedPayroll(row);
    // Initialize edit form with current values
    const form: Record<string, number> = {};
    PENDAPATAN_FIELDS.forEach((f) => { form[f.key] = (row as unknown as Record<string, number>)[f.key] || 0; });
    POTONGAN_FIELDS.forEach((f) => { form[f.key] = (row as unknown as Record<string, number>)[f.key] || 0; });
    setEditForm(form);
    const ket: Record<string, string> = {};
    [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].forEach((f) => {
      if (f.keteranganKey) ket[f.keteranganKey] = (row as unknown as Record<string, string | null>)[f.keteranganKey] || "";
    });
    setEditKeterangan(ket);
    setEditCatatan(row.catatan || "");
    setShowDetail(true);
    setAbsenBreakdown(null);
    setLemburBreakdown(null);
    fetchHistory(row.employee_id, requestId);
    
    // Fetch breakdown denda — pakai periode_mulai & periode_selesai yang tersimpan di slip
    setAbsenBreakdownLoading(true);
    const startDate = row.periode_mulai || getPeriodRange(row.periode).start;
    const endDate = row.periode_selesai || getPeriodRange(row.periode).end;
    const { data: attData } = await supabase
      .from("attendance_records")
      .select("tanggal, status, denda, durasi_telat")
      .gte("tanggal", startDate)
      .lte("tanggal", endDate)
      .eq("employee_id", row.employee_id)
      .gt("denda", 0)
      .order("tanggal", { ascending: true });
    if (detailRequestSeq.current !== requestId) return;
      
    let telat = 0;
    let alpha = 0;
    let lainnya = 0;
    (attData || []).forEach(d => {
      if (d.status === "Telat" || d.status === "Terlambat") telat += d.denda;
      else if (d.status === "Alpha") alpha += d.denda;
      else lainnya += d.denda;
    });
    setAbsenBreakdown({ telat, alpha, lainnya, items: (attData || []) as AbsenBreakdownItem[] });
    setAbsenBreakdownLoading(false);

    // Fetch breakdown lembur (status Disetujui) untuk periode yang sama
    setLemburBreakdownLoading(true);
    const { data: lemburData } = await supabase
      .from("overtime_requests")
      .select("tanggal, jam_mulai, jam_selesai, durasi_menit, rate_per_jam, total_lembur, alasan")
      .eq("status", "Disetujui")
      .eq("employee_id", row.employee_id)
      .gte("tanggal", startDate)
      .lte("tanggal", endDate)
      .order("tanggal", { ascending: true });
    if (detailRequestSeq.current !== requestId) return;
    setLemburBreakdown((lemburData || []) as LemburBreakdownItem[]);
    setLemburBreakdownLoading(false);
  };

  // ─── Fetch history ───
  const fetchHistory = async (employeeId: string, requestId?: number) => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from("payrolls")
      .select("*")
      .eq("employee_id", employeeId)
      .order("periode", { ascending: false })
      .limit(6);
    if (requestId && detailRequestSeq.current !== requestId) return;
    setHistory(data || []);
    setLoadingHistory(false);
  };

  // ─── Computed totals for edit form ───
  const computedTotalPendapatan = PENDAPATAN_FIELDS.reduce((sum, f) => sum + (editForm[f.key] || 0), 0);
  const computedTotalPotongan = POTONGAN_FIELDS.reduce((sum, f) => sum + (editForm[f.key] || 0), 0);
  const computedNetto = computedTotalPendapatan - computedTotalPotongan;

// ─── Urutan tampilan global (payroll_employee_order + kelompok) ───
  /** Urutkan pegawai: kelompok berprioritas sort_order, di dalam kelompok ikut payroll_order, tanpa kelompok di paling bawah. */
  const orderedEmployeeIds = useMemo(() => {
    const groupRank = new Map(groups.map((g, i) => [g.id, i]));
    const rankOf = (empId: string): number => {
      const gid = employeeGroups.get(empId);
      if (gid === undefined) return Infinity;
      const r = groupRank.get(gid);
      return r === undefined ? Infinity : r;
    };
    return [...employees].sort((a, b) => {
      const ra = rankOf(a.id);
      const rb = rankOf(b.id);
      if (ra !== rb) return ra - rb;
      const oa = payrollOrder.get(a.id);
      const ob = payrollOrder.get(b.id);
      if (oa === undefined && ob === undefined) return a.nama.localeCompare(b.nama, "id");
      if (oa === undefined) return 1;
      if (ob === undefined) return -1;
      if (oa !== ob) return oa - ob;
      return a.nama.localeCompare(b.nama, "id");
    }).map((e) => e.id);
  }, [employees, groups, employeeGroups, payrollOrder]);

  const orderedPayrolls = useMemo(() => {
    const posById = new Map(orderedEmployeeIds.map((id, i) => [id, i]));
    return [...payrolls].sort((a, b) => {
      const pa = posById.get(a.employee_id);
      const pb = posById.get(b.employee_id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa === undefined && pb === undefined) {
        return (a.pegawaiNama || a.employee_id).localeCompare(b.pegawaiNama || b.employee_id, "id");
      }
      return pa === undefined ? 1 : -1;
    });
  }, [payrolls, orderedEmployeeIds]);

  const orderedEmployees = useMemo(() => {
    const posById = new Map(orderedEmployeeIds.map((id, i) => [id, i]));
    return [...employees].sort((a, b) => {
      const pa = posById.get(a.id);
      const pb = posById.get(b.id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa === undefined && pb === undefined) return a.nama.localeCompare(b.nama, "id");
      return pa === undefined ? 1 : -1;
    });
  }, [employees, orderedEmployeeIds]);

  const getRowsForMainTab = useCallback((tab: "worksheet" | "draft" | "final" | "laporan" = activeMainTab) => {
    if (tab === "laporan") return orderedPayrolls.filter((p) => p.status === "Final");
    if (tab === "worksheet") return orderedPayrolls.filter((p) => p.status === "Worksheet");
    if (tab === "final") return orderedPayrolls.filter((p) => p.status === "Final");
    return orderedPayrolls.filter((p) => p.status === "Draft");
  }, [activeMainTab, orderedPayrolls]);

  const getFilteredRowsForMainTab = useCallback((tab: "worksheet" | "draft" | "final" | "laporan" = activeMainTab) => {
    const q = search.toLowerCase();
    return getRowsForMainTab(tab).filter((p) =>
      (p.pegawaiNama || "").toLowerCase().includes(q) ||
      p.employee_id.toLowerCase().includes(q)
    );
  }, [activeMainTab, getRowsForMainTab, search]);

  const getScopedSelectedRows = useCallback(() => {
    const visibleIds = new Set(getFilteredRowsForMainTab().map((p) => p.id));
    return payrolls.filter((p) => selectedIds.has(p.id) && visibleIds.has(p.id));
  }, [getFilteredRowsForMainTab, payrolls, selectedIds]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab, activeMainTab, periodKey, search]);

  // ─── Save edit ───
  const handleSave = async () => {
    if (!selectedPayroll) return;
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin edit payroll.");
      return;
    }
    if (selectedPayroll.status === "Final") {
      showToast("error", "Slip Terkunci", "Slip Final tidak dapat diedit. Kembalikan ke Draft terlebih dahulu.");
      return;
    }
    setSaving(true);

    // Only send individual component fields, NOT generated columns
    const updatePayload: Record<string, unknown> = { catatan: editCatatan || null };
    PENDAPATAN_FIELDS.forEach((f) => {
      if (!f.readonly) updatePayload[f.key] = editForm[f.key] || 0;
    });
    POTONGAN_FIELDS.forEach((f) => {
      if (!f.readonly) updatePayload[f.key] = editForm[f.key] || 0;
    });
    [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].forEach((f) => {
      if (f.keteranganKey) updatePayload[f.keteranganKey] = editKeterangan[f.keteranganKey] || null;
    });

    const { data, error } = await supabase
      .from("payrolls")
      .update(updatePayload)
      .eq("id", selectedPayroll.id)
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening, status)")
      .single();

    if (error) {
      showToast("error", "Gagal Menyimpan", error.message);
      setSaving(false);
      return;
    }

    if (data) {
      const peg = data.pegawai as Record<string, unknown> | null;
      const updated: PayrollRow = {
        ...data,
        pegawaiNama: (peg?.nama as string) || data.employee_id || "?",
        pegawaiJabatan: (peg?.jabatan as Record<string, unknown>)?.nama as string || "-",
      } as PayrollRow;
      setPayrolls((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setSelectedPayroll(updated);

      await logAudit({
        supabase,
        action: "update",
        entityType: "payrolls",
        entityId: updated.id,
        entityLabel: `Slip ${updated.pegawaiNama} (${updated.periode})`,
        oldData: { ...selectedPayroll } as unknown as Record<string, unknown>,
        newData: { ...updated } as unknown as Record<string, unknown>,
      });
    }

    showToast("success", "Slip Disimpan", "Perubahan berhasil disimpan.");
    setSaving(false);
  };

  // ─── Toggle status ───
  const handleToggleStatus = async () => {
    if (!selectedPayroll) return;
    const newStatus = selectedPayroll.status === "Draft" ? "Final" : "Draft";
    const oldStatus = selectedPayroll.status;
    if (newStatus === "Final" && !canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin finalisasi payroll.");
      return;
    }
    if (oldStatus === "Final" && !isSuperAdmin) {
      showToast("error", "Tidak Diizinkan", "Hanya super admin yang dapat mengembalikan Final ke Draft.");
      return;
    }

    setSaving(true);
    const updatePayload: Record<string, unknown> = { status: newStatus };
    if (newStatus === "Final") {
      updatePayload.locked_at = new Date().toISOString();
      updatePayload.locked_by = user?.id ?? null;
    } else {
      updatePayload.locked_at = null;
      updatePayload.locked_by = null;
    }

    const { data, error } = await supabase
      .from("payrolls")
      .update(updatePayload)
      .eq("id", selectedPayroll.id)
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening, status)")
      .single();

    if (error) {
      showToast("error", "Gagal Mengubah Status", error.message);
      setSaving(false);
      return;
    }

    if (data) {
      const peg = data.pegawai as Record<string, unknown> | null;
      const updated: PayrollRow = {
        ...data,
        pegawaiNama: (peg?.nama as string) || data.employee_id || "?",
        pegawaiJabatan: (peg?.jabatan as Record<string, unknown>)?.nama as string || "-",
      } as PayrollRow;
      setPayrolls((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setSelectedPayroll(updated);

      await logAudit({
        supabase,
        action: newStatus === "Final" ? "finalisasi" : "status_change",
        entityType: "payrolls",
        entityId: updated.id,
        entityLabel: `Slip ${updated.pegawaiNama} (${updated.periode})`,
        metadata: { from: oldStatus, to: newStatus },
      });
    }

    showToast("success", "Status Diubah", `Slip gaji diubah menjadi ${newStatus}.`);
    setSaving(false);
    setSingleFinalConfirm(null);
  };

  // ─── Delete slip ───
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin hapus payroll.");
      setDeleteConfirm(null);
      return;
    }
    setDeleting(true);
    const oldRecord = payrolls.find((p) => p.id === deleteConfirm.id);
    const { error } = await supabase.from("payrolls").delete().eq("id", deleteConfirm.id);
    if (error) {
      showToast("error", "Gagal Menghapus", error.message);
      setDeleting(false);
      setDeleteConfirm(null);
      return;
    }
    await logAudit({
      supabase,
      action: "delete",
      entityType: "payrolls",
      entityId: deleteConfirm.id,
      entityLabel: `Slip ${deleteConfirm.nama} (${oldRecord?.periode ?? ""})`,
      oldData: oldRecord ? { ...oldRecord } as unknown as Record<string, unknown> : null,
    });
    setPayrolls((prev) => prev.filter((p) => p.id !== deleteConfirm.id));
    // Remove from selection if exists
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(deleteConfirm.id);
      return next;
    });
    showToast("success", "Slip Dihapus", `Slip gaji ${deleteConfirm.nama} berhasil dihapus.`);
    setDeleting(false);
    setDeleteConfirm(null);
    if (selectedPayroll?.id === deleteConfirm.id) {
      setShowDetail(false);
      setSelectedPayroll(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin hapus payroll.");
      setBulkDeleteConfirm(false);
      return;
    }
    const scopedRows = getScopedSelectedRows();
    if (scopedRows.length === 0) return;
    setDeleting(true);
    
    const idsToDelete = scopedRows.map((p) => p.id);
    // Optimistically get records for audit
    const oldRecords = scopedRows;
    
    const { error } = await supabase.from("payrolls").delete().in("id", idsToDelete);
    if (error) {
      showToast("error", "Gagal Menghapus", error.message);
      setDeleting(false);
      setBulkDeleteConfirm(false);
      return;
    }
    
    await logAudit({
      supabase,
      action: "delete",
      entityType: "payrolls",
      entityId: `bulk-${idsToDelete.length}`,
      entityLabel: `Bulk delete ${idsToDelete.length} slip gaji`,
      metadata: { ids: idsToDelete, records: oldRecords.map(r => ({ id: r.id, nama: r.pegawaiNama, periode: r.periode })) }
    });
    
    setPayrolls((prev) => prev.filter((p) => !idsToDelete.includes(p.id)));
    showToast("success", "Slip Dihapus", `${idsToDelete.length} slip gaji berhasil dihapus.`);
    setDeleting(false);
    setBulkDeleteConfirm(false);
    setSelectedIds(new Set());
    
    if (selectedPayroll && idsToDelete.includes(selectedPayroll.id)) {
      setShowDetail(false);
      setSelectedPayroll(null);
    }
  };

  const handleBulkFinal = async () => {
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin finalisasi payroll.");
      setBulkFinalConfirm(false);
      return;
    }
    if (activeMainTab !== "draft") {
      showToast("error", "Tab Tidak Sesuai", "Finalisasi massal hanya bisa dilakukan dari tab Draft.");
      setBulkFinalConfirm(false);
      return;
    }
    const scopedRows = getScopedSelectedRows();
    if (scopedRows.length === 0) return;
    setBulkUpdating(true);
    
    // Hanya proses slip yang statusnya masih "Draft"
    const draftsToUpdate = scopedRows.filter((p) => p.status === "Draft");
    
    if (draftsToUpdate.length === 0) {
      showToast("error", "Info", "Semua slip yang dipilih sudah Final.");
      setBulkUpdating(false);
      setBulkFinalConfirm(false);
      return;
    }

    const draftIds = draftsToUpdate.map(p => p.id);
    const lockedAt = new Date().toISOString();
    
    const { error } = await supabase
      .from("payrolls")
      .update({ status: "Final", locked_at: lockedAt, locked_by: user?.id ?? null })
      .in("id", draftIds);
      
    if (error) {
      showToast("error", "Gagal Memfinalkan", error.message);
      setBulkUpdating(false);
      setBulkFinalConfirm(false);
      return;
    }
    
    await logAudit({
      supabase,
      action: "finalisasi",
      entityType: "payrolls",
      entityId: `bulk-final-${draftIds.length}`,
      entityLabel: `Bulk update ${draftIds.length} slip gaji ke Final`,
      metadata: { ids: draftIds, records: draftsToUpdate.map(r => ({ id: r.id, nama: r.pegawaiNama })) }
    });
    
    setPayrolls((prev) => prev.map((p) => draftIds.includes(p.id) ? { ...p, status: "Final", locked_at: lockedAt, locked_by: user?.id ?? null } : p));
    showToast("success", "Slip Difinalkan", `${draftIds.length} slip gaji berhasil diubah menjadi Final.`);
    
    // Update selected payroll if it's currently open
    if (selectedPayroll && draftIds.includes(selectedPayroll.id)) {
      setSelectedPayroll((prev) => prev ? { ...prev, status: "Final", locked_at: lockedAt, locked_by: user?.id ?? null } : null);
    }
    
    setBulkUpdating(false);
    setBulkFinalConfirm(false);
    setSelectedIds(new Set()); // Reset selection setelah aksi berhasil
  };

  const handleBulkDraft = async () => {
    if (!isSuperAdmin) {
      showToast("error", "Tidak Diizinkan", "Hanya super admin yang dapat mengembalikan Final ke Draft.");
      setBulkDraftConfirm(false);
      return;
    }
    if (activeMainTab !== "final") {
      showToast("error", "Tab Tidak Sesuai", "Batch Draft hanya bisa dilakukan dari tab Final.");
      setBulkDraftConfirm(false);
      return;
    }
    const scopedRows = getScopedSelectedRows();
    if (scopedRows.length === 0) return;
    setBulkUpdating(true);

    const finalsToUpdate = scopedRows.filter((p) => p.status === "Final");
    if (finalsToUpdate.length === 0) {
      showToast("error", "Info", "Semua slip yang dipilih sudah bukan Final.");
      setBulkUpdating(false);
      setBulkDraftConfirm(false);
      return;
    }

    const finalIds = finalsToUpdate.map((p) => p.id);
    const { error } = await supabase
      .from("payrolls")
      .update({ status: "Draft", locked_at: null, locked_by: null })
      .in("id", finalIds);

    if (error) {
      showToast("error", "Gagal Mengembalikan ke Draft", error.message);
      setBulkUpdating(false);
      setBulkDraftConfirm(false);
      return;
    }

    await logAudit({
      supabase,
      action: "status_change",
      entityType: "payrolls",
      entityId: `bulk-draft-${finalIds.length}`,
      entityLabel: `Bulk update ${finalIds.length} slip gaji ke Draft`,
      metadata: { from: "Final", to: "Draft", ids: finalIds, records: finalsToUpdate.map((r) => ({ id: r.id, nama: r.pegawaiNama })) },
    });

    setPayrolls((prev) =>
      prev.map((p) =>
        finalIds.includes(p.id) ? { ...p, status: "Draft", locked_at: null, locked_by: null } : p,
      ),
    );
    showToast("success", "Slip Dikembalikan", `${finalIds.length} slip gaji berhasil dikembalikan ke Draft.`);

    if (selectedPayroll && finalIds.includes(selectedPayroll.id)) {
      setSelectedPayroll((prev) =>
        prev ? { ...prev, status: "Draft", locked_at: null, locked_by: null } : null,
      );
    }

    setBulkUpdating(false);
    setBulkDraftConfirm(false);
    setSelectedIds(new Set());
  };

// ─── Export Excel (xlsx) ───
  const groupNameOf = useCallback((employeeId: string): string => {
    const gid = employeeGroups.get(employeeId);
    if (gid === undefined) return "";
    return groups.find((g) => g.id === gid)?.nama ?? "";
  }, [groups, employeeGroups]);

  const exportExcel = async (rowsToExport: PayrollRow[] = orderedPayrolls, scopeLabel?: string) => {
    if (rowsToExport.length === 0) {
      showToast("error", "Tidak Ada Data", "Tidak ada slip untuk di-export.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const periodLabel = formatPeriodLabel(periodKey);
      const filenameScope = scopeLabel ? `${scopeLabel}_` : "Slip_Gaji_";
      const filename = `${filenameScope}${periodLabel.replace(/\s/g, "_")}.xlsx`;

      const flatHeaders = (fields: FieldDef[]): string[] =>
        fields.flatMap((f) => f.keteranganKey ? [f.label, `Ket. ${f.label}`] : [f.label]);
      const flatValues = (p: PayrollRow, fields: FieldDef[]): (string | number)[] =>
        fields.flatMap((f) => f.keteranganKey
          ? [(p as unknown as Record<string, number>)[f.key] || 0, (p as unknown as Record<string, string | null>)[f.keteranganKey] || ""]
          : [(p as unknown as Record<string, number>)[f.key] || 0]
        );
      const flatTotals = (fields: FieldDef[]): (string | number)[] =>
        fields.flatMap((f) => f.keteranganKey
          ? [rowsToExport.reduce((s, p) => s + ((p as unknown as Record<string, number>)[f.key] || 0), 0), ""]
          : [rowsToExport.reduce((s, p) => s + ((p as unknown as Record<string, number>)[f.key] || 0), 0)]
        );

      const headers = [
        "No", "ID Pegawai", "Nama", "Kelompok", "Periode",
        ...flatHeaders(PENDAPATAN_FIELDS),
        "Total Pendapatan",
        ...flatHeaders(POTONGAN_FIELDS),
        "Total Potongan",
        "Netto", "Status", "Catatan",
      ];

      const rows = rowsToExport.map((p, idx) => [
        idx + 1,
        p.employee_id,
        p.pegawaiNama || "-",
        groupNameOf(p.employee_id),
        periodLabel,
        ...flatValues(p, PENDAPATAN_FIELDS),
        p.total_pendapatan,
        ...flatValues(p, POTONGAN_FIELDS),
        p.total_potongan,
        p.netto,
        p.status,
        p.catatan || "",
      ]);

      // Total row
      const totalRow = [
        "", "", "TOTAL", "", "",
        ...flatTotals(PENDAPATAN_FIELDS),
        rowsToExport.reduce((s, p) => s + p.total_pendapatan, 0),
        ...flatTotals(POTONGAN_FIELDS),
        rowsToExport.reduce((s, p) => s + p.total_potongan, 0),
        rowsToExport.reduce((s, p) => s + p.netto, 0),
        "", "",
      ];

      const wsData = [headers, ...rows, [], totalRow];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Auto width column heuristic
      const colWidths = headers.map((h, i) => {
        let max = String(h).length;
        rows.forEach((r) => {
          const v = String(r[i] ?? "");
          if (v.length > max) max = v.length;
        });
        return { wch: Math.min(Math.max(max + 2, 8), 30) };
      });
      ws["!cols"] = colWidths;

      // Format Rupiah: kolom angka mulai setelah kolom identitas (No, ID, Nama, Kelompok, Periode)
      // Excel format: "#,##0"
      const rupCols: number[] = [];
      for (let i = 5; i < headers.length - 2; i++) rupCols.push(i);
      const range = XLSX.utils.decode_range(ws["!ref"]!);
      for (let R = 1; R <= range.e.r; ++R) {
        for (const C of rupCols) {
          const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[cellRef];
          if (cell && typeof cell.v === "number") {
            cell.z = "#,##0";
          }
        }
      }

      // Freeze header
      ws["!freeze"] = { xSplit: 3, ySplit: 1 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Slip Gaji");
      XLSX.writeFile(wb, filename);

      showToast("success", "Export Excel", `${rowsToExport.length} slip diekspor ke ${filename}.`);

      await logAudit({
        supabase,
        action: "export",
        entityType: "payrolls",
        entityLabel: `Export Excel ${periodLabel}`,
        metadata: { periode: periodKey, jumlah_slip: rowsToExport.length, filename, scope: scopeLabel || "semua" },
      });
    } catch (err) {
      console.error("[Payroll] Export Excel failed:", err);
      showToast("error", "Gagal Export", err instanceof Error ? err.message : "Tidak dapat membuat file Excel.");
    }
  };

  // ─── Export CSV Gaji Pokok ───
  const exportGapokCsv = async () => {
    const data = gapokFiltered;
    if (data.length === 0) {
      showToast("error", "Tidak Ada Data", "Tidak ada data gaji pokok untuk di-export.");
      return;
    }
    try {
      const periodLabel = formatPeriodLabel(periodKey);
      const filename = `Gaji_Pokok_${periodLabel.replace(/\s/g, "_")}.csv`;

      const csvEscape = (v: unknown): string => {
        const s = String(v ?? "");
        return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const headers = ["No", "ID", "Nama Pegawai", "Jabatan", "Status", "Gaji Pokok"];
      const rows = data.map((e, idx) => [
        idx + 1,
        e.id,
        e.nama,
        e.jabatan?.nama || "-",
        e.status,
        e.gaji_pokok || 0,
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((r) => r.map(csvEscape).join(",")),
      ].join("\r\n");

      // UTF-8 BOM for Excel compatibility
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast("success", "Export CSV", `${data.length} data gaji pokok diekspor ke ${filename}.`);

      await logAudit({
        supabase,
        action: "export",
        entityType: "pegawai",
        entityLabel: `Export CSV Gaji Pokok ${periodLabel}`,
        metadata: { periode: periodKey, jumlah_pegawai: data.length, filename },
      });
    } catch (err) {
      console.error("[Payroll] Export CSV Gaji Pokok failed:", err);
      showToast("error", "Gagal Export", err instanceof Error ? err.message : "Tidak dapat membuat file CSV.");
    }
  };

  // ─── Export PDF slip gaji ───
  const exportSlipPDF = async (payroll: PayrollRow) => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;

    // ── Company header ──
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("JAMSLOGISTIC", pageWidth / 2, 20, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("Slip Gaji Karyawan", pageWidth / 2, 26, { align: "center" });

    // Separator line
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.8);
    doc.line(margin, 30, pageWidth - margin, 30);

    // ── Employee info ──
    const peg = payroll.pegawai;
    let y = 38;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Informasi Karyawan", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    const infoLeft = [
      ["Nama", payroll.pegawaiNama || "-"],
      ["ID Pegawai", payroll.employee_id],
      ["Jabatan", payroll.pegawaiJabatan || "-"],
    ];
    const infoRight = [
      ["Periode", formatPeriodLabel(payroll.periode)],
      ["Bank", peg?.bank || "-"],
      ["No. Rekening", peg?.no_rekening || "-"],
    ];

    infoLeft.forEach(([label, val], i) => {
      doc.setFont("helvetica", "normal");
      doc.text(`${label}`, margin, y + i * 5);
      doc.text(":", margin + 30, y + i * 5);
      doc.setFont("helvetica", "bold");
      doc.text(`${val}`, margin + 33, y + i * 5);
    });

    infoRight.forEach(([label, val], i) => {
      doc.setFont("helvetica", "normal");
      doc.text(`${label}`, pageWidth / 2 + 10, y + i * 5);
      doc.text(":", pageWidth / 2 + 40, y + i * 5);
      doc.setFont("helvetica", "bold");
      doc.text(`${val}`, pageWidth / 2 + 43, y + i * 5);
    });

    y += 20;

    // ── Pendapatan table ──
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("PENDAPATAN", margin, y);
    y += 2;

    const pendapatanData: (string | number)[][] = [];
    PENDAPATAN_FIELDS.forEach((f) => {
      pendapatanData.push([f.label, formatCurrency((payroll as unknown as Record<string, number>)[f.key] || 0)]);
      if (f.keteranganKey) {
        const ket = (payroll as unknown as Record<string, string | null>)[f.keteranganKey];
        if (ket) pendapatanData.push([`   Ket: ${ket}`, ""]);
      }
    });
    pendapatanData.push(["Total Pendapatan", formatCurrency(payroll.total_pendapatan)]);

    autoTable(doc, {
      startY: y,
      head: [["Komponen", "Jumlah"]],
      body: pendapatanData,
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { halign: "right", cellWidth: 60 },
      },
      didParseCell: (data) => {
        if (data.row.index === pendapatanData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [219, 234, 254];
        }
      },
      margin: { left: margin, right: margin },
    });

    y = ((doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? y + 50) + 8;

    // ── Potongan table ──
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("POTONGAN", margin, y);
    y += 2;

    const potonganData: (string | number)[][] = [];
    POTONGAN_FIELDS.forEach((f) => {
      potonganData.push([f.label, formatCurrency((payroll as unknown as Record<string, number>)[f.key] || 0)]);
      if (f.keteranganKey) {
        const ket = (payroll as unknown as Record<string, string | null>)[f.keteranganKey];
        if (ket) potonganData.push([`   Ket: ${ket}`, ""]);
      }
    });
    potonganData.push(["Total Potongan", formatCurrency(payroll.total_potongan)]);

    autoTable(doc, {
      startY: y,
      head: [["Komponen", "Jumlah"]],
      body: potonganData,
      theme: "grid",
      headStyles: { fillColor: [239, 68, 68], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { halign: "right", cellWidth: 60 },
      },
      didParseCell: (data) => {
        if (data.row.index === potonganData.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [254, 226, 226];
        }
      },
      margin: { left: margin, right: margin },
    });

    y = ((doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? y + 40) + 10;

    // ── Netto ──
    doc.setFillColor(16, 185, 129);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 12, 2, 2, "F");
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("GAJI BERSIH (NETTO)", margin + 5, y + 8);
    doc.text(formatCurrency(payroll.netto), pageWidth - margin - 5, y + 8, { align: "right" });
    doc.setTextColor(0, 0, 0);

    y += 22;

    // ── Catatan ──
    if (payroll.catatan) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(`Catatan: ${payroll.catatan}`, margin, y);
      y += 8;
    }

    // ── Signature area ──
    y = Math.max(y + 10, 230);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");

    const sigLeftX = margin + 15;
    const sigRightX = pageWidth - margin - 50;

    doc.text("Diterima oleh,", sigLeftX, y);
    doc.text("Disetujui oleh,", sigRightX, y);

    y += 25;
    doc.setFont("helvetica", "bold");
    doc.text(payroll.pegawaiNama || "-", sigLeftX, y);
    doc.text("HRD Jamslogistic", sigRightX, y);

    y += 3;
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.line(sigLeftX - 5, y, sigLeftX + 40, y);
    doc.line(sigRightX - 5, y, sigRightX + 40, y);

    doc.save(`Slip_Gaji_${payroll.employee_id}_${payroll.periode}.pdf`);
  };

  // ─── Worksheet helpers ───
  const initWsData = useCallback((rows: PayrollRow[]) => {
    const data: Record<number, Record<string, number>> = {};
    const keterangan: Record<number, Record<string, string>> = {};
    rows.forEach((r) => {
      const vals: Record<string, number> = {};
      PENDAPATAN_FIELDS.forEach((f) => { vals[f.key] = (r as unknown as Record<string, number>)[f.key] || 0; });
      POTONGAN_FIELDS.forEach((f) => { vals[f.key] = (r as unknown as Record<string, number>)[f.key] || 0; });
      data[r.id] = vals;
      const ket: Record<string, string> = {};
      [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].forEach((f) => {
        if (f.keteranganKey) ket[f.keteranganKey] = (r as unknown as Record<string, string | null>)[f.keteranganKey] || "";
      });
      keterangan[r.id] = ket;
    });
    setWsData(data);
    setWsKeterangan(keterangan);
    setWsChangedCells(new Map());
  }, []);

  // Init worksheet when payrolls change
  useEffect(() => {
    if (payrolls.length > 0) initWsData(payrolls);
  }, [payrolls, initWsData]);

  // Fetch breakdown potongan absen untuk row yang di-expand di worksheet
  useEffect(() => {
    if (wsExpandedId === null) return;
    const row = payrolls.find((r) => r.id === wsExpandedId);
    if (!row) return;
    if (wsAbsenBreakdown[wsExpandedId] !== undefined) return; // already fetched
    setWsAbsenLoading((prev) => ({ ...prev, [wsExpandedId]: true }));
    const startDate = row.periode_mulai || getPeriodRange(row.periode).start;
    const endDate = row.periode_selesai || getPeriodRange(row.periode).end;
    supabase
      .from("attendance_records")
      .select("tanggal, status, denda, durasi_telat")
      .gte("tanggal", startDate)
      .lte("tanggal", endDate)
      .eq("employee_id", row.employee_id)
      .gt("denda", 0)
      .order("tanggal", { ascending: true })
      .then(({ data }) => {
        let telat = 0, alpha = 0, lainnya = 0;
        (data || []).forEach((d) => {
          if (d.status === "Telat" || d.status === "Terlambat") telat += d.denda;
          else if (d.status === "Alpha") alpha += d.denda;
          else lainnya += d.denda;
        });
        setWsAbsenBreakdown((prev) => ({
          ...prev,
          [wsExpandedId]: { telat, alpha, lainnya, items: (data || []) as AbsenBreakdownItem[] },
        }));
        setWsAbsenLoading((prev) => ({ ...prev, [wsExpandedId]: false }));
      });

    // Fetch breakdown lembur disetujui untuk row yang sama
    if (wsLemburBreakdown[wsExpandedId] === undefined) {
      setWsLemburLoading((prev) => ({ ...prev, [wsExpandedId]: true }));
      supabase
        .from("overtime_requests")
        .select("tanggal, jam_mulai, jam_selesai, durasi_menit, rate_per_jam, total_lembur, alasan")
        .eq("status", "Disetujui")
        .eq("employee_id", row.employee_id)
        .gte("tanggal", startDate)
        .lte("tanggal", endDate)
        .order("tanggal", { ascending: true })
        .then(({ data }) => {
          const total = (data || []).reduce((s, x) => s + (x.total_lembur || 0), 0);
          setWsLemburBreakdown((prev) => ({
            ...prev,
            [wsExpandedId]: { total, items: (data || []) as LemburBreakdownItem[] },
          }));
          setWsLemburLoading((prev) => ({ ...prev, [wsExpandedId]: false }));
        });
    }
  }, [wsExpandedId, payrolls, wsAbsenBreakdown, wsLemburBreakdown]);

  /** Total cell yang berubah di seluruh worksheet (untuk header counter). */
  const wsTotalChanged = useMemo(() => {
    let total = 0;
    wsChangedCells.forEach((set) => { total += set.size; });
    return total;
  }, [wsChangedCells]);

  /** Total row yang punya minimal 1 cell berubah. */
  const wsRowsChanged = wsChangedCells.size;

  /** Cek apakah cell tertentu berubah. */
  const isCellChanged = useCallback((id: number, field: string) => {
    return wsChangedCells.get(id)?.has(field) ?? false;
  }, [wsChangedCells]);

  const handleWsChange = (id: number, field: string, rawValue: string) => {
    if (!canEdit) return;
    const row = payrolls.find((p) => p.id === id);
    if (row?.status === "Final") return;
    const value = parseCurrencyInput(rawValue);
    setWsData((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setWsChangedCells((prev) => {
      const next = new Map(prev);
      const cells = new Set(next.get(id) ?? []);
      cells.add(field);
      next.set(id, cells);
      return next;
    });
  };

  const handleWsKeteranganChange = (id: number, fieldKey: string, value: string) => {
    if (!canEdit) return;
    const row = payrolls.find((p) => p.id === id);
    if (row?.status === "Final") return;
    setWsKeterangan((prev) => ({ ...prev, [id]: { ...prev[id], [fieldKey]: value } }));
    setWsChangedCells((prev) => {
      const next = new Map(prev);
      const cells = new Set(next.get(id) ?? []);
      cells.add(fieldKey);
      next.set(id, cells);
      return next;
    });
  };

  const wsComputeTotals = (id: number) => {
    const vals = wsData[id];
    if (!vals) return { totalPendapatan: 0, totalPotongan: 0, netto: 0 };
    const totalPendapatan = PENDAPATAN_FIELDS.reduce((s, f) => s + (vals[f.key] || 0), 0);
    const totalPotongan = POTONGAN_FIELDS.reduce((s, f) => s + (vals[f.key] || 0), 0);
    return { totalPendapatan, totalPotongan, netto: totalPendapatan - totalPotongan };
  };

  const buildWsUpdatePayload = (id: number, vals: Record<string, number>, ket?: Record<string, string>) => {
    const payload: Record<string, number | string | null> = {};
    PENDAPATAN_FIELDS.filter((f) => !f.readonly).forEach((f) => { payload[f.key] = vals[f.key] || 0; });
    POTONGAN_FIELDS.filter((f) => !f.readonly).forEach((f) => { payload[f.key] = vals[f.key] || 0; });
    const keterangan = ket ?? wsKeterangan[id];
    if (keterangan) {
      [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].forEach((f) => {
        if (f.keteranganKey) payload[f.keteranganKey] = keterangan[f.keteranganKey] || null;
      });
    }
    return payload;
  };

const wsSaveTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const wsSavingRowsRef = useRef<Set<number>>(new Set());

  const wsLiveRef = useRef({ wsData, wsChangedCells, wsKeterangan, payrolls, canEdit });
  wsLiveRef.current = { wsData, wsChangedCells, wsKeterangan, payrolls, canEdit };

  useEffect(() => {
    return () => {
      wsSaveTimersRef.current.forEach((t) => clearTimeout(t));
      wsSaveTimersRef.current.clear();
    };
  }, []);

  const flushWsSaveRow = async (id: number, silent: boolean) => {
    const live = wsLiveRef.current;
    if (!live.wsChangedCells.has(id)) return;
    if (!live.canEdit) {
      if (!silent) showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin edit worksheet.");
      return;
    }
    if (wsSavingRowsRef.current.has(id)) {
      const timer = setTimeout(() => flushWsSaveRow(id, silent), 400);
      wsSaveTimersRef.current.set(id, timer);
      return;
    }
    const vals = live.wsData[id];
    if (!vals) return;

    const row = live.payrolls.find((p) => p.id === id);
    const status = row?.status;
    if (!status || status === "Final") {
      if (!silent) showToast("error", "Slip Terkunci", "Slip Final tidak dapat diedit.");
      return;
    }

    const savedCells = new Set(live.wsChangedCells.get(id) ?? []);
    const changedCellCount = savedCells.size;
    wsSavingRowsRef.current.add(id);
    setWsSaving(true);
    const { error } = await supabase
      .from("payrolls")
      .update(buildWsUpdatePayload(id, vals, live.wsKeterangan[id]))
      .eq("id", id)
      .eq("status", status);
    wsSavingRowsRef.current.delete(id);
    setWsSaving(false);

    if (error) {
      showToast("error", "Gagal Menyimpan", error.message);
      return;
    }

    const statusLabel = status === "Draft" ? "Draft" : "Worksheet";
    await logAudit({
      supabase,
      action: "update",
      entityType: "payrolls",
      entityLabel: `${statusLabel} ${row?.pegawaiNama || row?.employee_id || id}`,
      metadata: {
        periode: periodKey,
        payroll_id: id,
        employee_id: row?.employee_id,
        jumlah_cell: changedCellCount,
      },
    });

    setWsChangedCells((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (!cur) return next;
      const remaining = new Set([...cur].filter((c) => !savedCells.has(c)));
      if (remaining.size > 0) next.set(id, remaining);
      else next.delete(id);
      return next;
    });

    if (!silent) {
      showToast("success", `${statusLabel} Disimpan`, `${row?.pegawaiNama || "Pegawai"} berhasil diperbarui.`);
      if (live.wsChangedCells.size === 1) {
        await fetchPayrolls();
      }
    }
  };

  const handleWsSaveRow = (id: number): Promise<void> => {
    flushWsSaveRow(id, false);
    return Promise.resolve();
  };

  /** Autosave silent: Enter (immediate) atau pindah sel (debounce 450ms). */
  const handleWsAutoSave = (id: number, immediate: boolean) => {
    const existing = wsSaveTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    wsSaveTimersRef.current.delete(id);
    if (immediate) {
      flushWsSaveRow(id, true);
      return;
    }
    const timer = setTimeout(() => {
      wsSaveTimersRef.current.delete(id);
      flushWsSaveRow(id, true);
    }, 450);
    wsSaveTimersRef.current.set(id, timer);
  };

  /** Reorder global: pindahkan `movedId` sebelum/sesudah `targetId` (optimistic + upsert).
   *  Group-aware: pegawai yang dipindah mengikuti grup target (masuk/keluar grup otomatis). */
  const handleReorderRow = useCallback((movedId: string, targetId: string, placement: "before" | "after") => {
    if (!canEdit || orderSaving || groupSaving) return;
    if (movedId === targetId) return;
    const canonical = orderedEmployeeIds;
    if (!canonical.includes(movedId) || !canonical.includes(targetId)) return;
    const next = canonical.filter((id) => id !== movedId);
    const tIdx = next.indexOf(targetId);
    if (tIdx < 0) return;
    next.splice(placement === "after" ? tIdx + 1 : tIdx, 0, movedId);

    // Group pegawai pindah mengikuti grup target; tanpa grup = bukan anggota grup mana pun.
    const prevGroups = employeeGroups;
    const movedGroup = employeeGroups.get(movedId);
    const targetGroup = employeeGroups.get(targetId);
    const nextGroups = new Map(prevGroups);
    if (movedGroup !== targetGroup) {
      if (targetGroup === undefined) nextGroups.delete(movedId);
      else nextGroups.set(movedId, targetGroup);
    }

    const prevOrder = payrollOrder;
    setPayrollOrder(new Map(next.map((id, i) => [id, i + 1])));
    setEmployeeGroups(nextGroups);
    setOrderSaving(true);
    persistOrderAndMembership(next, nextGroups, prevGroups).then(() => {
      setOrderSaving(false);
      setOrderSavedTick((t) => t + 1);
    }).catch(() => {
      setOrderSaving(false);
      setPayrollOrder(prevOrder);
      setEmployeeGroups(prevGroups);
      showToast("error", "Gagal Menyimpan Urutan", "Perubahan urutan dibatalkan.");
    });
  }, [canEdit, orderSaving, groupSaving, orderedEmployeeIds, employeeGroups, payrollOrder, showToast]);

  /** Pindahkan pegawai ke kelompok tertentu (atau null = keluar dari kelompok), tanpa mengubah urutan global lain. */
  const handleMoveToGroup = useCallback((movedId: string, groupId: number | null) => {
    if (!canEdit || orderSaving || groupSaving) return;
    const prevGroups = employeeGroups;
    const nextGroups = new Map(prevGroups);
    if (groupId === null) nextGroups.delete(movedId);
    else nextGroups.set(movedId, groupId);
    if (nextGroups.get(movedId) === prevGroups.get(movedId)) return;

    setEmployeeGroups(nextGroups);
    setGroupSaving(true);
    persistMembershipOnly(nextGroups, prevGroups).then(() => {
      setGroupSaving(false);
      setGroupSavedTick((t) => t + 1);
    }).catch(() => {
      setGroupSaving(false);
      setEmployeeGroups(prevGroups);
      showToast("error", "Gagal Menyimpan Kelompok", "Perubahan kelompok dibatalkan.");
    });
  }, [canEdit, orderSaving, groupSaving, employeeGroups, showToast]);

  /** Buat kelompok baru dengan anggota terpilih (urutan sesuai tampilan saat ini). */
  const handleCreateGroup = useCallback(async (nama: string, warna: string, memberIds: string[]) => {
    if (!canEdit || memberIds.length === 0 || !nama.trim()) return false;
    try {
      const { data: newGroup, error: err1 } = await supabase
        .from("payroll_groups")
        .insert({ nama: nama.trim(), warna, sort_order: groups.length + 1 })
        .select()
        .single();
      if (err1) throw err1;
      const gid = (newGroup as DbPayrollGroup).id;
      const { error: err2 } = await supabase
        .from("payroll_employee_groups")
        .upsert(memberIds.map((id, i) => ({ employee_id: id, group_id: gid, member_sort_order: i + 1 })), { onConflict: "employee_id" });
      if (err2) throw err2;
      const prevGroups = employeeGroups;
      const nextGroups = new Map(prevGroups);
      memberIds.forEach((id) => nextGroups.set(id, gid));
      setGroups((prev) => [...prev, { ...newGroup } as DbPayrollGroup].sort((a, b) => a.sort_order - b.sort_order));
      setEmployeeGroups(nextGroups);
      setGroupSavedTick((t) => t + 1);
      return true;
    } catch (err) {
      showToast("error", "Gagal Membuat Kelompok", err instanceof Error ? err.message : "Terjadi kesalahan.");
      return false;
    }
  }, [canEdit, groups, employeeGroups, showToast]);

  /** Hapus kelompok (anggota otomatis keluar). */
  const handleDeleteGroup = useCallback((groupId: number) => {
    if (!canEdit) return;
    const prevGroups = employeeGroups;
    const prevGroupsList = groups;
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    setEmployeeGroups((prev) => {
      const next = new Map(prev);
      const toDelete = [...next.entries()].filter(([, gid]) => gid === groupId).map(([id]) => id);
      toDelete.forEach((id) => next.delete(id));
      return next;
    });
    setGroupSaving(true);
    supabase.from("payroll_groups").delete().eq("id", groupId).then(({ error }) => {
      setGroupSaving(false);
      if (error) {
        setGroups(prevGroupsList);
        setEmployeeGroups(prevGroups);
        showToast("error", "Gagal Menghapus Kelompok", error.message);
      } else {
        setGroupSavedTick((t) => t + 1);
      }
    });
  }, [canEdit, groups, employeeGroups, showToast]);

  // ─── Helper persistensi order + keanggotaan grup ───
  /** Tulis ulang payroll_employee_order + payroll_employee_groups (bulk upsert atomik). */
  const persistOrderAndMembership = useCallback(async (
    orderIds: string[],
    nextGroups: Map<string, number>,
    prevGroups: Map<string, number>,
  ) => {
    const { error: errOrder } = await supabase
      .from("payroll_employee_order")
      .upsert(orderIds.map((id, i) => ({ employee_id: id, sort_order: i + 1 })), { onConflict: "employee_id" });
    if (errOrder) throw errOrder;
    const removedIds = [...prevGroups.keys()].filter((id) => !nextGroups.has(id));
    if (removedIds.length > 0) {
      const { error: errDelete } = await supabase
        .from("payroll_employee_groups")
        .delete()
        .in("employee_id", removedIds);
      if (errDelete) throw errDelete;
    }
    // member_sort_order = urutan tampilan di dalam kelompok (nilai fallback; urutan utama tetap payroll_employee_order).
    const members = [...nextGroups.entries()].map(([employee_id, group_id]) => ({
      employee_id,
      group_id,
      member_sort_order: orderIds.indexOf(employee_id) + 1,
    }));
    if (members.length === 0) return;
    const { error: errMember } = await supabase
      .from("payroll_employee_groups")
      .upsert(members, { onConflict: "employee_id" });
    if (errMember) throw errMember;
  }, []);

  /** Tulis payroll_employee_groups saja (pindah grup tanpa ubah urutan global). */
  const persistMembershipOnly = useCallback(async (nextGroups: Map<string, number>, prevGroups: Map<string, number>) => {
    const members = [...nextGroups.entries()].map(([employee_id, group_id]) => ({
      employee_id,
      group_id,
      member_sort_order: orderedEmployeeIds.indexOf(employee_id) + 1,
    }));
    const { error: errUpsert } = await supabase
      .from("payroll_employee_groups")
      .upsert(members, { onConflict: "employee_id" });
    if (errUpsert) throw errUpsert;
    const removedIds = [...prevGroups.keys()].filter((id) => !nextGroups.has(id));
    if (removedIds.length > 0) {
      const { error: errDelete } = await supabase
        .from("payroll_employee_groups")
        .delete()
        .in("employee_id", removedIds);
      if (errDelete) throw errDelete;
    }
  }, [orderedEmployeeIds]);

  /** Reorder prioritas kelompok (drag header kelompok). */
  const handleReorderGroups = useCallback((fromId: number, toId: number) => {
    if (!canEdit || groupSaving) return;
    if (fromId === toId) return;
    const prev = groups;
    const next = [...groups];
    const fromIdx = next.findIndex((g) => g.id === fromId);
    const toIdx = next.findIndex((g) => g.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, prev[fromIdx]);
    const withOrder = next.map((g, i) => ({ ...g, sort_order: i + 1 }));
    setGroups(withOrder);
    setGroupSaving(true);
    supabase
      .from("payroll_groups")
      .upsert(withOrder.map((g) => ({ id: g.id, sort_order: g.sort_order })), { onConflict: "id" })
      .then(({ error }) => {
        setGroupSaving(false);
        if (error) {
          setGroups(prev);
          showToast("error", "Gagal Menyimpan Prioritas", error.message);
        } else {
          setGroupSavedTick((t) => t + 1);
        }
      });
  }, [canEdit, groupSaving, groups, showToast]);

  const handleWsRefreshSources = async () => {
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin refresh worksheet.");
      return;
    }
    if (wsChangedCells.size > 0) {
      showToast("error", "Simpan Worksheet Dulu", "Ada perubahan manual yang belum disimpan. Simpan atau reset sebelum refresh data sumber.");
      return;
    }

    const worksheetRows = payrolls.filter((p) => p.status === "Worksheet");
    if (worksheetRows.length === 0) {
      showToast("error", "Tidak Ada Worksheet", "Tidak ada baris Worksheet untuk di-refresh pada periode ini.");
      return;
    }

    setWsRefreshing(true);
    try {
      const employeeIds = worksheetRows.map((p) => p.employee_id);
      const refreshedAt = new Date().toISOString();

      const [empData, dpData, attData, lemburData] = await Promise.all([
        fetchAllRanges<{ id: string; gaji_pokok: number | null }>((from, to) =>
          supabase
            .from("pegawai")
            .select("id, gaji_pokok")
            .in("id", employeeIds)
            .order("id", { ascending: true })
            .range(from, to)
        ),
        fetchAllRanges<{ employee_id: string; total: number | null }>((from, to) =>
          supabase
            .from("delivery_points")
            .select("employee_id, total")
            .gte("tanggal", period.start)
            .lte("tanggal", period.end)
            .in("employee_id", employeeIds)
            .order("id", { ascending: true })
            .range(from, to)
        ),
        fetchAllRanges<{ employee_id: string; denda: number | null }>((from, to) =>
          supabase
            .from("attendance_records")
            .select("employee_id, denda")
            .gte("tanggal", period.start)
            .lte("tanggal", period.end)
            .in("employee_id", employeeIds)
            .order("id", { ascending: true })
            .range(from, to)
        ),
        fetchAllRanges<{ employee_id: string; total_lembur: number | null }>((from, to) =>
          supabase
            .from("overtime_requests")
            .select("employee_id, total_lembur")
            .eq("status", "Disetujui")
            .gte("tanggal", period.start)
            .lte("tanggal", period.end)
            .in("employee_id", employeeIds)
            .order("id", { ascending: true })
            .range(from, to)
        ),
      ]);

      const gapokMap = new Map(empData.map((e) => [e.id, e.gaji_pokok || 0]));
      const titikTotals = new Map<string, number>();
      dpData.forEach((d) => {
        titikTotals.set(d.employee_id, (titikTotals.get(d.employee_id) || 0) + (d.total || 0));
      });
      const absenTotals = new Map<string, number>();
      attData.forEach((d) => {
        absenTotals.set(d.employee_id, (absenTotals.get(d.employee_id) || 0) + (d.denda || 0));
      });
      const lemburTotals = new Map<string, number>();
      lemburData.forEach((d) => {
        lemburTotals.set(d.employee_id, (lemburTotals.get(d.employee_id) || 0) + (d.total_lembur || 0));
      });

      let updated = 0;
      let failed = 0;
      for (const row of worksheetRows) {
        const sourceGapok = gapokMap.get(row.employee_id) || 0;
        const sourceTitik = titikTotals.get(row.employee_id) || 0;
        const sourceLembur = lemburTotals.get(row.employee_id) || 0;
        const sourcePotonganAbsen = absenTotals.get(row.employee_id) || 0;
        const payload: Record<string, number | string | null> = {
          gaji_pokok: sourceGapok,
          pendapatan_titik: sourceTitik,
          lembur: sourceLembur,
          potongan_absen: sourcePotonganAbsen,
          source_gaji_pokok: sourceGapok,
          source_titik: sourceTitik,
          source_lembur: sourceLembur,
          last_recomputed_at: refreshedAt,
        };
        if (
          row.catatan?.startsWith("Prorata:") ||
          row.catatan?.startsWith("Tidak aktif") ||
          row.catatan?.startsWith("Belum bergabung") ||
          row.catatan?.startsWith("Sudah tidak aktif")
        ) {
          payload.catatan = null;
        }

        const { error } = await supabase
          .from("payrolls")
          .update(payload)
          .eq("id", row.id)
          .eq("status", "Worksheet");
        if (error) failed += 1;
        else updated += 1;
      }

      if (updated > 0) {
        await logAudit({
          supabase,
          action: "update",
          entityType: "payrolls",
          entityLabel: `Refresh sumber Worksheet ${formatPeriodLabel(periodKey)}`,
          metadata: {
            periode: periodKey,
            jumlah_slip: updated,
            sumber: ["gaji_pokok", "pendapatan_titik", "lembur", "potongan_absen"],
          },
        });
      }

      setWsAbsenBreakdown({});
      setWsLemburBreakdown({});
      await Promise.all([fetchEmployees(), fetchPayrolls()]);

      if (failed > 0) {
        showToast("error", "Sebagian Gagal", `${updated} slip berhasil di-refresh, ${failed} slip gagal.`);
      } else {
        showToast("success", "Data Worksheet Di-refresh", `${updated} slip diperbarui dari master gapok, titik, lembur, dan absensi.`);
      }
    } catch (e) {
      showToast("error", "Gagal Refresh", e instanceof Error ? e.message : "Gagal refresh data worksheet.");
    } finally {
      setWsRefreshing(false);
    }
  };

  // ─── Batch Fill handler ───
  const BATCH_FILL_OPTIONS = [
    ...PENDAPATAN_FIELDS.filter((f) => !f.readonly),
    ...POTONGAN_FIELDS.filter((f) => !f.readonly),
  ];

  /** Hitung target rows yang akan terkena batch fill (untuk preview & apply). */
  const computeBatchFillTargets = useCallback((rows: PayrollRow[]) => {
    if (!batchField) return [] as PayrollRow[];
    return rows.filter((row) => {
      if (batchFilter === "kosong") {
        const current = (wsData[row.id] || {})[batchField] || 0;
        return current === 0;
      }
      return true;
    });
  }, [batchField, batchFilter, wsData]);

  const handleBatchFill = () => {
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin edit worksheet.");
      return;
    }
    if (!batchField) return;
    const value = parseCurrencyInput(batchValue);
    const targets = computeBatchFillTargets(filtered);
    if (targets.length === 0) {
      showToast("error", "Tidak Ada Target", "Tidak ada pegawai yang cocok dengan target Batch Fill.");
      return;
    }
    const newData = { ...wsData };
    const newChangedCells = new Map(wsChangedCells);
    targets.forEach((row) => {
      if (newData[row.id]) {
        newData[row.id] = { ...newData[row.id], [batchField]: value };
        const cells = new Set(newChangedCells.get(row.id) ?? []);
        cells.add(batchField);
        newChangedCells.set(row.id, cells);
      }
    });
    setWsData(newData);
    setWsChangedCells(newChangedCells);
    setShowBatchFill(false);
    setBatchField("");
    setBatchValue("");
    setBatchFilter("semua");
    const fieldLabel = BATCH_FILL_OPTIONS.find((f) => f.key === batchField)?.label || batchField;
    showToast("success", "Batch Fill Berhasil", `${targets.length} pegawai diisi ${fieldLabel} = ${formatCurrency(value)}`);
  };

  // ─── Gapok handlers ───
  const handleGapokEdit = (empId: string, currentValue: number) => {
    setGapokEditId(empId);
    setGapokEditValue(formatInputCurrency(currentValue));
  };

  const handleGapokCancel = () => {
    setGapokEditId(null);
    setGapokEditValue("");
  };

  const handleGapokSave = async (empId: string) => {
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin edit gaji pokok.");
      return;
    }
    const value = parseCurrencyInput(gapokEditValue);
    setGapokSaving(true);
    const { error } = await supabase.from("pegawai").update({ gaji_pokok: value }).eq("id", empId);
    setGapokSaving(false);
    if (error) {
      showToast("error", "Gagal Menyimpan", error.message);
      return;
    }
    setEmployees((prev) => prev.map((e) => e.id === empId ? { ...e, gaji_pokok: value } : e));
    setGapokEditId(null);
    setGapokEditValue("");
    showToast("success", "Gaji Pokok Diperbarui");
  };

  // ─── Gapok filter & paginate ───
  const gapokFiltered = orderedEmployees.filter((e) => {
    // Search
    const matchSearch =
      e.nama.toLowerCase().includes(gapokSearch.toLowerCase()) ||
      e.id.toLowerCase().includes(gapokSearch.toLowerCase()) ||
      (e.jabatan?.nama || "").toLowerCase().includes(gapokSearch.toLowerCase());
    if (!matchSearch) return false;
    // Status filter
    if (gapokStatusFilter !== "semua" && e.status !== gapokStatusFilter) return false;
    // Gapok isi filter
    if (gapokIsiFilter === "terisi" && !e.gaji_pokok) return false;
    if (gapokIsiFilter === "belum" && e.gaji_pokok) return false;
    return true;
  });
  const gapokPaged = gapokFiltered.slice((gapokPage - 1) * GAPOK_PAGE_SIZE, gapokPage * GAPOK_PAGE_SIZE);
  const gapokTotalGapok = employees.reduce((s, e) => s + (e.gaji_pokok || 0), 0);
  const gapokBelumDiisi = employees.filter((e) => !e.gaji_pokok).length;

  // ─── Filter & paginate (by tab + search) ───
  const tabFiltered = getRowsForMainTab(activeMainTab);
  const filtered = getFilteredRowsForMainTab(activeMainTab);
  const paged = filtered.slice((page - 1) * PAYROLL_PAGE_SIZE, page * PAYROLL_PAGE_SIZE);
  const scopedSelectedRows = filtered.filter((p) => selectedIds.has(p.id));
  const scopedSelectedIds = scopedSelectedRows.map((p) => p.id);
  const scopedDraftSelectedCount = scopedSelectedRows.filter((p) => p.status === "Draft").length;
  const scopedFinalSelectedCount = scopedSelectedRows.filter((p) => p.status === "Final").length;
  const hasUnsavedBuatSlipSelection = buatSlipConfirm?.ids.some((id) => wsChangedCells.has(id)) ?? false;

  // ─── Summary ───
  const totalNetto = payrolls.reduce((s, p) => s + p.netto, 0);
  const totalPendapatanAll = payrolls.reduce((s, p) => s + p.total_pendapatan, 0);
  const totalPegawai = payrolls.length;
  const draftCount = payrolls.filter((p) => p.status === "Draft").length;
  const finalCount = payrolls.filter((p) => p.status === "Final").length;
  const worksheetCount = payrolls.filter((p) => p.status === "Worksheet").length;

  // ─── Periode navigation: berurutan (tidak boleh melompat) ───
  const prevPeriod = () => {
    setPeriodKey(shiftPeriodKey(periodKey, -1));
    setPage(1);
  };

  /** Pindah ke periode berikutnya hanya jika seluruh payroll periode berjalan sudah Final. */
  const nextPeriod = async () => {
    if (nextChecking) return;
    setNextChecking(true);
    try {
      const state = await fetchPeriodState(periodKey);
      if (state.error) {
        showToast("error", "Validasi Periode Gagal", "Status periode tidak dapat diperiksa. Perpindahan periode dibatalkan.");
        return;
      }
      if (state.total === 0) {
        showToast("error", "Periode Belum Diproses", `Periode ${formatPeriodLabel(periodKey)} belum memiliki data payroll. Hitung Worksheet terlebih dahulu sebelum melanjutkan.`);
        return;
      }
      if (state.worksheet > 0) {
        showToast("error", "Worksheet Belum Selesai", `Periode ${formatPeriodLabel(periodKey)} masih memiliki ${state.worksheet} Worksheet. Selesaikan dan finalisasi seluruh slip terlebih dahulu.`);
        return;
      }
      if (state.draft > 0) {
        showToast("error", "Periode Belum Final", `Periode ${formatPeriodLabel(periodKey)} masih memiliki ${state.draft} slip Draft. Finalisasi seluruh slip sebelum melanjutkan ke periode berikutnya.`);
        return;
      }
      setPeriodKey(shiftPeriodKey(periodKey, 1));
      setPage(1);
    } finally {
      setNextChecking(false);
    }
  };

// ─── Compute Worksheet (auto-recompute) ───
  const handleComputeWorksheet = async (specificPeriod?: string) => {
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin menghitung worksheet.");
      return;
    }
    if (wsComputingRef.current) {
      showToast("error", "Proses Sedang Berjalan", "Perhitungan worksheet masih berlangsung. Mohon tunggu sampai selesai.");
      return;
    }
    wsComputingRef.current = true;
    const targetPeriod = specificPeriod || periodKey;
    setWsComputing(true);
    const genPeriod = getPeriodRange(targetPeriod);
    try {
      // ── Validasi 1: periode target belum boleh memiliki payroll (cegah duplikasi) ──
      const targetState = await fetchPeriodState(targetPeriod);
      if (targetState.error) {
        showToast("error", "Validasi Gagal", "Data periode tidak dapat diverifikasi. Perhitungan dibatalkan dan tidak ada perubahan yang dilakukan.");
        return;
      }
      if (targetState.total > 0) {
        if (targetState.duplicates > 0) {
          showToast("error", "Data Payroll Duplikat", `Ditemukan payroll ganda untuk pegawai pada periode ${formatPeriodLabel(targetPeriod)}. Perhitungan dibatalkan.`);
        } else {
          showToast("error", "Periode Sudah Memiliki Data", `Periode ${formatPeriodLabel(targetPeriod)} sudah memiliki ${targetState.total} baris payroll. Perhitungan dibatalkan agar tidak terjadi duplikasi. Gunakan “Refresh Sumber” untuk memperbarui data.`);
        }
        return;
      }

      // ── Validasi 2: periode sebelumnya harus seluruhnya Final (tidak boleh melompat) ──
      const prevKey = shiftPeriodKey(targetPeriod, -1);
      const prevState = await fetchPeriodState(prevKey);
      if (prevState.error) {
        showToast("error", "Validasi Gagal", `Data periode sebelumnya (${formatPeriodLabel(prevKey)}) tidak dapat diverifikasi. Perhitungan dibatalkan.`);
        return;
      }
      if (prevState.total === 0) {
        if (!isSuperAdmin) {
          showToast("error", "Periode Belum Diproses", `Periode ${formatPeriodLabel(prevKey)} belum memiliki data payroll. Hitung dan finalisasi periode sebelumnya terlebih dahulu, atau minta Super Admin menetapkan periode awal.`);
          return;
        }
      } else if (prevState.worksheet > 0) {
        showToast("error", "Worksheet Belum Selesai", `Periode ${formatPeriodLabel(prevKey)} masih memiliki ${prevState.worksheet} Worksheet. Selesaikan dan finalisasi seluruh slip terlebih dahulu.`);
        return;
      } else if (prevState.draft > 0) {
        showToast("error", "Periode Belum Final", `Periode ${formatPeriodLabel(prevKey)} masih memiliki ${prevState.draft} slip Draft. Finalisasi seluruh slip terlebih dahulu.`);
        return;
      }

      // 1. Fetch semua pegawai. Gaji pokok selalu mengikuti master pegawai.
      const { data: allEmps, error: empErr } = await supabase
        .from("pegawai")
        .select("id, nama, gaji_pokok, tanggal_keluar, status, tanggal_bergabung, non_active_periods")
        .order("nama");
      if (empErr || !allEmps) {
        showToast("error", "Gagal Memuat Pegawai", (empErr as { message?: string } | null)?.message || "Unknown error");
        setWsComputing(false);
        return;
      }

      // 2. Fetch delivery points, attendance, lembur dalam periode
      const dpData = await fetchAllRanges<{ employee_id: string; total: number }>((from, to) =>
        supabase
          .from("delivery_points")
          .select("employee_id, total")
          .gte("tanggal", genPeriod.start)
          .lte("tanggal", genPeriod.end)
          .in("employee_id", allEmps.map((e) => e.id))
          .order("id", { ascending: true })
          .range(from, to)
      );
      const dpTotals = new Map<string, number>();
      dpData.forEach((d) => {
        dpTotals.set(d.employee_id, (dpTotals.get(d.employee_id) || 0) + d.total);
      });

      const attData = await fetchAllRanges<{ employee_id: string; denda: number; tanggal: string; status: string }>((from, to) =>
        supabase
          .from("attendance_records")
          .select("employee_id, denda, tanggal, status")
          .gte("tanggal", genPeriod.start)
          .lte("tanggal", genPeriod.end)
          .in("employee_id", allEmps.map((e) => e.id))
          .order("id", { ascending: true })
          .range(from, to)
      );
      const dendaTotals = new Map<string, number>();
      attData.forEach((d) => {
        dendaTotals.set(d.employee_id, (dendaTotals.get(d.employee_id) || 0) + d.denda);
      });

      const lemburData = await fetchAllRanges<{ employee_id: string; total_lembur: number | null }>((from, to) =>
        supabase
          .from("overtime_requests")
          .select("employee_id, total_lembur")
          .eq("status", "Disetujui")
          .gte("tanggal", genPeriod.start)
          .lte("tanggal", genPeriod.end)
          .in("employee_id", allEmps.map((e) => e.id))
          .order("id", { ascending: true })
          .range(from, to)
      );
      const lemburTotals = new Map<string, number>();
      lemburData.forEach((d) => {
        lemburTotals.set(d.employee_id, (lemburTotals.get(d.employee_id) || 0) + (d.total_lembur || 0));
      });

      // 3. Bangun insert rows untuk pegawai yang eligible.
      type Emp = { id: string; nama: string; status: string; gaji_pokok?: number; tanggal_keluar: string | null; tanggal_bergabung: string | null; non_active_periods: NonActivePeriod[] | null };

      const inserts = (allEmps as Emp[]).flatMap((e) => {
        const gapokFull = e.gaji_pokok || 0;

        // Skip jika tidak punya hari aktif dalam periode
        if (!hasActiveDayInPeriod(e, genPeriod.start, genPeriod.end)) return [];

        // Fallback untuk Tidak Aktif tanpa tanggal_keluar: butuh catatan absen
        if (e.status === "Tidak Aktif" && !e.tanggal_keluar) {
          const hariDenganCatatan = new Set(
            attData.filter((a) => a.employee_id === e.id).map((a) => a.tanggal)
          ).size;
          if (hariDenganCatatan === 0) return [];
        }

        const sourceTitik = dpTotals.get(e.id) || 0;
        const sourceLembur = lemburTotals.get(e.id) || 0;
        const sourceGapok = gapokFull;
        const totalPotongan = dendaTotals.get(e.id) || 0;

        return [{
          employee_id: e.id,
          periode: targetPeriod,
          periode_mulai: genPeriod.start,
          periode_selesai: genPeriod.end,
          gaji_pokok: sourceGapok,
          pendapatan_titik: sourceTitik,
          extra_job: 0,
          uang_makan: 0,
          insentif: 0,
          tunjangan_jabatan: 0,
          transport: 0,
          tunjangan_lain: 0,
          tambahan_lain: 0,
          lembur: sourceLembur,
          koperasi: 0,
          pinjaman_perusahaan: 0,
          potongan_absen: totalPotongan,
          potongan_lain: 0,
          jht: 0,
          bpjs_kesehatan: 0,
          status: "Worksheet",
          catatan: null,
          extra_job_keterangan: null,
          insentif_keterangan: null,
          pinjaman_perusahaan_keterangan: null,
          potongan_lain_keterangan: null,
          last_recomputed_at: new Date().toISOString(),
          source_gaji_pokok: sourceGapok,
          source_titik: sourceTitik,
          source_lembur: sourceLembur,
        }];
      });

      if (inserts.length === 0) {
        showToast("error", "Tidak Ada Data", "Tidak ada pegawai dengan catatan kehadiran di periode ini.");
        setWsComputing(false);
        return;
      }

      const { error: insErr } = await supabase.from("payrolls").insert(inserts);
      if (insErr) {
        showToast("error", "Gagal Menyimpan", insErr.message);
        setWsComputing(false);
        return;
      }

      showToast("success", "Worksheet Diperbarui", `${inserts.length} baris worksheet di-recompute untuk ${formatPeriodLabel(targetPeriod)}.`);
      // Audit log
      await logAudit({
        supabase,
        action: "generate",
        entityType: "payrolls",
        entityLabel: `Worksheet ${formatPeriodLabel(targetPeriod)}`,
        metadata: {
          periode: targetPeriod,
          jumlah_baris: inserts.length,
          rentang: `${genPeriod.start} – ${genPeriod.end}`,
        },
      });
      // Reload
      setReloadKey((k) => k + 1);
    } catch (e) {
      showToast("error", "Error", (e as Error).message);
    } finally {
      wsComputingRef.current = false;
      setWsComputing(false);
    }
  };

  // ─── Salin input manual dari periode sebelumnya (isi yang masih kosong) ───
  const handleCopyInputsFromPrev = async () => {
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin mengubah worksheet.");
      return;
    }
    if (copyInputsRef.current) {
      showToast("error", "Proses Sedang Berjalan", "Penyalinan input manual masih berlangsung. Mohon tunggu sampai selesai.");
      return;
    }
    if (wsChangedCells.size > 0) {
      showToast("error", "Simpan Worksheet Dulu", "Ada perubahan worksheet yang belum disimpan. Simpan atau reset sebelum menyalin input dari periode sebelumnya.");
      return;
    }
    const worksheetRows = payrolls.filter((p) => p.status === "Worksheet");
    if (worksheetRows.length === 0) {
      showToast("error", "Tidak Ada Worksheet", "Tidak ada baris Worksheet pada periode ini untuk disalin. Hitung Worksheet terlebih dahulu.");
      return;
    }

    copyInputsRef.current = true;
    setCopyInputsBusy(true);
    try {
      // ── Validasi: periode sumber (sebelumnya) harus seluruhnya Final ──
      const prevKey = shiftPeriodKey(periodKey, -1);
      const prevState = await fetchPeriodState(prevKey);
      if (prevState.error) {
        showToast("error", "Validasi Gagal", `Data periode ${formatPeriodLabel(prevKey)} tidak dapat diverifikasi. Penyalinan dibatalkan.`);
        return;
      }
      if (prevState.total === 0) {
        showToast("error", "Periode Sumber Belum Diproses", `Periode ${formatPeriodLabel(prevKey)} belum memiliki data payroll. Input manual tidak dapat disalin.`);
        return;
      }
      if (prevState.worksheet > 0) {
        showToast("error", "Periode Sumber Belum Selesai", `Periode ${formatPeriodLabel(prevKey)} masih memiliki ${prevState.worksheet} Worksheet. Finalisasi seluruh slip terlebih dahulu.`);
        return;
      }
      if (prevState.draft > 0) {
        showToast("error", "Periode Sumber Belum Final", `Periode ${formatPeriodLabel(prevKey)} masih memiliki ${prevState.draft} slip Draft. Finalisasi seluruh slip sebelum menyalin input.`);
        return;
      }

      // ── Ambil input manual periode sumber (status Final) ──
      const selectColumns = [...new Set([
        "employee_id",
        ...MANUAL_INPUT_FIELDS.map((f) => f.key),
        ...MANUAL_INPUT_FIELDS.map((f) => f.keteranganKey).filter((k): k is string => Boolean(k)),
      ])];
      const { data: prevRows, error: prevErr } = await supabase
        .from("payrolls")
        .select(selectColumns.join(","))
        .eq("periode", prevKey)
        .eq("status", "Final");
      if (prevErr || !prevRows) {
        showToast("error", "Gagal Memuat Data Sumber", (prevErr as { message?: string } | null)?.message || "Data periode sebelumnya tidak dapat dimuat.");
        return;
      }
      const prevMap = new Map<string, Record<string, number | string | null>>();
      prevRows.forEach((r) => {
        const rec = r as unknown as Record<string, number | string | null>;
        if (typeof rec.employee_id === "string") prevMap.set(rec.employee_id, rec);
      });

      // ── Isi field manual target yang masih kosong dari sumber (match by employee_id) ──
      let updated = 0;
      let failed = 0;
      let tanpaSumber = 0;
      let sudahTerisi = 0;
      for (const row of worksheetRows) {
        const prev = prevMap.get(row.employee_id);
        if (!prev) {
          tanpaSumber += 1;
          continue;
        }

        const tgt = row as unknown as Record<string, unknown>;
        const payload: Record<string, number | string | null> = {};
        const values: Record<string, number> = {};
        [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].forEach((f) => {
          values[f.key] = Number(tgt[f.key] || 0);
        });

        MANUAL_INPUT_FIELDS.forEach((f) => {
          if (f.keteranganKey) {
            const targetKet = tgt[f.keteranganKey];
            const sourceKet = prev[f.keteranganKey];
            if (!targetKet && sourceKet) payload[f.keteranganKey] = String(sourceKet);
            return;
          }
          const targetVal = Number(tgt[f.key] || 0);
          const sourceVal = Number(prev[f.key] || 0);
          if (targetVal === 0 && sourceVal > 0) {
            payload[f.key] = sourceVal;
            values[f.key] = sourceVal;
          }
        });

        if (Object.keys(payload).length === 0) {
          sudahTerisi += 1;
          continue;
        }

        const totalPendapatan = PENDAPATAN_FIELDS.reduce((s, f) => s + values[f.key], 0);
        const totalPotongan = POTONGAN_FIELDS.reduce((s, f) => s + values[f.key], 0);
        payload.total_pendapatan = totalPendapatan;
        payload.total_potongan = totalPotongan;
        payload.netto = totalPendapatan - totalPotongan;

        const { error } = await supabase
          .from("payrolls")
          .update(payload)
          .eq("id", row.id)
          .eq("status", "Worksheet");
        if (error) failed += 1;
        else updated += 1;
      }

      if (updated > 0) {
        await logAudit({
          supabase,
          action: "update",
          entityType: "payrolls",
          entityLabel: `Salin input manual ${formatPeriodLabel(periodKey)}`,
          metadata: {
            periode: periodKey,
            periode_sumber: prevKey,
            jumlah_slip: updated,
          },
        });
      }

      setWsAbsenBreakdown({});
      setWsLemburBreakdown({});
      await Promise.all([fetchEmployees(), fetchPayrolls()]);

      if (failed > 0) {
        showToast("error", "Sebagian Gagal", `${updated} slip berhasil disalin, ${failed} slip gagal diperbarui.`);
      } else if (updated === 0 && sudahTerisi === worksheetRows.length) {
        showToast("success", "Tidak Ada Perubahan", "Seluruh input manual pada periode ini sudah terisi.");
      } else {
        const parts: string[] = [];
        if (updated > 0) parts.push(`${updated} slip diperbarui dari periode sebelumnya`);
        if (tanpaSumber > 0) parts.push(`${tanpaSumber} pegawai tidak memiliki data di periode sumber`);
        showToast("success", "Input Manual Disalin", parts.length > 0 ? `${parts.join(", ")}.` : "Tidak ada perubahan yang dilakukan.");
      }
    } catch (e) {
      showToast("error", "Gagal Menyalin", e instanceof Error ? e.message : "Gagal menyalin input dari periode sebelumnya.");
    } finally {
      copyInputsRef.current = false;
      setCopyInputsBusy(false);
    }
  };

  // ─── Buat Slip dari Worksheet (Worksheet → Draft) ───
  const handleBuatSlip = async (ids: number[]) => {
    if (ids.length === 0) return;
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin membuat slip.");
      setBuatSlipConfirm(null);
      return;
    }
    if (ids.some((id) => wsChangedCells.has(id))) {
      showToast("error", "Simpan Worksheet Dulu", "Ada perubahan worksheet yang belum disimpan pada slip yang dipilih.");
      return;
    }
    const { error } = await supabase
      .from("payrolls")
      .update({ status: "Draft", last_recomputed_at: null })
      .in("id", ids)
      .eq("status", "Worksheet");
    if (error) {
      showToast("error", "Gagal", error.message);
      return;
    }
    showToast("success", "Slip Berhasil Dibuat", `${ids.length} slip dipindahkan ke tab Draft.`);
    await logAudit({
      supabase,
      action: "status_change",
      entityType: "payrolls",
      entityLabel: `${ids.length} slip dari worksheet`,
      metadata: { jumlah: ids.length, dari: "Worksheet", ke: "Draft" },
    });
    setBuatSlipConfirm(null);
    setReloadKey((k) => k + 1);
  };

  // ─── Batalkan Draft (Draft → Worksheet) ───
  const handleBatalkanDraft = async (ids: number[]) => {
    if (ids.length === 0) return;
    if (!canEdit) {
      showToast("error", "Tidak Diizinkan", "Anda tidak memiliki izin membatalkan draft.");
      return;
    }
    const { error } = await supabase
      .from("payrolls")
      .update({ status: "Worksheet" })
      .in("id", ids)
      .eq("status", "Draft");
    if (error) {
      showToast("error", "Gagal", error.message);
      return;
    }
    showToast("success", "Draft Dibatalkan", `${ids.length} slip dikembalikan ke tab Worksheet.`);
    setReloadKey((k) => k + 1);
  };

  return (
    <>
    {sheetMode && (
      <WorksheetSheetFullscreen
        filtered={getFilteredRowsForMainTab(activeMainTab === "laporan" ? "final" : activeMainTab)}
        wsData={wsData}
        wsChangedCells={wsChangedCells}
        wsAbsenBreakdown={wsAbsenBreakdown}
        wsLemburBreakdown={wsLemburBreakdown}
        wsSaving={wsSaving}
        period={period}
        prevPeriod={prevPeriod}
        nextPeriod={nextPeriod}
        handleWsChange={handleWsChange}
        handleWsKeteranganChange={handleWsKeteranganChange}
        wsKeterangan={wsKeterangan}
        handleWsSaveRow={handleWsSaveRow}
        handleWsAutoSave={handleWsAutoSave}
        isCellChanged={isCellChanged}
        wsComputeTotals={wsComputeTotals}
        exportSlipPDF={exportSlipPDF}
        setDeleteConfirm={setDeleteConfirm}
        setBuatSlipConfirm={activeMainTab === "worksheet" ? setBuatSlipConfirm : undefined}
        canEdit={canEdit}
        mode={activeMainTab === "laporan" ? "Final" : (activeMainTab.charAt(0).toUpperCase() + activeMainTab.slice(1)) as "Worksheet" | "Draft" | "Final"}
        orderSaving={orderSaving}
        orderSavedTick={orderSavedTick}
        handleReorderRow={handleReorderRow}
        groups={groups}
        employeeGroups={employeeGroups}
        handleMoveToGroup={handleMoveToGroup}
        handleCreateGroup={handleCreateGroup}
        handleDeleteGroup={handleDeleteGroup}
        handleReorderGroups={handleReorderGroups}
        groupSaving={groupSaving}
        groupSavedTick={groupSavedTick}
        onClose={() => setSheetMode(false)}
      />
    )}
    <RouteGuard permission="payroll">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Penggajian"
        description={activeTab === "gapok" ? "Kelola gaji pokok master data pegawai" : "Kelola slip gaji pegawai perusahaan"}
        icon={CreditCard}
        actions={
          <div className="flex items-center gap-2">
            {activeTab === "slip" && (
              <>
                <Button
                  variant="outline"
                  icon={FileSpreadsheet}
                  size="sm"
                  onClick={() => activeMainTab === "laporan" ? exportExcel(filtered, "Laporan_Final") : exportExcel()}
                  disabled={activeMainTab === "laporan" ? filtered.length === 0 : payrolls.length === 0}
                >
                  Export Excel
                </Button>
                <Button variant="outline" icon={Download} size="sm" onClick={() => {
                  const finalSlips = orderedPayrolls.filter((p) => p.status === "Final");
                  if (finalSlips.length === 0) {
                    showToast("error", "Tidak Ada Slip Final", "Belum ada slip gaji berstatus Final untuk di-export.");
                    return;
                  }
                  finalSlips.forEach((p) => exportSlipPDF(p));
                  showToast("success", "Export PDF", `${finalSlips.length} slip gaji sedang di-download.`);
                }}>
                  Export PDF
                </Button>
                <Button variant="outline" icon={FileText} size="sm" onClick={() => {
                  if (wsChangedCells.size > 0) setComputeWorksheetConfirm(true);
                  else handleComputeWorksheet();
                }} disabled={wsComputing || loading || !canEdit}>
                  {wsComputing ? "Menghitung..." : "Hitung Worksheet"}
                </Button>
                {activeMainTab === "worksheet" && worksheetCount > 0 && (
                  <Button variant="outline" icon={Copy} size="sm" onClick={() => {
                    if (wsChangedCells.size > 0) {
                      showToast("error", "Simpan Worksheet Dulu", "Ada perubahan worksheet yang belum disimpan. Simpan atau reset sebelum menyalin input dari periode sebelumnya.");
                      return;
                    }
                    setCopyInputsConfirm(true);
                  }} disabled={copyInputsBusy || loading || !canEdit}>
                    {copyInputsBusy ? "Menyalin..." : "Salin Input Periode Lalu"}
                  </Button>
                )}
                {activeMainTab !== "laporan" && (
                  <Button variant="outline" icon={Maximize2} size="sm" onClick={() => setSheetMode(true)}>
                    Spreadsheet
                  </Button>
                )}
              </>
            )}
            <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
              <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-bold text-foreground px-2.5 min-w-[200px] text-center whitespace-nowrap">{period.label}</span>
              <button onClick={nextPeriod} disabled={nextChecking} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                {nextChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
            {activeTab === "gapok" && (
              <Button variant="outline" icon={Download} size="sm" onClick={exportGapokCsv} disabled={gapokFiltered.length === 0}>
                Export CSV
              </Button>
            )}
            <Button
              variant={activeTab === "gapok" ? "primary" : "outline"}
              icon={Banknote}
              size="sm"
              onClick={() => setActiveTab(activeTab === "gapok" ? "slip" : "gapok")}
            >
              Data Gaji Pokok
              {gapokBelumDiisi > 0 && !loading && (
                <span className={cn(
                  "ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                  activeTab === "gapok" ? "bg-white/20 text-white" : "bg-danger text-white"
                )}>{gapokBelumDiisi}</span>
              )}
            </Button>
          </div>
        }
      />

      {/* ═══ Toast ═══ */}
      {toast.show && (
        <Portal>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
            <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]",
              toast.type === "error" ? "border-danger/20" : "border-success/20")}>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
                {toast.type === "error"
                  ? <AlertTriangle className="w-5 h-5 text-danger" />
                  : <CircleCheckBig className="w-5 h-5 text-success" />}
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

      {/* ═══════════════════════════════════════ */}
      {/* ═══ TAB: DATA GAJI POKOK ═══ */}
      {/* ═══════════════════════════════════════ */}
      {activeTab === "gapok" && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center"><Banknote className="w-5 h-5 text-primary" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Total Gaji Pokok</p><p className="text-lg font-bold text-foreground">{formatCurrency(gapokTotalGapok)}</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center"><Users className="w-5 h-5 text-success" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Jumlah Pegawai</p><p className="text-lg font-bold text-foreground">{employees.length}</p></div>
            </div>
            <div className={cn("bg-card rounded-2xl border p-4 flex items-center gap-3", gapokBelumDiisi > 0 ? "border-danger/30" : "border-border")}>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", gapokBelumDiisi > 0 ? "bg-danger/10" : "bg-success-light")}>
                <span className={cn("text-sm font-bold", gapokBelumDiisi > 0 ? "text-danger" : "text-success")}>{gapokBelumDiisi}</span>
              </div>
              <div><p className="text-xs text-muted-foreground font-medium">Belum Diisi</p><p className="text-xs text-muted-foreground">pegawai</p></div>
            </div>
          </div>

          {/* Search */}
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari nama, ID, atau jabatan..."
                value={gapokSearch}
                onChange={(e) => { setGapokSearch(e.target.value); setGapokPage(1); }}
                className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground"
              />
            </div>
          </div>

          {/* Filter controls */}
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Status:</span>
                <select
                  value={gapokStatusFilter}
                  onChange={(e) => { setGapokStatusFilter(e.target.value as "semua" | "Aktif" | "Tidak Aktif"); setGapokPage(1); }}
                  className="px-3 py-2 rounded-xl bg-muted border-none text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="semua">Semua Status</option>
                  <option value="Aktif">Aktif</option>
                  <option value="Tidak Aktif">Tidak Aktif</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Gaji Pokok:</span>
                <select
                  value={gapokIsiFilter}
                  onChange={(e) => { setGapokIsiFilter(e.target.value as "semua" | "terisi" | "belum"); setGapokPage(1); }}
                  className="px-3 py-2 rounded-xl bg-muted border-none text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="semua">Semua Gaji Pokok</option>
                  <option value="terisi">Sudah Diisi</option>
                  <option value="belum">Belum Diisi</option>
                </select>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">ID</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Nama Pegawai</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Jabatan</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Gaji Pokok</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? (
                    <SkeletonTable rows={6} cols={7} />
                  ) : gapokPaged.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-16 text-sm text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="w-10 h-10 text-muted-foreground/20" />
                        <p>Tidak ada pegawai ditemukan</p>
                      </div>
                    </td></tr>
                  ) : gapokPaged.map((emp, idx) => {
                    const isEditing = gapokEditId === emp.id;
                    return (
                      <tr key={emp.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{(gapokPage - 1) * GAPOK_PAGE_SIZE + idx + 1}</td>
                        <td className="px-5 py-3.5"><span className="text-xs font-mono text-muted-foreground">{emp.id}</span></td>
                        <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{emp.nama}</p></td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">{emp.jabatan?.nama || "-"}</td>
                        <td className="px-5 py-3.5">
                          <Badge variant={emp.status === "Aktif" ? "success" : "warning"}>{emp.status}</Badge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-xs text-muted-foreground">Rp</span>
                              <input
                                type="text"
                                value={gapokEditValue}
                                onChange={(e) => {
                                  const raw = parseCurrencyInput(e.target.value);
                                  setGapokEditValue(formatInputCurrency(raw));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleGapokSave(emp.id);
                                  if (e.key === "Escape") handleGapokCancel();
                                }}
                                autoFocus
                                className="w-32 px-2 py-1.5 rounded-lg border border-primary bg-muted/30 text-sm text-right outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                              />
                            </div>
                          ) : (
                            <span className={cn("text-sm font-semibold", emp.gaji_pokok ? "text-foreground" : "text-muted-foreground italic")}>
                              {emp.gaji_pokok ? formatCurrency(emp.gaji_pokok) : "Belum diisi"}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-center gap-1">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => handleGapokSave(emp.id)}
                                  disabled={gapokSaving}
                                  className="p-1.5 rounded-lg bg-success-light text-success hover:bg-success hover:text-white disabled:opacity-50"
                                  title="Simpan"
                                >
                                  {gapokSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={handleGapokCancel}
                                  disabled={gapokSaving}
                                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                                  title="Batal"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              canEdit && <button
                                onClick={() => handleGapokEdit(emp.id, emp.gaji_pokok || 0)}
                                className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"
                                title="Edit Gaji Pokok"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={gapokPage} totalItems={gapokFiltered.length} pageSize={GAPOK_PAGE_SIZE} onPageChange={setGapokPage} />
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* ═══ TAB: SLIP GAJI ═══ */}
      {/* ═══════════════════════════════════════ */}
      {activeTab === "slip" && (<>

      {/* ═══ Hero Metrics ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-2xl border border-border p-4 space-y-2">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <Skeleton className="h-3 w-20 rounded-md" />
            <Skeleton className="h-7 w-32 rounded-md" />
          </div>
        )) : (
          <>
            <_HeroMetric
              icon={DollarSign}
              label="Total Netto"
              value={formatCurrency(totalNetto)}
              iconBg="bg-primary/15"
              iconColor="text-primary"
            />
            <_HeroMetric
              icon={Users}
              label="Jumlah Pegawai"
              value={String(totalPegawai)}
              unit="slip"
              iconBg="bg-success/15"
              iconColor="text-success"
            />
            <_HeroMetric
              icon={Clock}
              label="Draft"
              value={String(draftCount)}
              unit="belum final"
              iconBg="bg-warning/15"
              iconColor="text-warning"
            />
            <_HeroMetric
              icon={CheckCircle2}
              label="Final"
              value={String(finalCount)}
              unit="terkunci"
              iconBg="bg-success/15"
              iconColor="text-success"
            />
          </>
        )}
      </div>

      {/* ═══ Stepper: Worksheet → Draft → Final → Laporan ═══ */}
      <PayrollStepper
        current={activeMainTab}
        counts={{
          worksheet: worksheetCount,
          draft: draftCount,
          final: finalCount,
          laporan: finalCount,
        }}
        onChange={(s) => {
          setActiveMainTab(s);
          setPage(1);
        }}
      />

      {/* ═══ Tab Body: Worksheet (inline editor) atau Ringkasan Tabel (Draft/Final/Laporan) ═══ */}
      {activeMainTab === "worksheet" ? (
        worksheetCount > 0 ? (
          <WorksheetEditor
            payrolls={payrolls}
            filtered={filtered}
            wsData={wsData}
            wsChangedCells={wsChangedCells}
            wsAbsenBreakdown={wsAbsenBreakdown}
            wsAbsenLoading={wsAbsenLoading}
            wsLemburBreakdown={wsLemburBreakdown}
            wsLemburLoading={wsLemburLoading}
            wsSaving={wsSaving}
            wsRefreshing={wsRefreshing}
            wsExpandedId={wsExpandedId}
            wsRowsChanged={wsRowsChanged}
            wsTotalChanged={wsTotalChanged}
            search={search}
            setSearch={setSearch}
            period={period}
            prevPeriod={prevPeriod}
            nextPeriod={nextPeriod}
            handleWsChange={handleWsChange}
            handleWsKeteranganChange={handleWsKeteranganChange}
            wsKeterangan={wsKeterangan}
            handleWsSaveRow={handleWsSaveRow}
            handleWsAutoSave={handleWsAutoSave}
            handleWsRefreshSources={handleWsRefreshSources}
            initWsData={initWsData}
            isCellChanged={isCellChanged}
            wsComputeTotals={wsComputeTotals}
            setWsExpandedId={setWsExpandedId}
            exportSlipPDF={exportSlipPDF}
            setDeleteConfirm={setDeleteConfirm}
            setBuatSlipConfirm={setBuatSlipConfirm}
            onOpenBatchFill={() => { setBatchField(""); setBatchValue(""); setShowBatchFill(true); }}
            canEdit={canEdit}
          />
        ) : (
          <EmptyState
            icon={CreditCard}
            title="Belum ada worksheet"
            description={"Klik \u201cHitung Worksheet\u201d untuk membuat draft slip gaji."}
          />
        )
      ) : activeMainTab === "laporan" ? (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border bg-card">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20 flex-shrink-0">
                <BarChart3 className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-foreground">Laporan Payroll Final</h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">Rekap read-only untuk slip yang sudah difinalkan</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" icon={FileSpreadsheet} size="sm" onClick={() => exportExcel(filtered, "Laporan_Final")} disabled={filtered.length === 0}>
                Excel Final
              </Button>
              <Button variant="outline" icon={Download} size="sm" onClick={() => {
                if (filtered.length === 0) {
                  showToast("error", "Tidak Ada Slip Final", "Belum ada slip Final untuk di-export.");
                  return;
                }
                filtered.forEach((p) => exportSlipPDF(p));
                showToast("success", "Export PDF", `${filtered.length} slip final sedang di-download.`);
              }} disabled={filtered.length === 0}>
                PDF Final
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-5 border-b border-border bg-muted/20">
            <_HeroMetric icon={ShieldCheck} label="Slip Final" value={String(filtered.length)} unit="slip" iconBg="bg-emerald-100" iconColor="text-emerald-700" />
            <_HeroMetric icon={TrendingDown} label="Pendapatan" value={formatCurrency(filtered.reduce((s, p) => s + p.total_pendapatan, 0))} iconBg="bg-success/15" iconColor="text-success" />
            <_HeroMetric icon={AlertTriangle} label="Potongan" value={formatCurrency(filtered.reduce((s, p) => s + p.total_potongan, 0))} iconBg="bg-danger/10" iconColor="text-danger" />
            <_HeroMetric icon={DollarSign} label="Netto" value={formatCurrency(filtered.reduce((s, p) => s + p.netto, 0))} iconBg="bg-primary/15" iconColor="text-primary" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Rekening</th>
                  <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pendapatan</th>
                  <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Potongan</th>
                  <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Netto Transfer</th>
                  <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                  <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {loading ? (
                  <SkeletonTable rows={6} cols={8} />
                ) : paged.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-16 text-sm text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <BarChart3 className="w-10 h-10 text-muted-foreground/20" />
                      <p>Belum ada laporan Final</p>
                      <p className="text-xs text-muted-foreground/60">Finalkan slip dari tab Draft untuk menampilkan laporan.</p>
                    </div>
                  </td></tr>
                ) : paged.map((row, idx) => {
                  const peg = row.pegawai as { bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null } | undefined;
                  return (
                    <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAYROLL_PAGE_SIZE + idx + 1}</td>
                      <td className="px-5 py-3.5 cursor-pointer" onClick={() => openDetail(row)}>
                        <p className="text-sm font-semibold text-foreground">{row.pegawaiNama}</p>
                        <p className="text-xs text-muted-foreground">{row.pegawaiJabatan}</p>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">
                        <p className="font-semibold text-foreground">{peg?.bank || "-"}</p>
                        <p>{peg?.no_rekening || "-"}</p>
                        <p className="text-[10px]">{peg?.nama_rekening || "-"}</p>
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm font-semibold text-success tabular-nums">{formatCurrency(row.total_pendapatan)}</td>
                      <td className="px-5 py-3.5 text-right text-sm font-semibold text-danger tabular-nums">{formatCurrency(row.total_potongan)}</td>
                      <td className="px-5 py-3.5 text-right text-sm font-bold text-foreground tabular-nums">{formatCurrency(row.netto)}</td>
                      <td className="px-5 py-3.5 text-center"><FinalPillBadge /></td>
                      <td className="px-5 py-3.5 text-center">
                        <button onClick={() => exportSlipPDF(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary" title="Download PDF">
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAYROLL_PAGE_SIZE} onPageChange={setPage} />
        </div>
      ) : (
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {activeMainTab === "draft" && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-3 border-b border-border bg-card">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-success to-success/70 flex items-center justify-center shadow-sm shadow-success/20 flex-shrink-0">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-foreground">Draft Penggajian</h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">Review slip, lalu finalkan untuk mengunci</p>
              </div>
            </div>
            {canEdit && <Button
              variant="primary"
              icon={ShieldCheck}
              size="sm"
              onClick={() => {
                setSelectedIds(new Set(filtered.map((r) => r.id)));
                setBulkFinalConfirm(true);
              }}
            >
              Finalkan ({filtered.length})
            </Button>}
          </div>
        )}
        {activeMainTab === "final" && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-3 border-b border-border bg-card">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-sm shadow-emerald-500/20 flex-shrink-0">
                <Lock className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-foreground">Slip Gaji Final</h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">{filtered.length} slip telah dikunci — siap untuk pembayaran</p>
              </div>
            </div>
            <FinalPillBadge />
          </div>
        )}
        {(canEdit || (activeMainTab === "final" && isSuperAdmin)) && <BatchActionBar
          count={scopedSelectedRows.length}
          onClear={() => setSelectedIds(new Set())}
          actions={(() => {
            const acts: { type: "buat" | "finalkan" | "batalkan" | "hapus" | "draftkan"; onClick: () => void }[] = [];
            if (activeMainTab === "draft") {
              acts.push({
                type: "batalkan",
                onClick: () => handleBatalkanDraft(scopedSelectedIds),
              });
              acts.push({
                type: "finalkan",
                onClick: () => setBulkFinalConfirm(true),
              });
            }
            if (activeMainTab === "final" && isSuperAdmin) {
              acts.push({
                type: "draftkan",
                onClick: () => setBulkDraftConfirm(true),
              });
            }
            if (canEdit) {
              acts.push({
                type: "hapus",
                onClick: () => setBulkDeleteConfirm(true),
              });
            }
            return acts;
          })()}
        />}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-5 py-3.5 w-12 text-center">
                  <input type="checkbox" className="rounded border-muted-foreground/30 text-primary cursor-pointer w-4 h-4 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!canEdit && !(activeMainTab === "final" && isSuperAdmin)}
                    checked={paged.length > 0 && paged.every(r => selectedIds.has(r.id))}
                    onChange={(e) => {
                      if (!canEdit && !(activeMainTab === "final" && isSuperAdmin)) return;
                      if (e.target.checked) {
                        setSelectedIds(new Set([...selectedIds, ...paged.map(r => r.id)]));
                      } else {
                        const next = new Set(selectedIds);
                        paged.forEach(r => next.delete(r.id));
                        setSelectedIds(next);
                      }
                    }}
                  />
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-3.5 w-12">#</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Total Pendapatan</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Total Potongan</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Netto</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <SkeletonTable rows={6} cols={8} />
              ) : paged.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-16 text-sm text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <CreditCard className="w-10 h-10 text-muted-foreground/20" />
                    {activeMainTab === "draft" ? (
                      <>
                        <p>Belum ada slip di tab Draft</p>
                        <p className="text-xs text-muted-foreground/60">Pilih slip di tab Worksheet, lalu klik &quot;Buat Slip&quot;</p>
                      </>
                    ) : activeMainTab === "final" ? (
                      <>
                        <p>Belum ada slip yang difinalkan</p>
                        <p className="text-xs text-muted-foreground/60">Finalkan slip dari tab Draft untuk melihat laporan di sini</p>
                      </>
                    ) : (
                      <>
                        <p>Belum ada slip gaji untuk periode ini</p>
                        <p className="text-xs text-muted-foreground/60">Pilih periode lain atau buat slip terlebih dahulu</p>
                      </>
                    )}
                  </div>
                </td></tr>
              ) : paged.map((row, idx) => (
                <tr key={row.id} className={cn("hover:bg-muted/30 transition-colors", selectedIds.has(row.id) && "bg-primary/5")}>
                  <td className="px-5 py-3.5 text-center">
                    <input type="checkbox" className="rounded border-muted-foreground/30 text-primary cursor-pointer w-4 h-4 disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={!canEdit && !(activeMainTab === "final" && isSuperAdmin)}
                      checked={selectedIds.has(row.id)}
                      onChange={(e) => {
                        if (!canEdit && !(activeMainTab === "final" && isSuperAdmin)) return;
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                  <td className="px-2 py-3.5 text-xs text-muted-foreground cursor-pointer" onClick={() => openDetail(row)}>{(page - 1) * PAYROLL_PAGE_SIZE + idx + 1}</td>
                  <td className="px-5 py-3.5 cursor-pointer" onClick={() => openDetail(row)}>
                    <p className="text-sm font-semibold text-foreground">{row.pegawaiNama}</p>
                    <p className="text-xs text-muted-foreground">{row.pegawaiJabatan}</p>
                  </td>
                  <td className="px-5 py-3.5 text-right text-sm font-semibold text-success cursor-pointer" onClick={() => openDetail(row)}>{formatCurrency(row.total_pendapatan)}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-semibold text-danger cursor-pointer" onClick={() => openDetail(row)}>{formatCurrency(row.total_potongan)}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-foreground cursor-pointer" onClick={() => openDetail(row)}>{formatCurrency(row.netto)}</td>
                  <td className="px-5 py-3.5 text-center cursor-pointer" onClick={() => openDetail(row)}>
                    {row.status === "Final" ? <FinalPillBadge /> : <Badge variant="muted">{row.status}</Badge>}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-center gap-1">
                      {row.status === "Worksheet" && canEdit && (
                        <button onClick={() => setBuatSlipConfirm({ ids: [row.id], mode: "single" })} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary" title="Buat Slip (Worksheet → Draft)">
                          <FileCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {row.status === "Draft" && canEdit && (
                        <button onClick={() => handleBatalkanDraft([row.id])} className="p-1.5 rounded-lg hover:bg-warning-light text-muted-foreground hover:text-warning" title="Batalkan (kembali ke Worksheet)">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => exportSlipPDF(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary" title="Download PDF">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && <button onClick={() => setDeleteConfirm({ id: row.id, nama: row.pegawaiNama || row.employee_id })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAYROLL_PAGE_SIZE} onPageChange={setPage} />
      </div>
      )}

      </>)}

      {/* ═══ Batch Fill Modal ═══ */}
      {showBatchFill && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBatchFill(false)} />
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm mx-4 animate-fade-in">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                    <Zap className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Batch Fill</h3>
                    <p className="text-[10px] text-muted-foreground">Isi nilai yang sama untuk {filtered.length} pegawai</p>
                  </div>
                </div>
                <button onClick={() => setShowBatchFill(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Target</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => setBatchFilter("semua")}
                      className={cn(
                        "px-3 py-2 rounded-xl text-xs font-semibold transition-colors border",
                        batchFilter === "semua" ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted"
                      )}>
                      Semua pegawai
                    </button>
                    <button type="button" onClick={() => setBatchFilter("kosong")}
                      className={cn(
                        "px-3 py-2 rounded-xl text-xs font-semibold transition-colors border",
                        batchFilter === "kosong" ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted"
                      )}>
                      Yang masih kosong
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Komponen</label>
                  <select
                    value={batchField}
                    onChange={(e) => setBatchField(e.target.value)}
                    className={cn(inputClass, "appearance-none")}
                  >
                    <option value="">Pilih komponen...</option>
                    <optgroup label="Pendapatan">
                      {PENDAPATAN_FIELDS.filter((f) => !f.readonly).map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Potongan">
                      {POTONGAN_FIELDS.filter((f) => !f.readonly).map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nilai</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rp</span>
                    <input
                      type="text"
                      value={batchValue}
                      onChange={(e) => {
                        if (e.target.value.trim() === "") {
                          setBatchValue("");
                          return;
                        }
                        const raw = parseCurrencyInput(e.target.value);
                        setBatchValue(raw === 0 ? "0" : formatInputCurrency(raw));
                      }}
                      placeholder="0"
                      className={cn(inputClass, "pl-9 text-right")}
                    />
                  </div>
                </div>
                {batchField && batchValue !== "" && (() => {
                  const targets = computeBatchFillTargets(filtered);
                  return (
                    <div className="bg-muted/50 rounded-xl px-3 py-2.5 text-xs text-muted-foreground">
                      <strong className="text-foreground">{BATCH_FILL_OPTIONS.find((f) => f.key === batchField)?.label}</strong> akan diisi <strong className="text-primary">{formatCurrency(parseCurrencyInput(batchValue))}</strong> untuk <strong className="text-foreground">{targets.length}</strong> dari {filtered.length} pegawai
                      {batchFilter === "kosong" && <span className="block mt-0.5 text-[10px] text-muted-foreground/70">Hanya yang nilai komponen ini masih 0.</span>}
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
                <Button variant="outline" size="sm" onClick={() => setShowBatchFill(false)}>Batal</Button>
                <Button icon={Zap} size="sm" onClick={handleBatchFill} disabled={!batchField || batchValue === ""}>Terapkan</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Detail Slide-over Panel ═══ */}
      {showDetail && selectedPayroll && (
        <Portal>
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDetail(false)} />
            <div className="relative w-full max-w-xl bg-card border-l border-border shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
              {/* Header */}
              <div className={cn(
                "flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0 bg-gradient-to-r",
                selectedPayroll.status === "Final"
                  ? "from-card via-card to-card"
                  : "from-card via-card to-primary/[0.03]"
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center",
                    selectedPayroll.status === "Final"
                      ? "bg-emerald-100 dark:bg-emerald-500/15"
                      : "bg-primary-light"
                  )}>
                    {selectedPayroll.status === "Final" ? (
                      <Lock className="w-4.5 h-4.5 text-emerald-700 dark:text-emerald-300" />
                    ) : (
                      <FileText className="w-4.5 h-4.5 text-primary" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{selectedPayroll.pegawaiNama}</h3>
                    <p className="text-xs text-muted-foreground">{selectedPayroll.pegawaiJabatan} &middot; {formatPeriodLabel(selectedPayroll.periode)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedPayroll.status === "Final" ? <FinalPillBadge /> : <StatusBadge status={selectedPayroll.status as LegacyPayrollStatus} />}
                  <button onClick={() => setShowDetail(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Lock banner untuk Final */}
              {selectedPayroll.status === "Final" && (
                <div className="relative mx-6 mt-5 px-3 py-2.5 pl-4 rounded-xl border border-emerald-200 bg-card flex items-center gap-2.5 flex-shrink-0 shadow-sm overflow-hidden">
                  <div className="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <Lock className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground leading-tight">Slip Terkunci</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">Difinalkan dan siap untuk pembayaran. Tidak dapat diedit.</p>
                  </div>
                </div>
              )}

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-6 py-5 space-y-6">

                  {/* ── PENDAPATAN ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-success/10 flex items-center justify-center">
                        <TrendingDown className="w-3.5 h-3.5 text-success rotate-180" />
                      </div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Pendapatan</h4>
                    </div>
                    <div className="space-y-2.5">
                      {PENDAPATAN_FIELDS.map((f) => {
                        const isLembur = f.key === "lembur";
                        return (
                          <div key={f.key} className={cn(isLembur || f.keteranganKey ? "space-y-2" : "flex items-center gap-3")}>
                            <div className="flex items-center gap-3">
                              <label className="text-xs text-muted-foreground w-36 flex-shrink-0">
                                {f.label}
                                {f.readonly && <span className="text-[9px] text-primary ml-1">(auto)</span>}
                              </label>
                              <div className="flex-1 relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">Rp</span>
                                <input
                                  type="text"
                                  value={formatInputCurrency(editForm[f.key] || 0)}
                                  onChange={(e) => {
                                    if (f.readonly || selectedPayroll.status === "Final" || !canEdit) return;
                                    const val = parseCurrencyInput(e.target.value);
                                    setEditForm((prev) => ({ ...prev, [f.key]: val }));
                                  }}
                                  readOnly={f.readonly || selectedPayroll.status === "Final" || !canEdit}
                                  className={cn(
                                    inputClass,
                                    "pl-9 text-right",
                                    (f.readonly || selectedPayroll.status === "Final" || !canEdit) && "bg-muted/60 text-muted-foreground cursor-not-allowed"
                                  )}
                                />
                              </div>
                            </div>
                            {f.keteranganKey && (
                              <div className="pl-[152px]">
                                <input
                                  type="text"
                                  value={editKeterangan[f.keteranganKey] || ""}
                                  onChange={(e) => {
                                    if (selectedPayroll.status === "Final" || !canEdit) return;
                                    setEditKeterangan((prev) => ({ ...prev, [f.keteranganKey!]: e.target.value }));
                                  }}
                                  placeholder="Keterangan..."
                                  readOnly={selectedPayroll.status === "Final" || !canEdit}
                                  className={cn(inputClass, "text-xs", (selectedPayroll.status === "Final" || !canEdit) && "bg-muted/60 text-muted-foreground cursor-not-allowed")}
                                />
                              </div>
                            )}
                            {isLembur && (
                              <div>
                                {lemburBreakdownLoading ? (
                                  <div className="text-[10px] text-muted-foreground text-right animate-pulse">Memuat detail...</div>
                                ) : lemburBreakdown && lemburBreakdown.length > 0 ? (
                                  <div className="rounded-xl border border-border bg-muted/10 overflow-hidden">
                                    <div className="px-3 py-2 bg-muted/30 border-b border-border flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                                      <span className="text-muted-foreground">Total lembur disetujui: <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(lemburBreakdown.reduce((s, x) => s + (x.total_lembur || 0), 0))}</strong></span>
                                      <span className="ml-auto text-[10px] font-semibold text-muted-foreground">{lemburBreakdown.length} pengajuan</span>
                                    </div>
                                    <div className="max-h-40 overflow-y-auto divide-y divide-border/60">
                                      {lemburBreakdown.map((it, idx) => {
                                        const dateLabel = new Date(it.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
                                        const jamMulai = it.jam_mulai?.slice(0, 5) || "";
                                        const jamSelesai = it.jam_selesai?.slice(0, 5) || "";
                                        const durasiJam = it.durasi_menit ? (it.durasi_menit / 60).toFixed(1).replace(/\.0$/, "") : "0";
                                        return (
                                          <div
                                            key={idx}
                                            className={cn(
                                              "grid grid-cols-[58px_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-1.5 text-[10px]",
                                              idx % 2 === 0 ? "bg-transparent" : "bg-muted/20"
                                            )}
                                          >
                                            <span className="tabular-nums text-muted-foreground font-medium">{dateLabel}</span>
                                            <span className="font-semibold text-foreground truncate">
                                              {jamMulai && jamSelesai ? `${jamMulai}–${jamSelesai} (${durasiJam}j)` : `${durasiJam}j`}
                                            </span>
                                            <span className="text-muted-foreground tabular-nums whitespace-nowrap">@ {formatCurrency(it.rate_per_jam || 0)}/j</span>
                                            <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">{formatCurrency(it.total_lembur || 0)}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : lemburBreakdown ? (
                                  <div className="text-[10px] text-muted-foreground text-right italic">Tidak ada lembur disetujui di periode ini</div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-3 pt-2 border-t border-border">
                        <span className="text-xs font-bold text-foreground w-36">Total Pendapatan</span>
                        <span className="flex-1 text-right text-sm font-bold text-success">{formatCurrency(computedTotalPendapatan)}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── POTONGAN ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-danger/10 flex items-center justify-center">
                        <TrendingDown className="w-3.5 h-3.5 text-danger" />
                      </div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Potongan</h4>
                    </div>
                    <div className="space-y-2.5">
                      {POTONGAN_FIELDS.map((f) => (
                        <div key={f.key} className={cn(f.keteranganKey ? "space-y-2" : "flex items-center gap-3")}>
                          <div className="flex items-center gap-3">
                            <label className="text-xs text-muted-foreground w-36 flex-shrink-0">
                              {f.label}
                              {f.readonly && <span className="text-[9px] text-primary ml-1">(auto)</span>}
                            </label>
                            <div className="flex-1 min-w-0">
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">Rp</span>
                                <input
                                  type="text"
                                  value={formatInputCurrency(editForm[f.key] || 0)}
                                  onChange={(e) => {
                                    if (f.readonly || selectedPayroll.status === "Final" || !canEdit) return;
                                    const val = parseCurrencyInput(e.target.value);
                                    setEditForm((prev) => ({ ...prev, [f.key]: val }));
                                  }}
                                  readOnly={f.readonly || selectedPayroll.status === "Final" || !canEdit}
                                  className={cn(
                                    inputClass,
                                    "pl-9 text-right",
                                    (f.readonly || selectedPayroll.status === "Final" || !canEdit) && "bg-muted/60 text-muted-foreground cursor-not-allowed"
                                  )}
                                />
                              </div>
                              {f.keteranganKey && (
                                <div className="mt-2">
                                  <input
                                    type="text"
                                    value={editKeterangan[f.keteranganKey] || ""}
                                    onChange={(e) => {
                                      if (selectedPayroll.status === "Final" || !canEdit) return;
                                      setEditKeterangan((prev) => ({ ...prev, [f.keteranganKey!]: e.target.value }));
                                    }}
                                    placeholder="Keterangan..."
                                    readOnly={selectedPayroll.status === "Final" || !canEdit}
                                    className={cn(inputClass, "text-xs", (selectedPayroll.status === "Final" || !canEdit) && "bg-muted/60 text-muted-foreground cursor-not-allowed")}
                                  />
                                </div>
                              )}
                              {f.key === "potongan_absen" && (
                              <div className="mt-3">
                                {absenBreakdownLoading ? (
                                  <div className="text-[10px] text-muted-foreground text-right animate-pulse">Memuat detail...</div>
                                ) : absenBreakdown && absenBreakdown.items.length > 0 ? (
                                  <div className="rounded-xl border border-border bg-muted/10 overflow-hidden">
                                    {/* Header ringkasan */}
                                    <div className="px-3 py-2 bg-muted/30 border-b border-border flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                                        <span>Telat: <strong className="text-foreground tabular-nums">{formatCurrency(absenBreakdown.telat)}</strong></span>
                                        {absenBreakdown.alpha > 0 && <span>Alpha: <strong className="text-foreground tabular-nums">{formatCurrency(absenBreakdown.alpha)}</strong></span>}
                                        {absenBreakdown.lainnya > 0 && <span>Lainnya: <strong className="text-foreground tabular-nums">{formatCurrency(absenBreakdown.lainnya)}</strong></span>}
                                      </div>
                                      <span className="ml-auto text-[10px] font-semibold text-muted-foreground">{absenBreakdown.items.length} kejadian</span>
                                    </div>
                                    {/* List kejadian — grid 3 kolom: Tgl · Status · Nominal */}
                                    <div className="max-h-40 overflow-y-auto divide-y divide-border/60">
                                      {absenBreakdown.items.map((it, idx) => {
                                        const isAlpha = it.status === "Alpha";
                                        const isTelat = it.status === "Telat" || it.status === "Terlambat";
                                        const dateLabel = new Date(it.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
                                        const statusLabel = isAlpha
                                          ? "Alpha"
                                          : isTelat
                                            ? (it.durasi_telat ? `Telat (${it.durasi_telat}m)` : "Telat")
                                            : it.status;
                                        return (
                                          <div
                                            key={idx}
                                            className={cn(
                                              "grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-[10px]",
                                              idx % 2 === 0 ? "bg-transparent" : "bg-muted/20"
                                            )}
                                          >
                                            <span className="tabular-nums text-muted-foreground font-medium">{dateLabel}</span>
                                            <span className={cn(
                                              "font-semibold truncate",
                                              isAlpha ? "text-rose-600 dark:text-rose-400" : isTelat ? "text-amber-600 dark:text-amber-400" : "text-foreground"
                                            )}>
                                              {statusLabel}
                                            </span>
                                            <span className="font-bold text-foreground tabular-nums whitespace-nowrap">{formatCurrency(it.denda)}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : absenBreakdown ? (
                                  <div className="text-[10px] text-muted-foreground text-right italic">Tidak ada denda di periode ini</div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      ))}
                      <div className="flex items-center gap-3 pt-2 border-t border-border">
                        <span className="text-xs font-bold text-foreground w-36">Total Potongan</span>
                        <span className="flex-1 text-right text-sm font-bold text-danger">{formatCurrency(computedTotalPotongan)}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── NETTO ── */}
                  <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-primary" />
                        </div>
                        <span className="text-sm font-bold text-foreground">Gaji Bersih (Netto)</span>
                      </div>
                      <span className={cn("text-xl font-bold", computedNetto >= 0 ? "text-primary" : "text-danger")}>
                        {formatCurrency(computedNetto)}
                      </span>
                    </div>
                  </div>

                  {/* ── Catatan ── */}
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan</label>
                    <textarea
                      value={editCatatan}
                      onChange={(e) => {
                        if (selectedPayroll.status === "Final" || !canEdit) return;
                        setEditCatatan(e.target.value);
                      }}
                      placeholder="Catatan tambahan (opsional)..."
                      rows={2}
                      readOnly={selectedPayroll.status === "Final" || !canEdit}
                      className={cn(inputClass, "resize-none", (selectedPayroll.status === "Final" || !canEdit) && "bg-muted/60 text-muted-foreground cursor-not-allowed")}
                    />
                  </div>

                  {/* ── Riwayat 6 bulan terakhir ── */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
                        <History className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Riwayat (6 Bulan Terakhir)</h4>
                    </div>
                    {loadingHistory ? (
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <Skeleton key={i} className="h-14 w-full rounded-xl" />
                        ))}
                      </div>
                    ) : history.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-4 text-center">Belum ada riwayat</p>
                    ) : (
                      <div className="space-y-2">
                        {history.map((h) => (
                          <div
                            key={h.id}
                            className={cn(
                              "flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-colors",
                              h.id === selectedPayroll.id
                                ? "border-primary/30 bg-primary/5"
                                : "border-border bg-muted/20 hover:bg-muted/40"
                            )}
                          >
                            <div>
                              <p className="text-xs font-semibold text-foreground">{formatPeriodLabel(h.periode)}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-muted-foreground">
                                  Pend: <span className="text-success font-medium">{formatCurrency(h.total_pendapatan)}</span>
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  Pot: <span className="text-danger font-medium">{formatCurrency(h.total_potongan)}</span>
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-foreground">{formatCurrency(h.netto)}</p>
                              {h.status === "Final" ? <FinalPillBadge /> : <Badge variant="muted" size="sm">{h.status}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-card flex-shrink-0">
                <div className="flex items-center gap-2">
                  {canEdit && <Button
                    variant="danger"
                    size="sm"
                    icon={Trash2}
                    onClick={() => setDeleteConfirm({ id: selectedPayroll.id, nama: selectedPayroll.pegawaiNama || selectedPayroll.employee_id })}
                  >
                    Hapus
                  </Button>}
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Download}
                    onClick={() => exportSlipPDF(selectedPayroll)}
                  >
                    PDF
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {/* Tombol Kembalikan ke Draft hanya untuk super admin (Final) */}
                  {selectedPayroll.status === "Final" ? (
                    isSuperAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleToggleStatus}
                        disabled={saving}
                        title="Hanya super admin yang bisa membatalkan finalisasi"
                      >
                        Kembalikan ke Draft
                      </Button>
                    )
                  ) : canEdit ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSingleFinalConfirm(selectedPayroll)}
                        disabled={saving}
                      >
                        Finalkan
                      </Button>
                      <Button
                        icon={saving ? Loader2 : Save}
                        size="sm"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? "Menyimpan..." : "Simpan"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      <ConfirmDialog
        open={computeWorksheetConfirm}
        title="Hitung Ulang Worksheet?"
        variant="warning"
        confirmLabel="Hitung Ulang"
        loading={wsComputing}
        onCancel={() => setComputeWorksheetConfirm(false)}
        onConfirm={() => {
          setComputeWorksheetConfirm(false);
          handleComputeWorksheet();
        }}
        description={
          <div className="space-y-1.5">
            <p>Worksheet periode ini akan dihitung ulang dari data absensi, titik, lembur, dan gaji pokok terbaru. Perhitungan otomatis dibatalkan jika periode ini sudah memiliki data payroll atau periode sebelumnya belum seluruhnya Final.</p>
            {wsChangedCells.size > 0 && (
              <p className="font-semibold text-warning">Ada {wsRowsChanged} baris perubahan yang belum disimpan. Simpan dulu jika ingin mempertahankan edit manual.</p>
            )}
          </div>
        }
      />

      <ConfirmDialog
        open={copyInputsConfirm}
        title="Salin Input Manual dari Periode Sebelumnya?"
        variant="default"
        confirmLabel="Ya, Salin"
        loading={copyInputsBusy}
        onCancel={() => setCopyInputsConfirm(false)}
        onConfirm={() => {
          setCopyInputsConfirm(false);
          handleCopyInputsFromPrev();
        }}
        description={
          <div className="space-y-1.5">
            <p>Input manual yang <strong>masih kosong</strong> di Worksheet periode <strong>{formatPeriodLabel(periodKey)}</strong> akan diisi dari slip Final periode {formatPeriodLabel(shiftPeriodKey(periodKey, -1))}.</p>
            <p>Nilai otomatis (titik, absensi, lembur, gaji pokok) dan input manual yang sudah terisi <strong>tidak akan ditimpa</strong>.</p>
            <p>Sumber harus berstatus <strong>Final</strong> agar dapat disalin.</p>
          </div>
        }
      />

      <ConfirmDialog
        open={!!singleFinalConfirm}
        title="Finalkan Slip Gaji?"
        variant="success"
        confirmLabel="Ya, Finalkan"
        loading={saving}
        onCancel={() => setSingleFinalConfirm(null)}
        onConfirm={handleToggleStatus}
        description={
          <span>
            Slip gaji <strong>{singleFinalConfirm?.pegawaiNama}</strong> akan dikunci sebagai <strong>Final</strong>. Setelah final, data tidak dapat diedit kecuali dikembalikan ke Draft oleh super admin.
          </span>
        }
      />

      {/* ═══ Bulk Final Confirmation Modal ═══ */}
      {bulkFinalConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !bulkUpdating && setBulkFinalConfirm(false)} />
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm mx-4 animate-fade-in">
              <div className="px-6 py-5 text-center">
                <div className="w-12 h-12 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
                  <CircleCheckBig className="w-6 h-6 text-success" />
                </div>
                <h3 className="text-sm font-bold text-foreground mb-1">Finalkan {scopedDraftSelectedCount} Slip Gaji?</h3>
                <p className="text-xs text-muted-foreground">
                  Semua slip gaji yang dipilih akan diubah statusnya menjadi <strong>Final</strong> dan tidak dapat diedit lagi oleh admin biasa.
                </p>
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setBulkFinalConfirm(false)} disabled={bulkUpdating}>
                  Batal
                </Button>
                <Button size="sm" className="flex-1 bg-success hover:bg-success/90 text-white border-success" icon={bulkUpdating ? Loader2 : CircleCheckBig} onClick={handleBulkFinal} disabled={bulkUpdating || scopedDraftSelectedCount === 0}>
                  {bulkUpdating ? "Memproses..." : "Ya, Finalkan"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Bulk Draft Confirmation Modal (Final → Draft) ═══ */}
      {bulkDraftConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !bulkUpdating && setBulkDraftConfirm(false)} />
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm mx-4 animate-fade-in">
              <div className="px-6 py-5 text-center">
                <div className="w-12 h-12 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
                  <RotateCcw className="w-6 h-6 text-warning" />
                </div>
                <h3 className="text-sm font-bold text-foreground mb-1">Kembalikan {scopedFinalSelectedCount} Slip ke Draft?</h3>
                <p className="text-xs text-muted-foreground">
                  Slip gaji akan dikembalikan ke status <strong>Draft</strong> sehingga bisa diedit ulang. Slip tidak akan muncul di aplikasi mobile sampai difinalkan kembali.
                </p>
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setBulkDraftConfirm(false)} disabled={bulkUpdating}>
                  Batal
                </Button>
                <Button size="sm" className="flex-1" icon={bulkUpdating ? Loader2 : RotateCcw} onClick={handleBulkDraft} disabled={bulkUpdating || scopedFinalSelectedCount === 0}>
                  {bulkUpdating ? "Memproses..." : "Ya, Kembalikan"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Bulk Delete Confirmation Modal ═══ */}
      {bulkDeleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setBulkDeleteConfirm(false)} />
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm mx-4 animate-fade-in">
              <div className="px-6 py-5 text-center">
                <div className="w-12 h-12 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-6 h-6 text-danger" />
                </div>
                <h3 className="text-sm font-bold text-foreground mb-1">Hapus {scopedSelectedRows.length} Slip Gaji?</h3>
                <p className="text-xs text-muted-foreground">
                  Semua slip gaji yang dipilih akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setBulkDeleteConfirm(false)} disabled={deleting}>
                  Batal
                </Button>
                <Button variant="danger" size="sm" className="flex-1" icon={deleting ? Loader2 : Trash2} onClick={handleBulkDelete} disabled={deleting || scopedSelectedRows.length === 0}>
                  {deleting ? "Menghapus..." : "Hapus Semua"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Delete Confirmation Modal ═══ */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteConfirm(null)} />
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm mx-4 animate-fade-in">
              <div className="px-6 py-5 text-center">
                <div className="w-12 h-12 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-6 h-6 text-danger" />
                </div>
                <h3 className="text-sm font-bold text-foreground mb-1">Hapus Slip Gaji?</h3>
                <p className="text-xs text-muted-foreground">
                  Slip gaji <strong>{deleteConfirm.nama}</strong> akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
                </p>
                {(() => {
                  const slip = payrolls.find((p) => p.id === deleteConfirm.id);
                  if (slip?.status === "Final") {
                    return (
                      <div className="mt-3 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-left flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                          Slip ini berstatus <strong>Final</strong> (sudah dikunci). Penghapusan bersifat permanen dan tidak dapat dibatalkan.
                        </p>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                  Batal
                </Button>
                <Button variant="danger" size="sm" className="flex-1" icon={deleting ? Loader2 : Trash2} onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Menghapus..." : "Hapus"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ Buat Slip Confirmation (Worksheet → Draft) ═══ */}
      {buatSlipConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setBuatSlipConfirm(null)} />
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm mx-4 animate-fade-in">
              <div className="px-6 py-5 text-center">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <FileCheck className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-sm font-bold text-foreground mb-1">Buat Slip dari Worksheet?</h3>
                <p className="text-xs text-muted-foreground">
                  <strong>{buatSlipConfirm.ids.length} slip</strong> akan dipindahkan ke tab <strong>Draft</strong>. Data akan ter-freeze dan siap untuk diedit sebelum difinalkan. Anda masih bisa membatalkan dari tab Draft.
                </p>
                {hasUnsavedBuatSlipSelection && (
                  <div className="mt-3 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-left">
                    <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Ada perubahan worksheet yang belum disimpan pada slip terpilih. Simpan worksheet dulu sebelum membuat slip.</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setBuatSlipConfirm(null)}>
                  Batal
                </Button>
                <Button variant="primary" size="sm" className="flex-1" icon={FileCheck} onClick={() => handleBuatSlip(buatSlipConfirm.ids)} disabled={hasUnsavedBuatSlipSelection}>
                  {hasUnsavedBuatSlipSelection ? "Simpan Dulu" : "Buat Slip"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}


    </div>
    </RouteGuard>
    </>
  );
}

// ═════════════════════════════════════════════════════════
// HERO METRIC CARD
// ═════════════════════════════════════════════════════════
function _HeroMetric({
  icon: Icon, label, value, unit, iconBg, iconColor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit?: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border px-3 py-2.5 flex items-center gap-2.5">
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", iconBg)}>
        <Icon className={cn("w-3.5 h-3.5", iconColor)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight truncate">{label}</p>
        <div className="flex items-baseline gap-1">
          <p className="text-sm font-bold text-foreground tabular-nums truncate">{value}</p>
          {unit && <p className="text-[10px] text-muted-foreground truncate">{unit}</p>}
        </div>
      </div>
    </div>
  );
}

function FinalPillBadge({ className }: { className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm",
      className
    )}>
      <ShieldCheck className="w-3 h-3 text-white" />
      Final
    </span>
  );
}
