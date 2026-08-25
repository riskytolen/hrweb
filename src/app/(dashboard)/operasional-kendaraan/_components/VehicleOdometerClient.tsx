"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  CircleCheckBig,
  ClipboardList,
  Edit2,
  FileDown,
  FileSpreadsheet,
  Gauge,
  Info,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Pagination from "@/components/ui/Pagination";
import RouteGuard from "@/components/RouteGuard";
import Select from "@/components/ui/Select";
import DatePicker from "@/components/ui/DatePicker";
import Portal from "@/components/ui/Portal";
import { supabase, type DbVehicleOdometerLog, type DbVehicleOdometerVehicle } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { downloadCsv } from "@/lib/finance";
import { cn } from "@/lib/utils";
import {
  calculateDistance,
  formatDateId,
  formatKm,
  localDateInput,
  monthStartInput,
  parseOdometerInput,
  summarizeDistanceByDate,
  summarizeDistanceByVehicle,
  summarizeOdometerLogs,
} from "@/lib/vehicle-odometer";

type VehicleOdometerMode = "dashboard" | "input" | "laporan";

interface VehicleOdometerClientProps {
  mode: VehicleOdometerMode;
}

type Toast = { type: "success" | "error"; title: string; message?: string };

const PAGE_SIZE = 20;

function tomorrowInput(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDateInput(d);
}

const modeConfig = {
  dashboard: {
    title: "Dashboard Kendaraan",
    description: "Ringkasan jarak tempuh dan odometer kendaraan operasional",
    icon: Gauge,
    permission: "vehicle-odometer",
  },
  input: {
    title: "Input Odometer",
    description: "Input odometer awal dan akhir per tanggal oleh Admin GA",
    icon: ClipboardList,
    permission: "vehicle-odometer.manage",
  },
  laporan: {
    title: "Laporan Odometer",
    description: "Laporan jarak tempuh berdasarkan kendaraan dan tanggal",
    icon: FileSpreadsheet,
    permission: "vehicle-odometer",
  },
} as const;

const emptyForm = () => ({
  vehicleId: "",
  tanggal: localDateInput(),
  odometerAwal: "",
  odometerAkhir: "",
  catatan: "",
});

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeVehicle(row: Record<string, unknown>): DbVehicleOdometerVehicle {
  return {
    id: Number(row.id),
    unit: String(row.unit ?? ""),
    jenis: String(row.jenis ?? ""),
    status: row.status === "Tidak Aktif" ? "Tidak Aktif" : "Aktif",
    last_log_id: row.last_log_id == null ? null : Number(row.last_log_id),
    last_log_date: row.last_log_date == null ? null : String(row.last_log_date),
    last_odometer: row.last_odometer == null ? null : toNumber(row.last_odometer),
    total_jarak: toNumber(row.total_jarak),
  };
}

function normalizeLog(row: Record<string, unknown>): DbVehicleOdometerLog {
  return {
    id: Number(row.id),
    vehicle_id: Number(row.vehicle_id),
    vehicle_unit: String(row.vehicle_unit ?? ""),
    vehicle_jenis: String(row.vehicle_jenis ?? ""),
    vehicle_status: row.vehicle_status === "Tidak Aktif" ? "Tidak Aktif" : "Aktif",
    tanggal: String(row.tanggal ?? ""),
    odometer_awal: toNumber(row.odometer_awal),
    odometer_akhir: toNumber(row.odometer_akhir),
    jarak_km: toNumber(row.jarak_km),
    catatan: row.catatan == null ? null : String(row.catatan),
    created_by: row.created_by == null ? null : String(row.created_by),
    created_by_nama: row.created_by_nama == null ? null : String(row.created_by_nama),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    is_latest: Boolean(row.is_latest),
  };
}

function fileStamp(): string {
  return localDateInput().replace(/-/g, "");
}

function StatCard({ title, value, subtitle, icon: Icon, accent = "primary" }: { title: string; value: string; subtitle?: string; icon: typeof Gauge; accent?: "primary" | "success" | "warning" | "danger" }) {
  const color = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-danger/10 text-danger",
  }[accent];

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">{title}</p>
          <p className="mt-1 text-xl font-bold text-foreground tabular-nums">{value}</p>
          {subtitle && <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", color)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </div>
  );
}

export default function VehicleOdometerClient({ mode }: VehicleOdometerClientProps) {
  const { user, isLoading: authLoading, getPermissionLevel, hasPermission } = useAuth();
  const config = modeConfig[mode];
  const [vehicles, setVehicles] = useState<DbVehicleOdometerVehicle[]>([]);
  const [logs, setLogs] = useState<DbVehicleOdometerLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "csv" | "xlsx" | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("Semua");
  const [draftStartDate, setDraftStartDate] = useState(monthStartInput());
  const [draftEndDate, setDraftEndDate] = useState(localDateInput());
  const [appliedStartDate, setAppliedStartDate] = useState(monthStartInput());
  const [appliedEndDate, setAppliedEndDate] = useState(localDateInput());
  const [form, setForm] = useState(emptyForm);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});

  // Edit modal (responsive: dialog on desktop, bottom-sheet on mobile)
  const [editTarget, setEditTarget] = useState<DbVehicleOdometerLog | null>(null);
  const [editForm, setEditForm] = useState({ tanggal: localDateInput(), odometerAwal: "", odometerAkhir: "", catatan: "" });
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm (custom, not window.confirm)
  const [deleteTarget, setDeleteTarget] = useState<DbVehicleOdometerLog | null>(null);
  const [deleting, setDeleting] = useState(false);

  const permissionLevel = getPermissionLevel("vehicle-odometer");
  const canManage = permissionLevel === "edit" || hasPermission("vehicle-odometer.manage");
  const canView = canManage || permissionLevel === "view" || permissionLevel === "input";

  const showToast = useCallback((type: Toast["type"], title: string, message?: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, title, message });
    toastTimerRef.current = setTimeout(() => setToast(null), 3800);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // Scroll lock when any modal is open (mirrors attendance/income patterns)
  useEffect(() => {
    const hasModal = !!editTarget || !!deleteTarget;
    if (hasModal) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [editTarget, deleteTarget]);

  const fetchVehicles = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_vehicle_odometer_vehicles");
    if (error) throw error;
    setVehicles(((data as Record<string, unknown>[] | null) ?? []).map(normalizeVehicle));
  }, []);

  const fetchLogs = useCallback(async () => {
    const params = mode === "laporan"
      ? {
          p_vehicle_id: vehicleFilter === "Semua" ? null : Number(vehicleFilter),
          p_start_date: appliedStartDate || null,
          p_end_date: appliedEndDate || null,
        }
      : { p_vehicle_id: null, p_start_date: null, p_end_date: null };
    const { data, error } = await supabase.rpc("get_vehicle_odometer_logs", params);
    if (error) throw error;
    setLogs(((data as Record<string, unknown>[] | null) ?? []).map(normalizeLog));
  }, [appliedEndDate, appliedStartDate, mode, vehicleFilter]);

  const loadData = useCallback(async () => {
    if (authLoading || !user || (mode === "input" ? !canManage : !canView)) return;
    setLoading(true);
    try {
      await Promise.all([fetchVehicles(), fetchLogs()]);
    } catch (err) {
      showToast("error", "Gagal memuat data", err instanceof Error ? err.message : "Coba refresh halaman.");
    } finally {
      setLoading(false);
    }
  }, [authLoading, canManage, canView, fetchLogs, fetchVehicles, mode, showToast, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === form.vehicleId) ?? null,
    [form.vehicleId, vehicles],
  );

  const searchableLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) => {
      const haystack = `${log.vehicle_unit} ${log.vehicle_jenis} ${log.catatan ?? ""} ${log.created_by_nama ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, search]);

  const pagedLogs = useMemo(
    () => searchableLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, searchableLogs],
  );

  const today = localDateInput();
  const tomorrow = tomorrowInput();
  const monthStart = monthStartInput();
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const dashboardSummary = useMemo(() => {
    const todayLogs = logs.filter((log) => log.tanggal === today);
    const monthLogs = logs.filter((log) => log.tanggal >= monthStart && log.tanggal <= today);
    const yearLogs = logs.filter((log) => log.tanggal >= yearStart && log.tanggal <= today);
    return {
      today: summarizeOdometerLogs(todayLogs),
      month: summarizeOdometerLogs(monthLogs),
      year: summarizeOdometerLogs(yearLogs),
      all: summarizeOdometerLogs(logs),
    };
  }, [logs, monthStart, today, yearStart]);

  const reportSummary = useMemo(() => summarizeOdometerLogs(searchableLogs), [searchableLogs]);
  const topVehicles = useMemo(() => summarizeDistanceByVehicle(logs).slice(0, 5), [logs]);
  const reportTopVehicles = useMemo(() => summarizeDistanceByVehicle(searchableLogs), [searchableLogs]);
  const dailyDistance = useMemo(() => summarizeDistanceByDate(logs).slice(-14), [logs]);
  const maxDailyDistance = Math.max(1, ...dailyDistance.map((row) => row.totalJarak));

  const vehicleOptions = useMemo(
    () => [
      { value: "Semua", label: "Semua Kendaraan" },
      ...vehicles.map((vehicle) => ({ value: String(vehicle.id), label: `${vehicle.unit} - ${vehicle.jenis}` })),
    ],
    [vehicles],
  );

  // ── Create form (input page) — selalu manual awal+akhir per rute; validasi anomali berurutan ──
  const formStart = parseOdometerInput(form.odometerAwal);
  const formEnd = parseOdometerInput(form.odometerAkhir);
  const previewDistance = calculateDistance(formStart, formEnd);
  const hasActiveVehicles = vehicles.length > 0;
  const lastOdoForSelected = selectedVehicle?.last_odometer ?? null;
  const lastDateForSelected = selectedVehicle?.last_log_date ?? null;

  const resetForm = () => {
    setForm(emptyForm());
    setCreateErrors({});
  };

  const getCreateErrors = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.vehicleId) errors.vehicleId = "Pilih kendaraan terlebih dahulu.";
    else if (!vehicles.some((v) => String(v.id) === form.vehicleId)) errors.vehicleId = "Kendaraan tidak valid.";
    if (!form.tanggal) errors.tanggal = "Pilih tanggal pencatatan.";
    else if (form.tanggal > tomorrow) errors.tanggal = "Tanggal tidak boleh melebihi besok.";
    else if (lastDateForSelected && form.tanggal < lastDateForSelected) errors.tanggal = `Tanggal tidak boleh sebelum log terakhir (${formatDateId(lastDateForSelected)}).`;
    if (formStart == null) errors.odometerAwal = "Isi odometer awal dengan angka yang valid.";
    if (formEnd == null) errors.odometerAkhir = "Isi odometer akhir dengan angka yang valid.";
    if (formStart != null && formEnd != null && previewDistance == null) errors.odometerAkhir = "Odometer akhir harus >= odometer awal.";
    if (lastOdoForSelected != null && formStart != null && formStart < lastOdoForSelected) errors.odometerAwal = `Odometer awal tidak boleh di bawah odometer terakhir ${formatKm(lastOdoForSelected, "")} (anomali). Boleh sama atau lebih besar karena pemakaian di luar rute.`;
    return errors;
  };

  const saveLog = async () => {
    if (!canManage) return;
    const errors = getCreateErrors();
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors);
      showToast("error", "Form belum lengkap", Object.values(errors)[0]);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc("create_vehicle_odometer_log", {
        p_vehicle_id: Number(form.vehicleId),
        p_tanggal: form.tanggal,
        p_odometer_awal: formStart!,
        p_odometer_akhir: formEnd!,
        p_catatan: form.catatan || null,
      });
      if (error) throw error;
      showToast("success", "Log tersimpan", `Jarak ${formatKm(previewDistance)} berhasil dicatat.`);
      resetForm();
      await loadData();
    } catch (err) {
      showToast("error", "Gagal menyimpan", err instanceof Error ? err.message : "Coba ulangi input odometer.");
    } finally {
      setSaving(false);
    }
  };

  // ── Edit modal helpers ──
  const openEdit = (log: DbVehicleOdometerLog) => {
    if (!canManage || !log.is_latest) return;
    setEditTarget(log);
    setEditForm({ tanggal: log.tanggal, odometerAwal: String(log.odometer_awal), odometerAkhir: String(log.odometer_akhir), catatan: log.catatan ?? "" });
    setEditErrors({});
  };
  const closeEdit = () => {
    if (editSaving) return;
    setEditTarget(null);
    setEditErrors({});
  };
  const editStart = parseOdometerInput(editForm.odometerAwal);
  const editEnd = parseOdometerInput(editForm.odometerAkhir);
  const editPreview = calculateDistance(editStart, editEnd);
  const previousLog = useMemo(() => {
    if (!editTarget) return null;
    const siblings = logs.filter((l) => l.vehicle_id === editTarget.vehicle_id && l.id !== editTarget.id);
    if (siblings.length === 0) return null;
    const sorted = [...siblings].sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.id - a.id);
    return sorted[0] ?? null;
  }, [editTarget, logs]);
  const previousLogDate = previousLog?.tanggal ?? null;
  const previousLogEnd = previousLog ? toNumber(previousLog.odometer_akhir) : null;

  const getEditErrors = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!editForm.tanggal) errors.tanggal = "Pilih tanggal koreksi.";
    else if (editForm.tanggal > tomorrow) errors.tanggal = "Tanggal tidak boleh melebihi besok.";
    else if (previousLogDate && editForm.tanggal < previousLogDate) errors.tanggal = `Tidak boleh sebelum ${formatDateId(previousLogDate)}.`;
    if (editStart == null) errors.odometerAwal = "Isi odometer awal dengan angka yang valid.";
    if (editEnd == null) errors.odometerAkhir = "Isi odometer akhir dengan angka yang valid.";
    else if (editPreview == null) errors.odometerAkhir = "Odometer akhir harus >= odometer awal.";
    if (previousLogEnd != null && editStart != null && editStart < previousLogEnd) errors.odometerAwal = `Odometer awal tidak boleh di bawah akhir log sebelumnya ${formatKm(previousLogEnd, "")}.`;
    return errors;
  };

  const saveEdit = async () => {
    if (!editTarget || !canManage) return;
    const errors = getEditErrors();
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      showToast("error", "Koreksi belum valid", Object.values(errors)[0]);
      return;
    }
    if (editStart == null || editEnd == null || editPreview == null) return;
    setEditSaving(true);
    try {
      const { error } = await supabase.rpc("update_vehicle_odometer_log", {
        p_log_id: editTarget.id,
        p_tanggal: editForm.tanggal,
        p_odometer_awal: editStart,
        p_odometer_akhir: editEnd,
        p_catatan: editForm.catatan || null,
      });
      if (error) throw error;
      showToast("success", "Koreksi disimpan", `Jarak terbaru ${formatKm(editPreview)} berhasil diperbarui.`);
      closeEdit();
      await loadData();
    } catch (err) {
      showToast("error", "Gagal menyimpan koreksi", err instanceof Error ? err.message : "Coba ulangi.");
    } finally {
      setEditSaving(false);
    }
  };

  // ── Delete helpers (custom confirm) ──
  const openDelete = (log: DbVehicleOdometerLog) => {
    if (!canManage || !log.is_latest) return;
    setDeleteTarget(log);
  };
  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
  };
  const confirmDelete = async () => {
    if (!deleteTarget || !canManage) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("delete_vehicle_odometer_log", { p_log_id: deleteTarget.id });
      if (error) throw error;
      showToast("success", "Log dihapus", "Odometer terbaru telah dikembalikan ke log sebelumnya.");
      const wasEditing = editTarget?.id === deleteTarget.id;
      if (wasEditing) setEditTarget(null);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      showToast("error", "Gagal menghapus", err instanceof Error ? err.message : "Hanya log terbaru yang bisa dihapus.");
    } finally {
      setDeleting(false);
    }
  };

  const handleApplyFilters = () => {
    if (draftStartDate && draftEndDate && draftStartDate > draftEndDate) {
      showToast("error", "Rentang tanggal tidak valid", "Tanggal awal tidak boleh melebihi tanggal akhir.");
      return;
    }
    if (draftStartDate && draftStartDate > tomorrow) {
      showToast("error", "Filter tanggal tidak valid", "Tanggal awal melebihi batas.");
      return;
    }
    if (draftEndDate && draftEndDate > tomorrow) {
      showToast("error", "Filter tanggal tidak valid", "Tanggal akhir melebihi batas.");
      return;
    }
    setAppliedStartDate(draftStartDate);
    setAppliedEndDate(draftEndDate);
    setPage(1);
  };
  const handleResetFilters = () => {
    const ms = monthStartInput();
    const td = localDateInput();
    setDraftStartDate(ms);
    setDraftEndDate(td);
    setAppliedStartDate(ms);
    setAppliedEndDate(td);
    setVehicleFilter("Semua");
    setSearch("");
    setPage(1);
  };
  const isFilterDirty = draftStartDate !== appliedStartDate || draftEndDate !== appliedEndDate;

  const exportRows = () => [
    ["Laporan Odometer Kendaraan"],
    ["Periode", appliedStartDate ? formatDateId(appliedStartDate) : "Semua", "s/d", appliedEndDate ? formatDateId(appliedEndDate) : "Semua"],
    ["Kendaraan", vehicleFilter === "Semua" ? "Semua Kendaraan" : vehicles.find((v) => String(v.id) === vehicleFilter)?.unit ?? "-"],
    [],
    ["Total Jarak", reportSummary.totalJarak],
    ["Jumlah Log", reportSummary.totalLog],
    ["Rata-rata Jarak", reportSummary.avgJarak],
    ["Jumlah Kendaraan", reportSummary.kendaraanCount],
    [],
    ["Tanggal", "Kendaraan", "Jenis", "Odometer Awal", "Odometer Akhir", "Jarak (km)", "Catatan", "Input Oleh"],
    ...[...searchableLogs]
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.vehicle_unit.localeCompare(b.vehicle_unit, "id"))
      .map((log) => [
        formatDateId(log.tanggal),
        log.vehicle_unit,
        log.vehicle_jenis,
        log.odometer_awal,
        log.odometer_akhir,
        log.jarak_km,
        log.catatan ?? "",
        log.created_by_nama ?? "-",
      ]),
  ];

  const exportCsv = () => {
    downloadCsv(`laporan-odometer-${fileStamp()}.csv`, exportRows());
  };

  const exportXlsx = async () => {
    setExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(exportRows());
      sheet["!cols"] = [
        { wch: 16 },
        { wch: 18 },
        { wch: 20 },
        { wch: 16 },
        { wch: 16 },
        { wch: 12 },
        { wch: 32 },
        { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, "Odometer");
      XLSX.writeFile(workbook, `laporan-odometer-${fileStamp()}.xlsx`);
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    setExporting("pdf");
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Laporan Odometer Kendaraan", pageWidth / 2, 14, { align: "center" });
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Periode: ${appliedStartDate ? formatDateId(appliedStartDate) : "Semua"} s/d ${appliedEndDate ? formatDateId(appliedEndDate) : "Semua"}`, pageWidth / 2, 20, { align: "center" });
      doc.text(`Total jarak: ${formatKm(reportSummary.totalJarak)} | Log: ${reportSummary.totalLog} | Kendaraan: ${reportSummary.kendaraanCount}`, pageWidth / 2, 25, { align: "center" });

      autoTable(doc, {
        startY: 32,
        head: [["Tanggal", "Kendaraan", "Jenis", "Awal", "Akhir", "Jarak", "Catatan", "Input Oleh"]],
        body: [...searchableLogs]
          .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.vehicle_unit.localeCompare(b.vehicle_unit, "id"))
          .map((log) => [
            formatDateId(log.tanggal),
            log.vehicle_unit,
            log.vehicle_jenis,
            formatKm(log.odometer_awal, ""),
            formatKm(log.odometer_akhir, ""),
            formatKm(log.jarak_km),
            log.catatan ?? "-",
            log.created_by_nama ?? "-",
          ]),
        styles: { fontSize: 8, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.1 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
        },
        didDrawPage: () => {
          const page = doc.getNumberOfPages();
          doc.setFontSize(8);
          doc.text(`Halaman ${page}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: "right" });
        },
      });

      doc.save(`laporan-odometer-${fileStamp()}.pdf`);
    } finally {
      setExporting(null);
    }
  };

  const renderTable = (showActions: boolean) => {
    const showEmpty = !loading && pagedLogs.length === 0;
    const emptyTitle = searchableLogs.length === 0 && logs.length > 0 ? "Tidak ada hasil" : "Belum ada data odometer";
    const emptyDesc = searchableLogs.length === 0 && logs.length > 0
      ? "Coba ubah kata kunci pencarian atau reset filter."
      : showActions ? "Input log pertama untuk kendaraan aktif untuk memulai rekap jarak." : "Data akan muncul setelah ada pencatatan dari Admin GA.";

    return (
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        {/* ── Desktop table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-muted/40">
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-3 text-left">Tanggal</th>
                <th className="px-3 py-3 text-left">Kendaraan</th>
                <th className="px-3 py-3 text-right">Odo Awal</th>
                <th className="px-3 py-3 text-right">Odo Akhir</th>
                <th className="px-3 py-3 text-right">Jarak</th>
                <th className="px-3 py-3 text-left">Catatan</th>
                <th className="px-3 py-3 text-left">Input Oleh</th>
                {showActions && <th className="px-3 py-3 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-3 py-3"><div className="h-3 w-20 rounded bg-muted" /></td>
                    <td className="px-3 py-3"><div className="h-3 w-28 rounded bg-muted" /><div className="mt-1 h-2 w-16 rounded bg-muted/50" /></td>
                    <td className="px-3 py-3"><div className="ml-auto h-3 w-14 rounded bg-muted" /></td>
                    <td className="px-3 py-3"><div className="ml-auto h-3 w-14 rounded bg-muted" /></td>
                    <td className="px-3 py-3"><div className="ml-auto h-3 w-12 rounded bg-primary/20" /></td>
                    <td className="px-3 py-3"><div className="h-3 w-24 rounded bg-muted" /></td>
                    <td className="px-3 py-3"><div className="h-3 w-16 rounded bg-muted" /></td>
                    {showActions && <td className="px-3 py-3"><div className="ml-auto h-7 w-16 rounded bg-muted" /></td>}
                  </tr>
                ))
              ) : showEmpty ? (
                <tr><td colSpan={showActions ? 8 : 7} className="px-4 py-10 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted"><Search className="h-5 w-5 text-muted-foreground" /></div>
                    <p className="text-sm font-semibold text-foreground">{emptyTitle}</p>
                    <p className="text-xs text-muted-foreground">{emptyDesc}</p>
                  </div>
                </td></tr>
              ) : (
                pagedLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/20">
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-foreground">{formatDateId(log.tanggal)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{log.vehicle_unit}</span>
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold", log.is_latest ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{log.is_latest ? "Terbaru" : "Terkunci"}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">{log.vehicle_jenis}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatKm(log.odometer_awal, "")}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatKm(log.odometer_akhir, "")}</td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-primary">{formatKm(log.jarak_km)}</td>
                    <td className="max-w-[260px] px-3 py-2.5 text-muted-foreground">{log.catatan || "-"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{log.created_by_nama || "-"}</td>
                    {showActions && (
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => openEdit(log)}
                            disabled={!log.is_latest || saving || editSaving || deleting}
                            aria-label={log.is_latest ? `Koreksi log ${log.vehicle_unit} ${formatDateId(log.tanggal)}` : "Hanya log terbaru yang bisa dikoreksi"}
                            title={log.is_latest ? "Koreksi log terbaru" : "Hanya log terbaru yang bisa dikoreksi"}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => openDelete(log)}
                            disabled={!log.is_latest || saving || deleting}
                            aria-label={log.is_latest ? `Hapus log ${log.vehicle_unit} ${formatDateId(log.tanggal)}` : "Hanya log terbaru yang bisa dihapus"}
                            title={log.is_latest ? "Hapus log terbaru" : "Hanya log terbaru yang bisa dihapus"}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-transparent bg-muted text-muted-foreground hover:bg-danger-light hover:text-danger disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Mobile cards ── */}
        <div className="md:hidden divide-y divide-border/40">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 animate-pulse">
                <div className="h-3 w-28 rounded bg-muted" />
                <div className="mt-2 h-3 w-20 rounded bg-muted/60" />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="h-10 rounded-xl bg-muted" />
                  <div className="h-10 rounded-xl bg-muted" />
                  <div className="h-10 rounded-xl bg-primary/20" />
                </div>
              </div>
            ))
          ) : showEmpty ? (
            <div className="p-8 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted"><Search className="h-5 w-5 text-muted-foreground" /></div>
              <p className="mt-3 text-sm font-semibold text-foreground">{emptyTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{emptyDesc}</p>
            </div>
          ) : (
            pagedLogs.map((log) => (
              <div key={log.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">{log.vehicle_unit}</p>
                    <p className="text-[11px] text-muted-foreground">{log.vehicle_jenis} · {formatDateId(log.tanggal)}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", log.is_latest ? "bg-success/10 text-success border border-success/20" : "bg-muted text-muted-foreground border border-border")}>{log.is_latest ? "Terbaru" : "Terkunci"}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-muted/40 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Awal</p>
                    <p className="mt-1 text-xs font-semibold tabular-nums text-foreground">{formatKm(log.odometer_awal, "")}</p>
                  </div>
                  <div className="rounded-xl bg-muted/40 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Akhir</p>
                    <p className="mt-1 text-xs font-semibold tabular-nums text-foreground">{formatKm(log.odometer_akhir, "")}</p>
                  </div>
                  <div className="rounded-xl bg-primary/10 p-2.5 border border-primary/15">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Jarak</p>
                    <p className="mt-1 text-xs font-bold tabular-nums text-primary">{formatKm(log.jarak_km)}</p>
                  </div>
                </div>
                {(log.catatan || log.created_by_nama) && (
                  <div className="mt-3 rounded-xl border border-border bg-muted/20 p-2.5">
                    {log.catatan && <p className="text-xs text-foreground"><span className="font-semibold">Catatan:</span> {log.catatan}</p>}
                    <p className="text-[11px] text-muted-foreground">Input oleh {log.created_by_nama || "-"}</p>
                  </div>
                )}
                {showActions && (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">{log.is_latest ? "Bisa dikoreksi / dihapus" : "Log terkunci"}</p>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(log)} disabled={!log.is_latest || saving || editSaving || deleting} className="inline-flex h-9 min-w-[72px] items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40"><Edit2 className="h-3.5 w-3.5" />Koreksi</button>
                      <button onClick={() => openDelete(log)} disabled={!log.is_latest || saving || deleting} className="inline-flex h-9 min-w-[64px] items-center justify-center gap-1.5 rounded-xl bg-danger px-3 text-xs font-semibold text-white hover:bg-danger/90 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Hapus</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {searchableLogs.length > PAGE_SIZE && (
          <div className="border-t border-border">
            <Pagination currentPage={page} totalItems={searchableLogs.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </div>
        )}
      </div>
    );
  };

  return (
    <RouteGuard permission={config.permission}>
      <div className="space-y-5 animate-fade-in">
        <PageHeader
          title={config.title}
          description={config.description}
          icon={config.icon}
          actions={
            <Button variant="outline" size="sm" icon={RefreshCw} onClick={loadData} disabled={loading}>
              Refresh
            </Button>
          }
        />

        {mode === "dashboard" && (
          <>
            <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4">
              <StatCard title="Kendaraan Aktif" value={String(vehicles.length)} subtitle="dari master Data Mobil" icon={Truck} />
              <StatCard title="Jarak Hari Ini" value={formatKm(dashboardSummary.today.totalJarak)} subtitle={`${dashboardSummary.today.totalLog} log`} icon={Gauge} accent="success" />
              <StatCard title="Jarak Bulan Ini" value={formatKm(dashboardSummary.month.totalJarak)} subtitle={`${dashboardSummary.month.kendaraanCount} kendaraan`} icon={CalendarDays} accent="warning" />
              <StatCard title="Jarak Tahun Ini" value={formatKm(dashboardSummary.year.totalJarak)} subtitle={`${dashboardSummary.year.totalLog} pencatatan`} icon={BarChart3} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Data Kendaraan Aktif</h2>
                    <p className="text-[11px] text-muted-foreground">Master kendaraan berasal dari menu GA Data Mobil.</p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{vehicles.length} unit</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)
                  ) : vehicles.length === 0 ? (
                    <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Belum ada kendaraan aktif.</div>
                  ) : (
                    vehicles.map((vehicle) => (
                      <div key={vehicle.id} className="rounded-xl border border-border bg-muted/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-foreground">{vehicle.unit}</p>
                            <p className="text-[11px] text-muted-foreground">{vehicle.jenis}</p>
                          </div>
                          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">Aktif</span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <p className="text-muted-foreground">Odo terakhir</p>
                            <p className="font-semibold text-foreground tabular-nums">{formatKm(vehicle.last_odometer, "")}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Total jarak</p>
                            <p className="font-semibold text-primary tabular-nums">{formatKm(vehicle.total_jarak)}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <h2 className="text-sm font-bold text-foreground">Top Kendaraan</h2>
                  <p className="mb-4 text-[11px] text-muted-foreground">Berdasarkan total jarak seluruh log.</p>
                  <div className="space-y-3">
                    {topVehicles.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">Belum ada jarak tercatat.</p>
                    ) : (
                      topVehicles.map((item, index) => {
                        const max = Math.max(1, topVehicles[0]?.totalJarak ?? 1);
                        return (
                          <div key={item.vehicleId}>
                            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                              <span className="font-semibold text-foreground">{index + 1}. {item.unit}</span>
                              <span className="font-bold text-primary tabular-nums">{formatKm(item.totalJarak)}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(6, (item.totalJarak / max) * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <h2 className="text-sm font-bold text-foreground">Jarak Harian</h2>
                  <p className="mb-4 text-[11px] text-muted-foreground">14 tanggal terakhir yang memiliki log.</p>
                  <div className="flex h-40 items-end gap-2">
                    {dailyDistance.length === 0 ? (
                      <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">Belum ada data.</div>
                    ) : (
                      dailyDistance.map((row) => (
                        <div key={row.tanggal} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                          <div className="w-full rounded-t-lg bg-primary/80" style={{ height: `${Math.max(8, (row.totalJarak / maxDailyDistance) * 128)}px` }} title={`${formatDateId(row.tanggal)} - ${formatKm(row.totalJarak)}`} />
                          <span className="max-w-full truncate text-[9px] text-muted-foreground">{row.tanggal.slice(8, 10)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Log Terbaru</h2>
                  <p className="text-[11px] text-muted-foreground">Delapan pencatatan odometer terakhir.</p>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-border bg-muted/40">
                      <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-3 text-left">Tanggal</th>
                        <th className="px-3 py-3 text-left">Kendaraan</th>
                        <th className="px-3 py-3 text-right">Jarak</th>
                        <th className="px-3 py-3 text-left">Catatan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {logs.slice(0, 8).map((log) => (
                        <tr key={log.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2.5 font-medium text-foreground">{formatDateId(log.tanggal)}</td>
                          <td className="px-3 py-2.5"><span className="font-semibold text-foreground">{log.vehicle_unit}</span><span className="text-muted-foreground"> - {log.vehicle_jenis}</span></td>
                          <td className="px-3 py-2.5 text-right font-bold text-primary tabular-nums">{formatKm(log.jarak_km)}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{log.catatan || "-"}</td>
                        </tr>
                      ))}
                      {!loading && logs.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Belum ada log odometer.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {mode === "input" && (
          <>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-foreground flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10"><Plus className="h-4 w-4 text-primary" /></span>Input Log Baru</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">Setiap log wajib isi odometer awal dan akhir manual per rute. Odo awal boleh &gt; akhir sebelumnya (pemakaian luar rute), tapi tidak boleh turun. Tanggal harus berurutan.</p>
                </div>
                {!hasActiveVehicles && !loading && <span className="rounded-full bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning border border-warning/20">Belum ada kendaraan aktif</span>}
              </div>

              {!hasActiveVehicles && !loading ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted"><Truck className="h-5 w-5 text-muted-foreground" /></div>
                  <p className="mt-3 text-sm font-semibold text-foreground">Belum ada kendaraan aktif</p>
                  <p className="mt-1 text-xs text-muted-foreground">Tambahkan data mobil di menu GA · Data Mobil dan pastikan status Aktif untuk mulai input odometer.</p>
                </div>
              ) : (
                <>
                  {Object.keys(createErrors).length > 0 && (
                    <div className="mb-4 flex gap-2 rounded-xl border border-danger/20 bg-danger-light px-3 py-2.5 text-xs text-danger" role="alert">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <div><p className="font-semibold">Periksa kembali form</p><p className="mt-0.5 text-[11px] opacity-90">{Object.values(createErrors)[0]}</p></div>
                    </div>
                  )}
                  <div className="grid gap-3 lg:grid-cols-5">
                    <div className="lg:col-span-2">
                      <label className="mb-1.5 block text-xs font-semibold text-foreground">Kendaraan <span className="text-danger">*</span></label>
                      <Select
                        value={form.vehicleId}
                        onChange={(value) => {
                          setForm((prev) => ({ ...prev, vehicleId: value }));
                          if (createErrors.vehicleId) setCreateErrors((p) => { const n = { ...p }; delete n.vehicleId; return n; });
                          if (createErrors.odometerAwal || createErrors.tanggal) setCreateErrors((p) => { const n = { ...p }; delete n.odometerAwal; delete n.tanggal; return n; });
                        }}
                        options={[{ value: "", label: "Pilih kendaraan..." }, ...vehicles.map((vehicle) => ({ value: String(vehicle.id), label: `${vehicle.unit} - ${vehicle.jenis}` }))]}
                        className="w-full"
                        hasError={!!createErrors.vehicleId}
                      />
                      {createErrors.vehicleId ? <p className="mt-1 text-[11px] font-medium text-danger">{createErrors.vehicleId}</p> : <p className="mt-1 text-[10px] text-muted-foreground">Hanya kendaraan Aktif yang tampil.{lastOdoForSelected != null ? ` Odo terakhir ${formatKm(lastOdoForSelected, "")}.` : ""}</p>}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-foreground">Tanggal <span className="text-danger">*</span></label>
                      <DatePicker value={form.tanggal} onChange={(v) => { setForm((prev) => ({ ...prev, tanggal: v })); if (createErrors.tanggal) setCreateErrors((p) => { const n = { ...p }; delete n.tanggal; return n; }); }} maxDate={tomorrow} minDate={lastDateForSelected ?? undefined} hasError={!!createErrors.tanggal} placeholder="Pilih tanggal" />
                      {createErrors.tanggal ? <p className="mt-1 text-[11px] font-medium text-danger">{createErrors.tanggal}</p> : <p className="mt-1 text-[10px] text-muted-foreground">{lastDateForSelected ? `Min ${formatDateId(lastDateForSelected)}, maks besok (${formatDateId(tomorrow)}).` : `Maksimal besok (${formatDateId(tomorrow)}).`}</p>}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-foreground">Odometer Awal <span className="text-danger">*</span></label>
                      <input
                        value={form.odometerAwal}
                        onChange={(e) => { setForm((prev) => ({ ...prev, odometerAwal: e.target.value })); if (createErrors.odometerAwal) setCreateErrors((p) => { const n = { ...p }; delete n.odometerAwal; return n; }); }}
                        inputMode="decimal"
                        aria-invalid={!!createErrors.odometerAwal}
                        placeholder="Contoh: 1250.5"
                        className={cn("w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2", createErrors.odometerAwal ? "border-danger bg-danger/5 focus:border-danger focus:ring-danger/10 text-foreground" : "border-border bg-muted/30 text-foreground focus:border-primary focus:ring-primary/10")}
                      />
                      {createErrors.odometerAwal ? <p className="mt-1 text-[11px] font-medium text-danger">{createErrors.odometerAwal}</p> : <p className="mt-1 text-[10px] text-muted-foreground">{lastOdoForSelected != null ? `Min ${formatKm(lastOdoForSelected, "")} (boleh naik karena pemakaian luar rute).` : "Isi manual per rute."}</p>}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-foreground">Odometer Akhir <span className="text-danger">*</span></label>
                      <input value={form.odometerAkhir} onChange={(e) => { setForm((prev) => ({ ...prev, odometerAkhir: e.target.value })); if (createErrors.odometerAkhir) setCreateErrors((p) => { const n = { ...p }; delete n.odometerAkhir; return n; }); }} inputMode="decimal" aria-invalid={!!createErrors.odometerAkhir} placeholder="Contoh: 1250.5" className={cn("w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2", createErrors.odometerAkhir ? "border-danger bg-danger/5 focus:border-danger focus:ring-danger/10 text-foreground" : "border-border bg-muted/30 text-foreground focus:border-primary focus:ring-primary/10")} />
                      {createErrors.odometerAkhir && <p className="mt-1 text-[11px] font-medium text-danger">{createErrors.odometerAkhir}</p>}
                    </div>
                    <div className="lg:col-span-4">
                      <label className="mb-1.5 block text-xs font-semibold text-foreground">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                      <input value={form.catatan} onChange={(e) => setForm((prev) => ({ ...prev, catatan: e.target.value }))} placeholder="Misal: dinas luar kota, BBM, dsb." className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
                    </div>
                    <div className={cn("rounded-xl border p-3", previewDistance == null ? "border-border bg-muted/30" : "border-primary/20 bg-primary/5")}>
                      <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" /> Jarak Otomatis</p>
                      <p className={cn("mt-1 text-xl font-bold tabular-nums", previewDistance == null ? "text-muted-foreground" : "text-primary")}>{formatKm(previewDistance)}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">Akhir − Awal, 1 desimal.</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] text-muted-foreground hidden sm:block">Koreksi data lama tidak dilakukan di sini—gunakan <span className="font-semibold text-foreground">Koreksi</span> pada tabel log terbaru.</p>
                    <div className="ml-auto flex gap-2">
                      <Button variant="outline" onClick={resetForm} disabled={saving}>Reset</Button>
                      <Button icon={saving ? Loader2 : Plus} onClick={saveLog} disabled={saving}>
                        {saving ? "Menyimpan..." : "Simpan Log"}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-muted px-3 py-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cari kendaraan, jenis, atau catatan..." className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60" />
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{searchableLogs.length} log</span>
              {search && <button onClick={() => setSearch("")} className="text-xs font-semibold text-primary hover:underline">Bersihkan</button>}
            </div>
            {renderTable(true)}
          </>
        )}

        {mode === "laporan" && (
          <>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Filter Laporan</h2>
                  <p className="text-[11px] text-muted-foreground">Ubah tanggal draft terlebih dahulu, lalu tekan Terapkan untuk memuat data baru. Export mengikuti filter yang sudah diterapkan.</p>
                </div>
                {isFilterDirty && <span className="rounded-full bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning border border-warning/20 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Belum diterapkan</span>}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1.4fr_auto]">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Kendaraan</label>
                  <Select value={vehicleFilter} onChange={(value) => { setVehicleFilter(value); setPage(1); }} options={vehicleOptions} className="w-full" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Filter kendaraan diterapkan langsung.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Tanggal Awal</label>
                  <DatePicker value={draftStartDate} onChange={(v) => setDraftStartDate(v)} maxDate={tomorrow} hasError={!!(draftStartDate && draftEndDate && draftStartDate > draftEndDate)} placeholder="Pilih tanggal awal" />
                  {draftStartDate && draftEndDate && draftStartDate > draftEndDate && <p className="mt-1 text-[11px] font-medium text-danger">Tanggal awal melebihi tanggal akhir.</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Tanggal Akhir</label>
                  <DatePicker value={draftEndDate} onChange={(v) => setDraftEndDate(v)} maxDate={tomorrow} hasError={!!(draftStartDate && draftEndDate && draftStartDate > draftEndDate) || !!(draftEndDate && draftEndDate > tomorrow)} placeholder="Pilih tanggal akhir" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Pencarian</label>
                  <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cari unit, jenis, catatan..." className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60" />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="outline" icon={RefreshCw} onClick={handleApplyFilters} disabled={loading} className={cn("flex-1", isFilterDirty && "border-warning/30 bg-warning/5 hover:bg-warning/10")}>Terapkan</Button>
                  <Button variant="ghost" size="sm" onClick={handleResetFilters} disabled={loading} className="px-3">Reset</Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-full bg-muted px-2.5 py-1">Diterapkan: <span className="font-semibold text-foreground">{appliedStartDate ? formatDateId(appliedStartDate) : "Semua"} — {appliedEndDate ? formatDateId(appliedEndDate) : "Semua"}</span></span>
                {isFilterDirty && <span className="text-warning font-medium">Draft: {draftStartDate ? formatDateId(draftStartDate) : "—"} — {draftEndDate ? formatDateId(draftEndDate) : "—"}</span>}
              </div>
            </div>

            <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4">
              <StatCard title="Total Jarak" value={formatKm(reportSummary.totalJarak)} subtitle={`${reportSummary.totalLog} log`} icon={Gauge} />
              <StatCard title="Rata-rata Jarak" value={formatKm(reportSummary.avgJarak)} subtitle="per pencatatan" icon={BarChart3} accent="success" />
              <StatCard title="Kendaraan" value={String(reportSummary.kendaraanCount)} subtitle="memiliki log" icon={Truck} accent="warning" />
              <StatCard title="Rentang Odometer" value={reportSummary.odometerAwal == null ? "-" : `${formatKm(reportSummary.odometerAwal, "")} - ${formatKm(reportSummary.odometerAkhir, "")}`} subtitle="awal sampai akhir periode" icon={CalendarDays} />
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Export dan Cetak</h2>
                  <p className="text-[11px] text-muted-foreground">Export mengikuti filter aktif, bukan hanya halaman pagination.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" icon={FileDown} onClick={exportPdf} disabled={!!exporting || searchableLogs.length === 0}>{exporting === "pdf" ? "Export..." : "PDF"}</Button>
                  <Button variant="outline" size="sm" icon={FileDown} onClick={exportCsv} disabled={searchableLogs.length === 0}>CSV</Button>
                  <Button variant="outline" size="sm" icon={FileSpreadsheet} onClick={exportXlsx} disabled={!!exporting || searchableLogs.length === 0}>{exporting === "xlsx" ? "Export..." : "Excel"}</Button>
                  <Button variant="outline" size="sm" icon={Printer} onClick={() => window.print()} disabled={searchableLogs.length === 0}>Cetak</Button>
                </div>
              </div>
              {reportTopVehicles.length > 0 && (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {reportTopVehicles.slice(0, 6).map((item) => (
                    <div key={item.vehicleId} className="rounded-xl border border-border bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-bold text-foreground">{item.unit}</span>
                        <span className="text-sm font-bold text-primary tabular-nums">{formatKm(item.totalJarak)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{item.totalLog} log pada periode ini</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {renderTable(false)}
          </>
        )}

      </div>

      {/* ── Toast (custom, top-center card, accessible) ── */}
      {toast && (
        <Portal>
          <div className="fixed top-6 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 animate-fade-in" role="status" aria-live="polite">
            <div className={cn("flex items-start gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-2xl", toast.type === "error" ? "border-danger/20" : "border-success/20")}>
              <div className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl", toast.type === "error" ? "bg-danger/10 text-danger" : "bg-success/10 text-success")}>
                {toast.type === "error" ? <AlertTriangle className="h-5 w-5" /> : <CircleCheckBig className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{toast.title}</p>
                {toast.message && <p className="mt-0.5 text-xs text-muted-foreground">{toast.message}</p>}
              </div>
              <button onClick={dismissToast} aria-label="Tutup notifikasi" className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </Portal>
      )}

      {/* ── Edit Modal (koreksi log terbaru) ── */}
      {editTarget && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={closeEdit} />
            <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden bg-card shadow-2xl animate-slide-up sm:animate-scale-in sm:rounded-2xl rounded-t-2xl border border-border">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/10 text-warning"><Edit2 className="h-4.5 w-4.5" /></div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Koreksi Log Terbaru</h2>
                    <p className="text-[11px] text-muted-foreground">Hanya log terbaru per kendaraan yang bisa dikoreksi</p>
                  </div>
                </div>
                <button onClick={closeEdit} disabled={editSaving} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label="Tutup"><X className="h-4 w-4" /></button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Immutable vehicle summary */}
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-foreground">{editTarget.vehicle_unit}</p>
                      <p className="text-[11px] text-muted-foreground">{editTarget.vehicle_jenis} · {editTarget.vehicle_status}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success border border-success/20">Terbaru</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">ID #{editTarget.id}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Jarak sebelumnya</p>
                      <p className="text-sm font-bold tabular-nums text-primary">{formatKm(editTarget.jarak_km)}</p>
                      <p className="text-[11px] text-muted-foreground">{formatKm(editTarget.odometer_awal, "")} → {formatKm(editTarget.odometer_akhir, "")}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2 rounded-lg bg-info/5 border border-info/15 px-3 py-2 text-[11px] text-muted-foreground">
                    <Info className="h-3.5 w-3.5 flex-shrink-0 text-info mt-0.5" />
                    <p>Kendaraan tidak dapat diganti saat koreksi. Odometer awal dan akhir wajib diisi manual; awal boleh naik dari log sebelumnya tapi tidak boleh turun.</p>
                  </div>
                </div>

                {/* Editable fields */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Tanggal <span className="text-danger">*</span></label>
                  <DatePicker value={editForm.tanggal} onChange={(v) => { setEditForm((p) => ({ ...p, tanggal: v })); if (editErrors.tanggal) setEditErrors((prev) => { const n = { ...prev }; delete n.tanggal; return n; }); }} maxDate={tomorrow} minDate={previousLogDate ?? undefined} hasError={!!editErrors.tanggal} placeholder="Pilih tanggal koreksi" />
                  {editErrors.tanggal ? <p className="mt-1 text-[11px] font-medium text-danger">{editErrors.tanggal}</p> : <p className="mt-1 text-[10px] text-muted-foreground">{previousLogDate ? `Tidak boleh sebelum ${formatDateId(previousLogDate)}.` : "Tanggal koreksi tidak boleh mundur sebelum log sebelumnya."}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Odometer Awal <span className="text-danger">*</span></label>
                  <input value={editForm.odometerAwal} onChange={(e) => { setEditForm((p) => ({ ...p, odometerAwal: e.target.value })); if (editErrors.odometerAwal) setEditErrors((prev) => { const n = { ...prev }; delete n.odometerAwal; return n; }); }} inputMode="decimal" aria-invalid={!!editErrors.odometerAwal} placeholder="Contoh: 1250.5" className={cn("w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2", editErrors.odometerAwal ? "border-danger bg-danger/5 focus:border-danger focus:ring-danger/10 text-foreground" : "border-border bg-muted/30 text-foreground focus:border-primary focus:ring-primary/10")} />
                  {editErrors.odometerAwal ? <p className="mt-1 text-[11px] font-medium text-danger">{editErrors.odometerAwal}</p> : <p className="mt-1 text-[10px] text-muted-foreground">{previousLogEnd != null ? `Min ${formatKm(previousLogEnd, "")} (boleh naik karena pemakaian luar rute).` : "Isi manual, harus ≤ odometer akhir."}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Odometer Akhir <span className="text-danger">*</span></label>
                  <input value={editForm.odometerAkhir} onChange={(e) => { setEditForm((p) => ({ ...p, odometerAkhir: e.target.value })); if (editErrors.odometerAkhir) setEditErrors((prev) => { const n = { ...prev }; delete n.odometerAkhir; return n; }); }} inputMode="decimal" aria-invalid={!!editErrors.odometerAkhir} placeholder="Misal: 1280.5" className={cn("w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2", editErrors.odometerAkhir ? "border-danger bg-danger/5 focus:border-danger focus:ring-danger/10 text-foreground" : "border-border bg-muted/30 text-foreground focus:border-primary focus:ring-primary/10")} />
                  {editErrors.odometerAkhir ? <p className="mt-1 text-[11px] font-medium text-danger">{editErrors.odometerAkhir}</p> : <p className="mt-1 text-[10px] text-muted-foreground">Harus ≥ odometer awal.</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                  <textarea value={editForm.catatan} onChange={(e) => setEditForm((p) => ({ ...p, catatan: e.target.value }))} rows={3} placeholder="Alasan koreksi, opsional..." className="w-full resize-none rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
                </div>
                <div className={cn("rounded-xl border p-3", editPreview == null ? "border-border bg-muted/20" : "border-primary/20 bg-primary/5")}>
                  <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" /> Jarak baru (otomatis)</p>
                  <p className={cn("mt-1 text-xl font-bold tabular-nums", editPreview == null ? "text-muted-foreground" : "text-primary")}>{formatKm(editPreview)}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Dari {editStart != null ? formatKm(editStart, "") : "—"} → {editEnd != null ? formatKm(editEnd, "") : "—"}</p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 px-5 py-4 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={closeEdit} disabled={editSaving}>Batal</Button>
                <Button size="sm" icon={editSaving ? Loader2 : Check} onClick={saveEdit} disabled={editSaving || editStart == null || editEnd == null || editPreview == null}>
                  {editSaving ? "Menyimpan Koreksi..." : "Simpan Koreksi"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ── Delete Confirm (custom, destructive) ── */}
      {deleteTarget && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={closeDelete} />
            <div className="relative w-full max-w-md bg-card shadow-2xl animate-slide-up sm:animate-scale-in overflow-hidden sm:rounded-2xl rounded-t-2xl border border-border">
              <div className="p-6 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10"><Trash2 className="h-7 w-7 text-danger" /></div>
                <h3 className="mt-4 text-base font-bold text-foreground">Hapus Log Odometer?</h3>
                <p className="mt-2 text-sm text-muted-foreground">Tindakan ini tidak dapat dibatalkan.</p>
                <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">{deleteTarget.vehicle_unit}</p>
                      <p className="text-[11px] text-muted-foreground">{deleteTarget.vehicle_jenis} · {formatDateId(deleteTarget.tanggal)}</p>
                    </div>
                    <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success border border-success/20">Terbaru</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-card border border-border p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Awal</p>
                      <p className="text-xs font-bold tabular-nums text-foreground">{formatKm(deleteTarget.odometer_awal, "")}</p>
                    </div>
                    <div className="rounded-lg bg-card border border-border p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Akhir</p>
                      <p className="text-xs font-bold tabular-nums text-foreground">{formatKm(deleteTarget.odometer_akhir, "")}</p>
                    </div>
                    <div className="rounded-lg bg-primary/10 border border-primary/15 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Jarak</p>
                      <p className="text-xs font-bold tabular-nums text-primary">{formatKm(deleteTarget.jarak_km)}</p>
                    </div>
                  </div>
                  {deleteTarget.catatan && <p className="mt-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Catatan:</span> {deleteTarget.catatan}</p>}
                  <p className="mt-3 flex gap-1.5 text-[11px] text-danger bg-danger-light border border-danger/15 rounded-lg px-2.5 py-2"><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />Odometer kendaraan akan kembali ke log sebelumnya.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={closeDelete} disabled={deleting}>Batal</Button>
                <Button variant="danger" size="sm" icon={deleting ? Loader2 : Trash2} className="flex-1" onClick={confirmDelete} disabled={deleting}>
                  {deleting ? "Menghapus..." : "Hapus Log"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </RouteGuard>
  );
}
