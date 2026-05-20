"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Clock, Plus, Search, Check, X, Pencil, Trash2,
  CircleCheckBig, AlertTriangle,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase, type DbOvertimeRequest } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type EmployeeLite = { id: string; nama: string; jabatan_id: number | null };
type DivisionScheduleLite = { division_id: number; overtime_rate_per_hour: number };
type AttendanceLite = { employee_id: string; division_id: number };
type OvertimeRow = DbOvertimeRequest & { employeeNama?: string };

const PAGE_SIZE = 10;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

const STATUS_OPTIONS = [
  { value: "Menunggu", label: "Menunggu", color: "#f59e0b" },
  { value: "Disetujui", label: "Disetujui", color: "#10b981" },
  { value: "Ditolak", label: "Ditolak", color: "#ef4444" },
];

function formatDurasi(menit: number): string {
  if (menit <= 0) return "0 menit";
  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  if (jam === 0) return `${sisaMenit} menit`;
  if (sisaMenit === 0) return `${jam} jam`;
  return `${jam} jam ${sisaMenit} menit`;
}

function formatTanggal(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function formatJam(t: string): string {
  return t.slice(0, 5);
}

export default function OvertimePage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("overtime");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Semua");

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [schedules, setSchedules] = useState<DivisionScheduleLite[]>([]);
  const [list, setList] = useState<OvertimeRow[]>([]);

  // Form input/edit
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ employee_id: "", tanggal: "", jam_mulai: "", jam_selesai: "", alasan: "" });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Approval
  const [approvalConfirm, setApprovalConfirm] = useState<{ id: number; nama: string; action: "approve" | "reject" } | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [approving, setApproving] = useState(false);

  // Detail catatan
  const [catatanDetail, setCatatanDetail] = useState<{ nama: string; status: string; catatan: string } | null>(null);
  const [alasanDetail, setAlasanDetail] = useState<{ nama: string; tanggal: string; alasan: string } | null>(null);

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
    const { data } = await supabase.from("pegawai").select("id, nama, jabatan_id").eq("status", "Aktif").order("nama");
    if (data) setEmployees(data as EmployeeLite[]);
  };

  const fetchSchedules = async () => {
    // Schedules per divisi (untuk lookup rate saat approve)
    const { data } = await supabase.from("division_schedules").select("division_id, overtime_rate_per_hour").eq("status", "Aktif");
    if (data) setSchedules(data as DivisionScheduleLite[]);
  };

  const fetchList = useCallback(async () => {
    const { data, error } = await supabase
      .from("overtime_requests")
      .select("*, pegawai(nama)")
      .order("created_at", { ascending: false });
    if (error) { showToast("error", "Gagal Memuat Data", error.message); return; }
    if (data) {
      setList(data.map((d) => ({ ...d, employeeNama: d.pegawai?.nama || d.employee_id })) as OvertimeRow[]);
    }
  }, [showToast]);

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchSchedules(), fetchList()]).then(() => setLoading(false));
  }, []);

  /**
   * Cari rate lembur untuk pegawai berdasarkan divisi terakhir yang dia absen.
   * Strategi: ambil attendance_records terakhir pegawai → division_id → schedule.overtime_rate_per_hour.
   * Fallback 0 jika tidak ada record.
   */
  const getEmployeeRate = async (employeeId: string): Promise<number> => {
    const { data: lastAtt } = await supabase
      .from("attendance_records")
      .select("division_id")
      .eq("employee_id", employeeId)
      .not("division_id", "is", null)
      .order("tanggal", { ascending: false })
      .limit(1)
      .maybeSingle<AttendanceLite>();

    if (!lastAtt?.division_id) return 0;
    const sched = schedules.find((s) => s.division_id === lastAtt.division_id);
    return sched?.overtime_rate_per_hour || 0;
  };

  // Summary
  const statusCounts: Record<string, number> = { Menunggu: 0, Disetujui: 0, Ditolak: 0 };
  list.forEach((r) => { if (r.status in statusCounts) statusCounts[r.status]++; });
  const totalLemburApproved = list.filter((r) => r.status === "Disetujui").reduce((s, r) => s + (r.total_lembur || 0), 0);

  // Filter
  const filtered = list.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = (r.employeeNama || "").toLowerCase().includes(q);
    const matchStatus = filterStatus === "Semua" || r.status === filterStatus;
    return matchSearch && matchStatus;
  });
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Form handlers
  const openAdd = () => {
    setForm({ employee_id: "", tanggal: localDateStr(), jam_mulai: "", jam_selesai: "", alasan: "" });
    setFormError("");
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (row: OvertimeRow) => {
    setForm({
      employee_id: row.employee_id,
      tanggal: row.tanggal,
      jam_mulai: row.jam_mulai.slice(0, 5),
      jam_selesai: row.jam_selesai.slice(0, 5),
      alasan: row.alasan || "",
    });
    setFormError("");
    setEditingId(row.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.employee_id) { setFormError("Pilih pegawai."); return; }
    if (!form.tanggal) { setFormError("Pilih tanggal."); return; }
    if (!form.jam_mulai) { setFormError("Isi jam mulai."); return; }
    if (!form.jam_selesai) { setFormError("Isi jam selesai."); return; }
    if (form.jam_selesai <= form.jam_mulai) { setFormError("Jam selesai harus setelah jam mulai."); return; }

    setFormSaving(true);
    const payload: Record<string, unknown> = {
      employee_id: form.employee_id,
      tanggal: form.tanggal,
      jam_mulai: form.jam_mulai,
      jam_selesai: form.jam_selesai,
      alasan: form.alasan || null,
    };

    try {
      if (editingId) {
        const { error } = await supabase.from("overtime_requests").update(payload).eq("id", editingId);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Pengajuan Diperbarui");
      } else {
        const { error } = await supabase.from("overtime_requests").insert(payload);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Pengajuan Dibuat", "Pengajuan lembur berhasil disimpan, menunggu persetujuan.");
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

    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      catatan_approval: approvalNote || null,
      approved_at: new Date().toISOString(),
    };

    // Jika approve, snapshot rate dari divisi pegawai
    if (isApprove) {
      const req = list.find((r) => r.id === approvalConfirm.id);
      if (req) {
        const rate = await getEmployeeRate(req.employee_id);
        updatePayload.rate_per_jam = rate;
      }
    }

    const { error } = await supabase.from("overtime_requests").update(updatePayload).eq("id", approvalConfirm.id);

    if (error) {
      showToast("error", "Gagal", error.message);
    } else {
      showToast("success", isApprove ? "Pengajuan Disetujui" : "Pengajuan Ditolak", isApprove ? "Lembur akan masuk ke laporan periode terkait." : "Pengajuan ditolak.");
      await fetchList();
    }

    setApproving(false);
    setApprovalConfirm(null);
    setApprovalNote("");
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { error } = await supabase.from("overtime_requests").delete().eq("id", deleteConfirm.id);
    if (error) {
      showToast("error", "Gagal Menghapus", error.message);
    } else {
      setList((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
      showToast("success", "Pengajuan Dihapus");
    }
    setDeleting(false);
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <RouteGuard permission="overtime">
        <div className="space-y-6 animate-fade-in">
          <Skeleton className="h-12 w-72" />
          <SkeletonTable rows={5} cols={7} />
        </div>
      </RouteGuard>
    );
  }

  return (
    <RouteGuard permission="overtime">
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Lembur" description="Kelola pengajuan lembur pegawai" icon={Clock}
          actions={canInput ? <Button icon={Plus} size="sm" onClick={openAdd}>Tambah Pengajuan</Button> : undefined} />

        {/* Toast */}
        {toast.show && (
          <Portal>
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
              <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]",
                toast.type === "error" ? "border-danger/20" : "border-success/20")}>
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                  toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
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

        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button onClick={() => { setFilterStatus("Semua"); setPage(1); }}
            className={cn("bg-card rounded-xl border p-4 text-left transition-all", filterStatus === "Semua" ? "border-primary ring-2 ring-primary/10" : "border-border hover:border-primary/30")}>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Total Pengajuan</p>
            <p className="text-2xl font-bold text-foreground mt-1">{list.length}</p>
          </button>
          {STATUS_OPTIONS.map((s) => (
            <button key={s.value} onClick={() => { setFilterStatus(s.value); setPage(1); }}
              className={cn("bg-card rounded-xl border p-4 text-left transition-all", filterStatus === s.value ? "border-primary ring-2 ring-primary/10" : "border-border hover:border-primary/30")}>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{s.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{statusCounts[s.value]}</p>
              {s.value === "Disetujui" && totalLemburApproved > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">Total {formatCurrency(totalLemburApproved)}</p>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Cari nama pegawai..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              autoComplete="off" className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Pegawai</th>
                  <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Tanggal</th>
                  <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Jam</th>
                  <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Durasi</th>
                  <th className="text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Total Lembur</th>
                  <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3 w-32">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-sm text-muted-foreground">Tidak ada pengajuan lembur.</td>
                  </tr>
                ) : paged.map((r) => {
                  const sc = STATUS_OPTIONS.find((s) => s.value === r.status);
                  return (
                    <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-foreground">{r.employeeNama}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{r.employee_id}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-xs text-foreground">{formatTanggal(r.tanggal)}</p>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span className="text-xs font-mono bg-muted/50 px-2 py-1 rounded-md">{formatJam(r.jam_mulai)} – {formatJam(r.jam_selesai)}</span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span className="text-xs font-semibold text-foreground">{formatDurasi(r.durasi_menit || 0)}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {r.status === "Disetujui" ? (
                          <span className="text-sm font-bold text-success">{formatCurrency(r.total_lembur || 0)}</span>
                        ) : r.rate_per_jam > 0 ? (
                          <span className="text-xs text-muted-foreground">{formatCurrency(r.rate_per_jam)}/jam</span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">-</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button
                          onClick={() => r.catatan_approval && setCatatanDetail({ nama: r.employeeNama || "", status: r.status, catatan: r.catatan_approval })}
                          disabled={!r.catatan_approval}
                          className={cn("inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md", r.catatan_approval ? "cursor-pointer hover:opacity-80" : "cursor-default")}
                          style={{ backgroundColor: `${sc?.color}20`, color: sc?.color }}>
                          {r.status}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1">
                          {r.alasan && (
                            <button onClick={() => setAlasanDetail({ nama: r.employeeNama || "", tanggal: formatTanggal(r.tanggal), alasan: r.alasan! })}
                              title="Lihat alasan" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Search className="w-3.5 h-3.5" /></button>
                          )}
                          {canEdit && r.status === "Menunggu" && (
                            <>
                              <button onClick={() => setApprovalConfirm({ id: r.id, nama: r.employeeNama || "", action: "approve" })}
                                title="Setujui" className="p-1.5 rounded-lg hover:bg-success-light text-muted-foreground hover:text-success"><Check className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setApprovalConfirm({ id: r.id, nama: r.employeeNama || "", action: "reject" })}
                                title="Tolak" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><X className="w-3.5 h-3.5" /></button>
                            </>
                          )}
                          {canInput && r.status === "Menunggu" && (
                            <button onClick={() => openEdit(r)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                          )}
                          {canEdit && (
                            <button onClick={() => setDeleteConfirm({ id: r.id, nama: r.employeeNama || "" })}
                              title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

        {/* ═══ ADD/EDIT FORM ═══ */}
        {showForm && (
          <Portal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !formSaving && setShowForm(false)} />
              <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
                <div className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                        {editingId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                      </div>
                      <h2 className="text-sm font-bold text-foreground">{editingId ? "Edit Pengajuan Lembur" : "Tambah Pengajuan Lembur"}</h2>
                    </div>
                    <button onClick={() => !formSaving && setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                  </div>
                </div>

                <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                  {formError && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{formError}
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Pegawai <span className="text-danger">*</span></label>
                    <Select
                      value={form.employee_id}
                      onChange={(val) => { setForm({ ...form, employee_id: val }); setFormError(""); }}
                      options={employees.map((e) => ({ value: e.id, label: e.nama }))}
                      placeholder="Pilih pegawai"
                      searchable
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal <span className="text-danger">*</span></label>
                    <DatePicker value={form.tanggal} onChange={(val) => { setForm({ ...form, tanggal: val }); setFormError(""); }} placeholder="Pilih tanggal" />
                    <p className="text-[10px] text-muted-foreground mt-1">Boleh tanggal mundur (lembur retroaktif diizinkan).</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1.5 block">Jam Mulai <span className="text-danger">*</span></label>
                      <input type="time" value={form.jam_mulai} onChange={(e) => { setForm({ ...form, jam_mulai: e.target.value }); setFormError(""); }} className={inputClass} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1.5 block">Jam Selesai <span className="text-danger">*</span></label>
                      <input type="time" value={form.jam_selesai} onChange={(e) => { setForm({ ...form, jam_selesai: e.target.value }); setFormError(""); }} className={inputClass} />
                    </div>
                  </div>

                  {form.jam_mulai && form.jam_selesai && form.jam_selesai > form.jam_mulai && (() => {
                    const [sh, sm] = form.jam_mulai.split(":").map(Number);
                    const [eh, em] = form.jam_selesai.split(":").map(Number);
                    const menit = (eh * 60 + em) - (sh * 60 + sm);
                    return (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-primary/[0.06] border border-primary/20">
                        <Clock className="w-4 h-4 text-primary" />
                        <span className="text-xs font-semibold text-primary">{formatDurasi(menit)}</span>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Alasan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                    <textarea rows={3} placeholder="Mis. lembur penyelesaian project, deadline, dll..." value={form.alasan}
                      onChange={(e) => setForm({ ...form, alasan: e.target.value })} className={cn(inputClass, "resize-none")} />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/30 flex-shrink-0">
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
                <div className="p-6">
                  <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4",
                    approvalConfirm.action === "approve" ? "bg-success/10" : "bg-danger/10")}>
                    {approvalConfirm.action === "approve" ? <Check className="w-7 h-7 text-success" /> : <X className="w-7 h-7 text-danger" />}
                  </div>
                  <h3 className="text-base font-bold text-foreground text-center">
                    {approvalConfirm.action === "approve" ? "Setujui Pengajuan?" : "Tolak Pengajuan?"}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-2 text-center">
                    Pengajuan lembur dari <span className="font-semibold text-foreground">&ldquo;{approvalConfirm.nama}&rdquo;</span>
                  </p>
                  <div className="mt-4">
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan {approvalConfirm.action === "reject" ? <span className="text-danger">*</span> : <span className="text-muted-foreground font-normal">(opsional)</span>}</label>
                    <textarea rows={3} placeholder={approvalConfirm.action === "approve" ? "Catatan persetujuan..." : "Alasan penolakan..."}
                      value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} className={cn(inputClass, "resize-none")} />
                  </div>
                </div>
                <div className="flex items-center gap-3 px-6 pb-6">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => { setApprovalConfirm(null); setApprovalNote(""); }} disabled={approving}>Batal</Button>
                  <Button size="sm" variant={approvalConfirm.action === "approve" ? "primary" : "danger"} className="flex-1" onClick={handleApproval} disabled={approving || (approvalConfirm.action === "reject" && !approvalNote.trim())}>
                    {approving ? "Memproses..." : approvalConfirm.action === "approve" ? "Setujui" : "Tolak"}
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
                  <h3 className="text-base font-bold text-foreground">Hapus Pengajuan?</h3>
                  <p className="text-sm text-muted-foreground mt-2">Pengajuan lembur dari <span className="font-semibold text-foreground">&ldquo;{deleteConfirm.nama}&rdquo;</span> akan dihapus permanen.</p>
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

        {/* ═══ DETAIL CATATAN ═══ */}
        {catatanDetail && (
          <Portal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setCatatanDetail(null)} />
              <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in">
                <div className="px-6 pt-5 pb-4 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Catatan Persetujuan</h3>
                  <button onClick={() => setCatatanDetail(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="px-6 py-4 space-y-2">
                  <p className="text-xs text-muted-foreground">Pegawai: <span className="font-semibold text-foreground">{catatanDetail.nama}</span></p>
                  <p className="text-xs text-muted-foreground">Status: <span className="font-semibold text-foreground">{catatanDetail.status}</span></p>
                  <div className="mt-3 px-3 py-3 rounded-xl bg-muted/30 text-sm text-foreground whitespace-pre-wrap">{catatanDetail.catatan}</div>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* ═══ DETAIL ALASAN ═══ */}
        {alasanDetail && (
          <Portal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAlasanDetail(null)} />
              <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in">
                <div className="px-6 pt-5 pb-4 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">Alasan Lembur</h3>
                  <button onClick={() => setAlasanDetail(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="px-6 py-4 space-y-2">
                  <p className="text-xs text-muted-foreground">Pegawai: <span className="font-semibold text-foreground">{alasanDetail.nama}</span></p>
                  <p className="text-xs text-muted-foreground">Tanggal: <span className="font-semibold text-foreground">{alasanDetail.tanggal}</span></p>
                  <div className="mt-3 px-3 py-3 rounded-xl bg-muted/30 text-sm text-foreground whitespace-pre-wrap">{alasanDetail.alasan}</div>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </div>
    </RouteGuard>
  );
}
