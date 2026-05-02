"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  UserPlus, Plus, Search, Pencil, Trash2, X, Check, CircleCheckBig, AlertTriangle,
  Phone, Mail, Briefcase, GraduationCap, MapPin, FileText, Upload, ExternalLink, Eye, Car,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase, type DbRecruitment } from "@/lib/supabase";
import { compressFile } from "@/lib/file-compression";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

const PAGE_SIZE = 10;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

const STATUS_OPTIONS = [
  { value: "Lamaran Masuk", label: "Lamaran Masuk", color: "#6b7280" },
  { value: "Terpilih", label: "Terpilih", color: "#3b82f6" },
  { value: "Training", label: "Training", color: "#f59e0b" },
  { value: "Diterima", label: "Diterima", color: "#10b981" },
  { value: "Ditolak", label: "Ditolak", color: "#ef4444" },
];

const PENDIDIKAN_OPTIONS = ["SD", "SMP", "SMA/SMK", "D1", "D2", "D3", "S1", "S2", "S3"];
const SIM_OPTIONS = [
  { value: "", label: "Tidak Ada" },
  { value: "A", label: "SIM A" },
  { value: "B1", label: "SIM B1" },
  { value: "B2", label: "SIM B2" },
  { value: "C", label: "SIM C" },
];

export default function RecruitmentPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("recruitment");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Semua");
  const [list, setList] = useState<DbRecruitment[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    nama: "", no_hp: "", email: "", posisi_dilamar: "", pendidikan_terakhir: "SMA/SMK",
    pengalaman_kerja: "", alamat: "", sim: "", status: "Lamaran Masuk", catatan: "",
    tanggal_training_mulai: "", tanggal_training_selesai: "",
  });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvCompressing, setCvCompressing] = useState(false);
  const [formErrors, setFormErrors] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; nama: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [statusChanging, setStatusChanging] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const [detailId, setDetailId] = useState<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  const fetchList = async () => {
    const { data, error } = await supabase.from("recruitments").select("*").order("created_at", { ascending: false });
    if (error) {
      showToast("error", "Gagal Memuat Data", error.message);
      return;
    }
    if (data) setList(data);
  };

  useEffect(() => { fetchList().then(() => setLoading(false)); }, []);

  useEffect(() => {
    if (showForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm]);

  const deleteOldCv = async (cvUrl: string) => {
    const path = cvUrl.split("/recruitment-docs/")[1];
    if (path) await supabase.storage.from("recruitment-docs").remove([path]);
  };

  const uploadCv = async (file: File, id: number, oldCvUrl?: string | null): Promise<{ url: string | null; error: string | null }> => {
    // Hapus CV lama jika ada (mencegah orphaned files)
    if (oldCvUrl) await deleteOldCv(oldCvUrl);

    const ext = file.name.split(".").pop();
    const path = `cv/${id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("recruitment-docs").upload(path, file, { upsert: true });
    if (error) return { url: null, error: `Gagal upload CV: ${error.message}` };
    const { data } = supabase.storage.from("recruitment-docs").getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  };

  const openAdd = () => {
    setForm({ nama: "", no_hp: "", email: "", posisi_dilamar: "", pendidikan_terakhir: "SMA/SMK", pengalaman_kerja: "", alamat: "", sim: "", status: "Lamaran Masuk", catatan: "", tanggal_training_mulai: "", tanggal_training_selesai: "" });
    setCvFile(null);
    setFormErrors(new Set());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (r: DbRecruitment) => {
    setForm({
      nama: r.nama, no_hp: r.no_hp, email: r.email || "", posisi_dilamar: r.posisi_dilamar,
      pendidikan_terakhir: r.pendidikan_terakhir, pengalaman_kerja: r.pengalaman_kerja || "",
      alamat: r.alamat || "", sim: r.sim || "", status: r.status, catatan: r.catatan || "",
      tanggal_training_mulai: r.tanggal_training_mulai || "", tanggal_training_selesai: r.tanggal_training_selesai || "",
    });
    setCvFile(null);
    setFormErrors(new Set());
    setEditingId(r.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    const errs = new Set<string>();
    if (!form.nama.trim()) errs.add("nama");
    if (!form.no_hp.trim()) errs.add("no_hp");
    if (!form.posisi_dilamar.trim()) errs.add("posisi_dilamar");
    if (!form.pendidikan_terakhir) errs.add("pendidikan_terakhir");
    if (errs.size > 0) { setFormErrors(errs); return; }

    setSaving(true);
    const payload = {
      nama: form.nama, no_hp: form.no_hp, email: form.email || null,
      posisi_dilamar: form.posisi_dilamar, pendidikan_terakhir: form.pendidikan_terakhir,
      pengalaman_kerja: form.pengalaman_kerja || null, alamat: form.alamat || null,
      sim: form.sim || null,
      status: form.status, catatan: form.catatan || null,
      tanggal_training_mulai: form.tanggal_training_mulai || null,
      tanggal_training_selesai: form.tanggal_training_selesai || null,
    };

    try {
      if (editingId !== null) {
        // --- UPDATE ---
        const existingRow = list.find((r) => r.id === editingId);
        let cvUrl: string | null = null;
        let cvWarning = false;

        if (cvFile) {
          const result = await uploadCv(cvFile, editingId, existingRow?.cv_url);
          if (result.error) cvWarning = true;
          else cvUrl = result.url;
        }

        const { error } = await supabase
          .from("recruitments")
          .update({ ...payload, ...(cvUrl ? { cv_url: cvUrl } : {}) })
          .eq("id", editingId);

        if (error) {
          showToast("error", "Gagal Memperbarui", error.message);
          return;
        }

        // Sync pegawai jika status berubah
        if (existingRow && existingRow.status !== form.status) {
          const updatedRec = { ...existingRow, ...payload, ...(cvUrl ? { cv_url: cvUrl } : {}) } as DbRecruitment;
          await syncPegawaiForStatus(updatedRec, form.status);
        } else if (cvWarning) {
          showToast("error", "Data Tersimpan, CV Gagal", "Data pelamar berhasil diperbarui tapi CV gagal diupload.");
        } else {
          showToast("success", "Data Diperbarui", `Pelamar "${form.nama}" telah disimpan.`);
        }
      } else {
        // --- INSERT ---
        const { data: inserted, error } = await supabase
          .from("recruitments")
          .insert(payload)
          .select("id")
          .single();

        if (error || !inserted) {
          showToast("error", "Gagal Menambahkan", error?.message || "Tidak mendapat data dari server.");
          return;
        }

        if (cvFile) {
          const result = await uploadCv(cvFile, inserted.id);
          if (result.error) {
            showToast("error", "Pelamar Ditambahkan, CV Gagal", "Data tersimpan tapi CV gagal diupload. Silakan edit untuk upload ulang.");
          } else if (result.url) {
            const { error: updateErr } = await supabase
              .from("recruitments")
              .update({ cv_url: result.url })
              .eq("id", inserted.id);

            if (updateErr) {
              showToast("error", "CV Terupload, Gagal Simpan URL", "File CV berhasil diupload tapi gagal menyimpan referensinya.");
            } else {
              showToast("success", "Pelamar Ditambahkan", `Data "${form.nama}" berhasil disimpan.`);
            }
          }
        } else {
          showToast("success", "Pelamar Ditambahkan", `Data "${form.nama}" berhasil disimpan.`);
        }
      }

      setSaving(false);
      setShowForm(false);
      setSearch("");
      setFilterStatus("Semua");
      setPage(1);
      await fetchList();
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Kesalahan tidak diketahui.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const targetId = deleteConfirm.id;
    setDeleting(true);
    try {
      // Hapus file CV dari storage jika ada
      const row = list.find((r) => r.id === targetId);
      if (row?.cv_url) await deleteOldCv(row.cv_url);

      const { error } = await supabase.from("recruitments").delete().eq("id", targetId);
      if (error) {
        showToast("error", "Gagal Menghapus", error.message);
        return;
      }

      // Hapus dari state lokal langsung
      setList((prev) => prev.filter((r) => r.id !== targetId));
      showToast("success", "Data Dihapus", "Data pelamar dan file CV telah dihapus.");
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Gagal menghapus data.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  // ─── Helper: generate ID pegawai ───
  const generateEmployeeId = async (): Promise<string> => {
    const { data: allIds } = await supabase.from("pegawai").select("id");
    const existingSet = new Set(allIds?.map((e) => e.id) || []);
    let generated: string;
    do {
      const rand = Math.floor(Math.random() * 100000);
      generated = `ID${String(rand).padStart(5, "0")}`;
    } while (existingSet.has(generated));
    return generated;
  };

  // ─── Helper: insert pegawai dari data recruitment ───
  const insertPegawaiFromRecruitment = async (rec: DbRecruitment, pegawaiStatus: string): Promise<{ id: string } | null> => {
    const newId = await generateEmployeeId();
    const { error } = await supabase.from("pegawai").insert({
      id: newId,
      nama: rec.nama,
      no_telp: rec.no_hp,
      alamat_domisili: rec.alamat || null,
      alamat_ktp: rec.alamat || null,
      status: pegawaiStatus,
      tanggal_bergabung: pegawaiStatus === "Training" ? null : new Date().toISOString().slice(0, 10),
      recruitment_id: rec.id,
    });
    if (error) return null;
    return { id: newId };
  };

  /** Sync pegawai berdasarkan status recruitment. Dipanggil dari handleStatusChange dan handleSave. */
  const syncPegawaiForStatus = async (rec: DbRecruitment, newStatus: string) => {
    // Cek apakah sudah ada pegawai dari recruitment ini
    const { data: existingEmp } = await supabase
      .from("pegawai")
      .select("id, status")
      .eq("recruitment_id", rec.id)
      .limit(1)
      .single();

    if (newStatus === "Training") {
      if (!existingEmp) {
        const result = await insertPegawaiFromRecruitment(rec, "Training");
        if (result) {
          showToast("success", "Training Dimulai", `${rec.nama} terdaftar sebagai pegawai training (${result.id}).`);
        } else {
          showToast("error", "Status Diubah, Gagal Buat Pegawai", "Status berhasil diubah tapi gagal membuat data pegawai.");
        }
      } else {
        await supabase.from("pegawai").update({ status: "Training" }).eq("recruitment_id", rec.id);
        showToast("success", "Status Diperbarui", `Status diubah ke Training.`);
      }
    } else if (newStatus === "Diterima") {
      if (existingEmp) {
        await supabase.from("pegawai").update({
          status: "Aktif",
          tanggal_bergabung: new Date().toISOString().slice(0, 10),
        }).eq("recruitment_id", rec.id);
        showToast("success", "Diterima & Aktif", `${rec.nama} (${existingEmp.id}) sekarang pegawai aktif.`);
      } else {
        // Langsung Diterima tanpa Training → buat pegawai Aktif
        const result = await insertPegawaiFromRecruitment(rec, "Aktif");
        if (result) {
          showToast("success", "Diterima", `${rec.nama} terdaftar sebagai pegawai aktif (${result.id}).`);
        } else {
          showToast("success", "Status Diperbarui", `Status diubah ke Diterima.`);
        }
      }
    } else if (newStatus === "Ditolak") {
      if (existingEmp) {
        await supabase.from("pegawai").delete().eq("recruitment_id", rec.id);
        showToast("success", "Ditolak", `${rec.nama} dihapus dari daftar pegawai. Data rekap titik tetap tersimpan.`);
      } else {
        showToast("success", "Status Diperbarui", `Status diubah ke Ditolak.`);
      }
    } else {
      // Status mundur (Terpilih, Lamaran Masuk) → hapus pegawai jika ada
      if (existingEmp) {
        await supabase.from("pegawai").delete().eq("recruitment_id", rec.id);
        showToast("success", "Status Diperbarui", `${rec.nama} dihapus dari daftar pegawai karena status mundur.`);
      } else {
        showToast("success", "Status Diperbarui", `Status berhasil diubah ke "${newStatus}".`);
      }
    }
  };

  const handleStatusChange = async (id: number, status: string) => {
    setStatusChanging(true);
    try {
      // Jika status Training, set tanggal training otomatis
      const updatePayload: Record<string, unknown> = { status };
      if (status === "Training") {
        const today = new Date().toISOString().slice(0, 10);
        const selesai = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
        updatePayload.tanggal_training_mulai = today;
        updatePayload.tanggal_training_selesai = selesai;
      }

      const { data: updated, error } = await supabase
        .from("recruitments")
        .update(updatePayload)
        .eq("id", id)
        .select("*")
        .single();

      if (error || !updated) {
        showToast("error", "Gagal Ubah Status", error?.message || "Gagal mendapat data terbaru.");
        return;
      }

      setList((prev) => prev.map((r) => (r.id === id ? updated : r)));
      await syncPegawaiForStatus(updated, status);
    } catch (err) {
      showToast("error", "Terjadi Kesalahan", err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setStatusChanging(false);
    }
  };

  const filtered = list.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = r.nama.toLowerCase().includes(q) ||
      r.posisi_dilamar.toLowerCase().includes(q) ||
      r.no_hp.includes(search) ||
      (r.email && r.email.toLowerCase().includes(q));
    const matchStatus = filterStatus === "Semua" || r.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const detail = detailId ? list.find((r) => r.id === detailId) : null;

  const statusCounts: Record<string, number> = { Semua: list.length, "Lamaran Masuk": 0, Terpilih: 0, Training: 0, Diterima: 0, Ditolak: 0 };
  for (const r of list) { if (r.status in statusCounts) statusCounts[r.status]++; }

  return (
    <RouteGuard permission="recruitment">
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Rekrutmen" description="Kelola data pelamar dan proses rekrutmen" icon={UserPlus}
        actions={canInput ? <Button icon={Plus} size="sm" onClick={openAdd}>Tambah Pelamar</Button> : undefined} />

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

      {/* Summary */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {(["Semua", "Lamaran Masuk", "Terpilih", "Training", "Diterima", "Ditolak"] as const).map((s) => {
          const color = STATUS_OPTIONS.find((o) => o.value === s)?.color || "#6b7280";
          const isActive = filterStatus === s;
          return (
            <button key={s} onClick={() => { setFilterStatus(s); setPage(1); }}
              className={cn("bg-card rounded-xl border p-3 text-center transition-all", isActive ? "border-primary ring-2 ring-primary/10" : "border-border hover:border-primary/30")}>
              <p className="text-lg font-bold" style={s !== "Semua" ? { color } : undefined}>{statusCounts[s]}</p>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{s}</p>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Cari nama, posisi, atau no. HP..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            autoComplete="off" className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Nama</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">No. HP</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Posisi Dilamar</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pendidikan</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Status</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">CV</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-32">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={5} cols={8} /> : paged.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data pelamar</td></tr>
              ) : paged.map((r, idx) => {
                const sc = STATUS_OPTIONS.find((o) => o.value === r.status);
                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-foreground">{r.nama}</p>
                      {r.email && <p className="text-[11px] text-muted-foreground">{r.email}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">{r.no_hp}</td>
                    <td className="px-5 py-3.5 text-sm text-foreground">{r.posisi_dilamar}</td>
                    <td className="px-5 py-3.5"><span className="text-xs font-medium bg-muted px-2 py-0.5 rounded text-muted-foreground">{r.pendidikan_terakhir}</span></td>
                    <td className="px-5 py-3.5">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${sc?.color}20`, color: sc?.color }}>{r.status}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {r.cv_url ? (
                        <a href={r.cv_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <FileText className="w-3.5 h-3.5" />Lihat
                        </a>
                      ) : <span className="text-xs text-muted-foreground italic">-</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDetailId(r.id)} title="Lihat Detail" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Eye className="w-3.5 h-3.5" /></button>
                        {canEdit && <button onClick={() => openEdit(r)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                        {canEdit && <button onClick={() => setDeleteConfirm({ id: r.id, nama: r.nama })} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
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
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setShowForm(false)} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30 rounded-t-2xl flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                    {editingId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                  </div>
                  <h2 className="text-sm font-bold text-foreground">{editingId ? "Edit Pelamar" : "Tambah Pelamar Baru"}</h2>
                </div>
                <button onClick={() => !saving && setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4 flex-1 overflow-y-auto">
                {formErrors.size > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                    <X className="w-3.5 h-3.5 flex-shrink-0" />Harap lengkapi field yang wajib diisi
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className={cn("text-xs font-semibold mb-1.5 block", formErrors.has("nama") ? "text-danger" : "text-foreground")}>Nama Lengkap <span className="text-danger">*</span></label>
                    <input type="text" placeholder="Nama pelamar" value={form.nama} onChange={(e) => { setForm({ ...form, nama: e.target.value }); setFormErrors((p) => { const n = new Set(p); n.delete("nama"); return n; }); }} className={cn(inputClass, formErrors.has("nama") && "border-danger")} />
                  </div>
                  <div>
                    <label className={cn("text-xs font-semibold mb-1.5 block", formErrors.has("no_hp") ? "text-danger" : "text-foreground")}>No. HP <span className="text-danger">*</span></label>
                    <input type="tel" placeholder="08xx-xxxx-xxxx" value={form.no_hp} onChange={(e) => { setForm({ ...form, no_hp: e.target.value }); setFormErrors((p) => { const n = new Set(p); n.delete("no_hp"); return n; }); }} className={cn(inputClass, formErrors.has("no_hp") && "border-danger")} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Email</label>
                    <input type="email" placeholder="email@contoh.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className={cn("text-xs font-semibold mb-1.5 block", formErrors.has("posisi_dilamar") ? "text-danger" : "text-foreground")}>Posisi Dilamar <span className="text-danger">*</span></label>
                    <input type="text" placeholder="Contoh: Driver" value={form.posisi_dilamar} onChange={(e) => { setForm({ ...form, posisi_dilamar: e.target.value }); setFormErrors((p) => { const n = new Set(p); n.delete("posisi_dilamar"); return n; }); }} className={cn(inputClass, formErrors.has("posisi_dilamar") && "border-danger")} />
                  </div>
                  <div>
                    <label className={cn("text-xs font-semibold mb-1.5 block", formErrors.has("pendidikan_terakhir") ? "text-danger" : "text-foreground")}>Pendidikan Terakhir <span className="text-danger">*</span></label>
                    <Select value={form.pendidikan_terakhir} onChange={(val) => { setForm({ ...form, pendidikan_terakhir: val }); setFormErrors((p) => { const n = new Set(p); n.delete("pendidikan_terakhir"); return n; }); }}
                      options={PENDIDIKAN_OPTIONS.map((p) => ({ value: p, label: p }))} placeholder="Pilih pendidikan" hasError={formErrors.has("pendidikan_terakhir")} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Pengalaman Kerja</label>
                    <textarea rows={2} placeholder="Deskripsi singkat pengalaman kerja" value={form.pengalaman_kerja} onChange={(e) => setForm({ ...form, pengalaman_kerja: e.target.value })} className={cn(inputClass, "resize-none")} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Alamat</label>
                    <textarea rows={2} placeholder="Alamat lengkap" value={form.alamat} onChange={(e) => setForm({ ...form, alamat: e.target.value })} className={cn(inputClass, "resize-none")} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">SIM</label>
                    <Select value={form.sim} onChange={(val) => setForm({ ...form, sim: val })}
                      options={SIM_OPTIONS} placeholder="Pilih SIM" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                    <Select value={form.status} onChange={(val) => setForm({ ...form, status: val })}
                      options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Upload CV (PDF, maks 300KB)</label>
                    <label className={cn("flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed text-xs transition-all",
                      cvCompressing
                        ? "border-warning/40 bg-warning/5 text-warning cursor-wait pointer-events-none"
                        : cvFile
                          ? "border-success/40 bg-success-light/20 text-success cursor-pointer"
                          : "border-border hover:border-primary/40 text-muted-foreground cursor-pointer")}>
                      {cvCompressing ? (
                        <><span className="w-3.5 h-3.5 border-2 border-warning/30 border-t-warning rounded-full animate-spin" /><span>Memproses...</span></>
                      ) : cvFile ? (
                        <><Check className="w-3.5 h-3.5" /><span className="truncate max-w-[120px]">{cvFile.name}</span></>
                      ) : (
                        <><Upload className="w-3.5 h-3.5" /><span>Pilih file</span></>
                      )}
                      <input type="file" accept=".pdf" className="hidden" disabled={cvCompressing} onChange={async (e) => {
                        const file = e.target.files?.[0] || null;
                        if (!file) { setCvFile(null); return; }
                        setCvCompressing(true);
                        const result = await compressFile(file);
                        setCvCompressing(false);
                        if (!result.success) { showToast("error", "File Gagal", result.error); e.target.value = ""; return; }
                        setCvFile(result.file);
                      }} />
                    </label>
                    {editingId && list.find((r) => r.id === editingId)?.cv_url && !cvFile && !cvCompressing && (
                      <p className="text-[10px] text-success mt-1">CV sudah ada</p>
                    )}
                  </div>
                  {(form.status === "Training" || form.status === "Diterima" || form.status === "Ditolak") && (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-foreground mb-1.5 block">Training Mulai</label>
                        <input type="date" value={form.tanggal_training_mulai} onChange={(e) => {
                          const mulai = e.target.value;
                          const selesai = mulai ? new Date(new Date(mulai).getTime() + 2 * 86400000).toISOString().slice(0, 10) : "";
                          setForm({ ...form, tanggal_training_mulai: mulai, tanggal_training_selesai: selesai });
                        }} className={inputClass} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-foreground mb-1.5 block">Training Selesai</label>
                        <input type="date" value={form.tanggal_training_selesai} onChange={(e) => setForm({ ...form, tanggal_training_selesai: e.target.value })} className={inputClass} />
                        <p className="text-[10px] text-muted-foreground mt-1">Default 3 hari dari tanggal mulai</p>
                      </div>
                    </>
                  )}
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan</label>
                    <input type="text" placeholder="Catatan internal (opsional)" value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} className={inputClass} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30 rounded-b-2xl flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>Batal</Button>
                <Button size="sm" icon={editingId ? Check : Plus} onClick={handleSave} disabled={saving}>
                  {saving ? "Menyimpan..." : editingId ? "Simpan" : "Tambah"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ DETAIL SLIDE-OVER ═══ */}
      {detail && (
        <Portal>
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDetailId(null)} />
            <div className="relative w-full max-w-md bg-card shadow-2xl animate-slide-in-right flex flex-col h-full">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold text-foreground">Detail Pelamar</h2>
                <button onClick={() => setDetailId(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <UserPlus className="w-8 h-8 text-primary/70" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">{detail.nama}</h3>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-md mt-1 inline-block" style={{ backgroundColor: `${STATUS_OPTIONS.find((s) => s.value === detail.status)?.color}20`, color: STATUS_OPTIONS.find((s) => s.value === detail.status)?.color }}>{detail.status}</span>
                </div>

                <div className="space-y-3">
                  {[
                    { icon: Phone, label: "No. HP", value: detail.no_hp },
                    { icon: Mail, label: "Email", value: detail.email || "-" },
                    { icon: Briefcase, label: "Posisi Dilamar", value: detail.posisi_dilamar },
                    { icon: GraduationCap, label: "Pendidikan", value: detail.pendidikan_terakhir },
                    { icon: MapPin, label: "Alamat", value: detail.alamat || "-" },
                    { icon: Car, label: "SIM", value: detail.sim ? `SIM ${detail.sim}` : "Tidak Ada" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        <item.icon className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{item.label}</p>
                        <p className="text-sm text-foreground">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {detail.tanggal_training_mulai && (
                  <div className="rounded-xl border border-warning/20 bg-warning/5 p-3">
                    <p className="text-[10px] text-warning uppercase tracking-wider font-semibold mb-1">Periode Training</p>
                    <p className="text-sm font-semibold text-foreground">{detail.tanggal_training_mulai} s/d {detail.tanggal_training_selesai || "-"}</p>
                  </div>
                )}

                {detail.pengalaman_kerja && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">Pengalaman Kerja</p>
                    <p className="text-sm text-foreground bg-muted/30 rounded-xl p-3">{detail.pengalaman_kerja}</p>
                  </div>
                )}

                {detail.cv_url && (
                  <a href={detail.cv_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border hover:border-primary/30 hover:bg-primary-light/10 transition-colors">
                    <FileText className="w-5 h-5 text-primary" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">Curriculum Vitae</p>
                      <p className="text-[10px] text-muted-foreground">Klik untuk membuka PDF</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </a>
                )}

                {detail.catatan && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">Catatan</p>
                    <p className="text-sm text-foreground bg-muted/30 rounded-xl p-3">{detail.catatan}</p>
                  </div>
                )}

                {/* Quick status change */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Ubah Status</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_OPTIONS.map((s) => (
                      <button key={s.value} disabled={statusChanging}
                        onClick={() => { if (!statusChanging) { handleStatusChange(detail.id, s.value); setDetailId(null); } }}
                        className={cn("text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all",
                          statusChanging ? "opacity-30 cursor-not-allowed" : detail.status === s.value ? "ring-2 shadow-sm" : "opacity-50 hover:opacity-100"
                        )}
                        style={{ backgroundColor: `${s.color}20`, color: s.color, ...(detail.status === s.value ? { boxShadow: `0 0 0 2px ${s.color}40` } : {}) }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 border-t border-border flex-shrink-0">
                <div className="flex items-center gap-2">
                  {canEdit && <Button variant="outline" size="sm" className="flex-1" onClick={() => { openEdit(detail); setDetailId(null); }} icon={Pencil}>Edit</Button>}
                  {canEdit && <Button variant="danger" size="sm" className="flex-1" onClick={() => { setDeleteConfirm({ id: detail.id, nama: detail.nama }); setDetailId(null); }} icon={Trash2}>Hapus</Button>}
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
                <h3 className="text-base font-bold text-foreground">Hapus Pelamar?</h3>
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
