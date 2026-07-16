"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Wallet,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  CircleCheckBig,
  Check,
  Users,
  User,
  GripVertical,
  RotateCcw,
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  MoreVertical,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase, type DbAttendanceRecord, type DbDeliveryPoint, type NonActivePeriod } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import ReportDetail from "./ReportDetail";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type EmployeeLite = {
  id: string;
  nama: string;
  status: string;
  tanggal_bergabung?: string | null;
  tanggal_keluar?: string | null;
  non_active_periods?: NonActivePeriod[] | null;
  jabatanNama?: string | null;
};
type ZoneLite = { id: number; nama: string; color: string };
type StatusLite = { id: number; nama: string; kode: string; color: string };
type DeliveryRow = DbDeliveryPoint & { employeeNama?: string; zoneNama?: string; zoneColor?: string; statusNama?: string; statusColor?: string };
type DeliveryQueryRow = DbDeliveryPoint & {
  pegawai?: { nama: string | null } | null;
  delivery_zones?: { nama: string | null; color: string | null } | null;
  delivery_statuses?: { nama: string | null; kode?: string | null; color: string | null } | null;
};
type QueryError = { message: string };
type EmployeeQueryRow = Omit<EmployeeLite, "jabatanNama"> & { jabatan?: { nama: string | null } | { nama: string | null }[] | null };
type AttendanceStatus = DbAttendanceRecord["status"];
type CalendarAttendanceRow = Pick<DbAttendanceRecord, "id" | "employee_id" | "tanggal" | "status" | "catatan">;
type CalendarEmployee = {
  id: string;
  nama: string;
  status?: string;
  tanggal_bergabung?: string | null;
  tanggal_keluar?: string | null;
  non_active_periods?: NonActivePeriod[] | null;
  jabatanNama?: string | null;
};
type CalendarAnomalyType = "non_present_with_points" | "present_without_points" | "points_without_attendance";
type CalendarAnomaly = { type: CalendarAnomalyType; empId: string; dateStr: string };
type CalendarValidation = {
  attendance: CalendarAttendanceRow | null;
  color: string;
  label: string;
  isAnomaly: boolean;
  anomalyType?: CalendarAnomalyType;
  message?: string;
};

// Batch form row
type BatchRow = {
  rowKey: string;
  /** null = baris kosong (admin belum pilih pegawai). */
  employee_id: string | null;
  /** Display nama (snapshot saat pilih). Empty string = baris kosong. */
  nama: string;
  zone_id: number;
  role: "Driver" | "Helper" | "";
  jumlah_titik: string;
  catatan: string;
  status_id: number;
};

type SingleForm = {
  tanggal: string;
  employee_id: string;
  zone_id: number;
  role: "Driver" | "Helper";
  jumlah_titik: string;
  catatan: string;
  status_id: number;
};

const DEFAULT_BLANK_ROWS = 10;
const ADD_ROWS_BATCH = 5;
const DELIVERY_SELECT = "*, pegawai(nama), delivery_zones(nama, color), delivery_statuses(nama, kode, color)";
const DELIVERY_FETCH_CHUNK_SIZE = 1000;
const ATTENDANCE_FETCH_CHUNK_SIZE = 1000;
const PRESENT_ATTENDANCE_STATUSES: AttendanceStatus[] = ["Hadir", "Terlambat"];
const NON_PRESENT_ATTENDANCE_STATUSES: AttendanceStatus[] = ["Izin", "Sakit", "Alpha", "Libur", "Cuti"];
const ATTENDANCE_STATUS_META: Record<AttendanceStatus, { label: string; color: string; short: string }> = {
  Hadir: { label: "Hadir", color: "#10b981", short: "H" },
  Terlambat: { label: "Terlambat", color: "#f59e0b", short: "T" },
  Izin: { label: "Izin", color: "#3b82f6", short: "I" },
  Sakit: { label: "Sakit", color: "#ef4444", short: "S" },
  Alpha: { label: "Alpa", color: "#6b7280", short: "A" },
  Libur: { label: "Libur", color: "#8b5cf6", short: "L" },
  Cuti: { label: "Cuti", color: "#8b5cf6", short: "C" },
};
const CALENDAR_VALIDATION_JABATAN = new Set(["driver", "helper", "koordinator", "wakil koordinator", "wakir koordinator"]);

const blankRow = (): BatchRow => ({
  rowKey: nextRowKey(),
  employee_id: null,
  nama: "",
  zone_id: 0,
  role: "",
  jumlah_titik: "",
  catatan: "",
  status_id: 0,
});

const blankSingleForm = (): SingleForm => ({
  tanggal: localDateStr(),
  employee_id: "",
  zone_id: 0,
  role: "Driver",
  jumlah_titik: "",
  catatan: "",
  status_id: 0,
});

let rowKeyCounter = 0;
const nextRowKey = () => `row-${++rowKeyCounter}`;

const PAGE_SIZE = 15;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const filterSelectClass = "normal-case tracking-normal";
const tableHeaderFilterClass = "mt-2 min-w-[140px] normal-case tracking-normal";
const CUT_OFF_DAY = 8; // Periode mulai tanggal 8

function parseLocalDateStr(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function hasPointInput(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function parsePointInput(value: string): number {
  return Math.floor(Number(value));
}

function mapDeliveryRow(d: DeliveryQueryRow): DeliveryRow {
  return {
    ...d,
    employeeNama: d.pegawai?.nama || d.employee_nama || d.employee_id || "?",
    zoneNama: d.delivery_zones?.nama || "-",
    zoneColor: d.delivery_zones?.color || "#3b82f6",
    statusNama: d.delivery_statuses?.nama || undefined,
    statusColor: d.delivery_statuses?.color || undefined,
  };
}

function mapEmployeeRow(e: EmployeeQueryRow): EmployeeLite {
  const jabatan = Array.isArray(e.jabatan) ? e.jabatan[0] : e.jabatan;
  return {
    id: e.id,
    nama: e.nama,
    status: e.status,
    tanggal_bergabung: e.tanggal_bergabung || null,
    tanggal_keluar: e.tanggal_keluar || null,
    non_active_periods: e.non_active_periods || [],
    jabatanNama: jabatan?.nama || null,
  };
}

function isCalendarValidationEmployee(emp: Pick<EmployeeLite, "jabatanNama">): boolean {
  const jabatan = (emp.jabatanNama || "").trim().toLowerCase();
  return CALENDAR_VALIDATION_JABATAN.has(jabatan);
}

function isInNonActivePeriod(dateStr: string, periods: NonActivePeriod[] | null | undefined): boolean {
  if (!periods || periods.length === 0) return false;
  return periods.some((p) => dateStr >= p.from && dateStr <= p.to);
}

function isEmployeeActiveOnDate(emp: Pick<EmployeeLite, "tanggal_bergabung" | "tanggal_keluar" | "non_active_periods">, dateStr: string): boolean {
  if (emp.tanggal_bergabung && dateStr < emp.tanggal_bergabung) return false;
  if (emp.tanggal_keluar && dateStr >= emp.tanggal_keluar) return false;
  return !isInNonActivePeriod(dateStr, emp.non_active_periods);
}

async function fetchDeliveryRowsInRange(start: string, end: string, ascending: boolean): Promise<{ data: DeliveryQueryRow[]; error: QueryError | null }> {
  const rows: DeliveryQueryRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("delivery_points")
      .select(DELIVERY_SELECT)
      .gte("tanggal", start)
      .lte("tanggal", end)
      .order("tanggal", { ascending })
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

async function fetchAttendanceRowsInRange(start: string, end: string): Promise<{ data: CalendarAttendanceRow[]; error: QueryError | null }> {
  const rows: CalendarAttendanceRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("id, employee_id, tanggal, status, catatan")
      .gte("tanggal", start)
      .lte("tanggal", end)
      .order("tanggal", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + ATTENDANCE_FETCH_CHUNK_SIZE - 1);

    if (error) return { data: rows, error };

    const pageRows = (data || []) as CalendarAttendanceRow[];
    rows.push(...pageRows);

    if (pageRows.length < ATTENDANCE_FETCH_CHUNK_SIZE) break;
    from += ATTENDANCE_FETCH_CHUNK_SIZE;
  }

  return { data: rows, error: null };
}

/** Hitung periode tutup buku: tgl 8 bulan ini s/d tgl 7 bulan berikutnya */
function getPeriodRange(periodKey: string): { start: string; end: string; label: string } {
  const [year, month] = periodKey.split("-").map(Number);
  // Periode: tgl 8 bulan ini → tgl 7 bulan berikutnya
  const startDate = new Date(year, month - 1, CUT_OFF_DAY); // tgl 8
  const endDate = new Date(year, month, CUT_OFF_DAY - 1); // tgl 7 bulan berikutnya
  const start = localDateStr(startDate);
  const end = localDateStr(endDate);
  const label = `${CUT_OFF_DAY} ${startDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })} – ${CUT_OFF_DAY - 1} ${endDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
  return { start, end, label };
}

/** Tentukan periode aktif berdasarkan tanggal hari ini */
function getCurrentPeriodKey(): string {
  const now = new Date();
  // Jika hari ini < tgl 8, berarti masih periode bulan lalu
  if (now.getDate() < CUT_OFF_DAY) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function IncomePage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("income");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | "Driver" | "Helper">("");
  const [periodKey, setPeriodKey] = useState(getCurrentPeriodKey);
  const period = getPeriodRange(periodKey);

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [employeeMeta, setEmployeeMeta] = useState<EmployeeLite[]>([]);
  const [zones, setZones] = useState<ZoneLite[]>([]);
  const [dStatuses, setDStatuses] = useState<StatusLite[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  // ─── Calendar Mode ───
  const [showCalendar, setShowCalendar] = useState(false);
  const [calMonth, setCalMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [calAttendance, setCalAttendance] = useState<CalendarAttendanceRow[]>([]);
  const [calendarValidationEnabled, setCalendarValidationEnabled] = useState(true);
  const [calendarCompactCells, setCalendarCompactCells] = useState(true);
  const [hideNonValidationRoles, setHideNonValidationRoles] = useState(false);
  const [emptyNavIdx, setEmptyNavIdx] = useState(-1);
  const [statusNavIdx, setStatusNavIdx] = useState<Map<string, number>>(new Map());
  const [anomalyNavIdx, setAnomalyNavIdx] = useState<Map<string, number>>(new Map());

  // Calendar cell edit
  const [calEditCell, setCalEditCell] = useState<{ empId: string; empNama: string; dateStr: string } | null>(null);
  const [calEditEntries, setCalEditEntries] = useState<{ id: number | null; zone_id: number; role: string; jumlah_titik: string; status_id: number; catatan: string }[]>([]);
  const [calEditSaving, setCalEditSaving] = useState(false);

  // ─── Batch Input State ───
  const [showBatch, setShowBatch] = useState(false);
  const [batchDate, setBatchDate] = useState(() => localDateStr());
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<{ newRows: Record<string, unknown>[]; updateRows: { id: number; data: Record<string, unknown> }[]; dupCount: number }>({ newRows: [], updateRows: [], dupCount: 0 });
  const [dbDuplicateRowKeys, setDbDuplicateRowKeys] = useState<Set<string>>(new Set());

  // ─── Single Input State ───
  const [showSingleForm, setShowSingleForm] = useState(false);
  const [singleForm, setSingleForm] = useState<SingleForm>(() => blankSingleForm());
  const [singleSaving, setSingleSaving] = useState(false);
  const [singleError, setSingleError] = useState("");

  // ─── Edit single row ───
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ zone_id: 0, role: "Driver", jumlah_titik: "", status_id: 0, catatan: "" });
  const [editError, setEditError] = useState("");

  const [showReport, setShowReport] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; nama: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from("pegawai")
      .select("id, nama, status, tanggal_bergabung, tanggal_keluar, non_active_periods, jabatan:jabatan_id(nama)")
      .in("status", ["Aktif", "Training"])
      .order("nama");
    if (error) { showToast("error", "Gagal Memuat Pegawai", error.message); return; }
    if (data) setEmployees((data as unknown as EmployeeQueryRow[]).map(mapEmployeeRow));
  };

  const fetchEmployeeMeta = async () => {
    const { data, error } = await supabase
      .from("pegawai")
      .select("id, nama, status, tanggal_bergabung, tanggal_keluar, non_active_periods, jabatan:jabatan_id(nama)")
      .order("nama");
    if (error) { showToast("error", "Gagal Memuat Metadata Pegawai", error.message); return; }
    if (data) setEmployeeMeta((data as unknown as EmployeeQueryRow[]).map(mapEmployeeRow));
  };

  const fetchZones = async () => {
    const { data, error } = await supabase.from("delivery_zones").select("id, nama, color").eq("status", "Aktif").order("nama");
    if (error) { showToast("error", "Gagal Memuat Nama Titik", error.message); return; }
    if (data) setZones(data);
  };

  const fetchDStatuses = async () => {
    const { data, error } = await supabase.from("delivery_statuses").select("id, nama, kode, color").eq("status", "Aktif").order("nama");
    if (error) { showToast("error", "Gagal Memuat Status", error.message); return; }
    if (data) setDStatuses(data);
  };

  const fetchDeliveries = async () => {
    const { data, error } = await fetchDeliveryRowsInRange(period.start, period.end, false);
    if (error) { showToast("error", "Gagal Memuat Data Titik", error.message); return; }
    if (data) {
      const mapped = data.map(mapDeliveryRow);
      mapped.sort((a, b) => {
        const dateCompare = b.tanggal.localeCompare(a.tanggal);
        if (dateCompare !== 0) return dateCompare;
        return a.id - b.id;
      });
      setDeliveries(mapped);
    }
  };

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchEmployeeMeta(), fetchZones(), fetchDStatuses(), fetchDeliveries()]).then(() => setLoading(false));
  }, []);

  useEffect(() => { fetchDeliveries(); }, [periodKey]);

  useEffect(() => {
    if (showBatch || showSingleForm || showEditForm || showCalendar || showReport) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showBatch, showSingleForm, showEditForm, showCalendar, showReport]);

  // ─── Single input handlers ───
  const openSingle = () => {
    setSingleForm(blankSingleForm());
    setSingleError("");
    setShowSingleForm(true);
  };

  const handleSingleSave = async () => {
    if (!singleForm.tanggal || !singleForm.employee_id || !singleForm.zone_id || !singleForm.role || !hasPointInput(singleForm.jumlah_titik)) return;
    setSingleSaving(true);
    setSingleError("");

    try {
      const employee = employees.find((e) => e.id === singleForm.employee_id);
      if (!employee) {
        setSingleError("Pegawai tidak ditemukan.");
        return;
      }

      const { data: existing, error: duplicateError } = await supabase
        .from("delivery_points")
        .select("id")
        .eq("employee_id", singleForm.employee_id)
        .eq("tanggal", singleForm.tanggal)
        .eq("zone_id", singleForm.zone_id)
        .eq("role", singleForm.role)
        .limit(1);

      if (duplicateError) {
        showToast("error", "Gagal Cek Duplikat", duplicateError.message);
        return;
      }
      if (existing && existing.length > 0) {
        setSingleError("Data pegawai dengan tanggal, nama titik, dan posisi ini sudah ada.");
        return;
      }

      const { data: rateData, error: rateError } = await supabase
        .from("point_rates")
        .select("rate_per_point")
        .eq("zone_id", singleForm.zone_id)
        .eq("role", singleForm.role)
        .eq("status", "Aktif")
        .maybeSingle();

      if (rateError) {
        showToast("error", "Gagal Mengambil Tarif", rateError.message);
        return;
      }
      if (!rateData) {
        setSingleError("Tarif aktif untuk nama titik dan posisi ini belum tersedia.");
        return;
      }

      const payload = {
        employee_id: employee.id,
        employee_nama: employee.nama,
        zone_id: singleForm.zone_id,
        role: singleForm.role,
        tanggal: singleForm.tanggal,
        jumlah_titik: parsePointInput(singleForm.jumlah_titik),
        rate_per_point: rateData.rate_per_point,
        catatan: singleForm.catatan || null,
        status_id: singleForm.status_id || null,
      };

      const { data: inserted, error: insertError } = await supabase
        .from("delivery_points")
        .insert(payload)
        .select(DELIVERY_SELECT)
        .single();

      if (insertError || !inserted) {
        showToast("error", "Gagal Menyimpan", insertError?.message || "Gagal mendapat data terbaru.");
        return;
      }

      await logAudit({
        supabase,
        action: "manual_input",
        entityType: "delivery_points",
        entityId: inserted.id,
        entityLabel: `Rekap titik ${employee.nama} (${singleForm.tanggal})`,
        newData: payload as unknown as Record<string, unknown>,
      });

      setShowSingleForm(false);
      await fetchDeliveries();
      showToast("success", "Input Titik Berhasil", "1 data pegawai berhasil disimpan.");
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Gagal menyimpan data.");
    } finally {
      setSingleSaving(false);
    }
  };

  // Batch mobile filter tab
  const [batchTab, setBatchTab] = useState<"semua" | "terisi" | "kosong">("semua");

  // ─── Batch handlers ───
  const openBatch = () => {
    setBatchDate(localDateStr());
    // Pre-populate dengan semua pegawai aktif, satu baris per nama
    setBatchRows(employees.map((e) => ({
      rowKey: nextRowKey(),
      employee_id: e.id,
      nama: e.nama,
      zone_id: 0,
      role: "",
      jumlah_titik: "",
      catatan: "",
      status_id: 0,
    })));
    setBatchTab("semua");
    setBatchSearch("");
    setDragIdx(null);
    setDragOverIdx(null);
    setDbDuplicateRowKeys(new Set());
    setShowBatch(true);
  };

  /** Pilih pegawai di baris kosong / ganti pegawai di baris terisi. */
  const handleEmployeeChange = (rowKey: string, employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    setBatchRows((prev) => prev.map((r) =>
      r.rowKey === rowKey
        ? { ...r, employee_id: emp.id, nama: emp.nama }
        : r,
    ));
  };

  const handleBatchRowChange = (rowKey: string, field: "zone_id" | "role" | "jumlah_titik" | "catatan" | "status_id", value: string | number) => {
    setBatchRows((prev) => prev.map((r) => r.rowKey === rowKey ? { ...r, [field]: value } : r));
    // Reset tanda duplikat DB saat user ubah nama titik atau posisi
    if ((field === "zone_id" || field === "role") && dbDuplicateRowKeys.has(rowKey)) {
      setDbDuplicateRowKeys((prev) => { const n = new Set(prev); n.delete(rowKey); return n; });
    }
  };

  /** Tambah n baris kosong di akhir tabel. */
  const addBlankRows = (count: number) => {
    setBatchRows((prev) => [...prev, ...Array.from({ length: count }, () => blankRow())]);
  };

  /** Tambah sub-baris untuk pegawai yang sama (untuk entri kedua dst). */
  const addSubRow = (sourceRowKey: string) => {
    const source = batchRows.find((r) => r.rowKey === sourceRowKey);
    if (!source || !source.employee_id) return;
    const newRow: BatchRow = {
      rowKey: nextRowKey(),
      employee_id: source.employee_id,
      nama: source.nama,
      zone_id: 0,
      role: "",
      jumlah_titik: "",
      catatan: "",
      status_id: 0,
    };
    setBatchRows((prev) => {
      const idx = prev.findIndex((r) => r.rowKey === sourceRowKey);
      const copy = [...prev];
      copy.splice(idx + 1, 0, newRow);
      return copy;
    });
  };

  /** Hapus 1 baris (kapan saja, tanpa syarat). */
  const removeRow = (rowKey: string) => {
    setBatchRows((prev) => {
      // Pastikan minimal selalu ada 1 baris
      if (prev.length <= 1) {
        return [blankRow()];
      }
      return prev.filter((r) => r.rowKey !== rowKey);
    });
    if (dbDuplicateRowKeys.has(rowKey)) {
      setDbDuplicateRowKeys((prev) => { const n = new Set(prev); n.delete(rowKey); return n; });
    }
  };

  /** Hapus semua baris yang masih kosong (belum pilih pegawai dan belum input apapun). */
  const removeBlankRows = () => {
    setBatchRows((prev) => {
      const filtered = prev.filter((r) => r.employee_id || r.zone_id || r.role || r.jumlah_titik);
      return filtered.length === 0 ? [blankRow()] : filtered;
    });
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    // Buat drag ghost transparan agar tidak mengganggu
    const ghost = document.createElement("div");
    ghost.style.opacity = "0";
    ghost.style.position = "absolute";
    ghost.style.top = "-9999px";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    setBatchRows((prev) => {
      const arr = [...prev];
      const [moved] = arr.splice(dragIdx, 1);
      arr.splice(idx, 0, moved);
      return arr;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const hasBatchData = batchRows.some((r) => r.employee_id || r.jumlah_titik || r.zone_id || r.role);

  const tryCloseBatch = () => {
    if (hasBatchData) {
      setShowCloseConfirm(true);
    } else {
      setShowBatch(false);
    }
  };

  const confirmCloseBatch = () => {
    setShowCloseConfirm(false);
    setShowBatch(false);
  };

  const prepareBatchData = async () => {
    // Worksheet: skip baris kosong/incomplete
    const validRows = batchRows.filter((r) =>
      r.employee_id &&
      hasPointInput(r.jumlah_titik) &&
      r.zone_id && r.role,
    );
    if (validRows.length === 0 || !batchDate) return null;

    // Lookup rates
    const { data: allRates } = await supabase.from("point_rates").select("zone_id, role, rate_per_point").eq("status", "Aktif");
    const rateMap = new Map<string, number>();
    allRates?.forEach((r) => rateMap.set(`${r.zone_id}-${r.role}`, r.rate_per_point));

    // Check existing data for this date
    const { data: existing } = await supabase.from("delivery_points").select("id, employee_id, zone_id, role").eq("tanggal", batchDate);
    const existingMap = new Map<string, number>();
    existing?.forEach((e) => existingMap.set(`${e.employee_id}-${e.zone_id}-${e.role}`, e.id));

    const newRows: Record<string, unknown>[] = [];
    const updateRows: { id: number; data: Record<string, unknown> }[] = [];
    const dupRowKeys: string[] = [];

    validRows.forEach((r) => {
      const key = `${r.employee_id}-${r.zone_id}-${r.role}`;
      const rate = rateMap.get(`${r.zone_id}-${r.role}`) || 0;
      const payload = {
        employee_id: r.employee_id,
        employee_nama: r.nama,
        zone_id: r.zone_id,
        role: r.role,
        tanggal: batchDate,
        jumlah_titik: parsePointInput(r.jumlah_titik),
        rate_per_point: rate,
        catatan: r.catatan || null,
        status_id: r.status_id || null,
      };

      const existingId = existingMap.get(key);
      if (existingId) {
        updateRows.push({ id: existingId, data: { jumlah_titik: payload.jumlah_titik, rate_per_point: payload.rate_per_point, catatan: payload.catatan, status_id: payload.status_id } });
        dupRowKeys.push(r.rowKey);
      } else {
        newRows.push(payload);
      }
    });

    return { newRows, updateRows, dupCount: updateRows.length, dupRowKeys };
  };

  const handleBatchSave = async () => {
    if (!batchDate) return;
    setBatchSaving(true);

    const result = await prepareBatchData();
    if (!result) { setBatchSaving(false); return; }

    // Jika ada duplikat, tandai baris dan tampilkan konfirmasi
    if (result.dupCount > 0) {
      setDuplicateInfo(result);
      setDbDuplicateRowKeys(new Set(result.dupRowKeys));
      setBatchSaving(false);
      setShowDuplicateConfirm(true);
      return;
    }

    // Tidak ada duplikat, langsung simpan
    await executeBatchSave(result.newRows, result.updateRows);
    setShowBatch(false);
    await fetchDeliveries();
  };

  const executeBatchSave = async (newRows: Record<string, unknown>[], updateRows: { id: number; data: Record<string, unknown> }[]) => {
    setBatchSaving(true);

    try {
      // Insert new rows
      if (newRows.length > 0) {
        const { error } = await supabase.from("delivery_points").insert(newRows);
        if (error) { showToast("error", "Gagal Menyimpan", error.message); setBatchSaving(false); return; }
      }

      // Update existing rows
      let updateErrors = 0;
      for (const row of updateRows) {
        const { error } = await supabase.from("delivery_points").update(row.data).eq("id", row.id);
        if (error) updateErrors++;
      }

      setBatchSaving(false);
      const total = newRows.length + updateRows.length;
      if (updateErrors > 0) {
        showToast("error", "Sebagian Gagal", `${updateErrors} dari ${updateRows.length} data gagal diperbarui.`);
      } else {
        const msg = updateRows.length > 0
          ? `${newRows.length} data baru disimpan, ${updateRows.length} data diperbarui.`
          : `${total} data pegawai berhasil disimpan.`;
        showToast("success", "Input Titik Berhasil", msg);
        // Audit log: input titik (batch). Tidak per-row supaya ringkas dan
        // tidak overload audit_logs untuk batch besar.
        const tanggalSet = new Set<string>();
        newRows.forEach((r) => { if (r.tanggal) tanggalSet.add(String(r.tanggal)); });
        updateRows.forEach((r) => {
          if ("tanggal" in r.data && r.data.tanggal) tanggalSet.add(String(r.data.tanggal));
        });
        const tanggalList = Array.from(tanggalSet).sort();
        await logAudit({
          supabase,
          action: newRows.length > 0 && updateRows.length === 0 ? "manual_input" : "update",
          entityType: "delivery_points",
          entityLabel: tanggalList.length === 1
            ? `Input rekap titik ${tanggalList[0]}`
            : `Input rekap titik ${tanggalList.length} tanggal`,
          metadata: {
            tanggal: tanggalList.length === 1 ? tanggalList[0] : tanggalList,
            jumlah_baru: newRows.length,
            jumlah_diperbarui: updateRows.length,
            total: newRows.length + updateRows.length,
          },
        });
      }
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Gagal menyimpan data.");
      setBatchSaving(false);
    }
  };

  // ─── Edit single ───
  const openEdit = (row: DeliveryRow) => {
    setEditForm({
      zone_id: row.zone_id,
      role: row.role,
      jumlah_titik: String(row.jumlah_titik),
      status_id: row.status_id || 0,
      catatan: row.catatan || "",
    });
    setEditError("");
    setEditingId(row.id);
    setShowEditForm(true);
  };

  const handleEditSave = async () => {
    if (!editingId || !hasPointInput(editForm.jumlah_titik) || !editForm.zone_id) return;
    setEditError("");
    const row = deliveries.find((d) => d.id === editingId);
    if (!row) return;

    // Cek duplikat: apakah ada data lain dengan pegawai + nama titik + posisi + tanggal yang sama
    let dupQuery = supabase
      .from("delivery_points")
      .select("id")
      .eq("zone_id", editForm.zone_id)
      .eq("role", editForm.role)
      .eq("tanggal", row.tanggal)
      .neq("id", editingId)
      .limit(1);
    dupQuery = row.employee_id ? dupQuery.eq("employee_id", row.employee_id) : dupQuery.is("employee_id", null);
    const { data: existing } = await dupQuery;

    if (existing && existing.length > 0) {
      setEditError(`Data ${row.employeeNama} dengan nama titik dan posisi ini sudah ada di tanggal ${row.tanggal}.`);
      return;
    }

    // Re-lookup rate
    const { data: rateData } = await supabase.from("point_rates").select("rate_per_point").eq("zone_id", editForm.zone_id).eq("role", editForm.role).eq("status", "Aktif").single();

    const updatePayload = {
      zone_id: editForm.zone_id,
      role: editForm.role,
      jumlah_titik: parsePointInput(editForm.jumlah_titik),
      rate_per_point: rateData?.rate_per_point || row.rate_per_point,
      status_id: editForm.status_id || null,
      catatan: editForm.catatan || null,
    };

    const { data: updated, error: updateError } = await supabase
      .from("delivery_points")
      .update(updatePayload)
      .eq("id", editingId)
      .select("*, pegawai(nama), delivery_zones(nama, color), delivery_statuses(nama, kode, color)")
      .single();

    if (updateError || !updated) {
      showToast("error", "Gagal Memperbarui", updateError?.message || "Gagal mendapat data terbaru.");
      return;
    }

    // Update state lokal langsung tanpa re-fetch (menjaga urutan)
    const mappedRow: DeliveryRow = {
      ...updated,
      employeeNama: updated.pegawai?.nama || updated.employee_nama || updated.employee_id || "?",
      zoneNama: updated.delivery_zones?.nama || "-",
      zoneColor: updated.delivery_zones?.color || "#3b82f6",
      statusNama: updated.delivery_statuses?.nama || undefined,
      statusColor: updated.delivery_statuses?.color || undefined,
    };
    setDeliveries((prev) => prev.map((d) => d.id === editingId ? mappedRow : d));

    await logAudit({
      supabase,
      action: "update",
      entityType: "delivery_points",
      entityId: editingId,
      entityLabel: `Rekap titik ${row.employeeNama} (${row.tanggal})`,
      oldData: { ...row } as unknown as Record<string, unknown>,
      newData: { ...row, ...updatePayload } as unknown as Record<string, unknown>,
    });
    showToast("success", "Data Diperbarui", "Input titik telah disimpan.");
    setShowEditForm(false);
  };

  // ─── Delete ───
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const targetId = deleteConfirm.id;
    setDeleting(true);
    try {
      const oldRow = deliveries.find((d) => d.id === targetId);
      const { error } = await supabase.from("delivery_points").delete().eq("id", targetId);
      if (error) {
        showToast("error", "Gagal Menghapus", error.message);
        return;
      }
      await logAudit({
        supabase,
        action: "delete",
        entityType: "delivery_points",
        entityId: targetId,
        entityLabel: oldRow ? `Rekap titik ${oldRow.employeeNama} (${oldRow.tanggal})` : `Rekap titik #${targetId}`,
        oldData: oldRow ? { ...oldRow } as unknown as Record<string, unknown> : null,
      });
      // Hapus dari state lokal langsung (menjaga urutan)
      setDeliveries((prev) => prev.filter((d) => d.id !== targetId));
      showToast("success", "Data Dihapus", "Input titik telah dihapus.");
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Gagal menghapus data.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  // ─── Filter & paginate ───
  const getEmployeeFilterKey = (d: DeliveryRow) => d.employee_id || `_deleted_${d.employeeNama || d.id}`;
  const employeeFilterOptions = Array.from(new Map(deliveries.map((d) => [getEmployeeFilterKey(d), d.employeeNama || d.employee_id || "?"])).entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const zoneFilterOptions = Array.from(new Map(deliveries.map((d) => [String(d.zone_id), d.zoneNama || "-"])).entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const employeeDropdownOptions = [{ value: "", label: "Semua pegawai" }, ...employeeFilterOptions];
  const zoneDropdownOptions = [{ value: "", label: "Semua nama titik" }, ...zoneFilterOptions];
  const roleDropdownOptions = [{ value: "", label: "Semua posisi" }, { value: "Driver", label: "Driver" }, { value: "Helper", label: "Helper" }];
  const searchTerm = search.trim().toLowerCase();
  const hasColumnFilters = !!employeeFilter || !!zoneFilter || !!roleFilter;
  const resetColumnFilters = () => {
    setEmployeeFilter("");
    setZoneFilter("");
    setRoleFilter("");
    setPage(1);
  };
  const filtered = deliveries.filter((d) => {
    const matchesSearch = !searchTerm ||
      (d.employeeNama || "").toLowerCase().includes(searchTerm) ||
      (d.employee_id || "").toLowerCase().includes(searchTerm) ||
      (d.zoneNama || "").toLowerCase().includes(searchTerm) ||
      d.role.toLowerCase().includes(searchTerm);
    const matchesEmployee = !employeeFilter || getEmployeeFilterKey(d) === employeeFilter;
    const matchesZone = !zoneFilter || String(d.zone_id) === zoneFilter;
    const matchesRole = !roleFilter || d.role === roleFilter;
    return matchesSearch && matchesEmployee && matchesZone && matchesRole;
  });
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Summary
  const totalTitik = deliveries.reduce((s, d) => s + d.jumlah_titik, 0);
  const totalPendapatan = deliveries.reduce((s, d) => s + d.total, 0);
  const totalEntri = deliveries.length;

  // Batch filtered (search by nama + mobile tab)
  const batchFiltered = batchRows.filter((r) => {
    if (batchSearch && !r.nama.toLowerCase().includes(batchSearch.toLowerCase())) return false;
    if (batchTab === "terisi") return !!(r.zone_id || r.role || hasPointInput(r.jumlah_titik));
    if (batchTab === "kosong") return !(r.zone_id || r.role || hasPointInput(r.jumlah_titik));
    return true;
  });
  const batchFilled = batchRows.filter((r) => r.employee_id && hasPointInput(r.jumlah_titik) && r.zone_id && r.role).length;
  // Baris yang setengah terisi (ada salah satu field tapi tidak lengkap)
  const batchIncomplete = batchRows.filter((r) => {
    const hasEmp = !!r.employee_id;
    const hasTitik = hasPointInput(r.jumlah_titik);
    const hasDiv = !!r.zone_id;
    const hasRole = !!r.role;
    const touched = hasEmp || hasTitik || hasDiv || hasRole;
    const complete = hasEmp && hasTitik && hasDiv && hasRole;
    return touched && !complete;
  });
  // Deteksi duplikat: pegawai + nama titik + role yang sama (skip baris yang belum pilih pegawai)
  const batchDuplicateKeys = new Set<string>();
  const seenCombos = new Map<string, string>(); // combo -> rowKey pertama
  batchRows.forEach((r) => {
    if (!r.employee_id || !r.zone_id || !r.role) return;
    const combo = `${r.employee_id}-${r.zone_id}-${r.role}`;
    if (seenCombos.has(combo)) {
      batchDuplicateKeys.add(r.rowKey);
      batchDuplicateKeys.add(seenCombos.get(combo)!);
    } else {
      seenCombos.set(combo, r.rowKey);
    }
  });
  const batchCanSave = batchFilled > 0 && batchIncomplete.length === 0 && batchDuplicateKeys.size === 0 && !!batchDate;
  const singleCanSave = !!singleForm.tanggal && !!singleForm.employee_id && !!singleForm.zone_id && !!singleForm.role && hasPointInput(singleForm.jumlah_titik);

  // ─── Calendar data (periode tutup buku) ───
  const calPeriod = getPeriodRange(calMonth);
  // Generate array of dates for the period (tgl 8 bulan ini s/d tgl 7 bulan berikutnya)
  const calDateList: Date[] = [];
  {
    const startD = parseLocalDateStr(calPeriod.start);
    const endD = parseLocalDateStr(calPeriod.end);
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
      calDateList.push(new Date(d));
    }
  }

  // Filter deliveries for calendar period
  const calDeliveries = deliveries.filter((d) => d.tanggal >= calPeriod.start && d.tanggal <= calPeriod.end);
  const employeeMetaMap = new Map(employeeMeta.map((e) => [e.id, e]));
  const calAttendanceMap = new Map<string, CalendarAttendanceRow>();
  calAttendance.forEach((a) => calAttendanceMap.set(`${a.employee_id}-${a.tanggal}`, a));

  // Group: employee -> dateStr -> entries[]
  // Gunakan employee_id jika ada, fallback ke employee_nama untuk pegawai yang sudah dihapus
  const calEmployeeKeys = [...new Set(calDeliveries.map((d) => d.employee_id || `_deleted_${d.employee_nama || d.id}`))];
  const allCalEmployees: CalendarEmployee[] = calEmployeeKeys.map((key) => {
    const emp = employeeMetaMap.get(key) || employees.find((e) => e.id === key);
    if (emp) return { ...emp, id: key, nama: emp.nama };
    // Pegawai sudah dihapus — ambil nama dari delivery data
    const delivery = calDeliveries.find((d) => (d.employee_id || `_deleted_${d.employee_nama || d.id}`) === key);
    return { id: key, nama: delivery?.employeeNama || "?" };
  }).sort((a, b) => a.nama.localeCompare(b.nama));
  const calEmployees = allCalEmployees.filter((emp) => !hideNonValidationRoles || isCalendarValidationEmployee(emp));
  const hiddenNonValidationRoleCount = hideNonValidationRoles ? allCalEmployees.length - calEmployees.length : 0;
  const calEmployeeIdSet = new Set(calEmployees.map((emp) => emp.id));
  const visibleCalDeliveries = calDeliveries.filter((d) => calEmployeeIdSet.has(d.employee_id || `_deleted_${d.employee_nama || d.id}`));

  const calDataMap = new Map<string, DeliveryRow[]>(); // key: empKey-YYYY-MM-DD
  visibleCalDeliveries.forEach((d) => {
    const empKey = d.employee_id || `_deleted_${d.employee_nama || d.id}`;
    const key = `${empKey}-${d.tanggal}`;
    if (!calDataMap.has(key)) calDataMap.set(key, []);
    calDataMap.get(key)!.push(d);
  });
  calDataMap.forEach((entries) => entries.sort((a, b) => a.id - b.id));

  const getCalendarValidation = (emp: CalendarEmployee, dateStr: string, entries: DeliveryRow[]): CalendarValidation | null => {
    if (!calendarValidationEnabled) return null;
    if (emp.id.startsWith("_deleted_")) return null;
    if (!isCalendarValidationEmployee(emp)) return null;
    if (!isEmployeeActiveOnDate(emp, dateStr)) return null;

    const attendance = calAttendanceMap.get(`${emp.id}-${dateStr}`) || null;
    if (!attendance) {
      return entries.length > 0
        ? {
          attendance,
          color: "#ef4444",
          label: "Tanpa absen",
          isAnomaly: true,
          anomalyType: "points_without_attendance",
          message: "Ada titik tanpa data absensi",
        }
        : null;
    }

    const meta = ATTENDANCE_STATUS_META[attendance.status];
    if (entries.length > 0 && NON_PRESENT_ATTENDANCE_STATUSES.includes(attendance.status)) {
      return {
        attendance,
        color: meta.color,
        label: meta.label,
        isAnomaly: true,
        anomalyType: "non_present_with_points",
        message: `${meta.label} tapi ada titik`,
      };
    }

    if (entries.length === 0 && PRESENT_ATTENDANCE_STATUSES.includes(attendance.status)) {
      return {
        attendance,
        color: meta.color,
        label: meta.label,
        isAnomaly: true,
        anomalyType: "present_without_points",
        message: `${meta.label} tanpa titik`,
      };
    }

    return { attendance, color: meta.color, label: meta.label, isAnomaly: false };
  };

  const calAnomalies: CalendarAnomaly[] = calEmployees.flatMap((emp) =>
    calDateList.flatMap((dt) => {
      const dateStr = localDateStr(dt);
      const entries = calDataMap.get(`${emp.id}-${dateStr}`) || [];
      const validation = getCalendarValidation(emp, dateStr, entries);
      return validation?.isAnomaly && validation.anomalyType
        ? [{ type: validation.anomalyType, empId: emp.id, dateStr }]
        : [];
    })
  );
  const anomalyCounts = calAnomalies.reduce((acc, anomaly) => {
    acc[anomaly.type] = (acc[anomaly.type] || 0) + 1;
    return acc;
  }, {} as Record<CalendarAnomalyType, number>);

  // List semua sel kosong (hanya pegawai aktif, bukan deleted): { empId, dateStr }
  const calEmptyCells = calEmployees
    .filter((emp) => !emp.id.startsWith("_deleted_"))
    .flatMap((emp) =>
      calDateList.filter((dt) => {
        const ds = localDateStr(dt);
        if (!isEmployeeActiveOnDate(emp, ds)) return false;
        return !(calDataMap.get(`${emp.id}-${ds}`)?.length) && !calAttendanceMap.get(`${emp.id}-${ds}`);
      }).map((dt) => ({ empId: emp.id, dateStr: localDateStr(dt) }))
    );

  const navigateToEmptyCell = () => {
    if (calEmptyCells.length === 0) return;
    const nextIdx = (emptyNavIdx + 1) % calEmptyCells.length;
    setEmptyNavIdx(nextIdx);
    setStatusNavIdx(new Map());
    setAnomalyNavIdx(new Map());
    const cell = calEmptyCells[nextIdx];
    const el = document.getElementById(`cal-${cell.empId}-${cell.dateStr}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  };

  // Sel yang punya status tertentu
  const calStatusCells = new Map<string, { empId: string; dateStr: string; deliveryId: number }[]>();
  visibleCalDeliveries.forEach((d) => {
    if (d.statusNama) {
      const empKey = d.employee_id || `_deleted_${d.employee_nama || d.id}`;
      if (!calStatusCells.has(d.statusNama)) calStatusCells.set(d.statusNama, []);
      calStatusCells.get(d.statusNama)!.push({ empId: empKey, dateStr: d.tanggal, deliveryId: d.id });
    }
  });

  const navigateToStatusCell = (statusName: string) => {
    const cells = calStatusCells.get(statusName);
    if (!cells || cells.length === 0) return;
    const currentIdx = statusNavIdx.get(statusName) ?? -1;
    const nextIdx = (currentIdx + 1) % cells.length;
    setStatusNavIdx(new Map(statusNavIdx).set(statusName, nextIdx));
    setEmptyNavIdx(-1);
    setAnomalyNavIdx(new Map());
    const cell = cells[nextIdx];
    const el = document.getElementById(`cal-${cell.empId}-${cell.dateStr}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  };

  const navigateToAnomaly = (type: CalendarAnomalyType | "all") => {
    const cells = type === "all" ? calAnomalies : calAnomalies.filter((a) => a.type === type);
    if (cells.length === 0) return;
    const currentIdx = anomalyNavIdx.get(type) ?? -1;
    const nextIdx = (currentIdx + 1) % cells.length;
    setAnomalyNavIdx(new Map(anomalyNavIdx).set(type, nextIdx));
    setEmptyNavIdx(-1);
    setStatusNavIdx(new Map());
    const cell = cells[nextIdx];
    const el = document.getElementById(`cal-${cell.empId}-${cell.dateStr}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  };

  const activeStatusCell = (() => {
    for (const [nama, idx] of statusNavIdx.entries()) {
      if (idx >= 0) {
        const cells = calStatusCells.get(nama);
        if (cells && cells[idx]) return cells[idx];
      }
    }
    return null;
  })();

  const activeAnomalyCell = (() => {
    for (const [type, idx] of anomalyNavIdx.entries()) {
      const cells = type === "all" ? calAnomalies : calAnomalies.filter((a) => a.type === type);
      if (idx >= 0 && cells[idx]) return cells[idx];
    }
    return null;
  })();

  // ─── Calendar cell edit handlers ───
  const openCalCell = (empId: string, empNama: string, dateStr: string) => {
    const entries = calDataMap.get(`${empId}-${dateStr}`) || [];
    if (entries.length > 0) {
      setCalEditEntries(entries.map((e) => ({
        id: e.id,
        zone_id: e.zone_id,
        role: e.role,
        jumlah_titik: String(e.jumlah_titik),
        status_id: e.status_id || 0,
        catatan: e.catatan || "",
      })));
    } else {
      // Sel kosong — buat 1 baris kosong untuk input baru
      setCalEditEntries([{ id: null, zone_id: 0, role: "", jumlah_titik: "", status_id: 0, catatan: "" }]);
    }
    setCalEditCell({ empId, empNama, dateStr });
  };

  const calEditAddRow = () => {
    setCalEditEntries((prev) => [...prev, { id: null, zone_id: 0, role: "", jumlah_titik: "", status_id: 0, catatan: "" }]);
  };

  const calEditRemoveRow = (idx: number) => {
    setCalEditEntries((prev) => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  };

  const calEditUpdateRow = (idx: number, field: string, value: string | number) => {
    setCalEditEntries((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const calEditReadableEntries = calEditEntries
    .map((entry, idx) => ({
      entry,
      idx,
      zone: zones.find((z) => z.id === entry.zone_id),
      status: dStatuses.find((s) => s.id === entry.status_id),
    }))
    .filter(({ entry }) => entry.zone_id && entry.role && hasPointInput(entry.jumlah_titik));
  const calEditTotalTitik = calEditReadableEntries.reduce((sum, { entry }) => sum + parsePointInput(entry.jumlah_titik), 0);
  const calEditDriverTotal = calEditReadableEntries
    .filter(({ entry }) => entry.role === "Driver")
    .reduce((sum, { entry }) => sum + parsePointInput(entry.jumlah_titik), 0);
  const calEditHelperTotal = calEditReadableEntries
    .filter(({ entry }) => entry.role === "Helper")
    .reduce((sum, { entry }) => sum + parsePointInput(entry.jumlah_titik), 0);

  const isDeletedEmployee = (empId: string) => empId.startsWith("_deleted_");

  const handleCalCellSave = async () => {
    if (!calEditCell) return;

    // Block insert untuk pegawai yang sudah dihapus
    if (isDeletedEmployee(calEditCell.empId)) {
      // Hanya allow update/delete existing entries, tidak bisa tambah baru
      const hasNewEntries = calEditEntries.some((e) => !e.id && e.zone_id && e.role && hasPointInput(e.jumlah_titik));
      if (hasNewEntries) {
        showToast("error", "Tidak Bisa Tambah", "Pegawai ini sudah dihapus. Hanya bisa edit/hapus data yang sudah ada.");
        return;
      }
    }

    setCalEditSaving(true);

    try {
      // Existing entries in DB for this cell
      const existingEntries = calDataMap.get(`${calEditCell.empId}-${calEditCell.dateStr}`) || [];
      const existingIds = new Set(existingEntries.map((e) => e.id));

      const hasAnyCalEditData = (entry: typeof calEditEntries[number]) =>
        Boolean(entry.zone_id || entry.role || hasPointInput(entry.jumlah_titik) || entry.status_id || entry.catatan.trim());
      const isValidCalEditEntry = (entry: typeof calEditEntries[number]) =>
        Boolean(entry.zone_id && entry.role && hasPointInput(entry.jumlah_titik));

      const incompleteRowIdx = calEditEntries.findIndex((entry) => hasAnyCalEditData(entry) && !isValidCalEditEntry(entry));
      if (incompleteRowIdx >= 0) {
        showToast("error", "Data Belum Lengkap", `Lengkapi nama titik, posisi, dan jumlah titik pada Entri ${incompleteRowIdx + 1}.`);
        return;
      }

      if (existingEntries.length === 0 && !calEditEntries.some(isValidCalEditEntry)) {
        showToast("error", "Belum Ada Data", "Isi minimal satu entri titik sebelum menyimpan.");
        return;
      }

      // Lookup rates
      const { data: allRates, error: rateError } = await supabase.from("point_rates").select("zone_id, role, rate_per_point").eq("status", "Aktif");
      if (rateError) {
        showToast("error", "Gagal Mengambil Tarif", rateError.message);
        return;
      }
      const rateMap = new Map<string, number>();
      allRates?.forEach((r) => rateMap.set(`${r.zone_id}-${r.role}`, r.rate_per_point));

      // Entries to keep (with id) — update them
      // Entries without id — insert them
      // Existing ids not in calEditEntries — delete them
      const keptIds = new Set<number>();
      const inserts: Record<string, unknown>[] = [];
      const updates: { id: number; data: Record<string, unknown> }[] = [];
      const mutationErrors: string[] = [];

      for (const entry of calEditEntries) {
        // Skip empty rows
        if (!isValidCalEditEntry(entry)) continue;

        const rate = rateMap.get(`${entry.zone_id}-${entry.role}`);
        if (rate == null) {
          const zoneName = zones.find((z) => z.id === entry.zone_id)?.nama || "titik terpilih";
          showToast("error", "Tarif Belum Ada", `Tarif aktif untuk ${zoneName} (${entry.role}) belum tersedia.`);
          return;
        }
        const payload = {
          zone_id: entry.zone_id,
          role: entry.role,
          jumlah_titik: parsePointInput(entry.jumlah_titik),
          rate_per_point: rate,
          status_id: entry.status_id || null,
          catatan: entry.catatan || null,
        };

        if (entry.id) {
          keptIds.add(entry.id);
          updates.push({ id: entry.id, data: payload });
        } else {
          inserts.push({
            ...payload,
            employee_id: isDeletedEmployee(calEditCell.empId) ? null : calEditCell.empId,
            employee_nama: calEditCell.empNama,
            tanggal: calEditCell.dateStr,
          });
        }
      }

      // Delete removed entries
      const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
      for (const id of toDelete) {
        const { error } = await supabase.from("delivery_points").delete().eq("id", id);
        if (error) mutationErrors.push(error.message);
      }

      // Update existing
      for (const u of updates) {
        const { error } = await supabase.from("delivery_points").update(u.data).eq("id", u.id);
        if (error) mutationErrors.push(error.message);
      }

      // Insert new
      if (inserts.length > 0) {
        const { error } = await supabase.from("delivery_points").insert(inserts);
        if (error) mutationErrors.push(error.message);
      }

      if (mutationErrors.length > 0) {
        showToast("error", "Gagal Menyimpan", mutationErrors[0]);
        return;
      } else {
        const total = updates.length + inserts.length + toDelete.length;
        if (total > 0) {
          showToast("success", "Data Disimpan", `${calEditCell.empNama} — ${calEditCell.dateStr}`);
          // Audit log: edit cell kalender = bisa update + insert + delete sekaligus
          await logAudit({
            supabase,
            action: inserts.length > 0 && updates.length === 0 && toDelete.length === 0 ? "manual_input" : "update",
            entityType: "delivery_points",
            entityLabel: `Rekap titik ${calEditCell.empNama} (${calEditCell.dateStr})`,
            metadata: {
              tanggal: calEditCell.dateStr,
              employee_id: calEditCell.empId,
              employee_nama: calEditCell.empNama,
              jumlah_baru: inserts.length,
              jumlah_diperbarui: updates.length,
              jumlah_dihapus: toDelete.length,
              source: "kalender",
            },
          });
        }
      }

      setCalEditCell(null);
      // Re-fetch calendar data
      const cp = getPeriodRange(calMonth);
      const { data, error } = await fetchDeliveryRowsInRange(cp.start, cp.end, true);
      if (error) { showToast("error", "Gagal Memuat Data Kalender", error.message); return; }
      if (data) {
        setDeliveries((prev) => {
          const others = prev.filter((d) => d.tanggal < cp.start || d.tanggal > cp.end);
          const calRows = data.map(mapDeliveryRow);
          return [...others, ...calRows];
        });
      }
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setCalEditSaving(false);
    }
  };

  const openCalendar = () => {
    setCalMonth(periodKey);
    setEmptyNavIdx(-1);
    setStatusNavIdx(new Map());
    setAnomalyNavIdx(new Map());
    setShowCalendar(true);
  };

  const calPrevPeriod = () => {
    const [y, m] = calMonth.split("-").map(Number);
    const prev = new Date(y, m - 2, 1);
    setCalMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
    setEmptyNavIdx(-1);
    setStatusNavIdx(new Map());
    setAnomalyNavIdx(new Map());
  };
  const calNextPeriod = () => {
    const [y, m] = calMonth.split("-").map(Number);
    const next = new Date(y, m, 1);
    setCalMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    setEmptyNavIdx(-1);
    setStatusNavIdx(new Map());
    setAnomalyNavIdx(new Map());
  };

  // Fetch calendar data when period changes
  useEffect(() => {
    if (!showCalendar) return;
    const fetchCalData = async () => {
      const cp = getPeriodRange(calMonth);
      const { data, error } = await fetchDeliveryRowsInRange(cp.start, cp.end, true);
      if (error) { showToast("error", "Gagal Memuat Data Kalender", error.message); return; }
      if (data) {
        setDeliveries((prev) => {
          const others = prev.filter((d) => d.tanggal < cp.start || d.tanggal > cp.end);
          const calRows = data.map(mapDeliveryRow);
          return [...others, ...calRows];
        });
      }
    };
    fetchCalData();
  }, [calMonth, showCalendar]);

  useEffect(() => {
    if (!showCalendar) return;
    const fetchCalAttendance = async () => {
      const cp = getPeriodRange(calMonth);
      const { data, error } = await fetchAttendanceRowsInRange(cp.start, cp.end);
      if (error) { showToast("error", "Gagal Memuat Data Absensi", error.message); return; }
      setCalAttendance(data);
    };
    fetchCalAttendance();
  }, [calMonth, showCalendar]);

  return (
    <RouteGuard permission="income">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Rekap Titik"
        description="Rekap titik pengantaran harian driver & helper"
        icon={Wallet}
        actions={
          <div className="flex items-center gap-2">
            {/* Desktop: 3 tombol horizontal */}
            <div className="hidden sm:flex items-center gap-2">
              <Button variant="outline" icon={FileText} size="sm" onClick={() => setShowReport(true)}>Laporan Detail</Button>
              <Button variant="outline" icon={CalendarDays} size="sm" onClick={openCalendar}>Mode Kalender</Button>
              {canInput && <Button variant="outline" icon={User} size="sm" onClick={openSingle}>Input Tunggal</Button>}
              {canInput && <Button icon={Users} size="sm" onClick={openBatch}>Input Bulk</Button>}
            </div>
            {/* Mobile: primary action + dropdown menu */}
            <div className="flex sm:hidden items-center gap-1.5">
              {canInput && <Button variant="outline" icon={User} size="sm" onClick={openSingle} className="min-h-[44px]">Tunggal</Button>}
              {canInput && <Button icon={Users} size="sm" onClick={openBatch} className="min-h-[44px]">Bulk</Button>}
              <_HeaderMenu
                onShowReport={() => setShowReport(true)}
                onOpenCalendar={openCalendar}
              />
            </div>
          </div>
        }
      />

      {toast.show && (
        <Portal>
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-fade-in w-[calc(100vw-1.5rem)] max-w-[480px]">
            <div className={cn("flex items-start gap-3 px-4 py-3.5 sm:px-5 sm:py-4 bg-card rounded-2xl shadow-2xl border",
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <div className="space-y-2"><Skeleton className="h-3 w-14 rounded-md" /><Skeleton className="h-5 w-8 rounded-md" /></div>
          </div>
        )) : (
          <>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center"><Wallet className="w-5 h-5 text-primary" /></div>
              <div><p className="text-xs text-muted-foreground font-medium">Total Pendapatan</p><p className="text-lg font-bold text-foreground">{formatCurrency(totalPendapatan)}</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center"><span className="text-sm font-bold text-success">{totalTitik}</span></div>
              <div><p className="text-xs text-muted-foreground font-medium">Total Titik</p><p className="text-xs text-muted-foreground">periode ini</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center"><span className="text-sm font-bold text-muted-foreground">{totalEntri}</span></div>
              <div><p className="text-xs text-muted-foreground font-medium">Total Entri</p><p className="text-xs text-muted-foreground">transaksi</p></div>
            </div>
          </>
        )}
      </div>

      {/* Filter & Search */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 flex-1 min-w-0">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input type="text" placeholder="Cari nama, nama titik, atau posisi..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-xl p-1 self-stretch sm:self-auto">
            <button onClick={() => {
              const [y, m] = periodKey.split("-").map(Number);
              const prev = new Date(y, m - 2, 1);
              setPeriodKey(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
              setPage(1);
            }} className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 py-1.5 text-center flex-1 sm:min-w-[240px] sm:flex-none">
              <p className="text-xs font-bold text-foreground">{period.label}</p>
            </div>
            <button onClick={() => {
              const [y, m] = periodKey.split("-").map(Number);
              const next = new Date(y, m, 1);
              setPeriodKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
              setPage(1);
            }} className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="sm:hidden mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen((v) => !v)}
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors min-h-[44px]"
          >
            <span className="text-xs font-medium text-foreground">Filter</span>
            <div className="flex items-center gap-2">
              {hasColumnFilters && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {[employeeFilter, zoneFilter, roleFilter].filter(Boolean).length} aktif
                </span>
              )}
              <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", mobileFiltersOpen && "rotate-180")} />
            </div>
          </button>
          {mobileFiltersOpen && (
            <div className="mt-2 space-y-2 animate-fade-in">
              <Select
                value={employeeFilter}
                onChange={(val) => { setEmployeeFilter(val); setPage(1); }}
                options={employeeDropdownOptions}
                placeholder="Semua pegawai"
                searchable
                className={filterSelectClass}
              />
              <Select
                value={zoneFilter}
                onChange={(val) => { setZoneFilter(val); setPage(1); }}
                options={zoneDropdownOptions}
                placeholder="Semua nama titik"
                searchable
                className={filterSelectClass}
              />
              <Select
                value={roleFilter}
                onChange={(val) => { setRoleFilter(val as "" | "Driver" | "Helper"); setPage(1); }}
                options={roleDropdownOptions}
                placeholder="Semua posisi"
                searchable
                className={filterSelectClass}
              />
            </div>
          )}
        </div>
        {hasColumnFilters && (
          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border">
            <span className="text-xs font-medium text-muted-foreground">Filter kolom aktif</span>
            <button type="button" onClick={resetColumnFilters} className="text-xs font-semibold text-primary hover:underline">
              Reset filter
            </button>
          </div>
        )}
      </div>

      {/* Table — Desktop only */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Tanggal</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 min-w-[220px]">
                  <span>Pegawai</span>
                  <Select
                    value={employeeFilter}
                    onChange={(val) => { setEmployeeFilter(val); setPage(1); }}
                    options={employeeDropdownOptions}
                    placeholder="Semua pegawai"
                    searchable
                    className={tableHeaderFilterClass}
                  />
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 min-w-[180px]">
                  <span>Nama Titik</span>
                  <Select
                    value={zoneFilter}
                    onChange={(val) => { setZoneFilter(val); setPage(1); }}
                    options={zoneDropdownOptions}
                    placeholder="Semua nama titik"
                    searchable
                    className={tableHeaderFilterClass}
                  />
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 min-w-[140px]">
                  <span>Posisi</span>
                  <Select
                    value={roleFilter}
                    onChange={(val) => { setRoleFilter(val as "" | "Driver" | "Helper"); setPage(1); }}
                    options={roleDropdownOptions}
                    placeholder="Semua posisi"
                    searchable
                    className={tableHeaderFilterClass}
                  />
                </th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Titik</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Catatan</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <SkeletonTable rows={6} cols={9} />
              ) : paged.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data ditemukan</td></tr>
              ) : paged.map((row, idx) => (
                <tr key={row.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-5 py-3.5 text-sm text-foreground">{row.tanggal}</td>
                  <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{row.employeeNama}</p></td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md" style={{ backgroundColor: `${row.zoneColor}15`, color: row.zoneColor }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.zoneColor }} />
                      {row.zoneNama}
                    </span>
                  </td>
                  <td className="px-5 py-3.5"><span className={cn("text-xs font-semibold px-2.5 py-1 rounded-lg", row.role === "Driver" ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" : "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400")}>{row.role}</span></td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-foreground">{row.jumlah_titik}</td>
                  <td className="px-5 py-3.5">
                    {row.statusNama ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${row.statusColor}20`, color: row.statusColor }}>{row.statusNama}</span>
                    ) : <span className="text-xs text-muted-foreground italic">-</span>}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground max-w-[200px] truncate">{row.catatan || <span className="italic">-</span>}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-center gap-1">
                      {canEdit && <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                      {canEdit && <button onClick={() => setDeleteConfirm({ id: row.id, nama: `${row.employeeNama} (${row.tanggal})` })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      {/* Card list — Mobile only */}
      <div className="block sm:hidden space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-4 space-y-2">
              <Skeleton className="h-4 w-32 rounded-md" />
              <Skeleton className="h-3 w-24 rounded-md" />
              <Skeleton className="h-3 w-20 rounded-md" />
            </div>
          ))
        ) : paged.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border py-10 text-center text-sm text-muted-foreground">
            Tidak ada data ditemukan
          </div>
        ) : (
          paged.map((row, idx) => (
            <div key={row.id} className="bg-card rounded-2xl border border-border p-4 space-y-3">
              {/* Header row: # + tanggal + aksi */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">#{(page - 1) * PAGE_SIZE + idx + 1}</span>
                  <span className="text-xs font-medium text-foreground tabular-nums">{row.tanggal}</span>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(row)} className="p-2 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary min-h-[36px] min-w-[36px] flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setDeleteConfirm({ id: row.id, nama: `${row.employeeNama} (${row.tanggal})` })} className="p-2 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger min-h-[36px] min-w-[36px] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>

              {/* Pegawai + Titik */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground truncate">{row.employeeNama}</p>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-bold text-foreground tabular-nums leading-none">{row.jumlah_titik}</p>
                  <p className="text-[9px] text-muted-foreground">titik</p>
                </div>
              </div>

              {/* Nama Titik + Posisi + Status */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md" style={{ backgroundColor: `${row.zoneColor}15`, color: row.zoneColor }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.zoneColor }} />
                  {row.zoneNama}
                </span>
                <span className={cn("text-[11px] font-semibold px-2 py-1 rounded-md", row.role === "Driver" ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" : "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400")}>{row.role}</span>
                {row.statusNama && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${row.statusColor}20`, color: row.statusColor }}>{row.statusNama}</span>
                )}
              </div>

              {/* Catatan (kalau ada) */}
              {row.catatan && (
                <p className="text-[11px] text-muted-foreground border-t border-border/50 pt-2 line-clamp-2">{row.catatan}</p>
              )}
            </div>
          ))
        )}
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      {/* ═══ CALENDAR MODE FULLSCREEN ═══ */}
      {showCalendar && (
        <Portal>
          <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-gradient-to-r from-card via-card to-primary/[0.03]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20">
                  <CalendarDays className="w-4.5 h-4.5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Mode Kalender</h2>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                    <span><strong className="text-foreground">{calEmployees.length}</strong> pegawai</span>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span><strong className="text-foreground">{visibleCalDeliveries.length}</strong> entri</span>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span><strong className="text-primary">{visibleCalDeliveries.reduce((s, d) => s + d.jumlah_titik, 0)}</strong> total titik</span>
                    {hiddenNonValidationRoleCount > 0 && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        <span><strong className="text-muted-foreground">{hiddenNonValidationRoleCount}</strong> non D/H/K/WK disembunyikan</span>
                      </>
                    )}
                    {visibleCalDeliveries.filter((d) => d.statusNama).length > 0 && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        {(() => {
                          const statusCounts = new Map<string, { count: number; color: string }>();
                          visibleCalDeliveries.forEach((d) => {
                            if (d.statusNama) {
                              const existing = statusCounts.get(d.statusNama);
                              if (existing) existing.count++;
                              else statusCounts.set(d.statusNama, { count: 1, color: d.statusColor || "#6b7280" });
                            }
                          });
                          return Array.from(statusCounts.entries()).map(([nama, { count, color }]) => (
                            <button key={nama} onClick={() => navigateToStatusCell(nama)} className="inline-flex items-center gap-1 hover:underline cursor-pointer">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                              <strong style={{ color }}>{count}</strong> {nama.toLowerCase()}
                            </button>
                          ));
                        })()}
                      </>
                    )}
                    {calendarValidationEnabled && calAnomalies.length > 0 && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        <button onClick={() => navigateToAnomaly("all")} className="hover:underline cursor-pointer">
                          <strong className="text-danger">{calAnomalies.length}</strong> anomali
                          <span className="text-[9px] text-danger/50 ml-1">(klik)</span>
                        </button>
                        {anomalyCounts.non_present_with_points ? (
                          <button onClick={() => navigateToAnomaly("non_present_with_points")} className="hover:underline cursor-pointer">
                            <strong className="text-danger">{anomalyCounts.non_present_with_points}</strong> tidak hadir + titik
                          </button>
                        ) : null}
                        {anomalyCounts.present_without_points ? (
                          <button onClick={() => navigateToAnomaly("present_without_points")} className="hover:underline cursor-pointer">
                            <strong className="text-warning">{anomalyCounts.present_without_points}</strong> hadir tanpa titik
                          </button>
                        ) : null}
                        {anomalyCounts.points_without_attendance ? (
                          <button onClick={() => navigateToAnomaly("points_without_attendance")} className="hover:underline cursor-pointer">
                            <strong className="text-danger">{anomalyCounts.points_without_attendance}</strong> titik tanpa absen
                          </button>
                        ) : null}
                      </>
                    )}
                    {(() => {
                      const totalEmpty = calEmptyCells.length;
                      return totalEmpty > 0 ? (
                        <>
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <button onClick={navigateToEmptyCell} className="hover:underline cursor-pointer">
                            <strong className="text-danger">{totalEmpty}</strong> sel kosong
                            <span className="text-[9px] text-danger/50 ml-1">(klik untuk navigasi)</span>
                          </button>
                        </>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <div className="flex items-center gap-1 rounded-2xl border border-border/70 bg-muted/45 p-1 shadow-sm shadow-black/5">
                  <button
                    type="button"
                    aria-pressed={calendarValidationEnabled}
                    onClick={() => { setCalendarValidationEnabled((v) => !v); setAnomalyNavIdx(new Map()); }}
                    className={cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all",
                      calendarValidationEnabled
                        ? "bg-success-light text-success shadow-sm ring-1 ring-success/20"
                        : "text-muted-foreground hover:bg-card hover:text-foreground"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", calendarValidationEnabled ? "bg-success" : "bg-muted-foreground/40")} />
                    <span>Validasi {calendarValidationEnabled ? "ON" : "OFF"}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={calendarCompactCells}
                    onClick={() => setCalendarCompactCells((v) => !v)}
                    className={cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all",
                      calendarCompactCells
                        ? "bg-primary-light text-primary shadow-sm ring-1 ring-primary/20"
                        : "text-muted-foreground hover:bg-card hover:text-foreground"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", calendarCompactCells ? "bg-primary" : "bg-muted-foreground/40")} />
                    <span>{calendarCompactCells ? "Ringkas" : "Detail"}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={hideNonValidationRoles}
                    onClick={() => { setHideNonValidationRoles((v) => !v); setEmptyNavIdx(-1); setStatusNavIdx(new Map()); setAnomalyNavIdx(new Map()); }}
                    className={cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all",
                      hideNonValidationRoles
                        ? "bg-primary-light text-primary shadow-sm ring-1 ring-primary/20"
                        : "bg-card text-foreground shadow-sm ring-1 ring-border/70 hover:ring-primary/20"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", hideNonValidationRoles ? "bg-primary" : "bg-muted-foreground/50")} />
                    <span>{hideNonValidationRoles ? "D/H/K/WK" : "Semua jabatan"}</span>
                  </button>
                </div>
                <div className="flex items-center bg-muted rounded-xl p-1">
                  <button onClick={calPrevPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                  <span className="text-xs font-bold text-foreground px-3 min-w-[220px] text-center">{calPeriod.label}</span>
                  <button onClick={calNextPeriod} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronRight className="w-4 h-4" /></button>
                </div>
                <button onClick={() => setShowCalendar(false)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />Tutup
                </button>
              </div>
            </div>

            {/* ── Matrix table ── */}
            <div className="flex-1 overflow-auto">
              <table className="border-collapse w-max min-w-full">
                <thead className="sticky top-0 z-20">
                  <tr>
                    {/* Sticky corner */}
                    <th className="sticky left-0 z-30 bg-card border-b-2 border-r-2 border-border px-3 sm:px-4 py-3 text-left min-w-[130px] sm:min-w-[180px] shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Pegawai</span>
                    </th>
                    {calDateList.map((dt) => {
                      const dateStr = localDateStr(dt);
                      const day = dt.getDate();
                      const dayOfWeek = dt.getDay();
                      const isSunday = dayOfWeek === 0;
                      const isSaturday = dayOfWeek === 6;
                      const now = new Date();
                      const isToday = day === now.getDate() && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
                      const isNewMonth = day === 1;
                      return (
                        <th key={dateStr} className={cn(
                          "border-b-2 border-r border-border px-0.5 sm:px-1 py-1 sm:py-2 text-center min-w-[90px] sm:min-w-[120px]",
                          isNewMonth && "border-l-2 border-l-primary/30",
                          isToday ? "bg-primary text-white" : isSunday ? "bg-red-100" : isSaturday ? "bg-amber-100" : "bg-card"
                        )}>
                          {isNewMonth && (
                            <div className={cn("text-[8px] font-bold uppercase tracking-wider mb-0.5", isToday ? "text-white/70" : "text-primary/60")}>
                              {dt.toLocaleDateString("id-ID", { month: "short" })}
                            </div>
                          )}
                          <div className={cn("text-xs font-bold leading-tight", isToday ? "text-white" : isSunday ? "text-red-500" : isSaturday ? "text-amber-600" : "text-foreground")}>
                            {day}
                          </div>
                          <div className={cn("text-[9px] font-medium", isToday ? "text-white/70" : isSunday ? "text-red-400" : isSaturday ? "text-amber-500" : "text-muted-foreground/50")}>
                            {["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"][dayOfWeek]}
                          </div>
                        </th>
                      );
                    })}
                    {/* Total column */}
                    <th className="sticky right-0 z-30 bg-card border-b-2 border-l-2 border-border px-4 py-3 text-center min-w-[65px] shadow-[-2px_0_8px_-2px_rgba(0,0,0,0.06)]">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {calEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={calDateList.length + 2} className="text-center py-24">
                        <CalendarDays className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">Tidak ada data titik untuk periode ini</p>
                      </td>
                    </tr>
                  ) : calEmployees.map((emp, empIdx) => {
                    const empTotal = visibleCalDeliveries.filter((d) => (d.employee_id || `_deleted_${d.employee_nama || d.id}`) === emp.id).reduce((s, d) => s + d.jumlah_titik, 0);
                    const isEven = empIdx % 2 === 0;
                    return (
                      <tr key={emp.id} className={cn("group transition-colors", isEven ? "" : "bg-muted/[0.03]")}>
                        {/* Employee name - sticky left */}
                        <td className={cn("sticky left-0 z-10 border-b border-r-2 border-border px-3 sm:px-4 py-2.5 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]", isEven ? "bg-card" : "bg-card")}>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <User className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-primary/70" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] sm:text-xs font-semibold text-foreground truncate max-w-[90px] sm:max-w-[130px]">{emp.nama}</p>
                              {emp.jabatanNama && <p className="text-[7px] sm:text-[8px] font-medium text-muted-foreground truncate max-w-[90px] sm:max-w-[130px]">{emp.jabatanNama}</p>}
                            </div>
                          </div>
                        </td>
                        {calDateList.map((dt) => {
                          const dateStr = localDateStr(dt);
                          const entries = calDataMap.get(`${emp.id}-${dateStr}`) || [];
                          const validation = getCalendarValidation(emp, dateStr, entries);
                          const isActiveForCalendar = emp.id.startsWith("_deleted_") || isEmployeeActiveOnDate(emp, dateStr);
                          const dayOfWeek = dt.getDay();
                          const isSunday = dayOfWeek === 0;
                          const isSaturday = dayOfWeek === 6;
                          const now = new Date();
                          const isToday = dt.getDate() === now.getDate() && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
                          const isNewMonth = dt.getDate() === 1;
                          const isActiveEmpty = entries.length === 0 && emptyNavIdx >= 0 && calEmptyCells[emptyNavIdx]?.empId === emp.id && calEmptyCells[emptyNavIdx]?.dateStr === dateStr;
                          const isActiveStatus = activeStatusCell && activeStatusCell.empId === emp.id && activeStatusCell.dateStr === dateStr;
                          const isActiveAnomaly = activeAnomalyCell && activeAnomalyCell.empId === emp.id && activeAnomalyCell.dateStr === dateStr;
                          const isCellEditing = calEditCell?.empId === emp.id && calEditCell?.dateStr === dateStr;
                          const totalPoints = entries.reduce((sum, entry) => sum + entry.jumlah_titik, 0);
                          const roleSummary = Array.from(new Set(entries.map((entry) => entry.role === "Driver" ? "D" : "H"))).join("/");
                          const zoneNames = Array.from(new Set(entries.map((entry) => entry.zoneNama || "-")));
                          const zoneSummary = zoneNames.length > 1 ? `${zoneNames[0]} +${zoneNames.length - 1}` : zoneNames[0] || "Titik";
                          const statusSummary = Array.from(entries.reduce((map, entry) => {
                            if (!entry.statusNama) return map;
                            const existing = map.get(entry.statusNama);
                            if (existing) existing.count += 1;
                            else map.set(entry.statusNama, { count: 1, color: entry.statusColor || "#6b7280" });
                            return map;
                          }, new Map<string, { count: number; color: string }>()));
                          const visibleStatusSummary = statusSummary.slice(0, 1);
                          const hiddenStatusSummaryCount = statusSummary.length - visibleStatusSummary.length;
                          return (
                            <td key={dateStr} id={`cal-${emp.id}-${dateStr}`}
                              onClick={() => !calEditCell && openCalCell(emp.id, emp.nama, dateStr)}
                              className={cn(
                                "border-b border-r border-border/60 px-0.5 sm:px-1 py-0.5 sm:py-1 align-top min-w-[90px] sm:min-w-[120px] transition-colors cursor-pointer",
                                isNewMonth && "border-l-2 border-l-primary/30",
                                isCellEditing ? "ring-2 ring-primary ring-inset bg-primary/[0.06]" : isActiveAnomaly ? "ring-2 ring-danger ring-inset bg-danger/[0.10]" : isActiveEmpty ? "ring-2 ring-danger ring-inset bg-danger/[0.08]" : isActiveStatus ? "ring-2 ring-warning ring-inset bg-warning/[0.08]" : validation?.isAnomaly ? "ring-1 ring-danger/70 ring-inset bg-danger/[0.06]" : isToday ? "bg-primary/[0.03]" : isSunday ? "bg-red-500/[0.03]" : isSaturday ? "bg-amber-500/[0.02]" : "",
                                !calEditCell && "hover:bg-primary/[0.04]",
                                "group-hover:bg-muted/30"
                              )}>
                              {entries.length > 0 ? (
                                calendarCompactCells ? (
                                  <div className={cn(
                                    "min-h-[78px] rounded-lg border px-2 py-1.5 flex flex-col gap-1",
                                    validation?.isAnomaly ? "border-danger/40 bg-danger/[0.07]" : "border-border/50 bg-card/80"
                                  )}>
                                    {validation?.isAnomaly ? (
                                      <div className="flex items-start justify-between gap-1 min-h-4">
                                        <span className="min-w-0 flex-1 whitespace-normal break-words rounded bg-danger/10 px-1.5 py-0.5 text-[8px] font-bold leading-tight text-danger" title={validation.message}>
                                          {validation.message}
                                        </span>
                                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger text-[10px] font-black text-white">!</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between gap-1 min-h-4">
                                        <div className="flex min-w-0 flex-1 items-center gap-0.5">
                                          {validation ? (
                                            <span className="max-w-[52px] shrink-0 truncate rounded px-1.5 py-0.5 text-[8px] font-bold text-white" style={{ backgroundColor: validation.color }}>
                                              {validation.label}
                                            </span>
                                          ) : (
                                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[8px] font-bold text-muted-foreground">Titik</span>
                                          )}
                                          {visibleStatusSummary.map(([nama, { count, color }]) => (
                                            <span key={nama} className="max-w-[48px] truncate rounded px-1 py-0.5 text-[8px] font-bold leading-none" style={{ backgroundColor: `${color}25`, color }} title={count > 1 ? `${count} ${nama}` : nama}>
                                              {count > 1 ? `${count} ${nama}` : nama}
                                            </span>
                                          ))}
                                          {hiddenStatusSummaryCount > 0 && <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[8px] font-bold leading-none text-muted-foreground">+{hiddenStatusSummaryCount}</span>}
                                        </div>
                                        {validation?.attendance ? (
                                          <span className="text-[9px] font-black" style={{ color: validation.color }}>{ATTENDANCE_STATUS_META[validation.attendance.status].short}</span>
                                        ) : null}
                                      </div>
                                    )}
                                    <div className="flex flex-1 items-center justify-center">
                                      <span className={cn("text-2xl font-black leading-none tabular-nums", validation?.isAnomaly ? "text-danger" : "text-primary")}>{totalPoints}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-1 text-[8px] font-semibold text-muted-foreground">
                                      <span>{entries.length} entri</span>
                                      {roleSummary && <span>{roleSummary}</span>}
                                    </div>
                                    <p className="truncate text-center text-[8px] font-medium text-muted-foreground/80" title={zoneNames.join(", ")}>{zoneSummary}</p>
                                  </div>
                                ) : (
                                  <div className="space-y-0.5">
                                    {validation && (
                                      <div className={cn("flex items-center justify-between gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-bold", validation.isAnomaly ? "bg-danger/10 text-danger" : "bg-muted/60 text-muted-foreground")}>
                                        <span>{validation.isAnomaly ? validation.message : `Absen ${validation.label}`}</span>
                                        {validation.attendance && (
                                          <span className="px-1 rounded text-white" style={{ backgroundColor: validation.color }}>{ATTENDANCE_STATUS_META[validation.attendance.status].short}</span>
                                        )}
                                      </div>
                                    )}
                                    {entries.map((e) => (
                                      <div key={e.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors" style={{ backgroundColor: `${e.zoneColor}20`, borderLeft: `3px solid ${e.zoneColor}` }}>
                                        <span className="text-[9px] font-bold truncate" style={{ color: e.zoneColor }}>{e.zoneNama}</span>
                                        <span className="text-[11px] font-extrabold ml-auto" style={{ color: e.zoneColor }}>{e.jumlah_titik}</span>
                                        <span className={cn("text-[9px] font-extrabold px-1.5 py-0.5 rounded-md", e.role === "Driver" ? "bg-blue-500 text-white" : "bg-orange-500 text-white")}>{e.role === "Driver" ? "D" : "H"}</span>
                                        {e.statusNama && <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: `${e.statusColor}25`, color: e.statusColor }}>{e.statusNama}</span>}
                                      </div>
                                    ))}
                                  </div>
                                )
                              ) : validation?.attendance ? (
                                <div className={cn("min-h-[78px] flex flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-1", validation.isAnomaly ? "border-warning/40 bg-warning/[0.10]" : "border-border/50 bg-muted/35")} title={validation.message || `Absensi ${validation.label}`}>
                                  <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[8px] font-bold text-white" style={{ backgroundColor: validation.color }}>{validation.label}</span>
                                  {validation.isAnomaly ? (
                                    <>
                                      <span className="text-lg font-black leading-none text-warning tabular-nums">0</span>
                                      <span className="text-center text-[8px] font-bold leading-tight text-warning">{validation.message}</span>
                                    </>
                                  ) : null}
                                </div>
                              ) : !isActiveForCalendar ? (
                                <div className="h-7 flex items-center justify-center">
                                  <span className="text-[10px] text-muted-foreground/20">-</span>
                                </div>
                              ) : (
                                <div className="min-h-[58px] flex items-center justify-center rounded-lg border border-dashed border-border/40 bg-muted/[0.18]">
                                  <span className="text-[8px] font-medium text-muted-foreground/35">kosong</span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                        {/* Total */}
                        <td className={cn("sticky right-0 z-10 border-b border-l-2 border-border px-3 py-2 text-center shadow-[-2px_0_8px_-2px_rgba(0,0,0,0.06)]", isEven ? "bg-card" : "bg-card")}>
                          {empTotal > 0 ? (
                            <div>
                              <span className="text-sm font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md">{empTotal}</span>
                              {(() => {
                                const empStatuses = visibleCalDeliveries.filter((d) => (d.employee_id || `_deleted_${d.employee_nama || d.id}`) === emp.id && d.statusNama);
                                if (empStatuses.length === 0) return null;
                                const counts = new Map<string, { count: number; color: string }>();
                                empStatuses.forEach((d) => {
                                  const ex = counts.get(d.statusNama!);
                                  if (ex) ex.count++; else counts.set(d.statusNama!, { count: 1, color: d.statusColor || "#6b7280" });
                                });
                                return (
                                  <div className="flex items-center justify-center gap-1 mt-1">
                                    {Array.from(counts.entries()).map(([nama, { count, color }]) => (
                                      <span key={nama} className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: `${color}20`, color }}>{count}{nama.charAt(0)}</span>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/30">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Footer totals per day */}
                  {calEmployees.length > 0 && (
                    <tr className="sticky bottom-0 z-10">
                      <td className="sticky left-0 z-20 bg-card border-t-2 border-r-2 border-border px-4 py-2.5 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total / Hari</span>
                      </td>
                      {calDateList.map((dt) => {
                        const dateStr = localDateStr(dt);
                        const dayTotal = visibleCalDeliveries.filter((d) => d.tanggal === dateStr).reduce((s, d) => s + d.jumlah_titik, 0);
                        const isNewMonth = dt.getDate() === 1;
                        return (
                          <td key={dateStr} className={cn("bg-card border-t-2 border-r border-border px-1 py-2.5 text-center", isNewMonth && "border-l-2 border-l-primary/30")}>
                            {dayTotal > 0 ? (
                              <span className="text-[11px] font-bold text-primary">{dayTotal}</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/20">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="sticky right-0 z-20 bg-card border-t-2 border-l-2 border-border px-3 py-2.5 text-center shadow-[-2px_0_8px_-2px_rgba(0,0,0,0.06)]">
                        <span className="text-sm font-extrabold text-primary">{visibleCalDeliveries.reduce((s, d) => s + d.jumlah_titik, 0)}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Calendar Cell Edit Panel ── */}
            {calEditCell && (
              <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget && !calEditSaving) setCalEditCell(null); }}>
                <div className="absolute inset-0 bg-black/30" />
                <div className="relative w-full max-w-2xl bg-card sm:rounded-2xl shadow-2xl animate-slide-up sm:animate-scale-in flex flex-col" style={{ maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))" }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30 rounded-t-2xl">
                    <div>
                      <h3 className="text-sm font-bold text-foreground">{calEditCell.empNama}</h3>
                      <p className="text-[10px] text-muted-foreground">{new Date(calEditCell.dateStr + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                      {calendarValidationEnabled && !calEditCell.empId.startsWith("_deleted_") && (() => {
                        const emp = employeeMetaMap.get(calEditCell.empId) || employees.find((e) => e.id === calEditCell.empId);
                        if (emp && !isEmployeeActiveOnDate(emp, calEditCell.dateStr)) return null;
                        const attendance = calAttendanceMap.get(`${calEditCell.empId}-${calEditCell.dateStr}`);
                        if (!attendance) return <p className="text-[10px] font-medium text-danger mt-0.5">Absensi: belum ada</p>;
                        const meta = ATTENDANCE_STATUS_META[attendance.status];
                        return <p className="text-[10px] font-medium mt-0.5" style={{ color: meta.color }}>Absensi: {meta.label}</p>;
                      })()}
                    </div>
                    <button onClick={() => !calEditSaving && setCalEditCell(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                  </div>

                  {calEditReadableEntries.length > 0 && (
                    <div className="px-5 py-4 border-b border-border bg-gradient-to-b from-muted/20 to-card space-y-3">
                      <div className="grid grid-cols-4 gap-2">
                        <div className="rounded-xl border border-primary/20 bg-primary-light/60 px-3 py-2 text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-primary/70">Total Titik</p>
                          <p className="text-xl font-black text-primary leading-none mt-1">{calEditTotalTitik}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-card px-3 py-2 text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Entri</p>
                          <p className="text-xl font-black text-foreground leading-none mt-1">{calEditReadableEntries.length}</p>
                        </div>
                        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Driver</p>
                          <p className="text-xl font-black text-blue-600 dark:text-blue-400 leading-none mt-1">{calEditDriverTotal}</p>
                        </div>
                        <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">Helper</p>
                          <p className="text-xl font-black text-orange-600 dark:text-orange-400 leading-none mt-1">{calEditHelperTotal}</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-muted/20">
                          <p className="text-xs font-bold text-foreground">Detail Titik</p>
                          <p className="text-[10px] font-medium text-muted-foreground">Klik Simpan jika ada perubahan di form bawah</p>
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          <table className="w-full">
                            <thead className="sticky top-0 bg-card z-10">
                              <tr className="border-b border-border/70">
                                <th className="text-left text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 w-8">#</th>
                                <th className="text-left text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2">Nama Titik</th>
                                <th className="text-center text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 w-20">Posisi</th>
                                <th className="text-right text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 w-20">Titik</th>
                                <th className="text-left text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2 w-24">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {calEditReadableEntries.map(({ entry, idx, zone, status }) => (
                                <tr key={`${entry.id || "new"}-${idx}`}>
                                  <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: zone?.color || "#3b82f6" }} />
                                      <div className="min-w-0">
                                        <p className="text-xs font-bold text-foreground truncate">{zone?.nama || "Nama titik tidak ditemukan"}</p>
                                        {entry.catatan && <p className="text-[10px] text-muted-foreground truncate">{entry.catatan}</p>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md", entry.role === "Driver" ? "bg-blue-500 text-white" : "bg-orange-500 text-white")}>{entry.role}</span>
                                  </td>
                                  <td className="px-3 py-2 text-right text-sm font-black text-foreground">{parsePointInput(entry.jumlah_titik)}</td>
                                  <td className="px-3 py-2">
                                    {status ? (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${status.color}20`, color: status.color }}>{status.nama}</span>
                                    ) : <span className="text-xs text-muted-foreground italic">-</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Entries */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold text-foreground">Edit Entri Titik</p>
                      <p className="text-[10px] text-muted-foreground">Ubah data di bawah ini jika perlu koreksi.</p>
                    </div>
                    {calEditEntries.map((entry, idx) => (
                      <div key={idx} className="rounded-xl border border-border p-3 space-y-2.5 bg-muted/10">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Entri {idx + 1}</span>
                          {calEditEntries.length > 1 && (
                            <button onClick={() => calEditRemoveRow(idx)} className="text-[10px] text-danger hover:underline">Hapus</button>
                          )}
                        </div>
                        {/* Nama Titik */}
                        <div>
                          <label className="text-[10px] font-semibold text-foreground mb-1 block">Nama Titik</label>
                          <select value={entry.zone_id || ""} onChange={(e) => calEditUpdateRow(idx, "zone_id", parseInt(e.target.value) || 0)}
                            className="w-full text-xs px-2.5 py-2 rounded-lg border border-border bg-card outline-none focus:border-primary text-foreground">
                            <option value="">Pilih nama titik</option>
                            {zones.map((d) => <option key={d.id} value={d.id}>{d.nama}</option>)}
                          </select>
                        </div>
                        {/* Posisi + Titik (inline) */}
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] font-semibold text-foreground mb-1 block">Posisi</label>
                            <div className="flex gap-1">
                              <button type="button" onClick={() => calEditUpdateRow(idx, "role", entry.role === "Driver" ? "" : "Driver")}
                                className={cn("flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                  entry.role === "Driver" ? "bg-blue-500 text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10"
                                )}>Driver</button>
                              <button type="button" onClick={() => calEditUpdateRow(idx, "role", entry.role === "Helper" ? "" : "Helper")}
                                className={cn("flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                                  entry.role === "Helper" ? "bg-orange-500 text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-orange-50 hover:text-orange-500 dark:hover:bg-orange-500/10"
                                )}>Helper</button>
                            </div>
                          </div>
                          <div className="w-20">
                            <label className="text-[10px] font-semibold text-foreground mb-1 block">Titik</label>
                            <input type="number" min={0} value={entry.jumlah_titik} onChange={(e) => calEditUpdateRow(idx, "jumlah_titik", e.target.value)}
                              placeholder="0" className="w-full text-center text-xs font-bold px-2 py-1.5 rounded-lg border border-border bg-card outline-none focus:border-primary text-foreground" />
                          </div>
                        </div>
                        {/* Status + Catatan (inline) */}
                        <div className="flex gap-2">
                          <div className="w-28">
                            <label className="text-[10px] font-semibold text-foreground mb-1 block">Status</label>
                            <select value={entry.status_id || ""} onChange={(e) => calEditUpdateRow(idx, "status_id", parseInt(e.target.value) || 0)}
                              className="w-full text-[10px] px-2 py-1.5 rounded-lg border border-border bg-card outline-none focus:border-primary text-foreground">
                              <option value="">-</option>
                              {dStatuses.map((s) => <option key={s.id} value={s.id}>{s.nama}</option>)}
                            </select>
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] font-semibold text-foreground mb-1 block">Catatan</label>
                            <input type="text" value={entry.catatan} onChange={(e) => calEditUpdateRow(idx, "catatan", e.target.value)}
                              placeholder="Opsional..." className="w-full text-[10px] px-2.5 py-1.5 rounded-lg border border-border bg-card outline-none focus:border-primary text-foreground placeholder:text-muted-foreground/40" />
                          </div>
                        </div>
                      </div>
                    ))}

                    <button type="button" onClick={calEditAddRow}
                      className="w-full py-2 rounded-xl border-2 border-dashed border-border text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                      + Tambah Entri
                    </button>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30 rounded-b-2xl">
                    <Button variant="outline" size="sm" onClick={() => setCalEditCell(null)} disabled={calEditSaving}>Batal</Button>
                    <Button size="sm" icon={Check} onClick={handleCalCellSave} disabled={calEditSaving}>
                      {calEditSaving ? "Menyimpan..." : "Simpan"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Portal>
      )}

      {/* ═══ SINGLE INPUT MODAL ═══ */}
      {showSingleForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !singleSaving && setShowSingleForm(false)} />
            <div className="relative w-full max-w-lg bg-card sm:rounded-2xl shadow-2xl animate-slide-up sm:animate-scale-in overflow-hidden flex flex-col max-h-[90vh] sm:max-h-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Input Titik Tunggal</h2>
                    <p className="text-[11px] text-muted-foreground">Simpan satu pegawai untuk satu tanggal</p>
                  </div>
                </div>
                <button onClick={() => setShowSingleForm(false)} disabled={singleSaving} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-50"><X className="w-4 h-4" /></button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                {singleError && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{singleError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal</label>
                    <DatePicker value={singleForm.tanggal} onChange={(val) => { setSingleForm({ ...singleForm, tanggal: val }); setSingleError(""); }} placeholder="Pilih tanggal" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Pegawai</label>
                    <Select
                      value={singleForm.employee_id}
                      onChange={(val) => { setSingleForm({ ...singleForm, employee_id: val }); setSingleError(""); }}
                      options={employees.map((e) => ({
                        value: e.id,
                        label: e.status === "Training" ? `${e.nama}  • Training` : e.nama,
                      }))}
                      placeholder="Pilih pegawai"
                      searchable
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Titik</label>
                    <Select
                      value={singleForm.zone_id ? String(singleForm.zone_id) : ""}
                      onChange={(val) => { setSingleForm({ ...singleForm, zone_id: parseInt(val) || 0 }); setSingleError(""); }}
                      options={zones.map((d) => ({ value: String(d.id), label: d.nama }))}
                      placeholder="Pilih nama titik"
                      searchable
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Posisi</label>
                    <Select
                      value={singleForm.role}
                      onChange={(val) => { setSingleForm({ ...singleForm, role: val as "Driver" | "Helper" }); setSingleError(""); }}
                      options={[{ value: "Driver", label: "Driver" }, { value: "Helper", label: "Helper" }]}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Jumlah Titik</label>
                    <input
                      type="number"
                      min={0}
                      value={singleForm.jumlah_titik}
                      onChange={(e) => { setSingleForm({ ...singleForm, jumlah_titik: e.target.value }); setSingleError(""); }}
                      className={inputClass}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Status <span className="text-muted-foreground font-normal">(opsional)</span></label>
                    <Select
                      value={String(singleForm.status_id || "")}
                      onChange={(val) => { setSingleForm({ ...singleForm, status_id: parseInt(val) || 0 }); setSingleError(""); }}
                      options={[{ value: "", label: "Tidak ada" }, ...dStatuses.map((s) => ({ value: String(s.id), label: s.nama }))]}
                      placeholder="Pilih status"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                  <input
                    type="text"
                    value={singleForm.catatan}
                    onChange={(e) => setSingleForm({ ...singleForm, catatan: e.target.value })}
                    className={inputClass}
                    placeholder="Tambahkan catatan jika perlu"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
                <Button variant="outline" size="sm" onClick={() => setShowSingleForm(false)} disabled={singleSaving}>Batal</Button>
                <Button size="sm" icon={Check} onClick={handleSingleSave} disabled={singleSaving || !singleCanSave}>
                  {singleSaving ? "Menyimpan..." : "Simpan Data"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ BATCH INPUT MODAL ═══ */}
      {showBatch && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-3">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative w-full max-w-7xl bg-card sm:rounded-2xl shadow-2xl overflow-hidden animate-scale-in flex flex-col" style={{ height: "100vh", maxHeight: "100vh" }}>

              {/* ── Header: Title + Tanggal + Search + Counter + Tabs ── */}
              <div className="px-3 sm:px-5 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
                <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                  {/* Title */}
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div className="hidden sm:block">
                      <h2 className="text-sm font-bold text-foreground leading-tight">Input Titik Harian</h2>
                      <p className="text-[10px] text-muted-foreground">Kosongkan yang tidak bertugas</p>
                    </div>
                  </div>

                  {/* Tanggal */}
                  <div className="w-40 sm:w-48 flex-shrink-0">
                    <DatePicker value={batchDate} onChange={(val) => setBatchDate(val)} placeholder="Pilih tanggal" />
                  </div>

                  {/* Search */}
                  <div className="flex-1 flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2 border border-border focus-within:border-primary min-w-[120px]">
                    <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <input type="text" placeholder="Cari pegawai..." value={batchSearch} onChange={(e) => setBatchSearch(e.target.value)}
                      className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/50 text-foreground" />
                  </div>

                  {/* Counter */}
                  <div className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold flex-shrink-0", batchFilled > 0 ? "border-success/30 bg-success-light/50 text-success" : "border-border bg-muted/30 text-muted-foreground")}>
                    <Check className="w-3.5 h-3.5" />
                    <span>{batchFilled}<span className="text-xs font-normal text-muted-foreground">/{batchRows.length}</span></span>
                  </div>

                  {/* Close */}
                  <button onClick={tryCloseBatch} disabled={batchSaving} className="p-2 sm:p-1.5 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-50 flex-shrink-0 min-h-[36px] min-w-[36px] sm:min-h-auto sm:min-w-auto flex items-center justify-center"><X className="w-4 h-4" /></button>
                </div>
                {/* Mobile filter tabs */}
                <div className="flex items-center gap-1.5 mt-3 lg:hidden overflow-x-auto pb-1">
                  {(["semua", "terisi", "kosong"] as const).map((tab) => (
                    <button key={tab} type="button" onClick={() => setBatchTab(tab)}
                      className={cn(
                        "whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px]",
                        batchTab === tab
                          ? "bg-primary text-white shadow-sm"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab === "semua" && `Semua (${batchRows.length})`}
                      {tab === "terisi" && `Terisi`}
                      {tab === "kosong" && `Kosong`}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Worksheet toolbar ── */}
              <div className="px-5 py-1.5 border-b border-border flex items-center justify-between bg-muted/20">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <GripVertical className="w-3 h-3" />Drag baris untuk ubah urutan
                </p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => addBlankRows(1)} className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-primary hover:bg-primary-light px-2 py-1 rounded-md transition-colors">
                    <Plus className="w-3 h-3" />1 Baris
                  </button>
                  <button type="button" onClick={() => addBlankRows(ADD_ROWS_BATCH)} className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-primary hover:bg-primary-light px-2 py-1 rounded-md transition-colors">
                    <Plus className="w-3 h-3" />{ADD_ROWS_BATCH} Baris
                  </button>
                  <button type="button" onClick={removeBlankRows} className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-danger hover:bg-danger-light px-2 py-1 rounded-md transition-colors">
                    <RotateCcw className="w-3 h-3" />Hapus Kosong
                  </button>
                </div>
              </div>

              {/* ── Worksheet table (desktop) ── */}
              <div className="flex-1 overflow-y-auto max-lg:hidden">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-card border-b-2 border-border shadow-sm">
                      <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-14">#</th>
                      <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 min-w-[200px]">Pegawai</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-40">Nama Titik</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-24">Posisi</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-20">Titik</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-24">Status</th>
                      <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-28">Catatan</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchFiltered.map((row, idx) => {
                      const hasEmp = !!row.employee_id;
                      const hasTitik = hasPointInput(row.jumlah_titik);
                      const hasDiv = !!row.zone_id;
                      const hasRole = !!row.role;
                      const touched = hasEmp || hasTitik || hasDiv || hasRole;
                      const isComplete = hasEmp && hasTitik && hasDiv && hasRole;
                      const isIncomplete = touched && !isComplete;
                      const isDuplicate = batchDuplicateKeys.has(row.rowKey);
                      const isDbDuplicate = dbDuplicateRowKeys.has(row.rowKey);
                      const isDragging = dragIdx === idx;
                      const isDropTarget = dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;
                      const empStatus = row.employee_id ? employees.find((e) => e.id === row.employee_id)?.status : undefined;

                      return (
                        <tr
                          key={row.rowKey}
                          draggable
                          onDragStart={(e) => handleDragStart(e, idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDrop={() => handleDrop(idx)}
                          onDragEnd={handleDragEnd}
                          className={cn(
                            "transition-all duration-200 relative border-b border-border/30",
                            isDragging
                              ? "opacity-30 scale-[0.98] bg-primary/5"
                              : !isDropTarget && (isDuplicate ? "bg-danger/[0.06]" : isDbDuplicate ? "bg-warning/[0.08]" : isComplete ? "bg-success/[0.06]" : isIncomplete ? "bg-danger/[0.04]" : "hover:bg-muted/40"),
                          )}
                          style={isDropTarget ? { boxShadow: "inset 0 3px 0 0 var(--color-primary, #3b82f6)" } : undefined}
                        >
                          {/* # + Grip */}
                          <td className="px-4 py-1.5">
                            <div className="flex items-center gap-1">
                              <div className={cn("p-0.5 rounded cursor-grab active:cursor-grabbing transition-colors", isDragging ? "text-primary" : "text-muted-foreground/30 hover:text-muted-foreground")}>
                                <GripVertical className="w-3.5 h-3.5" />
                              </div>
                              <span className={cn("text-[10px] font-mono", isComplete ? "text-success font-bold" : isIncomplete ? "text-danger font-bold" : "text-muted-foreground")}>{idx + 1}</span>
                            </div>
                          </td>

                          {/* Nama (searchable dropdown) */}
                          <td className="px-4 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 min-w-0">
                                <Select
                                  value={row.employee_id || ""}
                                  onChange={(val) => handleEmployeeChange(row.rowKey, val)}
                                  options={employees.map((e) => ({
                                    value: e.id,
                                    label: e.status === "Training" ? `${e.nama}  • Training` : e.nama,
                                  }))}
                                  placeholder="Pilih pegawai..."
                                  searchable
                                  hasError={isDuplicate}
                                />
                              </div>
                              {empStatus === "Training" && (
                                <span className="text-[8px] font-bold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded flex-shrink-0">TRAINING</span>
                              )}
                              {isDbDuplicate && <span className="text-[8px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded flex-shrink-0">SUDAH ADA</span>}
                            </div>
                          </td>

                          {/* Nama Titik */}
                          <td className="px-4 py-1.5">
                            <Select
                              value={row.zone_id ? String(row.zone_id) : ""}
                              onChange={(val) => handleBatchRowChange(row.rowKey, "zone_id", parseInt(val) || 0)}
                              options={zones.map((d) => ({ value: String(d.id), label: d.nama }))}
                              placeholder="Pilih nama titik..."
                              searchable
                              hasError={isDuplicate}
                            />
                          </td>

                          {/* Posisi */}
                          <td className="px-4 py-1.5">
                            <div className="flex items-center justify-center gap-1">
                              <button type="button" onClick={() => handleBatchRowChange(row.rowKey, "role", row.role === "Driver" ? "" : "Driver")}
                                className={cn("w-8 h-7 rounded-md text-[10px] font-bold transition-all duration-150",
                                  row.role === "Driver" ? "bg-blue-500 text-white shadow-sm shadow-blue-500/25" : "bg-muted/60 text-muted-foreground hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10"
                                )}>D</button>
                              <button type="button" onClick={() => handleBatchRowChange(row.rowKey, "role", row.role === "Helper" ? "" : "Helper")}
                                className={cn("w-8 h-7 rounded-md text-[10px] font-bold transition-all duration-150",
                                  row.role === "Helper" ? "bg-orange-500 text-white shadow-sm shadow-orange-500/25" : "bg-muted/60 text-muted-foreground hover:bg-orange-50 hover:text-orange-500 dark:hover:bg-orange-500/10"
                                )}>H</button>
                            </div>
                          </td>

                          {/* Titik */}
                          <td className="px-4 py-1.5">
                            <input type="number" min={0} placeholder="-" value={row.jumlah_titik}
                              onChange={(e) => handleBatchRowChange(row.rowKey, "jumlah_titik", e.target.value)}
                              className={cn("w-full text-center px-2 py-1.5 rounded-md border text-xs font-semibold outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20",
                                hasTitik ? "border-success/40 bg-success/[0.06] text-success" : isIncomplete && !hasTitik ? "border-danger/50 bg-danger/[0.03] text-foreground placeholder:text-danger/40" : "border-dashed border-border bg-transparent text-foreground placeholder:text-muted-foreground/40"
                              )} />
                          </td>

                          {/* Status */}
                          <td className="px-4 py-1.5">
                            <select value={row.status_id || ""} onChange={(e) => handleBatchRowChange(row.rowKey, "status_id", parseInt(e.target.value) || 0)}
                              className="w-full text-[11px] px-2 py-1.5 rounded-md border border-dashed border-border bg-transparent outline-none focus:border-primary text-foreground">
                              <option value="">-</option>
                              {dStatuses.map((s) => (<option key={s.id} value={s.id}>{s.nama}</option>))}
                            </select>
                          </td>

                          {/* Catatan */}
                          <td className="px-4 py-1.5">
                            <input type="text" placeholder="..." value={row.catatan}
                              onChange={(e) => handleBatchRowChange(row.rowKey, "catatan", e.target.value)}
                              className="w-full text-[11px] px-2 py-1.5 rounded-md border border-dashed border-border bg-transparent outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/30 text-foreground" />
                          </td>

                          {/* Aksi: hapus baris */}
                          <td className="px-2 py-1.5">
                            <div className="flex items-center justify-center">
                              <button type="button" onClick={() => removeRow(row.rowKey)} title="Hapus baris ini"
                                className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold text-muted-foreground hover:text-danger hover:bg-danger-light transition-colors">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Tombol tambah baris di akhir tabel */}
                    <tr>
                      <td colSpan={8} className="px-4 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <button type="button" onClick={() => addBlankRows(1)}
                            className="flex items-center gap-1 text-[10px] font-medium text-primary hover:bg-primary-light px-3 py-1.5 rounded-md transition-colors border border-dashed border-primary/40">
                            <Plus className="w-3 h-3" />Tambah 1 Baris
                          </button>
                          <button type="button" onClick={() => addBlankRows(ADD_ROWS_BATCH)}
                            className="flex items-center gap-1 text-[10px] font-medium text-primary hover:bg-primary-light px-3 py-1.5 rounded-md transition-colors border border-dashed border-primary/40">
                            <Plus className="w-3 h-3" />Tambah {ADD_ROWS_BATCH} Baris
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* ── Worksheet table (mobile) ── */}
              <div className="flex-1 overflow-hidden lg:hidden flex flex-col">
                <div className="overflow-x-auto flex-1">
                  <table className="w-full min-w-[580px]">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-card border-b-2 border-border shadow-sm">
                        <th className="sticky left-0 z-20 bg-card text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2.5 w-10 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]">#</th>
                        <th className="sticky left-[40px] z-20 bg-card text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2.5 min-w-[130px] shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]">Pegawai</th>
                        <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2.5 min-w-[140px]">Nama Titik</th>
                        <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2.5 w-[76px]">Pos</th>
                        <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2.5 w-[76px]">Titik</th>
                        <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2.5 w-[80px]">Status</th>
                        <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2.5 min-w-[90px]">Catatan</th>
                        <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2.5 w-[64px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchFiltered.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-10 text-xs text-muted-foreground">
                            {batchTab === "terisi" ? "Belum ada data yang diisi" : batchTab === "kosong" ? "Semua pegawai sudah diisi" : "Tidak ada pegawai ditemukan"}
                          </td>
                        </tr>
                      ) : batchFiltered.map((row, idx) => {
                        const hasEmp = !!row.employee_id;
                        const hasTitik = hasPointInput(row.jumlah_titik);
                        const hasDiv = !!row.zone_id;
                        const hasRole = !!row.role;
                        const touched = hasEmp || hasTitik || hasDiv || hasRole;
                        const isComplete = hasEmp && hasTitik && hasDiv && hasRole;
                        const isIncomplete = touched && !isComplete;
                        const isDuplicate = batchDuplicateKeys.has(row.rowKey);
                        const isDbDuplicate = dbDuplicateRowKeys.has(row.rowKey);
                        const empStatus = row.employee_id ? employees.find((e) => e.id === row.employee_id)?.status : undefined;

                        return (
                          <tr key={row.rowKey}
                            className={cn(
                              "border-b border-border/30 transition-colors",
                              isDuplicate ? "bg-danger/[0.06]" : isDbDuplicate ? "bg-warning/[0.08]" : isComplete ? "bg-success/[0.06]" : isIncomplete ? "bg-danger/[0.04]" : "hover:bg-muted/30"
                            )}
                          >
                            {/* Sticky: # */}
                            <td className="sticky left-0 z-10 bg-card px-2 py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]">
                              <span className={cn("text-[11px] font-mono font-bold", isComplete ? "text-success" : isIncomplete ? "text-danger" : "text-muted-foreground")}>
                                {idx + 1}
                              </span>
                            </td>
                            {/* Sticky: Nama */}
                            <td className="sticky left-[40px] z-10 bg-card px-2 py-2 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]">
                              <div className="flex items-center gap-1 min-w-0">
                                <p className="text-[13px] font-semibold text-foreground truncate max-w-[110px]">{row.nama}</p>
                                {empStatus === "Training" && (
                                  <span className="text-[7px] font-bold text-amber-600 bg-amber-500/10 px-1 py-0.5 rounded flex-shrink-0">TRAINING</span>
                                )}
                                {isDbDuplicate && (
                                  <span className="text-[7px] font-bold text-warning bg-warning/10 px-1 py-0.5 rounded flex-shrink-0">ADA</span>
                                )}
                              </div>
                            </td>
                            {/* Nama Titik */}
                            <td className="px-2 py-2">
                              <Select
                                value={row.zone_id ? String(row.zone_id) : ""}
                                onChange={(val) => handleBatchRowChange(row.rowKey, "zone_id", parseInt(val) || 0)}
                                options={zones.map((d) => ({ value: String(d.id), label: d.nama }))}
                                placeholder="Pilih titik..."
                                searchable
                                hasError={isDuplicate}
                              />
                            </td>
                            {/* Posisi */}
                            <td className="px-2 py-2">
                              <div className="flex items-center justify-center gap-1">
                                <button type="button" onClick={() => handleBatchRowChange(row.rowKey, "role", row.role === "Driver" ? "" : "Driver")}
                                  className={cn("w-9 h-9 rounded-md text-[11px] font-bold transition-all flex items-center justify-center",
                                    row.role === "Driver" ? "bg-blue-500 text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10"
                                  )}>D</button>
                                <button type="button" onClick={() => handleBatchRowChange(row.rowKey, "role", row.role === "Helper" ? "" : "Helper")}
                                  className={cn("w-9 h-9 rounded-md text-[11px] font-bold transition-all flex items-center justify-center",
                                    row.role === "Helper" ? "bg-orange-500 text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-orange-50 hover:text-orange-500 dark:hover:bg-orange-500/10"
                                  )}>H</button>
                              </div>
                            </td>
                            {/* Titik */}
                            <td className="px-2 py-2">
                              <input type="number" min={0} inputMode="numeric" placeholder="-" value={row.jumlah_titik}
                                onChange={(e) => handleBatchRowChange(row.rowKey, "jumlah_titik", e.target.value)}
                                className={cn("w-full text-center px-2 py-2 rounded-lg border text-[16px] font-bold outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20",
                                  hasTitik ? "border-success/40 bg-success/[0.06] text-success" : isIncomplete && !hasTitik ? "border-danger/50 bg-danger/[0.03] text-foreground placeholder:text-danger/40" : "border-dashed border-border bg-transparent text-foreground placeholder:text-muted-foreground/40"
                                )}
                                style={{ fontSize: "16px" }}
                              />
                            </td>
                            {/* Status */}
                            <td className="px-2 py-2">
                              <select value={row.status_id || ""} onChange={(e) => handleBatchRowChange(row.rowKey, "status_id", parseInt(e.target.value) || 0)}
                                className="w-full text-[13px] px-2 py-2 rounded-lg border border-dashed border-border bg-transparent outline-none focus:border-primary text-foreground">
                                <option value="">-</option>
                                {dStatuses.map((s) => (<option key={s.id} value={s.id}>{s.nama}</option>))}
                              </select>
                            </td>
                            {/* Catatan */}
                            <td className="px-2 py-2">
                              <input type="text" placeholder="..." value={row.catatan}
                                onChange={(e) => handleBatchRowChange(row.rowKey, "catatan", e.target.value)}
                                className="w-full text-[13px] px-2 py-2 rounded-lg border border-dashed border-border bg-transparent outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/30 text-foreground" />
                            </td>
                            {/* Aksi */}
                            <td className="px-1 py-2">
                              <div className="flex items-center justify-center gap-0.5">
                                <button type="button" onClick={() => addSubRow(row.rowKey)} title="Tambah entri lagi"
                                  className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary-light transition-colors">
                                  <Plus className="w-4 h-4" />
                                </button>
                                <button type="button" onClick={() => removeRow(row.rowKey)} title="Hapus baris"
                                  className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-danger hover:bg-danger-light transition-colors">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Hint */}
                <p className="text-[10px] text-muted-foreground/60 text-center py-1.5 border-t border-border/30 bg-muted/10 flex-shrink-0">
                  Geser tabel &rarr; untuk kolom lainnya &middot; Ketuk (+) untuk entri kedua pegawai yang sama
                </p>
              </div>

              {/* ── Footer ── */}
              <div className="px-5 py-3 border-t border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {batchDuplicateKeys.size > 0 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                        <span className="text-danger text-xs font-medium">Ada nama titik + posisi yang sama dalam satu pegawai</span>
                      </div>
                    ) : batchIncomplete.length > 0 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                        <span className="text-danger text-xs font-medium">{batchIncomplete.length} data belum lengkap</span>
                      </div>
                    ) : batchFilled > 0 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                        <span className="text-muted-foreground">Siap simpan</span>
                        <span className="font-bold text-foreground">{batchFilled} pegawai</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Belum ada data yang diisi</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={tryCloseBatch} disabled={batchSaving}>Batal</Button>
                    <Button size="sm" icon={Check} onClick={handleBatchSave} disabled={batchSaving || !batchCanSave}>
                      {batchSaving ? "Menyimpan..." : `Simpan ${batchFilled > 0 ? batchFilled + " Data" : ""}`}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ DUPLICATE CONFIRM DIALOG ═══ */}
      {showDuplicateConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative w-full max-w-sm bg-card sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up sm:animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-7 h-7 text-warning" />
                </div>
                <h3 className="text-base font-bold text-foreground">Data Duplikat Ditemukan</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  <span className="font-semibold text-foreground">{duplicateInfo.dupCount} data</span> sudah ada di tanggal ini dengan pegawai, nama titik, dan posisi yang sama.
                </p>
                <p className="text-xs text-muted-foreground mt-2">Pilih untuk memperbarui jumlah titik yang sudah ada, atau batalkan untuk mengubah input.</p>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowDuplicateConfirm(false)}>Batal</Button>
                <Button size="sm" className="flex-1" onClick={async () => {
                  setShowDuplicateConfirm(false);
                  await executeBatchSave(duplicateInfo.newRows, duplicateInfo.updateRows);
                  setShowBatch(false);
                  await fetchDeliveries();
                }}>Perbarui {duplicateInfo.dupCount} Data</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ CLOSE CONFIRM DIALOG ═══ */}
      {showCloseConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative w-full max-w-sm bg-card sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up sm:animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-7 h-7 text-warning" />
                </div>
                <h3 className="text-base font-bold text-foreground">Tutup Form Input?</h3>
                <p className="text-sm text-muted-foreground mt-2">Data yang sudah diisi belum disimpan dan akan hilang.</p>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowCloseConfirm(false)}>Kembali</Button>
                <Button variant="danger" size="sm" className="flex-1" onClick={confirmCloseBatch}>Tutup & Hapus</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ EDIT SINGLE MODAL ═══ */}
      {showEditForm && editingId && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowEditForm(false)} />
            <div className="relative w-full max-w-sm bg-card sm:rounded-2xl shadow-2xl animate-slide-up sm:animate-scale-in overflow-hidden flex flex-col max-h-[90vh] sm:max-h-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30 flex-shrink-0">
                <h2 className="text-sm font-bold text-foreground">Edit Input Titik</h2>
                <button onClick={() => setShowEditForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                {editError && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{editError}
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Titik</label>
                  <Select
                    value={String(editForm.zone_id)}
                    onChange={(val) => { setEditForm({ ...editForm, zone_id: parseInt(val) }); setEditError(""); }}
                    options={zones.map((d) => ({ value: String(d.id), label: d.nama }))}
                    placeholder="Pilih nama titik"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Posisi</label>
                  <Select value={editForm.role} onChange={(val) => { setEditForm({ ...editForm, role: val }); setEditError(""); }} options={[{ value: "Driver", label: "Driver" }, { value: "Helper", label: "Helper" }]} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Jumlah Titik</label>
                  <input type="number" min={0} value={editForm.jumlah_titik} onChange={(e) => setEditForm({ ...editForm, jumlah_titik: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status <span className="text-muted-foreground font-normal">(opsional)</span></label>
                  <Select
                    value={String(editForm.status_id || "")}
                    onChange={(val) => setEditForm({ ...editForm, status_id: parseInt(val) || 0 })}
                    options={[{ value: "", label: "Tidak ada" }, ...dStatuses.map((s) => ({ value: String(s.id), label: s.nama }))]}
                    placeholder="Pilih status"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                  <input
                    type="text"
                    value={editForm.catatan}
                    onChange={(e) => setEditForm({ ...editForm, catatan: e.target.value })}
                    className={inputClass}
                    placeholder="Tambahkan catatan jika perlu"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
                <Button variant="outline" size="sm" onClick={() => setShowEditForm(false)}>Batal</Button>
                <Button size="sm" icon={Check} onClick={handleEditSave} disabled={!hasPointInput(editForm.jumlah_titik) || !editForm.zone_id}>Simpan</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ REPORT DETAIL ═══ */}
      <ReportDetail
        show={showReport}
        onClose={() => setShowReport(false)}
        zones={zones}
        dStatuses={dStatuses}
      />

      {/* ═══ DELETE CONFIRM ═══ */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up sm:animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-danger" /></div>
                <h3 className="text-base font-bold text-foreground">Hapus Input Titik?</h3>
                <p className="text-sm text-muted-foreground mt-2">Data untuk <span className="font-semibold text-foreground">&ldquo;{deleteConfirm.nama}&rdquo;</span> akan dihapus permanen.</p>
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
    </div>
    </RouteGuard>
  );
}

// ═════════════════════════════════════════════════════════
// HEADER MENU — dropdown kebab untuk HP
// ═════════════════════════════════════════════════════════
function _HeaderMenu({ onShowReport, onOpenCalendar }: { onShowReport: () => void; onOpenCalendar: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-2.5 sm:p-2 rounded-xl border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Menu lainnya"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-48 bg-card rounded-xl border border-border shadow-xl z-50 animate-fade-in overflow-hidden">
          <button
            type="button"
            onClick={() => { onShowReport(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors text-left"
          >
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span>Laporan Detail</span>
          </button>
          <button
            type="button"
            onClick={() => { onOpenCalendar(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors text-left border-t border-border"
          >
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <span>Mode Kalender</span>
          </button>
        </div>
      )}
    </div>
  );
}
