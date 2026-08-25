"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Edit2,
  FileDown,
  FileSpreadsheet,
  Gauge,
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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("Semua");
  const [startDate, setStartDate] = useState(monthStartInput());
  const [endDate, setEndDate] = useState(localDateInput());
  const [editingLogId, setEditingLogId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const permissionLevel = getPermissionLevel("vehicle-odometer");
  const canManage = permissionLevel === "edit" || hasPermission("vehicle-odometer.manage");
  const canView = canManage || permissionLevel === "view" || permissionLevel === "input";

  const showToast = useCallback((type: Toast["type"], title: string, message?: string) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchVehicles = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_vehicle_odometer_vehicles");
    if (error) throw error;
    setVehicles(((data as Record<string, unknown>[] | null) ?? []).map(normalizeVehicle));
  }, []);

  const fetchLogs = useCallback(async () => {
    const params = mode === "laporan"
      ? {
          p_vehicle_id: vehicleFilter === "Semua" ? null : Number(vehicleFilter),
          p_start_date: startDate || null,
          p_end_date: endDate || null,
        }
      : { p_vehicle_id: null, p_start_date: null, p_end_date: null };
    const { data, error } = await supabase.rpc("get_vehicle_odometer_logs", params);
    if (error) throw error;
    setLogs(((data as Record<string, unknown>[] | null) ?? []).map(normalizeLog));
  }, [endDate, mode, startDate, vehicleFilter]);

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

  const formStart = parseOdometerInput(form.odometerAwal);
  const formEnd = parseOdometerInput(form.odometerAkhir);
  const previewDistance = calculateDistance(formStart, formEnd);
  const firstLogForVehicle = selectedVehicle?.last_odometer == null && !editingLogId;
  const startLocked = !firstLogForVehicle;

  const resetForm = () => {
    setEditingLogId(null);
    setForm(emptyForm());
  };

  const saveLog = async () => {
    if (!canManage) return;
    if (!form.vehicleId || !form.tanggal) {
      showToast("error", "Form belum lengkap", "Kendaraan dan tanggal wajib diisi.");
      return;
    }
    if (formEnd == null) {
      showToast("error", "Odometer akhir tidak valid", "Masukkan angka odometer akhir yang benar.");
      return;
    }
    if (formStart == null) {
      showToast("error", "Odometer awal tidak valid", "Untuk log pertama, odometer awal wajib diisi.");
      return;
    }
    if (previewDistance == null) {
      showToast("error", "Jarak tidak valid", "Odometer akhir tidak boleh lebih kecil dari odometer awal.");
      return;
    }

    setSaving(true);
    try {
      if (editingLogId) {
        const { error } = await supabase.rpc("update_vehicle_odometer_log", {
          p_log_id: editingLogId,
          p_tanggal: form.tanggal,
          p_odometer_akhir: formEnd,
          p_catatan: form.catatan || null,
        });
        if (error) throw error;
        showToast("success", "Log diperbarui", "Koreksi odometer berhasil disimpan.");
      } else {
        const { error } = await supabase.rpc("create_vehicle_odometer_log", {
          p_vehicle_id: Number(form.vehicleId),
          p_tanggal: form.tanggal,
          p_odometer_awal: formStart,
          p_odometer_akhir: formEnd,
          p_catatan: form.catatan || null,
        });
        if (error) throw error;
        showToast("success", "Log tersimpan", "Jarak otomatis sudah dihitung dan disimpan.");
      }
      resetForm();
      await loadData();
    } catch (err) {
      showToast("error", "Gagal menyimpan", err instanceof Error ? err.message : "Coba ulangi input odometer.");
    } finally {
      setSaving(false);
    }
  };

  const editLog = (log: DbVehicleOdometerLog) => {
    setEditingLogId(log.id);
    setForm({
      vehicleId: String(log.vehicle_id),
      tanggal: log.tanggal,
      odometerAwal: String(log.odometer_awal),
      odometerAkhir: String(log.odometer_akhir),
      catatan: log.catatan ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteLog = async (log: DbVehicleOdometerLog) => {
    if (!canManage) return;
    const ok = window.confirm(`Hapus log odometer ${log.vehicle_unit} tanggal ${formatDateId(log.tanggal)}?`);
    if (!ok) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("delete_vehicle_odometer_log", { p_log_id: log.id });
      if (error) throw error;
      showToast("success", "Log dihapus", "Odometer terbaru kendaraan sudah dikembalikan ke log sebelumnya.");
      if (editingLogId === log.id) resetForm();
      await loadData();
    } catch (err) {
      showToast("error", "Gagal menghapus", err instanceof Error ? err.message : "Hanya log terbaru kendaraan yang bisa dihapus.");
    } finally {
      setSaving(false);
    }
  };

  const exportRows = () => [
    ["Laporan Odometer Kendaraan"],
    ["Periode", startDate ? formatDateId(startDate) : "Semua", "s/d", endDate ? formatDateId(endDate) : "Semua"],
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
      doc.text(`Periode: ${startDate ? formatDateId(startDate) : "Semua"} s/d ${endDate ? formatDateId(endDate) : "Semua"}`, pageWidth / 2, 20, { align: "center" });
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

  const renderTable = (showActions: boolean) => (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
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
              <tr><td colSpan={showActions ? 8 : 7} className="px-4 py-12 text-center text-muted-foreground">Memuat data...</td></tr>
            ) : pagedLogs.length === 0 ? (
              <tr><td colSpan={showActions ? 8 : 7} className="px-4 py-12 text-center text-muted-foreground">Belum ada data odometer.</td></tr>
            ) : (
              pagedLogs.map((log) => (
                <tr key={log.id} className="hover:bg-muted/20">
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-foreground">{formatDateId(log.tanggal)}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-foreground">{log.vehicle_unit}</div>
                    <div className="text-[10px] text-muted-foreground">{log.vehicle_jenis}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatKm(log.odometer_awal, "")}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatKm(log.odometer_akhir, "")}</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums text-primary">{formatKm(log.jarak_km)}</td>
                  <td className="max-w-[260px] px-3 py-2.5 text-muted-foreground">{log.catatan || "-"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{log.created_by_nama || "-"}</td>
                  {showActions && (
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => editLog(log)}
                          disabled={!log.is_latest || saving}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                          title={log.is_latest ? "Edit" : "Hanya log terbaru yang bisa diedit"}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteLog(log)}
                          disabled={!log.is_latest || saving}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-danger-light hover:text-danger disabled:cursor-not-allowed disabled:opacity-35"
                          title={log.is_latest ? "Hapus" : "Hanya log terbaru yang bisa dihapus"}
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
      {searchableLogs.length > PAGE_SIZE && (
        <Pagination currentPage={page} totalItems={searchableLogs.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}
    </div>
  );

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
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-foreground">{editingLogId ? "Koreksi Log Terbaru" : "Input Log Baru"}</h2>
                  <p className="text-[11px] text-muted-foreground">Log pertama memakai odometer awal manual; log berikutnya otomatis dari odometer akhir terakhir.</p>
                </div>
                {editingLogId && <Button variant="outline" size="sm" icon={X} onClick={resetForm}>Batal Edit</Button>}
              </div>
              <div className="grid gap-3 lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Kendaraan</label>
                  <Select
                    value={form.vehicleId}
                    onChange={(value) => {
                      const nextVehicle = vehicles.find((vehicle) => String(vehicle.id) === value);
                      setForm((prev) => ({
                        ...prev,
                        vehicleId: value,
                        odometerAwal: editingLogId ? prev.odometerAwal : nextVehicle?.last_odometer == null ? "" : String(nextVehicle.last_odometer),
                      }));
                    }}
                    options={[{ value: "", label: "Pilih kendaraan..." }, ...vehicles.map((vehicle) => ({ value: String(vehicle.id), label: `${vehicle.unit} - ${vehicle.jenis}` }))]}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Tanggal</label>
                  <input type="date" value={form.tanggal} onChange={(e) => setForm((prev) => ({ ...prev, tanggal: e.target.value }))} className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Odometer Awal</label>
                  <input
                    value={form.odometerAwal}
                    onChange={(e) => setForm((prev) => ({ ...prev, odometerAwal: e.target.value }))}
                    disabled={startLocked}
                    inputMode="decimal"
                    placeholder={firstLogForVehicle ? "Isi awal" : "Otomatis"}
                    className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-70"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">{firstLogForVehicle ? "Baseline pertama oleh Admin GA." : "Terkunci dari log terakhir."}</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Odometer Akhir</label>
                  <input value={form.odometerAkhir} onChange={(e) => setForm((prev) => ({ ...prev, odometerAkhir: e.target.value }))} inputMode="decimal" placeholder="Contoh: 1250.5" className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
                </div>
                <div className="lg:col-span-4">
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Catatan</label>
                  <input value={form.catatan} onChange={(e) => setForm((prev) => ({ ...prev, catatan: e.target.value }))} placeholder="Opsional" className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
                </div>
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">Jarak Otomatis</p>
                  <p className={cn("mt-1 text-xl font-bold tabular-nums", previewDistance == null ? "text-muted-foreground" : "text-primary")}>{formatKm(previewDistance)}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" onClick={resetForm} disabled={saving}>Reset</Button>
                <Button icon={saving ? Loader2 : Plus} onClick={saveLog} disabled={saving || !form.vehicleId || !form.tanggal || formStart == null || formEnd == null || previewDistance == null}>
                  {saving ? "Menyimpan..." : editingLogId ? "Simpan Koreksi" : "Simpan Log"}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-muted px-3 py-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cari kendaraan atau catatan..." className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60" />
              </div>
              <span className="text-xs text-muted-foreground">{searchableLogs.length} log</span>
            </div>
            {renderTable(true)}
          </>
        )}

        {mode === "laporan" && (
          <>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1.4fr_auto]">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Kendaraan</label>
                  <Select value={vehicleFilter} onChange={(value) => { setVehicleFilter(value); setPage(1); }} options={vehicleOptions} className="w-full" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Tanggal Awal</label>
                  <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Tanggal Akhir</label>
                  <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">Pencarian</label>
                  <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Cari unit, jenis, catatan..." className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60" />
                  </div>
                </div>
                <div className="flex items-end">
                  <Button variant="outline" icon={RefreshCw} onClick={loadData} disabled={loading} className="w-full">Terapkan</Button>
                </div>
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

        {toast && (
          <div className={cn("fixed bottom-4 right-4 z-50 max-w-sm rounded-xl px-4 py-3 text-sm shadow-lg", toast.type === "success" ? "bg-success text-white" : "bg-danger text-white")}>
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p className="font-semibold">{toast.title}</p>
                {toast.message && <p className="mt-0.5 text-xs opacity-90">{toast.message}</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </RouteGuard>
  );
}
