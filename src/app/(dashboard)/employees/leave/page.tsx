"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CalendarDays, Plus, Search, Check, X, Clock, Pencil, Trash2,
  CircleCheckBig, AlertTriangle, ChevronDown, Download, FileText,
  Upload, Image, ExternalLink, BarChart3, RefreshCw,
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
import { logAudit, getCurrentApprover } from "@/lib/audit";
import { compressFile } from "@/lib/file-compression";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type EmployeeLite = { id: string; nama: string; tanggal_bergabung?: string };

type LeaveRow = DbLeaveRequest & { employeeNama?: string };
type LeaveSetting = { kuota_cuti_tahunan: number; maks_hari_per_pengajuan: number; prorata: boolean };
type ReportRow = {
  employee_id: string;
  nama: string;
  tanggal_bergabung: string | null;
  kuota: number;
  approved: number;
  pending: number;
  sisa: number;
};

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

function countDaysInYear(start: string, end: string, year: number): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const s = start < yearStart ? yearStart : start;
  const e = end > yearEnd ? yearEnd : end;
  if (s > e) return 0;
  return countDays(s, e);
}

export default function LeavePage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("leave");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Semua");
  const [filterSource, setFilterSource] = useState<"Semua" | "pegawai" | "admin">("Semua");

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [list, setList] = useState<LeaveRow[]>([]);
  const [leaveSetting, setLeaveSetting] = useState<LeaveSetting | null>(null);

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

  // Catatan detail
  const [catatanDetail, setCatatanDetail] = useState<{ nama: string; status: string; catatan: string } | null>(null);
  // Alasan detail
  const [alasanDetail, setAlasanDetail] = useState<{ nama: string; jenis: string; periode: string; alasan: string } | null>(null);

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

  // ─── Report ───
  const [showReport, setShowReport] = useState(false);
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [reportSearch, setReportSearch] = useState("");
  const [reportFilter, setReportFilter] = useState("Semua");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportEmployees, setReportEmployees] = useState<EmployeeLite[]>([]);
  const [reportData, setReportData] = useState<ReportRow[]>([]);

  useEffect(() => {
    if (showForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm]);

  // Fetch
  const fetchEmployees = async () => {
    const { data } = await supabase.from("pegawai").select("id, nama, tanggal_bergabung").eq("status", "Aktif").order("nama");
    if (data) setEmployees(data);
  };
  const fetchLeaveSetting = async () => {
    const { data } = await supabase.from("leave_settings").select("kuota_cuti_tahunan, maks_hari_per_pengajuan, prorata").order("id", { ascending: false }).limit(1).single();
    if (data) setLeaveSetting(data);
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
    Promise.all([fetchEmployees(), fetchList(), fetchLeaveSetting()]).then(() => setLoading(false));
  }, []);

  // Helper: hitung kuota cuti pegawai (prorata jika pegawai baru)
  const getKuotaCuti = (employeeId: string): number => {
    if (!leaveSetting) return 0;
    const emp = employees.find(e => e.id === employeeId);
    if (!emp?.tanggal_bergabung || !leaveSetting.prorata) return leaveSetting.kuota_cuti_tahunan;
    
    const now = new Date();
    const tahunIni = now.getFullYear();
    const bergabung = new Date(emp.tanggal_bergabung + "T00:00:00");
    
    // Jika bergabung sebelum tahun ini, kuota penuh
    if (bergabung.getFullYear() < tahunIni) return leaveSetting.kuota_cuti_tahunan;
    
    // Prorata: sisa bulan di tahun ini
    const bulanBergabung = bergabung.getMonth(); // 0-11
    const sisaBulan = 12 - bulanBergabung;
    return Math.ceil((leaveSetting.kuota_cuti_tahunan / 12) * sisaBulan);
  };

  // Helper: hitung cuti terpakai tahun ini
  const getCutiTerpakai = (employeeId: string): number => {
    const tahunIni = new Date().getFullYear();
    return list
      .filter(r => r.employee_id === employeeId && r.jenis === "Cuti" && r.status !== "Ditolak" && r.tanggal_mulai.startsWith(String(tahunIni)))
      .reduce((total, r) => total + countDays(r.tanggal_mulai, r.tanggal_selesai), 0);
  };

  // Helper: sisa cuti
  const getSisaCuti = (employeeId: string): number => {
    return getKuotaCuti(employeeId) - getCutiTerpakai(employeeId);
  };

  // Summary
  const statusCounts: Record<string, number> = { Menunggu: 0, Disetujui: 0, Ditolak: 0 };
  list.forEach((r) => { if (r.status in statusCounts) statusCounts[r.status]++; });
  const totalHari = list.filter((r) => r.status === "Disetujui").reduce((s, r) => s + countDays(r.tanggal_mulai, r.tanggal_selesai), 0);

  // Filter
  const filtered = list.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = (r.employeeNama || "").toLowerCase().includes(q) || r.jenis.toLowerCase().includes(q);
    const matchStatus = filterStatus === "Semua" || r.status === filterStatus;
    const matchSource = filterSource === "Semua" || r.created_by === filterSource;
    return matchSearch && matchStatus && matchSource;
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

    // Sakit, Izin, Cuti: semua pakai range tanggal_mulai - tanggal_selesai
    const effectiveMulai = form.tanggal_mulai;
    const effectiveSelesai = form.tanggal_selesai || form.tanggal_mulai;

    if (!form.tanggal_mulai) { setFormError("Pilih tanggal mulai."); return; }
    if (!effectiveSelesai) { setFormError("Pilih tanggal selesai."); return; }
    if (effectiveSelesai < effectiveMulai) { setFormError("Tanggal selesai harus >= tanggal mulai."); return; }

    // Validasi kuota cuti (hanya untuk jenis Cuti)
    if (form.jenis === "Cuti" && leaveSetting) {
      const hariDiajukan = countDays(effectiveMulai, effectiveSelesai);
      // Validasi maks hari per pengajuan
      if (hariDiajukan > leaveSetting.maks_hari_per_pengajuan) {
        setFormError(`Maksimal ${leaveSetting.maks_hari_per_pengajuan} hari per pengajuan. Anda mengajukan ${hariDiajukan} hari.`);
        return;
      }
      // Validasi sisa kuota (hanya saat tambah baru)
      if (!editingId) {
        const sisaCuti = getSisaCuti(form.employee_id);
        if (hariDiajukan > sisaCuti) {
          setFormError(`Kuota cuti tidak mencukupi. Sisa cuti: ${sisaCuti} hari, diajukan: ${hariDiajukan} hari.`);
          return;
        }
      }
    }

    // Cek overlap tanggal dengan pengajuan lain (hanya saat tambah baru)
    if (!editingId) {
      const { data: overlap } = await supabase
        .from("leave_requests")
        .select("id, jenis, tanggal_mulai, tanggal_selesai")
        .eq("employee_id", form.employee_id)
        .lte("tanggal_mulai", effectiveSelesai)
        .gte("tanggal_selesai", effectiveMulai)
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
      tanggal_mulai: effectiveMulai,
      tanggal_selesai: effectiveSelesai,
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
        const oldRecord = list.find((r) => r.id === editingId);
        const { error } = await supabase.from("leave_requests").update(payload).eq("id", editingId);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        const empNama = employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id;
        await logAudit({
          supabase,
          action: "update",
          entityType: "leave_requests",
          entityId: editingId,
          entityLabel: `${form.jenis} ${empNama} (${effectiveMulai}${effectiveMulai !== effectiveSelesai ? ` – ${effectiveSelesai}` : ""})`,
          oldData: oldRecord ? { ...oldRecord } as unknown as Record<string, unknown> : null,
          newData: { ...payload } as Record<string, unknown>,
        });
        showToast("success", "Pengajuan Diperbarui");
      } else {
        // Pengajuan baru dari admin = manual input
        const insertPayload = { ...payload, created_by: "admin" };
        const { data: inserted, error } = await supabase
          .from("leave_requests")
          .insert(insertPayload)
          .select("id")
          .single();
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        const empNama = employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id;
        await logAudit({
          supabase,
          action: "manual_input",
          entityType: "leave_requests",
          entityId: inserted?.id ?? undefined,
          entityLabel: `${form.jenis} ${empNama} (${effectiveMulai}${effectiveMulai !== effectiveSelesai ? ` – ${effectiveSelesai}` : ""})`,
          newData: { ...insertPayload, id: inserted?.id } as Record<string, unknown>,
          metadata: { created_by: "admin", durasi_hari: countDays(effectiveMulai, effectiveSelesai) },
        });
        showToast("success", "Pengajuan Dibuat", `${form.jenis} untuk ${countDays(effectiveMulai, effectiveSelesai)} hari.`);
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
    const oldRequest = list.find((r) => r.id === approvalConfirm.id);
    const approver = await getCurrentApprover(supabase);

    const { error } = await supabase.from("leave_requests").update({
      status: newStatus,
      catatan_approval: approvalNote || null,
      approved_at: new Date().toISOString(),
      approved_by_user_id: approver.userId,
      approved_by_nama: approver.nama,
    }).eq("id", approvalConfirm.id);

    if (error) {
      showToast("error", "Gagal", error.message);
    } else {
      // Audit log
      await logAudit({
        supabase,
        action: isApprove ? "approve" : "reject",
        entityType: "leave_requests",
        entityId: approvalConfirm.id,
        entityLabel: oldRequest
          ? `${oldRequest.jenis} ${approvalConfirm.nama} (${oldRequest.tanggal_mulai}${oldRequest.tanggal_mulai !== oldRequest.tanggal_selesai ? ` – ${oldRequest.tanggal_selesai}` : ""})`
          : `Pengajuan ${approvalConfirm.nama}`,
        oldData: oldRequest ? { ...oldRequest } as unknown as Record<string, unknown> : null,
        newData: oldRequest
          ? { ...oldRequest, status: newStatus, catatan_approval: approvalNote || null } as unknown as Record<string, unknown>
          : null,
        metadata: { catatan_approval: approvalNote || null },
      });

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
              division_id: null,
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
                status: req.jenis, division_id: null, jam_masuk: "00:00", durasi_telat: 0, denda: 0,
                catatan: `${req.jenis}: ${req.alasan || "-"}`,
              }).eq("id", existRec.id);
            } else {
              await supabase.from("attendance_records").upsert(attPayload, {
                onConflict: "employee_id,tanggal",
                ignoreDuplicates: false,
              });
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
      await logAudit({
        supabase,
        action: "delete",
        entityType: "leave_requests",
        entityId: deleteConfirm.id,
        entityLabel: req
          ? `${req.jenis} ${deleteConfirm.nama} (${req.tanggal_mulai}${req.tanggal_mulai !== req.tanggal_selesai ? ` – ${req.tanggal_selesai}` : ""})`
          : `Pengajuan ${deleteConfirm.nama}`,
        oldData: req ? { ...req } as unknown as Record<string, unknown> : null,
      });
      showToast("success", "Pengajuan Dihapus");
      setList((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
    }
    setDeleting(false);
    setDeleteConfirm(null);
  };

  // Form preview
  const formDays = form.tanggal_mulai && form.tanggal_selesai && form.tanggal_selesai >= form.tanggal_mulai
    ? countDays(form.tanggal_mulai, form.tanggal_selesai) : 0;

  // ─── Report ───
  const getKuotaForYear = (empId: string, year: number): number => {
    if (!leaveSetting) return 0;
    const emp = reportEmployees.find(e => e.id === empId);
    if (!emp?.tanggal_bergabung || !leaveSetting.prorata) return leaveSetting.kuota_cuti_tahunan;
    const gabung = new Date(emp.tanggal_bergabung + "T00:00:00");
    if (gabung.getFullYear() < year) return leaveSetting.kuota_cuti_tahunan;
    if (gabung.getFullYear() > year) return 0;
    const sisaBulan = 12 - gabung.getMonth();
    return Math.ceil((leaveSetting.kuota_cuti_tahunan / 12) * sisaBulan);
  };

  const generateReportData = useCallback(async () => {
    setReportLoading(true);
    const year = parseInt(reportYear) || new Date().getFullYear();

    // Fetch all employees
    const { data: allEmp } = await supabase
      .from("pegawai")
      .select("id, nama, tanggal_bergabung")
      .order("nama");
    const empList = allEmp || [];
    setReportEmployees(empList);

    // Fetch all approved + pending leave of type "Cuti" for the year
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const { data: leaves } = await supabase
      .from("leave_requests")
      .select("employee_id, jenis, tanggal_mulai, tanggal_selesai, status")
      .eq("jenis", "Cuti")
      .lte("tanggal_mulai", yearEnd)
      .gte("tanggal_selesai", yearStart);

    const leaveMap = new Map<string, { approved: number; pending: number }>();
    leaves?.forEach((l) => {
      const days = countDaysInYear(l.tanggal_mulai, l.tanggal_selesai, year);
      if (days === 0) return;
      if (!leaveMap.has(l.employee_id)) leaveMap.set(l.employee_id, { approved: 0, pending: 0 });
      const entry = leaveMap.get(l.employee_id)!;
      if (l.status === "Menunggu") entry.pending += days;
      else if (l.status === "Disetujui") entry.approved += days;
    });

    const rows: ReportRow[] = empList.map((emp) => {
      const l = leaveMap.get(emp.id);
      const approved = l?.approved || 0;
      const pending = l?.pending || 0;
      const kuota = getKuotaForYear(emp.id, year);
      return {
        employee_id: emp.id,
        nama: emp.nama,
        tanggal_bergabung: emp.tanggal_bergabung || null,
        kuota,
        approved,
        pending,
        sisa: kuota - approved,
      };
    });

    setReportData(rows);
    setReportLoading(false);
  }, [reportYear, leaveSetting]);

  const openReport = () => {
    setReportYear(String(new Date().getFullYear()));
    setReportSearch("");
    setReportFilter("Semua");
    setShowReport(true);
    // Fetch data will be triggered by useEffect on showReport
    setTimeout(() => generateReportData(), 0);
  };

  const exportReportCsv = () => {
    const rows = visibleReportRows;
    if (rows.length === 0) return;
    const year = reportYear;
    const header = "No,Nama Pegawai,Tanggal Bergabung,Kuota (hari),Disetujui (hari),Pending (hari),Sisa (hari),Status";
    const body = rows.map((r, i) => {
      const status = r.sisa <= 0 ? "Habis" : r.sisa <= 3 ? "Menipis" : "Aman";
      return `${i + 1},"${r.nama}",${r.tanggal_bergabung || "-"},${r.kuota},${r.approved},${r.pending},${r.sisa},${status}`;
    }).join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-sisa-cuti-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "Export Berhasil", `Laporan sisa cuti ${year} (${rows.length} pegawai)`);
  };

  const visibleReportRows = reportData.filter((r) => {
    const q = reportSearch.toLowerCase();
    const matchSearch = r.nama.toLowerCase().includes(q);
    const sisaStatus = r.sisa <= 0 ? "Habis" : r.sisa <= 3 ? "Menipis" : "Aman";
    const matchFilter = reportFilter === "Semua" || sisaStatus === reportFilter;
    return matchSearch && matchFilter;
  });

  const statusSisa = (sisa: number): { label: string; color: string } => {
    if (sisa <= 0) return { label: "Habis", color: "#ef4444" };
    if (sisa <= 3) return { label: "Menipis", color: "#f59e0b" };
    return { label: "Aman", color: "#10b981" };
  };

  return (
    <RouteGuard permission="leave">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Cuti & Izin"
        description="Kelola pengajuan cuti, izin, dan sakit pegawai"
        icon={CalendarDays}
        actions={<div className="flex items-center gap-2">{canInput ? <Button icon={Plus} size="sm" onClick={openAdd}>Ajukan</Button> : undefined}<Button variant="outline" size="sm" icon={BarChart3} onClick={openReport}>Laporan</Button></div>}
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
          {/* Filter source */}
          <div className="h-4 w-px bg-border" />
          {([
            { value: "Semua" as const, label: "Semua Sumber" },
            { value: "pegawai" as const, label: "Mobile" },
            { value: "admin" as const, label: "Manual Admin" },
          ]).map((src) => {
            const isActive = filterSource === src.value;
            return (
              <button key={src.value} onClick={() => { setFilterSource(src.value); setPage(1); }}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  isActive ? "bg-warning/10 text-warning ring-1 ring-warning/20" : "text-muted-foreground hover:bg-muted"
                )}>
                <span>{src.label}</span>
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
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{row.employeeNama}</p>
                        {row.created_by === "admin" && (
                          <span className="text-[9px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded" title="Diinput manual oleh admin">
                            MANUAL
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${jc?.color}20`, color: jc?.color }}>{row.jenis}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-foreground">{formatTanggal(row.tanggal_mulai)}</p>
                      {row.tanggal_mulai !== row.tanggal_selesai && (
                        <p className="text-[10px] text-muted-foreground">s/d {formatTanggal(row.tanggal_selesai)}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center text-sm font-semibold text-foreground">
                      {days}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground max-w-[200px]">
                      {row.alasan ? (
                        <button
                          onClick={() => setAlasanDetail({
                            nama: row.employeeNama || "-",
                            jenis: row.jenis,
                            periode: row.tanggal_mulai === row.tanggal_selesai
                              ? formatTanggal(row.tanggal_mulai)
                              : `${formatTanggal(row.tanggal_mulai)} — ${formatTanggal(row.tanggal_selesai)}`,
                            alasan: row.alasan || "",
                          })}
                          className="text-left truncate block max-w-[200px] hover:text-primary transition-colors cursor-pointer"
                          title="Klik untuk lihat selengkapnya"
                        >
                          {row.alasan}
                        </button>
                      ) : <span className="italic">-</span>}
                    </td>
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
                      {row.status !== "Menunggu" && row.approved_by_nama && (
                        <p className="text-[9px] text-muted-foreground mt-1 max-w-[140px] mx-auto truncate" title={row.approved_by_nama}>
                          oleh {row.approved_by_nama}
                        </p>
                      )}
                      {row.catatan_approval && (
                        <button onClick={() => setCatatanDetail({ nama: row.employeeNama || "-", status: row.status, catatan: row.catatan_approval || "" })}
                          className="block text-[10px] text-primary/80 hover:text-primary mt-1 max-w-[140px] mx-auto truncate hover:underline cursor-pointer">
                          &ldquo;{row.catatan_approval}&rdquo;
                        </button>
                      )}
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

                {/* Info kuota cuti */}
                {form.jenis === "Cuti" && form.employee_id && leaveSetting && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-primary/[0.06] border border-primary/20">
                    <CalendarDays className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <span className="text-muted-foreground">Kuota: <span className="font-bold text-foreground">{getKuotaCuti(form.employee_id)} hari</span></span>
                      <span className="text-muted-foreground">Terpakai: <span className="font-bold text-foreground">{getCutiTerpakai(form.employee_id)} hari</span></span>
                      <span className="text-muted-foreground">Sisa: <span className={cn("font-bold", getSisaCuti(form.employee_id) > 0 ? "text-success" : "text-danger")}>{getSisaCuti(form.employee_id)} hari</span></span>
                      <span className="text-muted-foreground">Maks: <span className="font-bold text-warning">{leaveSetting.maks_hari_per_pengajuan} hari/pengajuan</span></span>
                    </div>
                  </div>
                )}

                {form.jenis === "Sakit" && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-danger/[0.06] border border-danger/20">
                    <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-danger leading-relaxed">
                      Pengajuan sakit boleh untuk durasi beberapa hari sekaligus. Lampiran bukti (surat dokter) wajib dilampirkan.
                    </p>
                  </div>
                )}

                {/* Date pickers: range untuk Izin, Sakit, & Cuti */}
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
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5 text-left">
                    {approvalConfirm.action === "approve" ? "Catatan Persetujuan" : "Alasan Penolakan"}
                  </label>
                  <textarea rows={2}
                    placeholder={approvalConfirm.action === "approve" ? "Catatan persetujuan (opsional)..." : "Tuliskan alasan penolakan..."}
                    value={approvalNote}
                    onChange={(e) => setApprovalNote(e.target.value)}
                    className={cn(inputClass, "text-xs resize-none")} />
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

      {/* ═══ ALASAN DETAIL ═══ */}
      {alasanDetail && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAlasanDetail(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">Alasan {alasanDetail.jenis}</p>
                      <p className="text-[10px] text-muted-foreground">{alasanDetail.nama} — {alasanDetail.periode}</p>
                    </div>
                  </div>
                  <button onClick={() => setAlasanDetail(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="bg-muted/30 rounded-xl px-4 py-3 border border-border">
                  <p className="text-sm text-foreground whitespace-pre-wrap">{alasanDetail.alasan}</p>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ CATATAN DETAIL ═══ */}
      {catatanDetail && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setCatatanDetail(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center",
                      catatanDetail.status === "Disetujui" ? "bg-success/10" : "bg-danger/10")}>
                      {catatanDetail.status === "Disetujui"
                        ? <Check className="w-4.5 h-4.5 text-success" />
                        : <X className="w-4.5 h-4.5 text-danger" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">{catatanDetail.status === "Disetujui" ? "Catatan Persetujuan" : "Alasan Penolakan"}</p>
                      <p className="text-[10px] text-muted-foreground">{catatanDetail.nama}</p>
                    </div>
                  </div>
                  <button onClick={() => setCatatanDetail(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="bg-muted/30 rounded-xl px-4 py-3 border border-border">
                  <p className="text-sm text-foreground whitespace-pre-wrap">{catatanDetail.catatan}</p>
                </div>
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

      {/* ═══ LAPORAN KUOTA CUTI ═══ */}
      {showReport && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowReport(false)} />
            <div className="relative w-full max-w-4xl bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              {/* Header */}
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => setShowReport(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                    <BarChart3 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">Laporan Sisa Cuti {reportYear}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Ringkasan kuota dan sisa cuti per pegawai</p>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-muted-foreground" />
                  <input type="text" placeholder="Cari pegawai..." value={reportSearch} onChange={(e) => setReportSearch(e.target.value)}
                    className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
                </div>
                <select value={reportYear} onChange={(e) => { setReportYear(e.target.value); setTimeout(() => generateReportData(), 0); }}
                  className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-xs outline-none text-foreground">
                  {Array.from({ length: 10 }, (_, i) => {
                    const y = new Date().getFullYear() - 1 + i;
                    return <option key={y} value={y}>{y}</option>;
                  })}
                </select>
                <select value={reportFilter} onChange={(e) => setReportFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-xs outline-none text-foreground">
                  <option value="Semua">Semua Status</option>
                  <option value="Aman">Aman</option>
                  <option value="Menipis">Menipis</option>
                  <option value="Habis">Habis</option>
                </select>
                <Button variant="outline" size="sm" icon={RefreshCw} onClick={generateReportData} disabled={reportLoading}>
                  {reportLoading ? "Memuat..." : "Muat Ulang"}
                </Button>
                <Button variant="outline" size="sm" icon={Download} onClick={exportReportCsv} disabled={visibleReportRows.length === 0 || reportLoading}>
                  Export CSV
                </Button>
              </div>

              {/* Summary */}
              {!reportLoading && reportData.length > 0 && (
                <div className="px-6 py-3 border-b border-border bg-muted/20">
                  <div className="flex items-center gap-4 text-xs flex-wrap">
                    <span className="text-muted-foreground">Total Pegawai: <span className="font-bold text-foreground">{reportData.length}</span></span>
                    <span className="text-muted-foreground">Total Kuota: <span className="font-bold text-foreground">{reportData.reduce((s, r) => s + r.kuota, 0)} hari</span></span>
                    <span className="text-muted-foreground">Disetujui: <span className="font-bold text-success">{reportData.reduce((s, r) => s + r.approved, 0)} hari</span></span>
                    <span className="text-muted-foreground">Pending: <span className="font-bold text-warning">{reportData.reduce((s, r) => s + r.pending, 0)} hari</span></span>
                    <span className="text-muted-foreground">Sisa: <span className="font-bold text-primary">{reportData.reduce((s, r) => s + Math.max(0, r.sisa), 0)} hari</span></span>
                    <span className="text-muted-foreground">Habis: <span className="font-bold text-danger">{reportData.filter((r) => r.sisa <= 0).length} pegawai</span></span>
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="flex-1 overflow-y-auto">
                {reportLoading ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">Memuat data...</div>
                ) : visibleReportRows.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">Tidak ada data</div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 sticky top-0">
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-10">#</th>
                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Pegawai</th>
                        <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-28">Bergabung</th>
                        <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Kuota</th>
                        <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Disetujui</th>
                        <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Pending</th>
                        <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-20">Sisa</th>
                        <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3 w-24">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {visibleReportRows.map((r, idx) => {
                        const ss = statusSisa(r.sisa);
                        return (
                          <tr key={r.employee_id} className="hover:bg-muted/30">
                            <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="px-5 py-3">
                              <p className="text-sm font-semibold text-foreground">{r.nama}</p>
                            </td>
                            <td className="px-5 py-3 text-center text-xs text-muted-foreground">
                              {r.tanggal_bergabung ? formatTanggal(r.tanggal_bergabung) : "-"}
                            </td>
                            <td className="px-5 py-3 text-center text-sm font-semibold text-foreground">{r.kuota}</td>
                            <td className="px-5 py-3 text-center text-sm font-semibold text-success">{r.approved}</td>
                            <td className="px-5 py-3 text-center text-sm font-semibold text-warning">{r.pending}</td>
                            <td className="px-5 py-3 text-center text-sm font-semibold" style={{ color: ss.color }}>{r.sisa}</td>
                            <td className="px-5 py-3 text-center">
                              <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${ss.color}20`, color: ss.color }}>{ss.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button size="sm" variant="outline" onClick={() => setShowReport(false)}>Tutup</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
    </RouteGuard>
  );
}
