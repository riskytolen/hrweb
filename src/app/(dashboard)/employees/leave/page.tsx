"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CalendarDays, Plus, Search, Check, X, Clock, Pencil, Trash2,
  CircleCheckBig, AlertTriangle, ChevronDown, Download, FileText,
  Upload, Image, ExternalLink,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase, type DbLeaveRequest } from "@/lib/supabase";
import { compressFile } from "@/lib/file-compression";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type EmployeeLite = { id: string; nama: string };
type DivisionLite = { id: number };
type LeaveRow = DbLeaveRequest & { employeeNama?: string };

const PAGE_SIZE = 10;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

const JENIS_OPTIONS = [
  { value: "Izin", label: "Izin", color: "#3b82f6" },
  { value: "Sakit", label: "Sakit", color: "#ef4444" },
  { value: "Cuti", label: "Cuti", color: "#8b5cf6" },
];

const STATUS_OPTIONS = [
  { value: "Menunggu", label: "Menunggu", color: "#f59e0b" },
  { value: "Disetujui", label: "Disetujui", color: "#10b981" },
  { value: "Ditolak", label: "Ditolak", color: "#ef4444" },
];

function countDays(start: string, end: string): number {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}

function formatTanggal(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function LeavePage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("leave");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Semua");

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [divisions, setDivisions] = useState<DivisionLite[]>([]);
  const [list, setList] = useState<LeaveRow[]>([]);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ employee_id: "", jenis: "Izin", tanggal_mulai: "", tanggal_selesai: "", alasan: "" });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [lampFile, setLampFile] = useState<File | null>(null);
  const [lampCompressing, setLampCompressing] = useState(false);

  // Approval
  const [approvalConfirm, setApprovalConfirm] = useState<{ id: number; nama: string; action: "approve" | "reject" } | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [approving, setApproving] = useState(false);

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; nama: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    if (showForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm]);

  // Fetch
  const fetchEmployees = async () => {
    const { data } = await supabase.from("pegawai").select("id, nama").in("status", ["Aktif", "Training"]).order("nama");
    if (data) setEmployees(data);
  };
  const fetchDivisions = async () => {
    const { data } = await supabase.from("divisions").select("id").eq("status", "Aktif").order("id").limit(1);
    if (data) setDivisions(data);
  };

  const fetchList = useCallback(async () => {
    const { data, error } = await supabase
      .from("leave_requests")
      .select("*, pegawai(nama)")
      .order("created_at", { ascending: false });
    if (error) { showToast("error", "Gagal Memuat Data", error.message); return; }
    if (data) {
      setList(data.map((d) => ({ ...d, employeeNama: d.pegawai?.nama || d.employee_id })) as LeaveRow[]);
    }
  }, [showToast]);

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchDivisions(), fetchList()]).then(() => setLoading(false));
  }, []);

  // Summary
  const statusCounts: Record<string, number> = { Menunggu: 0, Disetujui: 0, Ditolak: 0 };
  list.forEach((r) => { if (r.status in statusCounts) statusCounts[r.status]++; });
  const totalHari = list.filter((r) => r.status === "Disetujui").reduce((s, r) => s + countDays(r.tanggal_mulai, r.tanggal_selesai), 0);

  // Filter
  const filtered = list.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = (r.employeeNama || "").toLowerCase().includes(q) || r.jenis.toLowerCase().includes(q);
    const matchStatus = filterStatus === "Semua" || r.status === filterStatus;
    return matchSearch && matchStatus;
  });
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Open form
  const openAdd = () => {
    setForm({ employee_id: "", jenis: "Izin", tanggal_mulai: "", tanggal_selesai: "", alasan: "" });
    setFormError("");
    setLampFile(null);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (row: LeaveRow) => {
    setForm({
      employee_id: row.employee_id, jenis: row.jenis,
      tanggal_mulai: row.tanggal_mulai, tanggal_selesai: row.tanggal_selesai,
      alasan: row.alasan || "",
    });
    setFormError("");
    setLampFile(null);
    setEditingId(row.id);
    setShowForm(true);
  };

  // Save
  const handleSave = async () => {
    setFormError("");
    if (!form.employee_id) { setFormError("Pilih pegawai."); return; }
    if (!form.tanggal_mulai) { setFormError("Pilih tanggal mulai."); return; }
    if (form.jenis !== "Sakit" && !form.tanggal_selesai) { setFormError("Pilih tanggal selesai."); return; }
    if (form.tanggal_selesai && form.tanggal_selesai < form.tanggal_mulai) { setFormError("Tanggal selesai harus >= tanggal mulai."); return; }

    // Cek overlap tanggal dengan pengajuan lain (hanya saat tambah baru)
    if (!editingId) {
      const tglEnd = form.tanggal_selesai || form.tanggal_mulai;
      const { data: overlap } = await supabase
        .from("leave_requests")
        .select("id, jenis, tanggal_mulai, tanggal_selesai")
        .eq("employee_id", form.employee_id)
        .lte("tanggal_mulai", tglEnd)
        .gte("tanggal_selesai", form.tanggal_mulai)
        .limit(1);
      if (overlap && overlap.length > 0) {
        setFormError(`Tanggal bentrok dengan pengajuan ${overlap[0].jenis} (${overlap[0].tanggal_mulai} s/d ${overlap[0].tanggal_selesai}).`);
        return;
      }
    }

    setFormSaving(true);
    const payload: Record<string, unknown> = {
      employee_id: form.employee_id,
      jenis: form.jenis,
      tanggal_mulai: form.tanggal_mulai,
      tanggal_selesai: form.tanggal_selesai || form.tanggal_mulai,
      alasan: form.alasan || null,
    };

    try {
      // Upload lampiran jika ada
      if (lampFile) {
        const ext = lampFile.name.split(".").pop();
        const path = `lampiran/${form.employee_id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("leave-attachments").upload(path, lampFile, { upsert: true });
        if (!upErr) {
          // Hapus lampiran lama jika edit
          if (editingId) {
            const oldRow = list.find((r) => r.id === editingId);
            if (oldRow?.lampiran_url) {
              const oldPath = oldRow.lampiran_url.split("/leave-attachments/")[1];
              if (oldPath) await supabase.storage.from("leave-attachments").remove([oldPath]);
            }
          }
          const { data: urlData } = supabase.storage.from("leave-attachments").getPublicUrl(path);
          payload.lampiran_url = urlData.publicUrl;
        }
      }

      if (editingId) {
        const { error } = await supabase.from("leave_requests").update(payload).eq("id", editingId);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Pengajuan Diperbarui");
      } else {
        const { error } = await supabase.from("leave_requests").insert(payload);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Pengajuan Dibuat", `${form.jenis} untuk ${countDays(form.tanggal_mulai, form.tanggal_selesai)} hari.`);
      }
      setShowForm(false);
      await fetchList();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setFormSaving(false);
    }
  };

  // Approval
  const handleApproval = async () => {
    if (!approvalConfirm) return;
    setApproving(true);
    const isApprove = approvalConfirm.action === "approve";
    const newStatus = isApprove ? "Disetujui" : "Ditolak";

    const { error } = await supabase.from("leave_requests").update({
      status: newStatus,
      catatan_approval: approvalNote || null,
      approved_at: new Date().toISOString(),
    }).eq("id", approvalConfirm.id);

    if (error) {
      showToast("error", "Gagal", error.message);
    } else {
      // Jika disetujui, insert ke attendance_records (skip hari libur)
      if (isApprove) {
        const req = list.find((r) => r.id === approvalConfirm.id);
        if (req) {
          // Fetch hari libur pegawai ini
          const { data: empOffDays } = await supabase
            .from("employee_off_days").select("day_of_week").eq("employee_id", req.employee_id);
          const offDaySet = new Set(empOffDays?.map((o) => o.day_of_week) || []);

          // Fetch custom overrides untuk range ini
          const { data: empOverrides } = await supabase
            .from("employee_leave_overrides").select("tanggal, type").eq("employee_id", req.employee_id)
            .gte("tanggal", req.tanggal_mulai).lte("tanggal", req.tanggal_selesai);
          const overrideMap = new Map<string, string>();
          empOverrides?.forEach((o) => overrideMap.set(o.tanggal, o.type));

          // Generate tanggal dari range (timezone safe)
          const dates: string[] = [];
          const [sy, sm, sd] = req.tanggal_mulai.split("-").map(Number);
          const [ey, em, ed] = req.tanggal_selesai.split("-").map(Number);
          const startMs = Date.UTC(sy, sm - 1, sd);
          const endMs = Date.UTC(ey, em - 1, ed);
          for (let ms = startMs; ms <= endMs; ms += 86400000) {
            const dt = new Date(ms);
            dates.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`);
          }

          const defaultDivId = divisions[0]?.id || 1;

          for (const tanggal of dates) {
            // Skip hari libur (kecuali ada override masuk)
            const [ty, tm, td] = tanggal.split("-").map(Number);
            const dow = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();
            const override = overrideMap.get(tanggal);
            const isOffDay = override === "libur" || (!override && offDaySet.has(dow));
            const isMasukOverride = override === "masuk";
            if (isOffDay && !isMasukOverride) continue; // skip hari libur

            const { data: existRec } = await supabase
              .from("attendance_records").select("id")
              .eq("employee_id", req.employee_id).eq("tanggal", tanggal)
              .limit(1).maybeSingle();

            const attPayload = {
              employee_id: req.employee_id,
              division_id: defaultDivId,
              tanggal,
              jam_masuk: "00:00",
              schedule_jam_masuk: "00:00",
              toleransi_menit: 0,
              status: req.jenis,
              durasi_telat: 0,
              denda: 0,
              catatan: `${req.jenis}: ${req.alasan || "-"}`,
            };

            if (existRec) {
              await supabase.from("attendance_records").update({
                status: req.jenis, jam_masuk: "00:00", durasi_telat: 0, denda: 0,
                catatan: `${req.jenis}: ${req.alasan || "-"}`,
              }).eq("id", existRec.id);
            } else {
              await supabase.from("attendance_records").insert(attPayload);
            }
          }
        }
      }
      showToast("success", isApprove ? "Pengajuan Disetujui" : "Pengajuan Ditolak", approvalConfirm.nama);
      await fetchList();
    }
    setApproving(false);
    setApprovalConfirm(null);
    setApprovalNote("");
  };

  // Helper: cleanup attendance records for a leave request
  const cleanupAttendanceForLeave = async (req: LeaveRow) => {
    if (req.status !== "Disetujui") return;
    // Hapus attendance records yang dibuat dari pengajuan ini
    const [sy, sm, sd] = req.tanggal_mulai.split("-").map(Number);
    const [ey, em, ed] = req.tanggal_selesai.split("-").map(Number);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    for (let ms = startMs; ms <= endMs; ms += 86400000) {
      const dt = new Date(ms);
      const tanggal = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
      await supabase.from("attendance_records")
        .delete()
        .eq("employee_id", req.employee_id)
        .eq("tanggal", tanggal)
        .in("status", ["Izin", "Sakit", "Cuti"]);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    // Cleanup attendance jika sudah disetujui
    const req = list.find((r) => r.id === deleteConfirm.id);
    if (req) await cleanupAttendanceForLeave(req);

    const { error } = await supabase.from("leave_requests").delete().eq("id", deleteConfirm.id);
    if (error) showToast("error", "Gagal Menghapus", error.message);
    else {
      showToast("success", "Pengajuan Dihapus");
      setList((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
    }
    setDeleting(false);
    setDeleteConfirm(null);
  };

  // Form preview
  const formDays = form.tanggal_mulai && form.tanggal_selesai && form.tanggal_selesai >= form.tanggal_mulai
    ? countDays(form.tanggal_mulai, form.tanggal_selesai) : 0;

  return (
    <RouteGuard permission="leave">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Cuti & Izin"
        description="Kelola pengajuan cuti, izin, dan sakit pegawai"
        icon={CalendarDays}
        actions={canEdit ? <Button icon={Plus} size="sm" onClick={openAdd}>Ajukan</Button> : undefined}
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

      {/* Toolbar: status filter + search */}
      <div className="bg-card rounded-2xl border border-border p-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" placeholder="Cari pegawai atau jenis..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {[
            { label: "Semua", value: list.length, color: "#6b7280" },
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
                <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded", isActive ? "bg-primary/15" : "bg-muted")}>{loading ? "-" : stat.value}</span>
              </button>
            );
          })}
          {totalHari > 0 && !loading && (
            <>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 text-[11px]">
                <CalendarDays className="w-3 h-3 text-primary" />
                <span className="text-muted-foreground">Total disetujui:</span>
                <span className="font-bold text-primary">{totalHari} hari</span>
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
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Jenis</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Periode</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Hari</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Alasan</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Bukti</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Status</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-36">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={5} cols={9} /> : paged.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-sm text-muted-foreground">Tidak ada pengajuan</td></tr>
              ) : paged.map((row, idx) => {
                const jc = JENIS_OPTIONS.find((j) => j.value === row.jenis);
                const sc = STATUS_OPTIONS.find((s) => s.value === row.status);
                const days = countDays(row.tanggal_mulai, row.tanggal_selesai);
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{row.employeeNama}</p></td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${jc?.color}20`, color: jc?.color }}>{row.jenis}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-foreground">{formatTanggal(row.tanggal_mulai)}</p>
                      {row.jenis === "Sakit" && row.tanggal_mulai === row.tanggal_selesai ? (
                        <p className="text-[10px] text-warning font-medium">Belum sembuh</p>
                      ) : row.tanggal_mulai !== row.tanggal_selesai ? (
                        <p className="text-[10px] text-muted-foreground">s/d {formatTanggal(row.tanggal_selesai)}</p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3.5 text-center text-sm font-semibold text-foreground">
                      {row.jenis === "Sakit" && row.tanggal_mulai === row.tanggal_selesai ? (
                        <span className="text-warning">-</span>
                      ) : days}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground max-w-[200px] truncate">{row.alasan || <span className="italic">-</span>}</td>
                    <td className="px-5 py-3.5 text-center">
                      {row.lampiran_url ? (
                        <a href={row.lampiran_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <Image className="w-3.5 h-3.5" />Lihat
                        </a>
                      ) : <span className="text-xs text-muted-foreground italic">-</span>}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${sc?.color}20`, color: sc?.color }}>{row.status}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-center gap-1">
                        {canEdit && row.status === "Menunggu" && (
                          <>
                            <button onClick={() => setApprovalConfirm({ id: row.id, nama: `${row.employeeNama} (${row.jenis})`, action: "approve" })}
                              title="Setujui" className="p-1.5 rounded-lg hover:bg-success-light text-muted-foreground hover:text-success"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setApprovalConfirm({ id: row.id, nama: `${row.employeeNama} (${row.jenis})`, action: "reject" })}
                              title="Tolak" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><X className="w-3.5 h-3.5" /></button>
                            <button onClick={() => openEdit(row)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                          </>
                        )}
                        {canEdit && <button onClick={() => setDeleteConfirm({ id: row.id, nama: `${row.employeeNama} (${row.jenis})` })}
                          title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
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

      {/* ═══ FORM MODAL ═══ */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !formSaving && setShowForm(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              {/* Header */}
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !formSaving && setShowForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                    {editingId ? <Pencil className="w-5 h-5 text-white" /> : <CalendarDays className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{editingId ? "Edit Pengajuan" : "Ajukan Cuti / Izin"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Isi data pengajuan di bawah</p>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                {formError && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{formError}
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Pegawai <span className="text-danger">*</span></label>
                  {editingId ? (
                    <div className="px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-foreground">
                      {employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id}
                    </div>
                  ) : (
                    <Select value={form.employee_id} onChange={(val) => { setForm({ ...form, employee_id: val }); setFormError(""); }}
                      options={employees.map((e) => ({ value: e.id, label: e.nama }))} placeholder="Pilih pegawai" searchable />
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Jenis <span className="text-danger">*</span></label>
                  <div className="flex items-center gap-2">
                    {JENIS_OPTIONS.map((j) => {
                      const active = form.jenis === j.value;
                      return (
                        <button key={j.value} type="button" onClick={() => setForm({ ...form, jenis: j.value })}
                          className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border-2",
                            active ? "shadow-md" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                          )}
                          style={active ? { borderColor: j.color, backgroundColor: `${j.color}15`, color: j.color, boxShadow: `0 4px 12px ${j.color}20` } : undefined}>
                          {j.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {form.jenis === "Sakit" ? (
                  /* Sakit: tanggal mulai saja, selesai opsional */
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal Sakit <span className="text-danger">*</span></label>
                      <DatePicker value={form.tanggal_mulai} onChange={(val) => {
                        setForm({ ...form, tanggal_mulai: val, tanggal_selesai: form.tanggal_selesai || "" });
                        setFormError("");
                      }} placeholder="Tanggal mulai sakit" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal Masuk <span className="text-muted-foreground font-normal">(opsional)</span></label>
                      <DatePicker value={form.tanggal_selesai} onChange={(val) => { setForm({ ...form, tanggal_selesai: val }); setFormError(""); }} placeholder="Diisi setelah sembuh" />
                      <p className="text-[10px] text-muted-foreground mt-1">Bisa diisi nanti setelah pegawai masuk kerja</p>
                    </div>
                  </div>
                ) : (
                  /* Izin & Cuti: range tanggal */
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal Mulai <span className="text-danger">*</span></label>
                        <DatePicker value={form.tanggal_mulai} onChange={(val) => {
                          setForm({ ...form, tanggal_mulai: val, tanggal_selesai: form.tanggal_selesai && form.tanggal_selesai >= val ? form.tanggal_selesai : val });
                          setFormError("");
                        }} placeholder="Mulai" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal Selesai <span className="text-danger">*</span></label>
                        <DatePicker value={form.tanggal_selesai} onChange={(val) => { setForm({ ...form, tanggal_selesai: val }); setFormError(""); }} placeholder="Selesai" />
                      </div>
                    </div>

                    {/* Duration preview */}
                    {formDays > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-primary/[0.06] border border-primary/20">
                        <CalendarDays className="w-4 h-4 text-primary" />
                        <span className="text-xs font-semibold text-primary">{formDays} hari</span>
                        <span className="text-[10px] text-muted-foreground">
                          ({formatTanggal(form.tanggal_mulai)}{form.tanggal_mulai !== form.tanggal_selesai ? ` - ${formatTanggal(form.tanggal_selesai)}` : ""})
                        </span>
                      </div>
                    )}
                  </>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Alasan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                  <textarea rows={3} placeholder="Keterangan pengajuan..." value={form.alasan}
                    onChange={(e) => setForm({ ...form, alasan: e.target.value })} className={cn(inputClass, "resize-none")} />
                </div>

                {/* Lampiran foto (opsional, hanya untuk Izin & Sakit) */}
                {(form.jenis === "Izin" || form.jenis === "Sakit") && (
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Bukti Foto <span className="text-muted-foreground font-normal">(opsional, maks 300KB)</span></label>
                    <label className={cn(
                      "flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed text-xs transition-all",
                      lampCompressing
                        ? "border-warning/40 bg-warning/5 text-warning cursor-wait pointer-events-none"
                        : lampFile
                          ? "border-success/40 bg-success-light/20 text-success cursor-pointer"
                          : "border-border hover:border-primary/40 text-muted-foreground hover:text-primary cursor-pointer"
                    )}>
                      {lampCompressing ? (
                        <><span className="w-3.5 h-3.5 border-2 border-warning/30 border-t-warning rounded-full animate-spin" /><span>Memproses...</span></>
                      ) : lampFile ? (
                        <><Check className="w-3.5 h-3.5" /><span className="truncate max-w-[200px]">{lampFile.name}</span></>
                      ) : (
                        <><Upload className="w-3.5 h-3.5" /><span>Upload foto bukti (JPG, PNG, PDF)</span></>
                      )}
                      <input type="file" accept="image/*,.pdf" className="hidden" disabled={lampCompressing} onChange={async (e) => {
                        const file = e.target.files?.[0] || null;
                        if (!file) { setLampFile(null); return; }
                        setLampCompressing(true);
                        const result = await compressFile(file);
                        setLampCompressing(false);
                        if (!result.success) { showToast("error", "File Gagal", result.error); e.target.value = ""; return; }
                        setLampFile(result.file);
                      }} />
                    </label>
                    {editingId && list.find((r) => r.id === editingId)?.lampiran_url && !lampFile && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Image className="w-3 h-3 text-success" />
                        <span className="text-[10px] text-success">Bukti sudah ada</span>
                        <a href={list.find((r) => r.id === editingId)?.lampiran_url || ""} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline ml-1">Lihat</a>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                <Button size="sm" icon={editingId ? Check : Plus} onClick={handleSave} disabled={formSaving}>
                  {formSaving ? "Menyimpan..." : editingId ? "Simpan" : "Ajukan"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ APPROVAL CONFIRM ═══ */}
      {approvalConfirm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !approving && setApprovalConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
              <div className="p-6 text-center">
                <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4",
                  approvalConfirm.action === "approve" ? "bg-success/10" : "bg-danger/10")}>
                  {approvalConfirm.action === "approve"
                    ? <Check className="w-7 h-7 text-success" />
                    : <X className="w-7 h-7 text-danger" />}
                </div>
                <h3 className="text-base font-bold text-foreground">
                  {approvalConfirm.action === "approve" ? "Setujui Pengajuan?" : "Tolak Pengajuan?"}
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  <span className="font-semibold text-foreground">{approvalConfirm.nama}</span>
                </p>
                {approvalConfirm.action === "approve" && (
                  <p className="text-xs text-muted-foreground mt-1 bg-muted/50 rounded-lg px-3 py-2">
                    Data akan otomatis masuk ke rekap absensi
                  </p>
                )}
                <div className="mt-3">
                  <input type="text" placeholder="Catatan (opsional)" value={approvalNote}
                    onChange={(e) => setApprovalNote(e.target.value)}
                    className={cn(inputClass, "text-center text-xs")} />
                </div>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => { setApprovalConfirm(null); setApprovalNote(""); }} disabled={approving}>Batal</Button>
                {approvalConfirm.action === "approve" ? (
                  <Button size="sm" icon={Check} className="flex-1" onClick={handleApproval} disabled={approving}>
                    {approving ? "Memproses..." : "Setujui"}
                  </Button>
                ) : (
                  <Button variant="danger" size="sm" icon={X} className="flex-1" onClick={handleApproval} disabled={approving}>
                    {approving ? "Memproses..." : "Tolak"}
                  </Button>
                )}
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
                <h3 className="text-base font-bold text-foreground">Hapus Pengajuan?</h3>
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
    </div>
    </RouteGuard>
  );
}
