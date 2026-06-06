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
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase, type DbPayroll, type DbPegawai } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

// ─── Types ───
type EmployeeLite = { id: string; nama: string; status: string; jabatan?: { nama: string } | null; bank?: string | null; no_rekening?: string | null; nama_rekening?: string | null; gaji_pokok?: number };
type PayrollRow = DbPayroll & { pegawaiNama?: string; pegawaiJabatan?: string };

const PAGE_SIZE = 15;
const CUT_OFF_DAY = 7;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

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

function formatPeriodLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

// ─── Currency input helper ───
function parseCurrencyInput(val: string): number {
  return parseInt(val.replace(/\D/g, "")) || 0;
}

function formatInputCurrency(val: number): string {
  if (val === 0) return "";
  return new Intl.NumberFormat("id-ID").format(val);
}

// ─── Pendapatan & Potongan field definitions ───
const PENDAPATAN_FIELDS: { key: string; label: string; readonly?: boolean }[] = [
  { key: "gaji_pokok", label: "Gaji Pokok" },
  { key: "pendapatan_titik", label: "Pendapatan Titik", readonly: true },
  { key: "lembur", label: "Lembur", readonly: true },
  { key: "extra_job", label: "Extra Job" },
  { key: "uang_makan", label: "Uang Makan" },
  { key: "insentif", label: "Insentif" },
  { key: "tunjangan_jabatan", label: "Tunjangan Jabatan" },
  { key: "transport", label: "Transport" },
  { key: "tunjangan_lain", label: "Tunjangan Lain" },
  { key: "tambahan_lain", label: "Tambahan Lain" },
];

const POTONGAN_FIELDS: { key: string; label: string; readonly?: boolean }[] = [
  { key: "koperasi", label: "Koperasi" },
  { key: "pinjaman_perusahaan", label: "Pinjaman Perusahaan" },
  { key: "potongan_absen", label: "Potongan Absen", readonly: true },
  { key: "potongan_lain", label: "Potongan Lain" },
  { key: "jht", label: "JHT" },
  { key: "bpjs_kesehatan", label: "BPJS Kesehatan" },
];

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
  const [periodKey, setPeriodKey] = useState(getCurrentPeriodKey);
  const period = getPeriodRange(periodKey);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollRow[]>([]);

  // ─── Generate modal ───
  const [showGenerate, setShowGenerate] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState(getCurrentPeriodKey);
  const [generating, setGenerating] = useState(false);

  // ─── Detail slide-over ───
  const [showDetail, setShowDetail] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<PayrollRow | null>(null);
  const [editForm, setEditForm] = useState<Record<string, number>>({});
  const [editCatatan, setEditCatatan] = useState("");
  const [saving, setSaving] = useState(false);

  // ─── History ───
  const [history, setHistory] = useState<DbPayroll[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // ─── Gapok tab state ───
  const [gapokSearch, setGapokSearch] = useState("");
  const [gapokPage, setGapokPage] = useState(1);
  const [gapokEditId, setGapokEditId] = useState<string | null>(null);
  const [gapokEditValue, setGapokEditValue] = useState("");
  const [gapokSaving, setGapokSaving] = useState(false);

  // ─── Workflow state: Worksheet → Draft → Final ───
  const [activeMainTab, setActiveMainTab] = useState<"worksheet" | "draft" | "final" | "laporan">("worksheet");
  const [showWorksheet, setShowWorksheet] = useState(false);
  const [wsData, setWsData] = useState<Record<number, Record<string, number>>>({});
  /** Map<payrollId, Set<fieldKey>> — track cell-level changes untuk highlight */
  const [wsChangedCells, setWsChangedCells] = useState<Map<number, Set<string>>>(new Map());
  const [wsSaving, setWsSaving] = useState(false);
  const [wsExpandedId, setWsExpandedId] = useState<number | null>(null);
  /** Loading state untuk computeWorksheet (auto-recompute) */
  const [wsComputing, setWsComputing] = useState(false);
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
  const [bulkUpdating, setBulkUpdating] = useState(false);

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

  // ─── Lock body scroll ───
  useEffect(() => {
    if (showGenerate || showDetail || showWorksheet) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showGenerate, showDetail, showWorksheet]);

  // ─── Fetch employees ───
  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from("pegawai")
      .select("id, nama, status, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening, gaji_pokok")
      .eq("status", "Aktif")
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

  // ─── Fetch payrolls ───
  const fetchPayrolls = useCallback(async () => {
    const { data, error } = await supabase
      .from("payrolls")
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening)")
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
    Promise.all([fetchEmployees(), fetchPayrolls()]).then(() => setLoading(false));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPayrolls().then(() => setLoading(false));
  }, [periodKey, fetchPayrolls, reloadKey]);

  // ─── Generate slip gaji ───
  const handleGenerate = async () => {
    setGenerating(true);
    const genPeriod = getPeriodRange(generatePeriod);

    try {
      // 1. Fetch pegawai relevan untuk periode ini:
      //    - Aktif (semua)
      //    - Tidak Aktif: tetap di-generate kalau masih ada data absen/delivery/lembur di
      //      periode (penghasilan yang belum dibayarkan), atau tanggal_keluar di dalam periode.
      const { data: allEmps, error: empErr } = await supabase
        .from("pegawai")
        .select("id, nama, gaji_pokok, tanggal_bergabung, tanggal_keluar, status")
        .order("nama");
      if (empErr || !allEmps) {
        showToast("error", "Gagal Memuat Pegawai", (empErr as { message?: string } | null)?.message || "Unknown error");
        setGenerating(false);
        return;
      }
      // Filter di-JS: skip pegawai Tidak Aktif yang sudah keluar sebelum periode
      // dan tidak punya data aktual di periode (tidak ada yg perlu dibayar)
      const activeEmps = (allEmps as { id: string; nama: string; status: string; gaji_pokok?: number; tanggal_bergabung: string | null; tanggal_keluar: string | null }[]).filter((e) => {
        if (e.status === "Aktif") return true;
        // Tidak Aktif: tetap include untuk dicek data aktualnya di langkah 4-5
        return true;
      });


      // 2. Check existing payrolls for this period
      const { data: existing } = await supabase
        .from("payrolls")
        .select("employee_id")
        .eq("periode", generatePeriod);
      const existingSet = new Set((existing || []).map((e: { employee_id: string }) => e.employee_id));

      // 3. Filter employees that don't have a slip yet
      const newEmps = (activeEmps as { id: string; nama: string; gaji_pokok?: number; tanggal_bergabung: string | null; tanggal_keluar: string | null }[]).filter((e) => !existingSet.has(e.id));
      if (newEmps.length === 0) {
        showToast("error", "Tidak Ada Slip Baru", "Semua pegawai aktif sudah memiliki slip gaji untuk periode ini.");
        setGenerating(false);
        return;
      }

      // 4. Fetch delivery points totals for each employee in period
      const { data: dpData } = await supabase
        .from("delivery_points")
        .select("employee_id, total")
        .gte("tanggal", genPeriod.start)
        .lte("tanggal", genPeriod.end)
        .in("employee_id", newEmps.map((e) => e.id));

      const dpTotals = new Map<string, number>();
      (dpData || []).forEach((d: { employee_id: string; total: number }) => {
        dpTotals.set(d.employee_id, (dpTotals.get(d.employee_id) || 0) + d.total);
      });

      // 5. Fetch attendance denda totals for each employee in period
      const { data: attData } = await supabase
        .from("attendance_records")
        .select("employee_id, denda, tanggal, status")
        .gte("tanggal", genPeriod.start)
        .lte("tanggal", genPeriod.end)
        .in("employee_id", newEmps.map((e) => e.id));

      const dendaTotals = new Map<string, number>();
      (attData || []).forEach((d: { employee_id: string; denda: number }) => {
        dendaTotals.set(d.employee_id, (dendaTotals.get(d.employee_id) || 0) + d.denda);
      });

      // 5b. Fetch lembur Disetujui per employee dalam periode
      const { data: lemburData } = await supabase
        .from("overtime_requests")
        .select("employee_id, total_lembur")
        .eq("status", "Disetujui")
        .gte("tanggal", genPeriod.start)
        .lte("tanggal", genPeriod.end)
        .in("employee_id", newEmps.map((e) => e.id));

      const lemburTotals = new Map<string, number>();
      (lemburData || []).forEach((d: { employee_id: string; total_lembur: number | null }) => {
        lemburTotals.set(d.employee_id, (lemburTotals.get(d.employee_id) || 0) + (d.total_lembur || 0));
      });

      // 5c. Filter pegawai Tidak Aktif yang TIDAK punya data aktual di periode
      // (tidak ada absen, titik, lembur). Pegawai ini tidak perlu slip karena
      // tidak ada penghasilan yang harus dibayarkan.
      // Untuk pegawai Aktif: tetap di-generate (gaji pokok prorata sesuai tgl gabung/keluar)
      const exitDateLookup = new Map<string, string | null>();
      const statusLookup = new Map<string, string>();
      (activeEmps as { id: string; status: string; tanggal_keluar: string | null }[]).forEach((e) => {
        exitDateLookup.set(e.id, e.tanggal_keluar);
        statusLookup.set(e.id, e.status);
      });
      const empsWithData = newEmps.filter((e) => {
        if (statusLookup.get(e.id) === "Aktif") return true;
        // Tidak Aktif: skip kalau tidak punya catatan absen di periode
        // (tidak ada kehadiran = tidak ada gapok; titik/lembur tanpa absen = anomali)
        const exitDate = exitDateLookup.get(e.id);
        // Tidak Aktif + tanggal_keluar valid → tetap include, prorata via isProratedExit
        if (exitDate) return true;
        // Tidak Aktif + NULL tanggal_keluar → hanya include kalau ada catatan absen
        const hariAdaCatatan = new Set(
          (attData || []).filter((a) => a.employee_id === e.id).map((a) => a.tanggal)
        ).size;
        return hariAdaCatatan > 0;
      });
      const skippedNoAbsen = newEmps.length - empsWithData.length;
      if (empsWithData.length === 0) {
        showToast("error", "Tidak Ada Slip Baru", "Tidak ada pegawai dengan catatan kehadiran di periode ini.");
        setGenerating(false);
        return;
      }

      // 6. Build gaji_pokok, tanggal_bergabung & tanggal_keluar lookup
      const gapokMap = new Map<string, number>();
      const joinDateMap = new Map<string, string | null>();
      const exitDateMap = new Map<string, string | null>();
      (activeEmps as { id: string; gaji_pokok?: number; tanggal_bergabung: string | null; tanggal_keluar: string | null }[]).forEach((e) => {
        gapokMap.set(e.id, e.gaji_pokok || 0);
        joinDateMap.set(e.id, e.tanggal_bergabung);
        exitDateMap.set(e.id, e.tanggal_keluar);
      });

      // 6b. Fetch off_days untuk pegawai-pegawai yang akan di-generate (untuk hitung prorata)
      const { data: offDaysData } = await supabase
        .from("employee_off_days")
        .select("employee_id, day_of_week")
        .in("employee_id", empsWithData.map((e) => e.id));

      const offDayMap = new Map<string, Set<number>>();
      (offDaysData || []).forEach((od: { employee_id: string; day_of_week: number }) => {
        if (!offDayMap.has(od.employee_id)) offDayMap.set(od.employee_id, new Set());
        offDayMap.get(od.employee_id)!.add(od.day_of_week);
      });

      // Helper: hitung hari kerja (non off-day) di range tanggal inklusif
      const countWorkingDays = (startStr: string, endStr: string, empOff: Set<number>): number => {
        if (startStr > endStr) return 0;
        const [sy, sm, sd] = startStr.split("-").map(Number);
        const [ey, em, ed] = endStr.split("-").map(Number);
        const startMs = Date.UTC(sy, sm - 1, sd);
        const endMs = Date.UTC(ey, em - 1, ed);
        let count = 0;
        for (let ms = startMs; ms <= endMs; ms += 86400000) {
          const dow = new Date(ms).getUTCDay();
          if (!empOff.has(dow)) count++;
        }
        return count;
      };

      // Helper: hitung hari kalender inklusif di range tanggal (untuk prorata Tidak Aktif)
      const countCalendarDays = (startStr: string, endStr: string): number => {
        if (startStr > endStr) return 0;
        const [sy, sm, sd] = startStr.split("-").map(Number);
        const [ey, em, ed] = endStr.split("-").map(Number);
        const startMs = Date.UTC(sy, sm - 1, sd);
        const endMs = Date.UTC(ey, em - 1, ed);
        return Math.floor((endMs - startMs) / 86400000) + 1;
      };

      // 7. Build insert rows (exclude generated columns)
      const inserts = empsWithData.map((e) => {
        const empOff = offDayMap.get(e.id) || new Set<number>();
        const tglBergabung = joinDateMap.get(e.id);
        const tglKeluar = exitDateMap.get(e.id);
        const totalHariKerja = countWorkingDays(genPeriod.start, genPeriod.end, empOff);
        const gapokFull = gapokMap.get(e.id) || 0;

        // Range efektif untuk prorata:
        //   start = max(periode.start, tanggal_bergabung || periode.start)
        //   end   = min(periode.end, tanggal_keluar || periode.end)
        const effectiveStart = tglBergabung && tglBergabung > genPeriod.start ? tglBergabung : genPeriod.start;
        const effectiveEnd = tglKeluar && tglKeluar < genPeriod.end ? tglKeluar : genPeriod.end;

        let gapokProrata = gapokFull;
        let catatanProrata: string | null = null;
        const isProratedJoin = tglBergabung && tglBergabung > genPeriod.start && tglBergabung <= genPeriod.end;
        const isProratedExit = tglKeluar && tglKeluar >= genPeriod.start && tglKeluar < genPeriod.end;
        const isOutsidePeriod = (tglBergabung && tglBergabung > genPeriod.end) || (tglKeluar && tglKeluar < genPeriod.start);
        const isInactiveNoExitDate = statusLookup.get(e.id) === "Tidak Aktif" && !tglKeluar;

        // Pegawai Tidak Aktif tanpa tanggal_keluar: masih di-generate karena ada
        // penghasilan yang harus dibayar. Gapok di-prorata per **hari kalender**:
        //   numerator   = unique hari dengan catatan absen (semua status, termasuk
        //                 Alpha/Cuti/Libur/Sakit — dihitung sebagai hari masuk)
        //   denominator = total hari kalender dalam periode (mis. 8 Mei–7 Juni = 31)
        // Pegawai Tidak Aktif + NULL exit date + 0 catatan absen sudah di-skip
        // di filter empsWithData, jadi di sini selalu ada >= 1 catatan.
        if (isInactiveNoExitDate) {
          const totalHariKalender = countCalendarDays(genPeriod.start, genPeriod.end);
          const hariDenganCatatan = new Set(
            (attData || []).filter((a) => a.employee_id === e.id).map((a) => a.tanggal)
          ).size;
          const factor = Math.min(hariDenganCatatan / totalHariKalender, 1);
          gapokProrata = Math.round(gapokFull * factor);
          const pct = Math.round(factor * 100);
          catatanProrata = `Tidak aktif — prorata per hari kalender: ${hariDenganCatatan}/${totalHariKalender} hari (${pct}%)`;
        }

        if (isOutsidePeriod) {
          gapokProrata = 0;
          if (tglBergabung && tglBergabung > genPeriod.end) {
            catatanProrata = `Belum bergabung di periode ini (bergabung ${tglBergabung})`;
          } else if (tglKeluar && tglKeluar < genPeriod.start) {
            catatanProrata = `Sudah tidak aktif sebelum periode ini (keluar ${tglKeluar})`;
          }
        } else if (isProratedJoin || isProratedExit) {
          const hariKerjaEfektif = countWorkingDays(effectiveStart, effectiveEnd, empOff);
          const factor = totalHariKerja > 0 ? hariKerjaEfektif / totalHariKerja : 0;
          gapokProrata = Math.round(gapokFull * factor);
          const parts: string[] = [];
          if (isProratedJoin) {
            const tglLabel = new Date(tglBergabung + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" });
            parts.push(`bergabung ${tglLabel}`);
          }
          if (isProratedExit) {
            const tglLabel = new Date(tglKeluar + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" });
            parts.push(`keluar ${tglLabel}`);
          }
          catatanProrata = `Prorata: ${parts.join(", ")} (${hariKerjaEfektif}/${totalHariKerja} hari kerja)`;
        }

        return {
          employee_id: e.id,
          periode: generatePeriod,
          periode_mulai: genPeriod.start,
          periode_selesai: genPeriod.end,
          gaji_pokok: gapokProrata,
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
          catatan: catatanProrata,
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
  type AbsenBreakdownItem = { tanggal: string; status: string; denda: number; durasi_telat: number | null };
  type LemburBreakdownItem = { tanggal: string; jam_mulai: string; jam_selesai: string; durasi_menit: number; rate_per_jam: number; total_lembur: number; alasan: string | null };
  const [absenBreakdown, setAbsenBreakdown] = useState<{ telat: number; alpha: number; lainnya: number; items: AbsenBreakdownItem[] } | null>(null);
  const [lemburBreakdown, setLemburBreakdown] = useState<LemburBreakdownItem[] | null>(null);
  const [lemburBreakdownLoading, setLemburBreakdownLoading] = useState(false);
  const [absenBreakdownLoading, setAbsenBreakdownLoading] = useState(false);

  const openDetail = async (row: PayrollRow) => {
    setSelectedPayroll(row);
    // Initialize edit form with current values
    const form: Record<string, number> = {};
    PENDAPATAN_FIELDS.forEach((f) => { form[f.key] = (row as unknown as Record<string, number>)[f.key] || 0; });
    POTONGAN_FIELDS.forEach((f) => { form[f.key] = (row as unknown as Record<string, number>)[f.key] || 0; });
    setEditForm(form);
    setEditCatatan(row.catatan || "");
    setShowDetail(true);
    setAbsenBreakdown(null);
    setLemburBreakdown(null);
    fetchHistory(row.employee_id);
    
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
    setLemburBreakdown((lemburData || []) as LemburBreakdownItem[]);
    setLemburBreakdownLoading(false);
  };

  // ─── Fetch history ───
  const fetchHistory = async (employeeId: string) => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from("payrolls")
      .select("*")
      .eq("employee_id", employeeId)
      .order("periode", { ascending: false })
      .limit(6);
    setHistory(data || []);
    setLoadingHistory(false);
  };

  // ─── Computed totals for edit form ───
  const computedTotalPendapatan = PENDAPATAN_FIELDS.reduce((sum, f) => sum + (editForm[f.key] || 0), 0);
  const computedTotalPotongan = POTONGAN_FIELDS.reduce((sum, f) => sum + (editForm[f.key] || 0), 0);
  const computedNetto = computedTotalPendapatan - computedTotalPotongan;

  // ─── Save edit ───
  const handleSave = async () => {
    if (!selectedPayroll) return;
    setSaving(true);

    // Only send individual component fields, NOT generated columns
    const updatePayload: Record<string, unknown> = { catatan: editCatatan || null };
    PENDAPATAN_FIELDS.forEach((f) => {
      if (!f.readonly) updatePayload[f.key] = editForm[f.key] || 0;
    });
    POTONGAN_FIELDS.forEach((f) => {
      if (!f.readonly) updatePayload[f.key] = editForm[f.key] || 0;
    });

    const { data, error } = await supabase
      .from("payrolls")
      .update(updatePayload)
      .eq("id", selectedPayroll.id)
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening)")
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
    setSaving(true);
    const newStatus = selectedPayroll.status === "Draft" ? "Final" : "Draft";
    const oldStatus = selectedPayroll.status;

    const { data, error } = await supabase
      .from("payrolls")
      .update({ status: newStatus })
      .eq("id", selectedPayroll.id)
      .select("*, pegawai(nama, jabatan:jabatan_id(nama), bank, no_rekening, nama_rekening)")
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
  };

  // ─── Delete slip ───
  const handleDelete = async () => {
    if (!deleteConfirm) return;
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
    if (selectedIds.size === 0) return;
    setDeleting(true);
    
    const idsToDelete = Array.from(selectedIds);
    // Optimistically get records for audit
    const oldRecords = payrolls.filter((p) => idsToDelete.includes(p.id));
    
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
    if (selectedIds.size === 0) return;
    setBulkUpdating(true);
    
    const idsToUpdate = Array.from(selectedIds);
    // Hanya proses slip yang statusnya masih "Draft"
    const draftsToUpdate = payrolls.filter((p) => idsToUpdate.includes(p.id) && p.status === "Draft");
    
    if (draftsToUpdate.length === 0) {
      showToast("error", "Info", "Semua slip yang dipilih sudah Final.");
      setBulkUpdating(false);
      setBulkFinalConfirm(false);
      return;
    }

    const draftIds = draftsToUpdate.map(p => p.id);
    
    const { error } = await supabase
      .from("payrolls")
      .update({ status: "Final" })
      .in("id", draftIds);
      
    if (error) {
      showToast("error", "Gagal Memfinalkan", error.message);
      setBulkUpdating(false);
      setBulkFinalConfirm(false);
      return;
    }
    
    await logAudit({
      supabase,
      action: "update",
      entityType: "payrolls",
      entityId: `bulk-final-${draftIds.length}`,
      entityLabel: `Bulk update ${draftIds.length} slip gaji ke Final`,
      metadata: { ids: draftIds, records: draftsToUpdate.map(r => ({ id: r.id, nama: r.pegawaiNama })) }
    });
    
    setPayrolls((prev) => prev.map((p) => draftIds.includes(p.id) ? { ...p, status: "Final" } : p));
    showToast("success", "Slip Difinalkan", `${draftIds.length} slip gaji berhasil diubah menjadi Final.`);
    
    // Update selected payroll if it's currently open
    if (selectedPayroll && draftIds.includes(selectedPayroll.id)) {
      setSelectedPayroll((prev) => prev ? { ...prev, status: "Final" } : null);
    }
    
    setBulkUpdating(false);
    setBulkFinalConfirm(false);
    setSelectedIds(new Set()); // Reset selection setelah aksi berhasil
  };

  // ─── Export Excel (xlsx) untuk semua slip dalam periode ───
  const exportExcel = async () => {
    if (payrolls.length === 0) {
      showToast("error", "Tidak Ada Data", "Tidak ada slip untuk di-export.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const periodLabel = formatPeriodLabel(periodKey);
      const filename = `Slip_Gaji_${periodLabel.replace(/\s/g, "_")}.xlsx`;

      // Build rows
      const headers = [
        "No", "ID Pegawai", "Nama", "Periode",
        ...PENDAPATAN_FIELDS.map((f) => f.label),
        "Total Pendapatan",
        ...POTONGAN_FIELDS.map((f) => f.label),
        "Total Potongan",
        "Netto", "Status", "Catatan",
      ];

      const rows = payrolls.map((p, idx) => [
        idx + 1,
        p.employee_id,
        p.pegawaiNama || "-",
        periodLabel,
        ...PENDAPATAN_FIELDS.map((f) => (p as unknown as Record<string, number>)[f.key] || 0),
        p.total_pendapatan,
        ...POTONGAN_FIELDS.map((f) => (p as unknown as Record<string, number>)[f.key] || 0),
        p.total_potongan,
        p.netto,
        p.status,
        p.catatan || "",
      ]);

      // Total row
      const totalRow = [
        "", "", "TOTAL", "",
        ...PENDAPATAN_FIELDS.map((f) =>
          payrolls.reduce((s, p) => s + ((p as unknown as Record<string, number>)[f.key] || 0), 0)
        ),
        payrolls.reduce((s, p) => s + p.total_pendapatan, 0),
        ...POTONGAN_FIELDS.map((f) =>
          payrolls.reduce((s, p) => s + ((p as unknown as Record<string, number>)[f.key] || 0), 0)
        ),
        payrolls.reduce((s, p) => s + p.total_potongan, 0),
        payrolls.reduce((s, p) => s + p.netto, 0),
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

      // Format Rupiah: column 4 sampai sebelum status (kolom angka)
      // Excel format: "#,##0"
      const rupCols: number[] = [];
      for (let i = 4; i < headers.length - 2; i++) rupCols.push(i);
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

      showToast("success", "Export Excel", `${payrolls.length} slip diekspor ke ${filename}.`);

      await logAudit({
        supabase,
        action: "export",
        entityType: "payrolls",
        entityLabel: `Export Excel ${periodLabel}`,
        metadata: { periode: periodKey, jumlah_slip: payrolls.length, filename },
      });
    } catch (err) {
      console.error("[Payroll] Export Excel failed:", err);
      showToast("error", "Gagal Export", err instanceof Error ? err.message : "Tidak dapat membuat file Excel.");
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

    const pendapatanData = PENDAPATAN_FIELDS.map((f) => [
      f.label,
      formatCurrency((payroll as unknown as Record<string, number>)[f.key] || 0),
    ]);
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

    const potonganData = POTONGAN_FIELDS.map((f) => [
      f.label,
      formatCurrency((payroll as unknown as Record<string, number>)[f.key] || 0),
    ]);
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
    rows.forEach((r) => {
      const vals: Record<string, number> = {};
      PENDAPATAN_FIELDS.forEach((f) => { vals[f.key] = (r as unknown as Record<string, number>)[f.key] || 0; });
      POTONGAN_FIELDS.forEach((f) => { vals[f.key] = (r as unknown as Record<string, number>)[f.key] || 0; });
      data[r.id] = vals;
    });
    setWsData(data);
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

  const wsComputeTotals = (id: number) => {
    const vals = wsData[id];
    if (!vals) return { totalPendapatan: 0, totalPotongan: 0, netto: 0 };
    const totalPendapatan = PENDAPATAN_FIELDS.reduce((s, f) => s + (vals[f.key] || 0), 0);
    const totalPotongan = POTONGAN_FIELDS.reduce((s, f) => s + (vals[f.key] || 0), 0);
    return { totalPendapatan, totalPotongan, netto: totalPendapatan - totalPotongan };
  };

  const handleWsSaveAll = async () => {
    if (wsChangedCells.size === 0) return;
    setWsSaving(true);
    let errorCount = 0;
    const changedIds = Array.from(wsChangedCells.keys());
    for (const id of changedIds) {
      const vals = wsData[id];
      if (!vals) continue;
      // Only send editable fields, not generated columns
      const payload: Record<string, number> = {};
      PENDAPATAN_FIELDS.forEach((f) => { payload[f.key] = vals[f.key] || 0; });
      POTONGAN_FIELDS.forEach((f) => { payload[f.key] = vals[f.key] || 0; });
      const { error } = await supabase.from("payrolls").update(payload).eq("id", id);
      if (error) errorCount++;
    }
    setWsSaving(false);
    if (errorCount > 0) {
      showToast("error", "Sebagian Gagal", `${errorCount} dari ${changedIds.length} slip gagal disimpan.`);
    } else {
      showToast("success", "Worksheet Disimpan", `${changedIds.length} slip gaji berhasil diperbarui.`);
      await logAudit({
        supabase,
        action: "update",
        entityType: "payrolls",
        entityLabel: `Worksheet ${formatPeriodLabel(periodKey)}`,
        metadata: {
          periode: periodKey,
          jumlah_slip: changedIds.length,
          jumlah_cell: wsTotalChanged,
        },
      });
    }
    setWsChangedCells(new Map());
    await fetchPayrolls();
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
    if (!batchField) return;
    const value = parseCurrencyInput(batchValue);
    const targets = computeBatchFillTargets(filtered);
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
  const gapokFiltered = employees.filter((e) =>
    e.nama.toLowerCase().includes(gapokSearch.toLowerCase()) ||
    e.id.toLowerCase().includes(gapokSearch.toLowerCase()) ||
    (e.jabatan?.nama || "").toLowerCase().includes(gapokSearch.toLowerCase())
  );
  const gapokPaged = gapokFiltered.slice((gapokPage - 1) * PAGE_SIZE, gapokPage * PAGE_SIZE);
  const gapokTotalGapok = employees.reduce((s, e) => s + (e.gaji_pokok || 0), 0);
  const gapokBelumDiisi = employees.filter((e) => !e.gaji_pokok).length;

  // ─── Filter & paginate (by tab + search) ───
  const tabFiltered = (() => {
    if (activeMainTab === "laporan") return payrolls.filter((p) => p.status === "Final");
    if (activeMainTab === "worksheet") return payrolls.filter((p) => p.status === "Worksheet");
    if (activeMainTab === "final") return payrolls.filter((p) => p.status === "Final");
    return payrolls.filter((p) => p.status === "Draft");
  })();
  const filtered = tabFiltered.filter((p) =>
    (p.pegawaiNama || "").toLowerCase().includes(search.toLowerCase()) ||
    p.employee_id.toLowerCase().includes(search.toLowerCase())
  );
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ─── Summary ───
  const totalNetto = payrolls.reduce((s, p) => s + p.netto, 0);
  const totalPendapatanAll = payrolls.reduce((s, p) => s + p.total_pendapatan, 0);
  const totalPegawai = payrolls.length;
  const draftCount = payrolls.filter((p) => p.status === "Draft").length;
  const finalCount = payrolls.filter((p) => p.status === "Final").length;
  const worksheetCount = payrolls.filter((p) => p.status === "Worksheet").length;

  // ─── Period navigation ───
  const prevPeriod = () => {
    const [y, m] = periodKey.split("-").map(Number);
    const prev = new Date(y, m - 2, 1);
    setPeriodKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
    setPage(1);
  };
  const nextPeriod = () => {
    const [y, m] = periodKey.split("-").map(Number);
    const next = new Date(y, m, 1);
    setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setPage(1);
  };

  // ─── Compute Worksheet (auto-recompute) ───
  const handleComputeWorksheet = async (specificPeriod?: string) => {
    const targetPeriod = specificPeriod || periodKey;
    setWsComputing(true);
    const genPeriod = getPeriodRange(targetPeriod);
    try {
      // Hapus worksheet rows existing untuk periode ini
      await supabase
        .from("payrolls")
        .delete()
        .eq("periode", targetPeriod)
        .eq("status", "Worksheet");

      // 1. Fetch semua pegawai
      const { data: allEmps, error: empErr } = await supabase
        .from("pegawai")
        .select("id, nama, gaji_pokok, tanggal_bergabung, tanggal_keluar, status")
        .order("nama");
      if (empErr || !allEmps) {
        showToast("error", "Gagal Memuat Pegawai", (empErr as { message?: string } | null)?.message || "Unknown error");
        setWsComputing(false);
        return;
      }

      // 2. Fetch delivery points, attendance, lembur dalam periode
      const { data: dpData } = await supabase
        .from("delivery_points")
        .select("employee_id, total")
        .gte("tanggal", genPeriod.start)
        .lte("tanggal", genPeriod.end)
        .in("employee_id", allEmps.map((e) => e.id));
      const dpTotals = new Map<string, number>();
      (dpData || []).forEach((d: { employee_id: string; total: number }) => {
        dpTotals.set(d.employee_id, (dpTotals.get(d.employee_id) || 0) + d.total);
      });

      const { data: attData } = await supabase
        .from("attendance_records")
        .select("employee_id, denda, tanggal, status")
        .gte("tanggal", genPeriod.start)
        .lte("tanggal", genPeriod.end)
        .in("employee_id", allEmps.map((e) => e.id));
      const dendaTotals = new Map<string, number>();
      (attData || []).forEach((d: { employee_id: string; denda: number }) => {
        dendaTotals.set(d.employee_id, (dendaTotals.get(d.employee_id) || 0) + d.denda);
      });

      const { data: lemburData } = await supabase
        .from("overtime_requests")
        .select("employee_id, total_lembur")
        .eq("status", "Disetujui")
        .gte("tanggal", genPeriod.start)
        .lte("tanggal", genPeriod.end)
        .in("employee_id", allEmps.map((e) => e.id));
      const lemburTotals = new Map<string, number>();
      (lemburData || []).forEach((d: { employee_id: string; total_lembur: number | null }) => {
        lemburTotals.set(d.employee_id, (lemburTotals.get(d.employee_id) || 0) + (d.total_lembur || 0));
      });

      // 3. Fetch off_days
      const { data: offDaysData } = await supabase
        .from("employee_off_days")
        .select("employee_id, day_of_week")
        .in("employee_id", allEmps.map((e) => e.id));
      const offDayMap = new Map<string, Set<number>>();
      (offDaysData || []).forEach((od: { employee_id: string; day_of_week: number }) => {
        if (!offDayMap.has(od.employee_id)) offDayMap.set(od.employee_id, new Set());
        offDayMap.get(od.employee_id)!.add(od.day_of_week);
      });

      const countCalendarDays = (startStr: string, endStr: string): number => {
        if (startStr > endStr) return 0;
        const [sy, sm, sd] = startStr.split("-").map(Number);
        const [ey, em, ed] = endStr.split("-").map(Number);
        const startMs = Date.UTC(sy, sm - 1, sd);
        const endMs = Date.UTC(ey, em - 1, ed);
        return Math.floor((endMs - startMs) / 86400000) + 1;
      };

      // 4. Bangun insert rows untuk pegawai yang eligible
      type Emp = { id: string; nama: string; status: string; gaji_pokok?: number; tanggal_bergabung: string | null; tanggal_keluar: string | null };
      const statusLookup = new Map<string, string>();
      (allEmps as Emp[]).forEach((e) => statusLookup.set(e.id, e.status));

      const inserts = (allEmps as Emp[]).flatMap((e) => {
        const empOff = offDayMap.get(e.id) || new Set<number>();
        const tglBergabung = e.tanggal_bergabung;
        const tglKeluar = e.tanggal_keluar;
        const totalHariKalender = countCalendarDays(genPeriod.start, genPeriod.end);
        const gapokFull = e.gaji_pokok || 0;

        const isProratedJoin = tglBergabung && tglBergabung > genPeriod.start && tglBergabung <= genPeriod.end;
        const isProratedExit = tglKeluar && tglKeluar >= genPeriod.start && tglKeluar < genPeriod.end;
        const isOutsidePeriod = (tglBergabung && tglBergabung > genPeriod.end) || (tglKeluar && tglKeluar < genPeriod.start);
        const isInactiveNoExitDate = statusLookup.get(e.id) === "Tidak Aktif" && !tglKeluar;

        let gapokProrata = gapokFull;
        let catatanProrata: string | null = null;

        if (isInactiveNoExitDate) {
          const hariDenganCatatan = new Set(
            (attData || []).filter((a) => a.employee_id === e.id).map((a) => a.tanggal)
          ).size;
          if (hariDenganCatatan === 0) return []; // Skip: Tidak Aktif tanpa catatan absen
          const factor = Math.min(hariDenganCatatan / totalHariKalender, 1);
          gapokProrata = Math.round(gapokFull * factor);
          const pct = Math.round(factor * 100);
          catatanProrata = `Tidak aktif — prorata per hari kalender: ${hariDenganCatatan}/${totalHariKalender} hari (${pct}%)`;
        } else if (isOutsidePeriod) {
          gapokProrata = 0;
          if (tglBergabung && tglBergabung > genPeriod.end) {
            catatanProrata = `Belum bergabung di periode ini (bergabung ${tglBergabung})`;
          } else if (tglKeluar && tglKeluar < genPeriod.start) {
            catatanProrata = `Sudah tidak aktif sebelum periode ini (keluar ${tglKeluar})`;
          }
        } else if (isProratedJoin || isProratedExit) {
          // Simplified: tidak ada perhitungan hari kerja di sini karena V1 single admin
          if (isProratedJoin) {
            catatanProrata = `Prorata: bergabung ${tglBergabung}`;
          }
          if (isProratedExit) {
            catatanProrata = (catatanProrata || "") + `Prorata: keluar ${tglKeluar}`;
          }
        }

        const sourceTitik = dpTotals.get(e.id) || 0;
        const sourceLembur = lemburTotals.get(e.id) || 0;
        const sourceGapok = gapokProrata;
        const totalPendapatan = gapokProrata + sourceTitik + sourceLembur;
        const totalPotongan = dendaTotals.get(e.id) || 0;
        const netto = totalPendapatan - totalPotongan;

        return [{
          employee_id: e.id,
          periode: targetPeriod,
          periode_mulai: genPeriod.start,
          periode_selesai: genPeriod.end,
          gaji_pokok: gapokProrata,
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
          total_pendapatan: totalPendapatan,
          total_potongan: totalPotongan,
          netto: netto,
          status: "Worksheet",
          catatan: catatanProrata,
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
    }
    setWsComputing(false);
  };

  // ─── Buat Slip dari Worksheet (Worksheet → Draft) ───
  const handleBuatSlip = async (ids: number[]) => {
    if (ids.length === 0) return;
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
    <RouteGuard permission="payroll">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Penggajian"
        description="Kelola slip gaji pegawai perusahaan"
        icon={CreditCard}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={FileSpreadsheet} size="sm" onClick={exportExcel} disabled={payrolls.length === 0}>
              Export Excel
            </Button>
            <Button variant="outline" icon={Download} size="sm" onClick={() => {
              const finalSlips = payrolls.filter((p) => p.status === "Final");
              if (finalSlips.length === 0) {
                showToast("error", "Tidak Ada Slip Final", "Belum ada slip gaji berstatus Final untuk di-export.");
                return;
              }
              finalSlips.forEach((p) => exportSlipPDF(p));
              showToast("success", "Export PDF", `${finalSlips.length} slip gaji sedang di-download.`);
            }}>
              Export PDF
            </Button>
            <Button variant="outline" icon={FileText} size="sm" onClick={() => handleComputeWorksheet()} disabled={wsComputing || loading}>
              {wsComputing ? "Menghitung..." : "Hitung Worksheet"}
            </Button>
            <Button variant="outline" icon={Pencil} size="sm" onClick={() => setShowWorksheet(true)} disabled={worksheetCount === 0}>
              Edit Cells
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

      {/* ═══ Tab Switcher ═══ */}
      <div className="bg-card rounded-2xl border border-border p-1.5 inline-flex items-center gap-1">
        <button
          onClick={() => setActiveTab("slip")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all",
            activeTab === "slip"
              ? "bg-primary text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <CreditCard className="w-3.5 h-3.5" />
          Slip Gaji
        </button>
        <button
          onClick={() => setActiveTab("gapok")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all",
            activeTab === "gapok"
              ? "bg-primary text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <Banknote className="w-3.5 h-3.5" />
          Data Gaji Pokok
          {gapokBelumDiisi > 0 && !loading && (
            <span className="ml-0.5 text-[9px] font-bold bg-danger text-white px-1.5 py-0.5 rounded-full">{gapokBelumDiisi}</span>
          )}
        </button>
      </div>

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
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{(gapokPage - 1) * PAGE_SIZE + idx + 1}</td>
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
            <Pagination currentPage={gapokPage} totalItems={gapokFiltered.length} pageSize={PAGE_SIZE} onPageChange={setGapokPage} />
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
              gradient="from-primary/15 via-primary/5 to-transparent"
              iconBg="bg-primary/15"
              iconColor="text-primary"
              breakdown={`Pendapatan ${formatCurrency(totalPendapatanAll)}`}
            />
            <_HeroMetric
              icon={Users}
              label="Jumlah Pegawai"
              value={String(totalPegawai)}
              unit="slip"
              gradient="from-success/15 via-success/5 to-transparent"
              iconBg="bg-success/15"
              iconColor="text-success"
            />
            <_HeroMetric
              icon={Clock}
              label="Draft"
              value={String(draftCount)}
              unit="belum final"
              gradient="from-warning/15 via-warning/5 to-transparent"
              iconBg="bg-warning/15"
              iconColor="text-warning"
            />
            <_HeroMetric
              icon={CheckCircle2}
              label="Final"
              value={String(finalCount)}
              unit="terkunci"
              gradient="from-success/15 via-success/5 to-transparent"
              iconBg="bg-success/15"
              iconColor="text-success"
            />
          </>
        )}
      </div>

      {/* ═══ Filter & Period Navigator ═══ */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 flex-1">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari nama pegawai atau ID..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
            <button onClick={prevPeriod} className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 py-1.5 text-center min-w-[240px]">
              <p className="text-xs font-bold text-foreground">{period.label}</p>
            </div>
            <button onClick={nextPeriod} className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Sub-tab: Worksheet / Draft / Final / Laporan ═══ */}
      <div className="bg-card rounded-2xl border border-border p-1.5 inline-flex items-center gap-1 overflow-x-auto">
        <button
          onClick={() => { setActiveMainTab("worksheet"); setPage(1); }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap",
            activeMainTab === "worksheet"
              ? "bg-primary text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          Worksheet
          <span className={cn(
            "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
            activeMainTab === "worksheet" ? "bg-white/20 text-white" : "bg-muted-foreground/10 text-muted-foreground"
          )}>{worksheetCount}</span>
        </button>
        <button
          onClick={() => { setActiveMainTab("draft"); setPage(1); }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap",
            activeMainTab === "draft"
              ? "bg-primary text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <Clock className="w-3.5 h-3.5" />
          Draft
          <span className={cn(
            "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
            activeMainTab === "draft" ? "bg-white/20 text-white" : "bg-warning/15 text-warning"
          )}>{draftCount}</span>
        </button>
        <button
          onClick={() => { setActiveMainTab("final"); setPage(1); }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap",
            activeMainTab === "final"
              ? "bg-primary text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Final
          <span className={cn(
            "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
            activeMainTab === "final" ? "bg-white/20 text-white" : "bg-success/15 text-success"
          )}>{finalCount}</span>
        </button>
        <button
          onClick={() => { setActiveMainTab("laporan"); setPage(1); }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap",
            activeMainTab === "laporan"
              ? "bg-primary text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Laporan
        </button>
      </div>

      {/* ═══ Ringkasan Tabel + Tombol Worksheet ═══ */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {selectedIds.size > 0 && (
          <div className="bg-primary/10 border-b border-primary/20 px-5 py-3 flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">{selectedIds.size}</div>
              <p className="text-sm font-semibold text-primary">Slip gaji dipilih</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>Batal</Button>
              {activeMainTab === "worksheet" && (
                <Button size="sm" icon={FileCheck} onClick={() => setBuatSlipConfirm({ ids: Array.from(selectedIds), mode: "bulk" })}
                  className="bg-primary text-white hover:bg-primary/90 border-primary">Buat {selectedIds.size} Slip</Button>
              )}
              {activeMainTab === "draft" && (
                <Button variant="outline" size="sm" icon={RotateCcw} onClick={() => handleBatalkanDraft(Array.from(selectedIds))}
                  className="text-warning border-warning/30 hover:bg-warning/10 hover:text-warning">Batalkan {selectedIds.size} Slip</Button>
              )}
              {activeMainTab === "draft" && (
                <Button variant="outline" size="sm" icon={CircleCheckBig} onClick={() => setBulkFinalConfirm(true)} className="text-success border-success/30 hover:bg-success/10 hover:text-success">Finalkan {selectedIds.size} Slip</Button>
              )}
              <Button size="sm" icon={Trash2} onClick={() => setBulkDeleteConfirm(true)} className="bg-danger text-white hover:bg-danger/90 border-danger">Hapus {selectedIds.size} Slip</Button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-5 py-3.5 w-12 text-center">
                  <input type="checkbox" className="rounded border-muted-foreground/30 text-primary cursor-pointer w-4 h-4"
                    checked={paged.length > 0 && paged.every(r => selectedIds.has(r.id))}
                    onChange={(e) => {
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
                    {activeMainTab === "worksheet" ? (
                      <>
                        <p>Belum ada worksheet untuk periode ini</p>
                        <p className="text-xs text-muted-foreground/60">Klik &quot;Hitung Worksheet&quot; untuk membuat draft slip gaji</p>
                      </>
                    ) : activeMainTab === "draft" ? (
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
                    <input type="checkbox" className="rounded border-muted-foreground/30 text-primary cursor-pointer w-4 h-4"
                      checked={selectedIds.has(row.id)}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                  <td className="px-2 py-3.5 text-xs text-muted-foreground cursor-pointer" onClick={() => openDetail(row)}>{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-5 py-3.5 cursor-pointer" onClick={() => openDetail(row)}>
                    <p className="text-sm font-semibold text-foreground">{row.pegawaiNama}</p>
                    <p className="text-xs text-muted-foreground">{row.pegawaiJabatan}</p>
                  </td>
                  <td className="px-5 py-3.5 text-right text-sm font-semibold text-success cursor-pointer" onClick={() => openDetail(row)}>{formatCurrency(row.total_pendapatan)}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-semibold text-danger cursor-pointer" onClick={() => openDetail(row)}>{formatCurrency(row.total_potongan)}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-foreground cursor-pointer" onClick={() => openDetail(row)}>{formatCurrency(row.netto)}</td>
                  <td className="px-5 py-3.5 text-center cursor-pointer" onClick={() => openDetail(row)}>
                    <Badge variant={row.status === "Final" ? "success" : "muted"}>{row.status}</Badge>
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
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      </>)}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ WORKSHEET FULLSCREEN ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {showWorksheet && (
        <Portal>
          <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-card flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20">
                  <CreditCard className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Worksheet Penggajian</h2>
                  <div className="flex items-center gap-2.5 mt-0.5 text-[10px] text-muted-foreground">
                    <span><strong className="text-foreground">{filtered.length}</strong> pegawai</span>
                    <span className="w-px h-3 bg-border" />
                    <span>Netto: <strong className="text-primary">{formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).netto, 0))}</strong></span>
                    {wsRowsChanged > 0 && (
                      <>
                        <span className="w-px h-3 bg-border" />
                        <span className="flex items-center gap-1 text-warning">
                          <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                          <strong>{wsRowsChanged}</strong> baris &middot; <strong>{wsTotalChanged}</strong> cell diubah
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-muted rounded-xl p-0.5">
                  <button onClick={prevPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <span className="text-[11px] font-bold text-foreground px-2.5 min-w-[200px] text-center">{period.label}</span>
                  <button onClick={nextPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-1.5 bg-muted rounded-xl px-2.5 py-1.5 w-44">
                  <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <input type="text" placeholder="Cari pegawai..." value={search} onChange={(e) => setSearch(e.target.value)}
                    className="bg-transparent text-[11px] outline-none w-full placeholder:text-muted-foreground/50 text-foreground" />
                </div>
                <button onClick={() => { setBatchField(""); setBatchValue(""); setShowBatchFill(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors">
                  <Zap className="w-3 h-3" />Batch Fill
                </button>
                {wsRowsChanged > 0 && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => initWsData(payrolls)} disabled={wsSaving}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                      Reset
                    </button>
                    <Button icon={wsSaving ? Loader2 : Save} size="sm" onClick={handleWsSaveAll} disabled={wsSaving}>
                      {wsSaving ? "Menyimpan..." : `Simpan (${wsRowsChanged})`}
                    </Button>
                  </div>
                )}
                <button onClick={() => setShowWorksheet(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Tutup">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Table ── */}
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse min-w-[900px]">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b-2 border-border bg-muted/80">
                    <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-10">#</th>
                    <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">Pegawai</th>
                    <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3 w-[130px]">Gaji Pokok</th>
                    <th className="text-right text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-4 py-3 w-[130px]">Pend. Titik <span className="block text-[7px] font-normal normal-case opacity-60">otomatis</span></th>
                    <th className="text-right text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider px-4 py-3 w-[140px] bg-emerald-50/50 dark:bg-emerald-500/[0.04]">Total Pendapatan</th>
                    <th className="text-right text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider px-4 py-3 w-[140px] bg-rose-50/50 dark:bg-rose-500/[0.04]">Total Potongan</th>
                    <th className="text-right text-[10px] font-bold text-primary uppercase tracking-wider px-4 py-3 w-[150px] bg-primary/[0.04]">Netto</th>
                    <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-3 w-[80px]">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-24 text-sm text-muted-foreground">
                      <CreditCard className="w-10 h-10 text-muted-foreground/15 mx-auto mb-2" />
                      Belum ada slip gaji untuk periode ini
                    </td></tr>
                  ) : filtered.map((row, idx) => {
                    const vals = wsData[row.id] || {};
                    const computed = wsComputeTotals(row.id);
                    const isChanged = wsChangedCells.has(row.id);
                    const isEven = idx % 2 === 0;
                    return (
                      <React.Fragment key={row.id}>
                        {/* Main row */}
                        <tr
                          className={cn(
                            "border-b transition-colors cursor-pointer",
                            isChanged ? "bg-amber-50/60 dark:bg-amber-500/[0.04] border-amber-200/50 dark:border-amber-500/10" : isEven ? "bg-card border-border/40" : "bg-muted/20 border-border/40",
                            wsExpandedId === row.id ? "border-b-0" : "hover:bg-primary/[0.03]"
                          )}
                          onClick={() => setWsExpandedId(wsExpandedId === row.id ? null : row.id)}
                        >
                          <td className="px-4 py-3 text-[10px] text-muted-foreground">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-foreground truncate">{row.pegawaiNama}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{row.pegawaiJabatan}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-medium text-foreground tabular-nums">{formatCurrency(vals.gaji_pokok || 0)}</td>
                          <td className="px-4 py-3 text-right text-xs font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(vals.pendapatan_titik || 0)}</td>
                          <td className="px-4 py-3 text-right text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums bg-emerald-50/30 dark:bg-emerald-500/[0.02]">{formatCurrency(computed.totalPendapatan)}</td>
                          <td className="px-4 py-3 text-right text-xs font-bold text-rose-700 dark:text-rose-400 tabular-nums bg-rose-50/30 dark:bg-rose-500/[0.02]">{formatCurrency(computed.totalPotongan)}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-foreground tabular-nums bg-primary/[0.02]">{formatCurrency(computed.netto)}</td>
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-0.5">
                              <button onClick={() => exportSlipPDF(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary transition-colors" title="PDF">
                                <Download className="w-3 h-3" />
                              </button>
                              <button onClick={() => setDeleteConfirm({ id: row.id, nama: row.pegawaiNama || row.employee_id })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger transition-colors" title="Hapus">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded detail row */}
                        {wsExpandedId === row.id && (
                          <tr className={cn("border-b border-border", isChanged ? "bg-amber-50/30 dark:bg-amber-500/[0.02]" : "bg-muted/10")}>
                            <td />
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-2 gap-6 max-w-4xl">
                                {/* Pendapatan */}
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <div className="w-5 h-5 rounded-md bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                                      <TrendingDown className="w-3 h-3 text-emerald-600 dark:text-emerald-400 rotate-180" />
                                    </div>
                                    <h4 className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Pendapatan</h4>
                                  </div>
                                  <div className="space-y-1.5">
                                    {PENDAPATAN_FIELDS.map((f) => {
                                      const isLembur = f.key === "lembur";
                                      const wsLembur = isLembur ? wsLemburBreakdown[row.id] : null;
                                      const wsLemburLoad = isLembur ? !!wsLemburLoading[row.id] : false;
                                      return (
                                        <div key={f.key} className={cn(isLembur ? "space-y-1.5" : "flex items-center gap-2")}>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[11px] text-muted-foreground w-32 flex-shrink-0 truncate">{f.label}</span>
                                            {f.readonly ? (
                                              <span className="flex-1 text-right text-[11px] font-medium text-emerald-600/70 dark:text-emerald-400/70 tabular-nums">{formatCurrency(vals[f.key] || 0)}</span>
                                            ) : (
                                              <div className="flex-1 relative">
                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">Rp</span>
                                                <input
                                                  type="text"
                                                  value={vals[f.key] ? formatInputCurrency(vals[f.key]) : ""}
                                                  onChange={(e) => handleWsChange(row.id, f.key, e.target.value)}
                                                  placeholder="0"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className={cn(
                                                    "w-full text-right text-[11px] tabular-nums pl-7 pr-2 py-1.5 rounded-lg border outline-none text-foreground placeholder:text-muted-foreground/30 transition-all",
                                                    isCellChanged(row.id, f.key)
                                                      ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20"
                                                      : "border-border/60 bg-card hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
                                                  )}
                                                />
                                              </div>
                                            )}
                                          </div>
                                          {isLembur && (
                                            <div>
                                              {wsLemburLoad ? (
                                                <div className="text-[10px] text-muted-foreground text-right animate-pulse">Memuat detail...</div>
                                              ) : wsLembur && wsLembur.items.length > 0 ? (
                                                <div className="rounded-lg border border-emerald-200/60 dark:border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/[0.03] overflow-hidden">
                                                  <div className="px-2.5 py-1.5 bg-emerald-100/40 dark:bg-emerald-500/10 border-b border-emerald-200/60 dark:border-emerald-500/20 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px]">
                                                    <span className="text-muted-foreground">Total: <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(wsLembur.total)}</strong></span>
                                                    <span className="ml-auto text-[10px] font-semibold text-muted-foreground">{wsLembur.items.length} pengajuan</span>
                                                  </div>
                                                  <div className="max-h-28 overflow-y-auto divide-y divide-emerald-200/40 dark:divide-emerald-500/10">
                                                    {wsLembur.items.map((it, idx) => {
                                                      const dateLabel = new Date(it.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
                                                      const jamMulai = it.jam_mulai?.slice(0, 5) || "";
                                                      const jamSelesai = it.jam_selesai?.slice(0, 5) || "";
                                                      const durasiJam = it.durasi_menit ? (it.durasi_menit / 60).toFixed(1).replace(/\.0$/, "") : "0";
                                                      return (
                                                        <div
                                                          key={idx}
                                                          className={cn(
                                                            "grid grid-cols-[50px_minmax(0,1fr)_auto_auto] items-center gap-2 px-2.5 py-1 text-[10px]",
                                                            idx % 2 === 0 ? "bg-transparent" : "bg-emerald-50/40 dark:bg-emerald-500/[0.04]"
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
                                              ) : wsLembur ? (
                                                <div className="text-[10px] text-muted-foreground text-right italic">Tidak ada lembur disetujui di periode ini</div>
                                              ) : null}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                    <div className="flex items-center gap-2 pt-2 mt-1 border-t border-emerald-200/50 dark:border-emerald-500/10">
                                      <span className="text-[11px] font-bold text-foreground w-32">Total</span>
                                      <span className="flex-1 text-right text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(computed.totalPendapatan)}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Potongan */}
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <div className="w-5 h-5 rounded-md bg-rose-100 dark:bg-rose-500/10 flex items-center justify-center">
                                      <TrendingDown className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                                    </div>
                                    <h4 className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">Potongan</h4>
                                  </div>
                                  <div className="space-y-1.5">
                                    {POTONGAN_FIELDS.map((f) => {
                                      const isPotAbsen = f.key === "potongan_absen";
                                      const wsBreakdown = isPotAbsen ? wsAbsenBreakdown[row.id] : null;
                                      const wsBreakdownLoading = isPotAbsen ? !!wsAbsenLoading[row.id] : false;
                                      return (
                                        <div key={f.key} className={cn(isPotAbsen ? "space-y-1.5" : "flex items-center gap-2")}>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[11px] text-muted-foreground w-32 flex-shrink-0 truncate">{f.label}</span>
                                            {f.readonly ? (
                                              <span className="flex-1 text-right text-[11px] font-medium text-rose-600/70 dark:text-rose-400/70 tabular-nums">{formatCurrency(vals[f.key] || 0)}</span>
                                            ) : (
                                              <div className="flex-1 relative">
                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">Rp</span>
                                                <input
                                                  type="text"
                                                  value={vals[f.key] ? formatInputCurrency(vals[f.key]) : ""}
                                                  onChange={(e) => handleWsChange(row.id, f.key, e.target.value)}
                                                  placeholder="0"
                                                  onClick={(e) => e.stopPropagation()}
                                                  className={cn(
                                                    "w-full text-right text-[11px] tabular-nums pl-7 pr-2 py-1.5 rounded-lg border outline-none text-foreground placeholder:text-muted-foreground/30 transition-all",
                                                    isCellChanged(row.id, f.key)
                                                      ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 ring-1 ring-amber-200 dark:ring-amber-500/20"
                                                      : "border-border/60 bg-card hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
                                                  )}
                                                />
                                              </div>
                                            )}
                                          </div>
                                          {isPotAbsen && (
                                            <div>
                                              {wsBreakdownLoading ? (
                                                <div className="text-[10px] text-muted-foreground text-right animate-pulse">Memuat detail...</div>
                                              ) : wsBreakdown && wsBreakdown.items.length > 0 ? (
                                                <div className="rounded-lg border border-rose-200/60 dark:border-rose-500/20 bg-rose-50/30 dark:bg-rose-500/[0.03] overflow-hidden">
                                                  <div className="px-2.5 py-1.5 bg-rose-100/40 dark:bg-rose-500/10 border-b border-rose-200/60 dark:border-rose-500/20 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px]">
                                                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-muted-foreground">
                                                      <span>Telat: <strong className="text-foreground tabular-nums">{formatCurrency(wsBreakdown.telat)}</strong></span>
                                                      {wsBreakdown.alpha > 0 && <span>Alpha: <strong className="text-foreground tabular-nums">{formatCurrency(wsBreakdown.alpha)}</strong></span>}
                                                      {wsBreakdown.lainnya > 0 && <span>Lainnya: <strong className="text-foreground tabular-nums">{formatCurrency(wsBreakdown.lainnya)}</strong></span>}
                                                    </div>
                                                    <span className="ml-auto text-[10px] font-semibold text-muted-foreground">{wsBreakdown.items.length} kejadian</span>
                                                  </div>
                                                  <div className="max-h-28 overflow-y-auto divide-y divide-rose-200/40 dark:divide-rose-500/10">
                                                    {wsBreakdown.items.map((it, idx) => {
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
                                                            "grid grid-cols-[50px_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1 text-[10px]",
                                                            idx % 2 === 0 ? "bg-transparent" : "bg-rose-50/40 dark:bg-rose-500/[0.04]"
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
                                              ) : wsBreakdown ? (
                                                <div className="text-[10px] text-muted-foreground text-right italic">Tidak ada denda di periode ini</div>
                                              ) : null}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                    <div className="flex items-center gap-2 pt-2 mt-1 border-t border-rose-200/50 dark:border-rose-500/10">
                                      <span className="text-[11px] font-bold text-foreground w-32">Total</span>
                                      <span className="flex-1 text-right text-xs font-bold text-rose-700 dark:text-rose-400 tabular-nums">{formatCurrency(computed.totalPotongan)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Netto bar */}
                              <div className="mt-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/10 max-w-4xl">
                                <span className="text-xs font-bold text-foreground">Gaji Bersih (Netto)</span>
                                <span className={cn("text-lg font-bold tabular-nums", computed.netto >= 0 ? "text-primary" : "text-danger")}>{formatCurrency(computed.netto)}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                {/* Footer */}
                {filtered.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10">
                    <tr className="border-t-2 border-border bg-card shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3">
                        <p className="text-[10px] font-bold text-foreground uppercase tracking-wider">Grand Total</p>
                        <p className="text-[9px] text-muted-foreground">{filtered.length} pegawai</p>
                      </td>
                      <td className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground tabular-nums">
                        {formatCurrency(filtered.reduce((s, r) => s + ((wsData[r.id] || {}).gaji_pokok || 0), 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-[11px] font-bold text-muted-foreground tabular-nums">
                        {formatCurrency(filtered.reduce((s, r) => s + ((wsData[r.id] || {}).pendapatan_titik || 0), 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums bg-emerald-50/50 dark:bg-emerald-500/[0.04]">
                        {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).totalPendapatan, 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-extrabold text-rose-700 dark:text-rose-400 tabular-nums bg-rose-50/50 dark:bg-rose-500/[0.04]">
                        {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).totalPotongan, 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-extrabold text-primary tabular-nums bg-primary/[0.04]">
                        {formatCurrency(filtered.reduce((s, r) => s + wsComputeTotals(r.id).netto, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </Portal>
      )}

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
                        const raw = parseCurrencyInput(e.target.value);
                        setBatchValue(formatInputCurrency(raw));
                      }}
                      placeholder="0"
                      className={cn(inputClass, "pl-9 text-right")}
                    />
                  </div>
                </div>
                {batchField && batchValue && (() => {
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
                <Button icon={Zap} size="sm" onClick={handleBatchFill} disabled={!batchField || !batchValue}>Terapkan</Button>
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
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r from-card via-card to-primary/[0.03] flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center">
                    <FileText className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{selectedPayroll.pegawaiNama}</h3>
                    <p className="text-xs text-muted-foreground">{selectedPayroll.pegawaiJabatan} &middot; {formatPeriodLabel(selectedPayroll.periode)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={selectedPayroll.status === "Final" ? "success" : "muted"}>{selectedPayroll.status}</Badge>
                  <button onClick={() => setShowDetail(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

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
                          <div key={f.key} className={cn(isLembur ? "space-y-2" : "flex items-center gap-3")}>
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
                                    if (f.readonly) return;
                                    const val = parseCurrencyInput(e.target.value);
                                    setEditForm((prev) => ({ ...prev, [f.key]: val }));
                                  }}
                                  readOnly={f.readonly}
                                  className={cn(
                                    inputClass,
                                    "pl-9 text-right",
                                    f.readonly && "bg-muted/60 text-muted-foreground cursor-not-allowed"
                                  )}
                                />
                              </div>
                            </div>
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
                        <div key={f.key} className="flex items-center gap-3">
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
                                  if (f.readonly) return;
                                  const val = parseCurrencyInput(e.target.value);
                                  setEditForm((prev) => ({ ...prev, [f.key]: val }));
                                }}
                                readOnly={f.readonly}
                                className={cn(
                                  inputClass,
                                  "pl-9 text-right",
                                  f.readonly && "bg-muted/60 text-muted-foreground cursor-not-allowed"
                                )}
                              />
                            </div>
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
                      onChange={(e) => setEditCatatan(e.target.value)}
                      placeholder="Catatan tambahan (opsional)..."
                      rows={2}
                      className={cn(inputClass, "resize-none")}
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
                              <Badge variant={h.status === "Final" ? "success" : "muted"} size="sm">{h.status}</Badge>
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
                  <Button
                    variant="danger"
                    size="sm"
                    icon={Trash2}
                    onClick={() => setDeleteConfirm({ id: selectedPayroll.id, nama: selectedPayroll.pegawaiNama || selectedPayroll.employee_id })}
                  >
                    Hapus
                  </Button>
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
                  {/* Tombol Kembalikan ke Draft hanya untuk super admin */}
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
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleStatus}
                      disabled={saving}
                    >
                      Finalkan
                    </Button>
                  )}
                  <Button
                    icon={saving ? Loader2 : Save}
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || (selectedPayroll.status === "Final" && !isSuperAdmin)}
                    title={selectedPayroll.status === "Final" && !isSuperAdmin ? "Slip sudah Final, hanya super admin yang bisa edit" : undefined}
                  >
                    {saving ? "Menyimpan..." : "Simpan"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

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
                <h3 className="text-sm font-bold text-foreground mb-1">Finalkan {selectedIds.size} Slip Gaji?</h3>
                <p className="text-xs text-muted-foreground">
                  Semua slip gaji yang dipilih akan diubah statusnya menjadi <strong>Final</strong> dan tidak dapat diedit lagi oleh admin biasa.
                </p>
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setBulkFinalConfirm(false)} disabled={bulkUpdating}>
                  Batal
                </Button>
                <Button size="sm" className="flex-1 bg-success hover:bg-success/90 text-white border-success" icon={bulkUpdating ? Loader2 : CircleCheckBig} onClick={handleBulkFinal} disabled={bulkUpdating}>
                  {bulkUpdating ? "Memproses..." : "Ya, Finalkan"}
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
                <h3 className="text-sm font-bold text-foreground mb-1">Hapus {selectedIds.size} Slip Gaji?</h3>
                <p className="text-xs text-muted-foreground">
                  Semua slip gaji yang dipilih akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setBulkDeleteConfirm(false)} disabled={deleting}>
                  Batal
                </Button>
                <Button variant="danger" size="sm" className="flex-1" icon={deleting ? Loader2 : Trash2} onClick={handleBulkDelete} disabled={deleting}>
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
              </div>
              <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setBuatSlipConfirm(null)}>
                  Batal
                </Button>
                <Button variant="primary" size="sm" className="flex-1" icon={FileCheck} onClick={() => handleBuatSlip(buatSlipConfirm.ids)}>
                  Buat Slip
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}


    </div>
    </RouteGuard>
  );
}

// ═════════════════════════════════════════════════════════
// HERO METRIC CARD
// ═════════════════════════════════════════════════════════
function _HeroMetric({
  icon: Icon, label, value, unit, gradient, iconBg, iconColor, breakdown,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit?: string;
  gradient: string;
  iconBg: string;
  iconColor: string;
  breakdown?: string;
}) {
  return (
    <div className="relative bg-card rounded-2xl border border-border p-4 overflow-hidden">
      <div className={cn("absolute inset-0 bg-gradient-to-br pointer-events-none", gradient)} />
      <div className="relative">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-2.5", iconBg)}>
          <Icon className={cn("w-4 h-4", iconColor)} />
        </div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className="flex items-baseline gap-1.5 mt-1">
          <p className="text-xl font-bold text-foreground tabular-nums truncate">{value}</p>
          {unit && <p className="text-xs text-muted-foreground font-medium">{unit}</p>}
        </div>
        {breakdown && (
          <p className="text-[10px] text-muted-foreground mt-1.5 truncate">{breakdown}</p>
        )}
      </div>
    </div>
  );
}
