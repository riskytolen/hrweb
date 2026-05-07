"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Megaphone, Plus, Search, Pencil, Trash2, X, Check, Pin, PinOff,
  AlertTriangle, CircleCheckBig, Clock, Eye, Users, Briefcase,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type JabatanLite = { id: number; nama: string };
type Announcement = {
  id: number; judul: string; konten: string; kategori: string;
  target: string; target_ids: string[] | null;
  tanggal_mulai: string; tanggal_berakhir: string | null;
  is_pinned: boolean; status: string;
  created_at: string; updated_at: string;
};

const PAGE_SIZE = 10;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

const KATEGORI_OPTIONS = [
  { value: "Umum", label: "Umum", color: "#3b82f6" },
  { value: "Penting", label: "Penting", color: "#f59e0b" },
  { value: "Urgent", label: "Urgent", color: "#ef4444" },
];

const TARGET_OPTIONS = [
  { value: "Semua", label: "Semua Pegawai" },
  { value: "Jabatan", label: "Jabatan Tertentu" },
];

const STATUS_OPTIONS = [
  { value: "Aktif", label: "Aktif", color: "#10b981" },
  { value: "Draft", label: "Draft", color: "#6b7280" },
  { value: "Tidak Aktif", label: "Tidak Aktif", color: "#ef4444" },
];

function formatTanggal(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function isExpired(tanggalBerakhir: string | null): boolean {
  if (!tanggalBerakhir) return false;
  return new Date(tanggalBerakhir + "T23:59:59") < new Date();
}

export default function AnnouncementsPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("employees");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterKategori, setFilterKategori] = useState("Semua");
  const [filterStatus, setFilterStatus] = useState("Semua");

  const [list, setList] = useState<Announcement[]>([]);
  const [jabatanList, setJabatanList] = useState<JabatanLite[]>([]);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    judul: "", konten: "", kategori: "Umum",
    target: "Semua", target_ids: [] as number[],
    tanggal_mulai: "", tanggal_berakhir: "",
    is_pinned: false, status: "Aktif",
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Detail view
  const [viewDetail, setViewDetail] = useState<Announcement | null>(null);

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; judul: string } | null>(null);
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
    if (showForm || viewDetail) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm, viewDetail]);

  // Fetch
  const fetchList = useCallback(async () => {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) { showToast("error", "Gagal Memuat Data", error.message); return; }
    if (data) setList(data);
  }, [showToast]);

  const fetchJabatan = async () => {
    const { data } = await supabase.from("jabatan").select("id, nama").eq("status", "Aktif").order("nama");
    if (data) setJabatanList(data);
  };

  useEffect(() => {
    Promise.all([fetchList(), fetchJabatan()]).then(() => setLoading(false));
  }, []);

  // Summary
  const aktifCount = list.filter(a => a.status === "Aktif" && !isExpired(a.tanggal_berakhir)).length;
  const pinnedCount = list.filter(a => a.is_pinned).length;
  const urgentCount = list.filter(a => a.kategori === "Urgent" && a.status === "Aktif").length;

  // Filter
  const filtered = list.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = r.judul.toLowerCase().includes(q) || r.konten.toLowerCase().includes(q);
    const matchKategori = filterKategori === "Semua" || r.kategori === filterKategori;
    const matchStatus = filterStatus === "Semua" || r.status === filterStatus;
    return matchSearch && matchKategori && matchStatus;
  });
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Open form
  const openAdd = () => {
    const today = new Date().toISOString().split("T")[0];
    setForm({ judul: "", konten: "", kategori: "Umum", target: "Semua", target_ids: [], tanggal_mulai: today, tanggal_berakhir: "", is_pinned: false, status: "Aktif" });
    setFormError("");
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (row: Announcement) => {
    setForm({
      judul: row.judul, konten: row.konten, kategori: row.kategori,
      target: row.target, target_ids: (row.target_ids || []).map(Number),
      tanggal_mulai: row.tanggal_mulai, tanggal_berakhir: row.tanggal_berakhir || "",
      is_pinned: row.is_pinned, status: row.status,
    });
    setFormError("");
    setEditingId(row.id);
    setShowForm(true);
  };

  // Save
  const handleSave = async () => {
    setFormError("");
    if (!form.judul.trim()) { setFormError("Judul wajib diisi."); return; }
    if (!form.konten.trim()) { setFormError("Konten wajib diisi."); return; }
    if (!form.tanggal_mulai) { setFormError("Pilih tanggal mulai."); return; }
    if (form.target === "Jabatan" && form.target_ids.length === 0) { setFormError("Pilih minimal 1 jabatan."); return; }

    setFormSaving(true);
    const payload = {
      judul: form.judul.trim(),
      konten: form.konten.trim(),
      kategori: form.kategori,
      target: form.target,
      target_ids: form.target === "Semua" ? null : form.target_ids.map(String),
      tanggal_mulai: form.tanggal_mulai,
      tanggal_berakhir: form.tanggal_berakhir || null,
      is_pinned: form.is_pinned,
      status: form.status,
    };

    try {
      if (editingId) {
        const { error } = await supabase.from("announcements").update(payload).eq("id", editingId);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Pengumuman Diperbarui");
      } else {
        const { error } = await supabase.from("announcements").insert(payload);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Pengumuman Dibuat", form.judul);
      }
      setShowForm(false);
      await fetchList();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setFormSaving(false);
    }
  };

  // Toggle pin
  const handleTogglePin = async (id: number) => {
    const item = list.find(a => a.id === id);
    if (!item) return;
    await supabase.from("announcements").update({ is_pinned: !item.is_pinned }).eq("id", id);
    await fetchList();
    showToast("success", item.is_pinned ? "Pin Dilepas" : "Pengumuman Disematkan");
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { error } = await supabase.from("announcements").delete().eq("id", deleteConfirm.id);
    if (error) showToast("error", "Gagal Menghapus", error.message);
    else {
      showToast("success", "Pengumuman Dihapus");
      setList(prev => prev.filter(a => a.id !== deleteConfirm.id));
    }
    setDeleting(false);
    setDeleteConfirm(null);
  };

  // Helper: get target label
  const getTargetLabel = (row: Announcement): string => {
    if (row.target === "Semua") return "Semua Pegawai";
    if (row.target === "Jabatan" && row.target_ids) {
      const names = row.target_ids.map(id => jabatanList.find(j => j.id === Number(id))?.nama || id).join(", ");
      return names;
    }
    return row.target;
  };

  return (
    <RouteGuard permission="employees">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pengumuman"
        description="Kelola pengumuman dan informasi untuk pegawai"
        icon={Megaphone}
        actions={canInput ? <Button icon={Plus} size="sm" onClick={openAdd}>Buat Pengumuman</Button> : undefined}
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

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Megaphone className="w-5 h-5 text-primary" /></div>
            <div><p className="text-[10px] text-muted-foreground font-medium uppercase">Total</p><p className="text-lg font-bold text-foreground">{loading ? "-" : list.length}</p></div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center"><Check className="w-5 h-5 text-success" /></div>
            <div><p className="text-[10px] text-muted-foreground font-medium uppercase">Aktif</p><p className="text-lg font-bold text-success">{loading ? "-" : aktifCount}</p></div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center"><Pin className="w-5 h-5 text-warning" /></div>
            <div><p className="text-[10px] text-muted-foreground font-medium uppercase">Disematkan</p><p className="text-lg font-bold text-warning">{loading ? "-" : pinnedCount}</p></div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-danger" /></div>
            <div><p className="text-[10px] text-muted-foreground font-medium uppercase">Urgent</p><p className="text-lg font-bold text-danger">{loading ? "-" : urgentCount}</p></div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-card rounded-2xl border border-border p-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" placeholder="Cari judul atau konten..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {[{ label: "Semua", color: "#6b7280" }, ...KATEGORI_OPTIONS.map(k => ({ label: k.value, color: k.color }))].map((item) => (
            <button key={item.label} onClick={() => { setFilterKategori(item.label); setPage(1); }}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                filterKategori === item.label ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted")}>
              {item.label !== "Semua" && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />}
              <span>{item.label}</span>
            </button>
          ))}
          <div className="h-4 w-px bg-border" />
          {[{ label: "Semua", color: "#6b7280" }, ...STATUS_OPTIONS.map(s => ({ label: s.value, color: s.color }))].map((item) => (
            <button key={`s-${item.label}`} onClick={() => { setFilterStatus(item.label); setPage(1); }}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                filterStatus === item.label ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted")}>
              {item.label !== "Semua" && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-5"><Skeleton className="h-5 w-48 mb-2" /><Skeleton className="h-3 w-full mb-1" /><Skeleton className="h-3 w-3/4" /></div>
          ))}</div>
        ) : paged.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border p-10 text-center">
            <Megaphone className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Tidak ada pengumuman</p>
          </div>
        ) : paged.map((row) => {
          const kc = KATEGORI_OPTIONS.find(k => k.value === row.kategori);
          const sc = STATUS_OPTIONS.find(s => s.value === row.status);
          const expired = isExpired(row.tanggal_berakhir);
          return (
            <div key={row.id} className={cn("bg-card rounded-2xl border overflow-hidden transition-all hover:shadow-md",
              row.is_pinned ? "border-warning/30 bg-warning/[0.02]" : "border-border",
              expired && "opacity-60"
            )}>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      {row.is_pinned && <Pin className="w-3.5 h-3.5 text-warning flex-shrink-0" />}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${kc?.color}20`, color: kc?.color }}>{row.kategori}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${sc?.color}20`, color: sc?.color }}>{row.status}</span>
                      {expired && <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-danger/10 text-danger">Berakhir</span>}
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        {row.target === "Semua" ? <Users className="w-3 h-3" /> : <Briefcase className="w-3 h-3" />}
                        {getTargetLabel(row)}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-foreground mb-1 cursor-pointer hover:text-primary" onClick={() => setViewDetail(row)}>{row.judul}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{row.konten}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span>{formatTanggal(row.tanggal_mulai)}</span>
                      {row.tanggal_berakhir && <span>s/d {formatTanggal(row.tanggal_berakhir)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setViewDetail(row)} title="Lihat" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary"><Eye className="w-3.5 h-3.5" /></button>
                    {canEdit && <button onClick={() => handleTogglePin(row.id)} title={row.is_pinned ? "Lepas Pin" : "Sematkan"}
                      className={cn("p-1.5 rounded-lg", row.is_pinned ? "hover:bg-warning/10 text-warning" : "hover:bg-muted text-muted-foreground hover:text-warning")}>
                      {row.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </button>}
                    {canEdit && <button onClick={() => openEdit(row)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                    {canEdit && <button onClick={() => setDeleteConfirm({ id: row.id, judul: row.judul })} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {/* ═══ DETAIL VIEW ═══ */}
      {viewDetail && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewDetail(null)} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => setViewDetail(null)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {viewDetail.is_pinned && <Pin className="w-3.5 h-3.5 text-warning" />}
                  {(() => { const kc = KATEGORI_OPTIONS.find(k => k.value === viewDetail.kategori); return (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${kc?.color}20`, color: kc?.color }}>{viewDetail.kategori}</span>
                  ); })()}
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {viewDetail.target === "Semua" ? <Users className="w-3 h-3" /> : <Briefcase className="w-3 h-3" />}
                    {getTargetLabel(viewDetail)}
                  </span>
                </div>
                <h2 className="text-base font-bold text-foreground">{viewDetail.judul}</h2>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatTanggal(viewDetail.tanggal_mulai)}
                  {viewDetail.tanggal_berakhir && ` s/d ${formatTanggal(viewDetail.tanggal_berakhir)}`}
                </p>
              </div>
              <div className="px-6 py-5 flex-1 overflow-y-auto">
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{viewDetail.konten}</p>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ FORM MODAL ═══ */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !formSaving && setShowForm(false)} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !formSaving && setShowForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                    {editingId ? <Pencil className="w-5 h-5 text-white" /> : <Megaphone className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{editingId ? "Edit Pengumuman" : "Buat Pengumuman"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Informasi untuk pegawai</p>
                  </div>
                </div>
              </div>

              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                {formError && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{formError}
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Judul <span className="text-danger">*</span></label>
                  <input type="text" placeholder="Judul pengumuman..." value={form.judul}
                    onChange={(e) => setForm({ ...form, judul: e.target.value })} className={inputClass} autoFocus />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Konten <span className="text-danger">*</span></label>
                  <textarea rows={5} placeholder="Isi pengumuman..." value={form.konten}
                    onChange={(e) => setForm({ ...form, konten: e.target.value })} className={cn(inputClass, "resize-none")} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Kategori</label>
                    <div className="flex items-center gap-1.5">
                      {KATEGORI_OPTIONS.map((k) => {
                        const active = form.kategori === k.value;
                        return (
                          <button key={k.value} type="button" onClick={() => setForm({ ...form, kategori: k.value })}
                            className={cn("flex-1 py-2 rounded-xl text-[11px] font-bold transition-all border-2",
                              active ? "shadow-sm" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                            )}
                            style={active ? { borderColor: k.color, backgroundColor: `${k.color}15`, color: k.color } : undefined}>
                            {k.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                    <Select value={form.status} onChange={(val) => setForm({ ...form, status: val })}
                      options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Target Penerima</label>
                  <div className="flex items-center gap-2 mb-2">
                    {TARGET_OPTIONS.map((t) => {
                      const active = form.target === t.value;
                      return (
                        <button key={t.value} type="button" onClick={() => setForm({ ...form, target: t.value, target_ids: [] })}
                          className={cn("flex-1 py-2 rounded-xl text-[11px] font-bold transition-all border-2",
                            active ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                          )}>
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                  {form.target === "Jabatan" && (
                    <div className="border border-border rounded-xl bg-card overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox"
                            checked={form.target_ids.length === jabatanList.length && jabatanList.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) setForm({ ...form, target_ids: jabatanList.map(j => j.id) });
                              else setForm({ ...form, target_ids: [] });
                            }}
                            className="rounded border-border text-primary focus:ring-primary" />
                          <span className="text-xs font-semibold text-foreground">Pilih Semua</span>
                        </label>
                      </div>
                      <div className="max-h-32 overflow-y-auto p-2 grid grid-cols-2 gap-1.5">
                        {jabatanList.map(j => (
                          <label key={j.id} className={cn("flex items-center gap-2 p-1.5 rounded-lg cursor-pointer border transition-colors",
                            form.target_ids.includes(j.id) ? "border-primary bg-primary/[0.05]" : "border-transparent hover:bg-muted/50"
                          )}>
                            <input type="checkbox"
                              checked={form.target_ids.includes(j.id)}
                              onChange={(e) => {
                                const newIds = e.target.checked ? [...form.target_ids, j.id] : form.target_ids.filter(id => id !== j.id);
                                setForm({ ...form, target_ids: newIds });
                              }}
                              className="rounded border-border text-primary focus:ring-primary" />
                            <span className="text-[11px] text-foreground truncate">{j.nama}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal Mulai <span className="text-danger">*</span></label>
                    <DatePicker value={form.tanggal_mulai} onChange={(val) => setForm({ ...form, tanggal_mulai: val })} placeholder="Mulai tampil" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal Berakhir <span className="text-muted-foreground font-normal">(opsional)</span></label>
                    <DatePicker value={form.tanggal_berakhir} onChange={(val) => setForm({ ...form, tanggal_berakhir: val })} placeholder="Berakhir tampil" />
                  </div>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer bg-warning/[0.05] border border-warning/20 rounded-xl px-3 py-2.5">
                  <input type="checkbox" checked={form.is_pinned}
                    onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })}
                    className="rounded border-border text-warning focus:ring-warning" />
                  <div>
                    <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Pin className="w-3.5 h-3.5 text-warning" />Sematkan Pengumuman</p>
                    <p className="text-[10px] text-muted-foreground">Pengumuman akan selalu tampil di atas</p>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                <Button size="sm" icon={editingId ? Check : Plus} onClick={handleSave} disabled={formSaving}>
                  {formSaving ? "Menyimpan..." : editingId ? "Simpan" : "Buat"}
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
                <h3 className="text-base font-bold text-foreground">Hapus Pengumuman?</h3>
                <p className="text-sm text-muted-foreground mt-2">&ldquo;<span className="font-semibold text-foreground">{deleteConfirm.judul}</span>&rdquo; akan dihapus permanen.</p>
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
