"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ClipboardCheck, Plus, Search, Pencil, Trash2, X, Check, CircleCheckBig, AlertTriangle,
  ChevronLeft, ChevronRight, ChevronUp, Download, FileText, ChevronDown, Clock, User,
  CalendarOff,
  ArrowRightLeft,
  UserCheck,
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
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type EmployeeLite = { id: string; nama: string; status: string };
type OffDayEntry = { employee_id: string; day_of_week: number };
type OverrideEntry = { id: number; employee_id: string; tanggal: string; type: "libur" | "masuk"; catatan: string | null };
type DivisionLite = { id: number; nama: string; color: string };
type ScheduleLite = { division_id: number; jam_masuk: string; toleransi_menit: number };
type PenaltyLite = { division_id: number; denda_per_menit: number; batas_menit: number; denda_maksimum: number; denda_alpha: number };
type AttendanceRow = DbAttendanceRecord & {
  employeeNama?: string;
  divisionNama?: string;
  divisionColor?: string;
};

const PAGE_SIZE = 15;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

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

/** Get local date string YYYY-MM-DD (timezone safe) */
function localDateStr(d?: Date): string {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Add/subtract days from YYYY-MM-DD string (timezone safe) */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return localDateStr(dt);
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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Semua");
  const [dateFilter, setDateFilter] = useState(() => localDateStr());

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [divisions, setDivisions] = useState<DivisionLite[]>([]);
  const [schedules, setSchedules] = useState<ScheduleLite[]>([]);
  const [penalties, setPenalties] = useState<PenaltyLite[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [offDays, setOffDays] = useState<OffDayEntry[]>([]);
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);

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
  const [offDayTab, setOffDayTab] = useState<"mingguan" | "custom">("mingguan");
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
    if (showForm || showOffDay) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm, showOffDay]);

  // ─── Fetch ───
  const fetchEmployees = async () => {
    const { data } = await supabase.from("pegawai").select("id, nama, status").in("status", ["Aktif", "Training"]).order("nama");
    if (data) setEmployees(data);
  };
  const fetchDivisions = async () => {
    const { data } = await supabase.from("divisions").select("id, nama, color").eq("status", "Aktif").order("nama");
    if (data) setDivisions(data);
  };
  const fetchSchedules = async () => {
    const { data } = await supabase.from("division_schedules").select("division_id, jam_masuk, toleransi_menit").eq("status", "Aktif");
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

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchDivisions(), fetchSchedules(), fetchPenalties(), fetchOffDays(), fetchOverrides(), fetchRecords()]).then(() => setLoading(false));
  }, []);

  useEffect(() => { fetchRecords(); }, [dateFilter, fetchRecords]);

  // ─── Summary ───
  const statusCounts: Record<string, number> = { Hadir: 0, Terlambat: 0, Izin: 0, Sakit: 0, Alpha: 0, Libur: 0, Cuti: 0 };
  records.forEach((r) => { if (r.status in statusCounts) statusCounts[r.status]++; });
  const totalDenda = records.reduce((s, r) => s + r.denda, 0);

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
        const { error } = await supabase.from("attendance_records").update(payload).eq("id", editingId);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Data Diperbarui", "Data absen berhasil diperbarui.");
      } else {
        const { error } = await supabase.from("attendance_records").insert(payload);
        if (error) {
          if (error.message.includes("duplicate") || error.message.includes("unique")) {
            setFormError("Pegawai ini sudah memiliki data absen di tanggal tersebut.");
          } else {
            setFormError(error.message);
          }
          setFormSaving(false);
          return;
        }
        showToast("success", "Absensi Disimpan", `Data absen ${employees.find((e) => e.id === form.employee_id)?.nama || ""} berhasil disimpan.`);
      }
      setShowForm(false);
      setDateFilter(form.tanggal);
      await fetchRecords();
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
    const { error } = await supabase.from("attendance_records").delete().eq("id", deleteConfirm.id);
    if (error) showToast("error", "Gagal Menghapus", error.message);
    else {
      showToast("success", "Data Dihapus", "Data absen berhasil dihapus.");
      setRecords((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
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

  const handleSaveOffDays = async () => {
    setOffDaySaving(true);
    // Per employee: delete existing lalu insert baru
    for (const emp of employees) {
      const newDays = offDayLocal.get(emp.id) || new Set<number>();
      // Hapus semua off-day pegawai ini
      await supabase.from("employee_off_days").delete().eq("employee_id", emp.id);
      // Insert yang baru
      const inserts = Array.from(newDays).map((d) => ({ employee_id: emp.id, day_of_week: d }));
      if (inserts.length > 0) {
        await supabase.from("employee_off_days").insert(inserts);
      }
    }
    await fetchOffDays();
    setOffDaySaving(false);
    setShowOffDay(false);
    const totalDays = Array.from(offDayLocal.values()).reduce((s, days) => s + days.size, 0);
    showToast("success", "Jadwal Libur Disimpan", `${totalDays} hari libur untuk ${employees.length} pegawai.`);
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

      {/* Compact toolbar: date nav + search + status filter + info badges */}
      <div className="bg-card rounded-2xl border border-border p-3">
        {/* Row 1: Date navigator + search + tutup absen */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
            <button onClick={() => { setDateFilter(addDays(dateFilter, -1)); setPage(1); }}
              className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
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
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Jadwal</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Status</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Telat</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Denda</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Catatan</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={6} cols={10} /> : paged.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data absen</td></tr>
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
                      {NO_JAM_STATUSES.includes(row.status)
                        ? <span className="text-muted-foreground italic">-</span>
                        : <span className="text-muted-foreground">{row.schedule_jam_masuk.slice(0, 5)}</span>}
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
                    <DatePicker value={form.tanggal} onChange={(val) => { setForm({ ...form, tanggal: val, employee_id: "" }); if (!editingId) fetchFormExisting(val); }} placeholder="Pilih tanggal" />
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
              ) : (
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
              )}
            </div>

            {/* Footer (hanya untuk tab mingguan) */}
            {offDayTab === "mingguan" && (
              <div className="px-5 py-3 border-t border-border bg-card flex items-center justify-end gap-2 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowOffDay(false)} disabled={offDaySaving}>Batal</Button>
                <Button size="sm" icon={Check} onClick={handleSaveOffDays} disabled={offDaySaving}>
                  {offDaySaving ? "Menyimpan..." : "Simpan Jadwal"}
                </Button>
              </div>
            )}
          </div>
        </Portal>
      )}


    </div>
    </RouteGuard>
  );
}
