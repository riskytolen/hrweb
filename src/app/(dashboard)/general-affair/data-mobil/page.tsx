"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Truck, Plus, Search, Pencil, Trash2, X, Check,
  CircleCheckBig, AlertTriangle,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase, type DbGaVehicle } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

const PAGE_SIZE = 15;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

const COLUMNS = [
  { key: "unit", label: "UNIT" },
  { key: "jenis", label: "JENIS" },
  { key: "divisi", label: "DEVISI" },
  { key: "milik", label: "MILIK" },
  { key: "no_rangka", label: "NO RANGKA" },
  { key: "nomer_mesin", label: "NOMER MESIN" },
  { key: "volume", label: "VOLUME" },
  { key: "tonase", label: "TONASE" },
  { key: "suhu", label: "SUHU" },
] as const;

type FormState = {
  unit: string;
  jenis: string;
  divisi: string;
  milik: string;
  no_rangka: string;
  nomer_mesin: string;
  volume: string;
  tonase: string;
  suhu: string;
};

const emptyForm: FormState = {
  unit: "", jenis: "", divisi: "", milik: "",
  no_rangka: "", nomer_mesin: "", volume: "", tonase: "", suhu: "",
};

export default function DataMobilPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("data-mobil");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Semua");

  const [vehicles, setVehicles] = useState<DbGaVehicle[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; unit: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    if (showForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm]);

  const fetchVehicles = useCallback(async () => {
    const { data, error } = await supabase
      .from("ga_vehicles")
      .select("*")
      .order("unit", { ascending: true });
    if (error) { showToast("error", "Gagal Memuat Data", error.message); return; }
    if (data) setVehicles(data as DbGaVehicle[]);
  }, [showToast]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchVehicles();
      setLoading(false);
    })();
  }, [fetchVehicles]);

  const filtered = vehicles.filter((v) => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || v.unit.toLowerCase().includes(q)
      || v.jenis.toLowerCase().includes(q)
      || (v.divisi || "").toLowerCase().includes(q)
      || (v.milik || "").toLowerCase().includes(q)
      || (v.no_rangka || "").toLowerCase().includes(q)
      || (v.nomer_mesin || "").toLowerCase().includes(q)
      || (v.volume || "").toLowerCase().includes(q)
      || (v.tonase || "").toLowerCase().includes(q)
      || (v.suhu || "").toLowerCase().includes(q);
    const matchStatus = filterStatus === "Semua" || v.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const aktifCount = vehicles.filter((v) => v.status === "Aktif").length;
  const tidakAktifCount = vehicles.filter((v) => v.status === "Tidak Aktif").length;

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (v: DbGaVehicle) => {
    setForm({
      unit: v.unit,
      jenis: v.jenis,
      divisi: v.divisi || "",
      milik: v.milik || "",
      no_rangka: v.no_rangka || "",
      nomer_mesin: v.nomer_mesin || "",
      volume: v.volume || "",
      tonase: v.tonase || "",
      suhu: v.suhu || "",
    });
    setEditingId(v.id);
    setFormError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.unit.trim()) { setFormError("Unit wajib diisi."); return; }
    if (!form.jenis.trim()) { setFormError("Jenis wajib diisi."); return; }

    setFormSaving(true);
    const payload = {
      unit: form.unit.trim(),
      jenis: form.jenis.trim(),
      divisi: form.divisi.trim() || null,
      milik: form.milik.trim() || null,
      no_rangka: form.no_rangka.trim() || null,
      nomer_mesin: form.nomer_mesin.trim() || null,
      volume: form.volume.trim() || null,
      tonase: form.tonase.trim() || null,
      suhu: form.suhu.trim() || null,
    };

    try {
      if (editingId) {
        const { data: oldRow } = await supabase.from("ga_vehicles").select("*").eq("id", editingId).maybeSingle();
        const { error } = await supabase.from("ga_vehicles").update(payload).eq("id", editingId);
        if (error) {
          if (error.message.includes("unique") || error.message.includes("duplicate")) {
            setFormError(`Unit "${payload.unit}" sudah digunakan.`);
          } else {
            setFormError(error.message);
          }
          setFormSaving(false);
          return;
        }
        await logAudit({
          supabase, action: "update", entityType: "ga_vehicles", entityId: String(editingId),
          entityLabel: payload.unit, oldData: oldRow as Record<string, unknown>, newData: payload,
        });
        showToast("success", "Data Mobil Diperbarui", `Unit ${payload.unit} berhasil diperbarui.`);
      } else {
        const { data: inserted, error } = await supabase.from("ga_vehicles").insert(payload).select("id").single();
        if (error) {
          if (error.message.includes("unique") || error.message.includes("duplicate")) {
            setFormError(`Unit "${payload.unit}" sudah digunakan.`);
          } else {
            setFormError(error.message);
          }
          setFormSaving(false);
          return;
        }
        await logAudit({
          supabase, action: "create", entityType: "ga_vehicles", entityId: String(inserted?.id || ""),
          entityLabel: payload.unit, newData: payload,
        });
        showToast("success", "Data Mobil Ditambahkan", `Unit ${payload.unit} berhasil disimpan.`);
      }
      setShowForm(false);
      await fetchVehicles();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { data: oldRow } = await supabase.from("ga_vehicles").select("*").eq("id", deleteConfirm.id).maybeSingle();
    const { error } = await supabase.from("ga_vehicles").delete().eq("id", deleteConfirm.id);
    if (error) { showToast("error", "Gagal Menghapus", error.message); setDeleting(false); return; }
    await logAudit({
      supabase, action: "delete", entityType: "ga_vehicles", entityId: String(deleteConfirm.id),
      entityLabel: deleteConfirm.unit, oldData: oldRow as Record<string, unknown>,
    });
    showToast("success", "Data Mobil Dihapus", `Unit ${deleteConfirm.unit} berhasil dihapus.`);
    setDeleting(false);
    setDeleteConfirm(null);
    await fetchVehicles();
  };

  return (
    <RouteGuard permission="data-mobil">
      <div className="space-y-4 animate-fade-in">
        <PageHeader
          title="Data Mobil"
          description="Kelola data kendaraan/mobil operasional General Affair"
          icon={Truck}
          actions={
            canInput && (
              <Button icon={Plus} size="sm" onClick={openAdd}>Tambah Mobil</Button>
            )
          }
        />

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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total Kendaraan</p>
            <p className="text-xl font-bold text-foreground mt-1">{vehicles.length}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Aktif</p>
            <p className="text-xl font-bold text-success mt-1">{aktifCount}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tidak Aktif</p>
            <p className="text-xl font-bold text-danger mt-1">{tidakAktifCount}</p>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input type="text" placeholder="Cari unit, jenis, devisi, milik..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
            </div>
            <Select
              value={filterStatus}
              onChange={(v) => { setFilterStatus(v); setPage(1); }}
              options={[
                { value: "Semua", label: "Semua Status" },
                { value: "Aktif", label: "Aktif" },
                { value: "Tidak Aktif", label: "Tidak Aktif" },
              ]}
              className="w-40"
            />
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">{col.label}</th>
                  ))}
                  <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-20">Status</th>
                  <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {loading ? <SkeletonTable rows={8} cols={12} /> : paged.length === 0 ? (
                  <tr><td colSpan={12} className="text-center py-12 text-sm text-muted-foreground">
                    {vehicles.length === 0 ? "Belum ada data mobil. Klik tombol Tambah Mobil untuk mulai." : "Tidak ada data yang cocok dengan filter."}
                  </td></tr>
                ) : paged.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    {COLUMNS.map((col) => {
                      const value = row[col.key] || "-";
                      return (
                        <td key={col.key} className="px-5 py-3 text-xs text-foreground max-w-[180px] truncate">
                          {col.key === "unit" ? (
                            <span className="font-semibold">{value}</span>
                          ) : (
                            <span className="text-muted-foreground">{value}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-5 py-3 text-center">
                      <span className={cn("inline-flex items-center text-[10px] font-bold px-2 py-1 rounded-full", row.status === "Aktif" ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {canEdit && <button onClick={() => openEdit(row)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                        {canEdit && <button onClick={() => setDeleteConfirm({ id: row.id, unit: row.unit })} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>

        {showForm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
              <div className="relative w-full max-w-2xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Truck className="w-5 h-5 text-primary" /></div>
                    <h3 className="text-base font-bold text-foreground">{editingId ? "Edit Data Mobil" : "Tambah Data Mobil"}</h3>
                  </div>
                  <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {formError && (
                    <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger">{formError}</div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">UNIT *</label>
                      <input type="text" placeholder="B 1234 ABC" value={form.unit}
                        onChange={(e) => setForm({ ...form, unit: e.target.value.toUpperCase() })}
                        className={cn(inputClass, "uppercase")} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">JENIS *</label>
                      <input type="text" placeholder="Box, Wingbox, Tronton, dll" value={form.jenis}
                        onChange={(e) => setForm({ ...form, jenis: e.target.value })}
                        className={inputClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">DEVISI</label>
                      <input type="text" placeholder="Divisi/lokasi" value={form.divisi}
                        onChange={(e) => setForm({ ...form, divisi: e.target.value })}
                        className={inputClass} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">MILIK</label>
                      <input type="text" placeholder="Perusahaan / Rental / Pribadi" value={form.milik}
                        onChange={(e) => setForm({ ...form, milik: e.target.value })}
                        className={inputClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">NO RANGKA</label>
                      <input type="text" placeholder="Nomor rangka kendaraan" value={form.no_rangka}
                        onChange={(e) => setForm({ ...form, no_rangka: e.target.value })}
                        className={inputClass} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">NOMER MESIN</label>
                      <input type="text" placeholder="Nomor mesin kendaraan" value={form.nomer_mesin}
                        onChange={(e) => setForm({ ...form, nomer_mesin: e.target.value })}
                        className={inputClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">VOLUME</label>
                      <input type="text" placeholder="CBM / liter" value={form.volume}
                        onChange={(e) => setForm({ ...form, volume: e.target.value })}
                        className={inputClass} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">TONASE</label>
                      <input type="text" placeholder="Ton / kg" value={form.tonase}
                        onChange={(e) => setForm({ ...form, tonase: e.target.value })}
                        className={inputClass} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">SUHU</label>
                      <input type="text" placeholder="-18C / Normal" value={form.suhu}
                        onChange={(e) => setForm({ ...form, suhu: e.target.value })}
                        className={inputClass} />
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                  <Button size="sm" icon={Check} onClick={handleSave} disabled={formSaving}>{formSaving ? "Menyimpan..." : editingId ? "Simpan" : "Tambah"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {deleteConfirm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
              <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0"><Trash2 className="w-5 h-5 text-danger" /></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-foreground">Hapus Data Mobil?</h3>
                    <p className="text-xs text-muted-foreground mt-1">Unit <strong className="text-foreground">{deleteConfirm.unit}</strong> akan dihapus permanen.</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                  <Button size="sm" icon={Trash2} onClick={handleDelete} disabled={deleting} className="bg-danger text-white hover:bg-danger/90">{deleting ? "Menghapus..." : "Hapus"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </div>
    </RouteGuard>
  );
}
