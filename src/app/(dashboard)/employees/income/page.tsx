"use client";

import { useState, useEffect } from "react";
import {
  Wallet,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Check,
  CircleCheckBig,
  Filter,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase, type DbDeliveryPoint } from "@/lib/supabase";

type EmployeeLite = { id: string; nama: string };
type DivisionLite = { id: number; nama: string };
type DeliveryRow = DbDeliveryPoint & { employeeNama?: string; divisionNama?: string };

const PAGE_SIZE = 10;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

export default function IncomePage() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [divisions, setDivisions] = useState<DivisionLite[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ employee_id: "", division_id: 0, role: "Driver", tanggal: new Date().toISOString().slice(0, 10), jumlah_titik: "", catatan: "" });
  const [formRate, setFormRate] = useState<number | null>(null);
  const [formErrors, setFormErrors] = useState<Set<string>>(new Set());

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; nama: string } | null>(null);
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string }>({ show: false, title: "", message: "" });

  const showSuccess = (title: string, message?: string) => {
    setToast({ show: true, title, message: message || "" });
    setTimeout(() => setToast({ show: false, title: "", message: "" }), 3500);
  };

  const fetchEmployees = async () => {
    const { data } = await supabase.from("pegawai").select("id, nama").eq("status", "Aktif").order("nama");
    if (data) setEmployees(data);
  };

  const fetchDivisions = async () => {
    const { data } = await supabase.from("divisions").select("id, nama").eq("status", "Aktif").order("nama");
    if (data) setDivisions(data);
  };

  const fetchDeliveries = async () => {
    const { data } = await supabase
      .from("delivery_points")
      .select("*, pegawai(nama), divisions(nama)")
      .gte("tanggal", `${filterDate}-01`)
      .lte("tanggal", `${filterDate}-31`)
      .order("tanggal", { ascending: false });
    if (data) {
      setDeliveries(data.map((d) => ({
        ...d,
        employeeNama: d.pegawai?.nama || d.employee_id,
        divisionNama: d.divisions?.nama || "-",
      })) as DeliveryRow[]);
    }
  };

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchDivisions()]).then(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDeliveries();
  }, [filterDate]);

  useEffect(() => {
    if (showForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm]);

  // Lookup rate saat divisi + role berubah
  const lookupRate = async (divId: number, role: string) => {
    const { data } = await supabase.from("point_rates").select("rate_per_point").eq("division_id", divId).eq("role", role).eq("status", "Aktif").single();
    setFormRate(data?.rate_per_point ?? null);
  };

  const handleFormChange = (field: string, value: string | number) => {
    const updated = { ...form, [field]: value };
    setForm(updated);
    setFormErrors((prev) => { const n = new Set(prev); n.delete(field); return n; });

    if (field === "division_id" || field === "role") {
      const divId = field === "division_id" ? Number(value) : updated.division_id;
      const role = field === "role" ? String(value) : updated.role;
      if (divId) lookupRate(divId, role);
    }
  };

  const openAdd = () => {
    setForm({ employee_id: "", division_id: 0, role: "Driver", tanggal: new Date().toISOString().slice(0, 10), jumlah_titik: "", catatan: "" });
    setFormRate(null);
    setFormErrors(new Set());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (row: DeliveryRow) => {
    setForm({ employee_id: row.employee_id, division_id: row.division_id, role: row.role, tanggal: row.tanggal, jumlah_titik: String(row.jumlah_titik), catatan: row.catatan || "" });
    setFormRate(row.rate_per_point);
    setFormErrors(new Set());
    setEditingId(row.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    const errs = new Set<string>();
    if (!form.employee_id) errs.add("employee_id");
    if (!form.division_id) errs.add("division_id");
    if (!form.tanggal) errs.add("tanggal");
    if (!form.jumlah_titik || parseInt(form.jumlah_titik) <= 0) errs.add("jumlah_titik");
    if (formRate === null) errs.add("rate");
    if (errs.size > 0) { setFormErrors(errs); return; }

    const payload = {
      employee_id: form.employee_id,
      division_id: form.division_id,
      role: form.role,
      tanggal: form.tanggal,
      jumlah_titik: parseInt(form.jumlah_titik),
      rate_per_point: formRate!,
      catatan: form.catatan || null,
    };

    const empNama = employees.find((e) => e.id === form.employee_id)?.nama || "";

    if (editingId !== null) {
      await supabase.from("delivery_points").update(payload).eq("id", editingId);
      showSuccess("Data Diperbarui", `Input titik ${empNama} telah disimpan.`);
    } else {
      await supabase.from("delivery_points").insert(payload);
      showSuccess("Input Titik Berhasil", `${form.jumlah_titik} titik untuk ${empNama} telah dicatat.`);
    }
    setShowForm(false);
    fetchDeliveries();
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await supabase.from("delivery_points").delete().eq("id", deleteConfirm.id);
    setDeleteConfirm(null);
    showSuccess("Data Dihapus", "Input titik telah dihapus.");
    fetchDeliveries();
  };

  const filtered = deliveries.filter((d) =>
    (d.employeeNama || "").toLowerCase().includes(search.toLowerCase()) ||
    d.employee_id.toLowerCase().includes(search.toLowerCase()) ||
    (d.divisionNama || "").toLowerCase().includes(search.toLowerCase()) ||
    d.role.toLowerCase().includes(search.toLowerCase())
  );

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Summary
  const totalTitik = deliveries.reduce((s, d) => s + d.jumlah_titik, 0);
  const totalPendapatan = deliveries.reduce((s, d) => s + d.total, 0);
  const totalDriver = deliveries.filter((d) => d.role === "Driver").length;
  const totalHelper = deliveries.filter((d) => d.role === "Helper").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pendapatan Pegawai"
        description="Input titik pengantaran harian driver & helper"
        icon={Wallet}
        actions={<Button icon={Plus} size="sm" onClick={openAdd}>Input Titik</Button>}
      />

      {toast.show && (
        <Portal>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
            <div className="flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border border-success/20 min-w-[360px] max-w-[480px]">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
                <CircleCheckBig className="w-5 h-5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{toast.title}</p>
                {toast.message && <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>}
              </div>
              <button onClick={() => setToast({ show: false, title: "", message: "" })} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </Portal>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => (
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
              <div><p className="text-xs text-muted-foreground font-medium">Total Titik</p><p className="text-xs text-muted-foreground">bulan ini</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center"><span className="text-sm font-bold text-primary">{totalDriver}</span></div>
              <div><p className="text-xs text-muted-foreground font-medium">Entri Driver</p><p className="text-xs text-muted-foreground">transaksi</p></div>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center"><span className="text-sm font-bold text-accent">{totalHelper}</span></div>
              <div><p className="text-xs text-muted-foreground font-medium">Entri Helper</p><p className="text-xs text-muted-foreground">transaksi</p></div>
            </div>
          </>
        )}
      </div>

      {/* Filter & Search */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 flex-1">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Cari nama, ID, divisi, atau posisi..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <input type="month" value={filterDate} onChange={(e) => { setFilterDate(e.target.value); setPage(1); }}
              className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary text-foreground" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Tanggal</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Divisi</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Posisi</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Titik</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Rate</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Total</th>
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
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-foreground">{row.employeeNama}</p>
                    <p className="text-[11px] text-muted-foreground">{row.employee_id}</p>
                  </td>
                  <td className="px-5 py-3.5"><span className="text-xs font-medium text-accent bg-accent-light px-2 py-1 rounded-md">{row.divisionNama}</span></td>
                  <td className="px-5 py-3.5"><span className={cn("text-xs font-semibold px-2.5 py-1 rounded-lg", row.role === "Driver" ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" : "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400")}>{row.role}</span></td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-foreground">{row.jumlah_titik}</td>
                  <td className="px-5 py-3.5 text-right text-sm text-muted-foreground">{formatCurrency(row.rate_per_point)}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-success">{formatCurrency(row.total)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setDeleteConfirm({ id: row.id, nama: `${row.employeeNama} (${row.tanggal})` })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      {/* ═══ INPUT TITIK FORM MODAL ═══ */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                    {editingId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                  </div>
                  <h2 className="text-sm font-bold text-foreground">{editingId ? "Edit Input Titik" : "Input Titik Baru"}</h2>
                </div>
                <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                {formErrors.size > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger-light border border-danger/20 text-danger text-xs font-medium animate-fade-in">
                    <X className="w-3.5 h-3.5 flex-shrink-0" />Harap lengkapi field yang wajib diisi
                  </div>
                )}

                <div>
                  <label className={cn("text-xs font-semibold mb-1.5 block", formErrors.has("employee_id") ? "text-danger" : "text-foreground")}>Pegawai <span className="text-danger">*</span></label>
                  {editingId !== null ? (
                    <div className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm text-muted-foreground cursor-not-allowed">
                      {employees.find((e) => e.id === form.employee_id)?.nama || form.employee_id}
                    </div>
                  ) : (
                    <Select
                      value={form.employee_id}
                      onChange={(val) => handleFormChange("employee_id", val)}
                      options={employees.map((e) => ({ value: e.id, label: e.nama }))}
                      placeholder="Pilih pegawai"
                      hasError={formErrors.has("employee_id")}
                    />
                  )}
                  {formErrors.has("employee_id") && <p className="text-[10px] text-danger mt-1">Pegawai wajib dipilih</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={cn("text-xs font-semibold mb-1.5 block", formErrors.has("division_id") ? "text-danger" : "text-foreground")}>Divisi <span className="text-danger">*</span></label>
                    <Select
                      value={String(form.division_id)}
                      onChange={(val) => handleFormChange("division_id", parseInt(val))}
                      options={divisions.map((d) => ({ value: String(d.id), label: d.nama }))}
                      placeholder="Pilih divisi"
                      hasError={formErrors.has("division_id")}
                    />
                    {formErrors.has("division_id") && <p className="text-[10px] text-danger mt-1">Divisi wajib dipilih</p>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Posisi <span className="text-danger">*</span></label>
                    <Select
                      value={form.role}
                      onChange={(val) => handleFormChange("role", val)}
                      options={[{ value: "Driver", label: "Driver" }, { value: "Helper", label: "Helper" }]}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={cn("text-xs font-semibold mb-1.5 block", formErrors.has("tanggal") ? "text-danger" : "text-foreground")}>Tanggal <span className="text-danger">*</span></label>
                    <input type="date" value={form.tanggal} onChange={(e) => handleFormChange("tanggal", e.target.value)} className={cn(inputClass, formErrors.has("tanggal") && "border-danger ring-2 ring-danger/20")} />
                    {formErrors.has("tanggal") && <p className="text-[10px] text-danger mt-1">Tanggal wajib diisi</p>}
                  </div>
                  <div>
                    <label className={cn("text-xs font-semibold mb-1.5 block", formErrors.has("jumlah_titik") ? "text-danger" : "text-foreground")}>Jumlah Titik <span className="text-danger">*</span></label>
                    <input type="number" min={1} placeholder="Contoh: 10" value={form.jumlah_titik} onChange={(e) => handleFormChange("jumlah_titik", e.target.value)} className={cn(inputClass, formErrors.has("jumlah_titik") && "border-danger ring-2 ring-danger/20")} />
                    {formErrors.has("jumlah_titik") && <p className="text-[10px] text-danger mt-1">Jumlah titik wajib diisi</p>}
                  </div>
                </div>

                {/* Rate & Total Preview */}
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Harga per titik</span>
                    {formRate !== null ? (
                      <span className="text-sm font-bold text-foreground">{formatCurrency(formRate)}</span>
                    ) : form.division_id ? (
                      <span className="text-xs text-danger font-medium">{formErrors.has("rate") ? "Tarif belum diatur di Data Master" : "Pilih divisi & posisi"}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </div>
                  {formRate !== null && form.jumlah_titik && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                      <span className="text-xs text-muted-foreground">{form.jumlah_titik} titik x {formatCurrency(formRate)}</span>
                      <span className="text-lg font-bold text-success">{formatCurrency(parseInt(form.jumlah_titik) * formRate)}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan</label>
                  <input type="text" placeholder="Opsional" value={form.catatan} onChange={(e) => handleFormChange("catatan", e.target.value)} className={inputClass} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Batal</Button>
                <Button size="sm" icon={editingId ? Check : Plus} onClick={handleSave}>
                  {editingId ? "Simpan" : "Input Titik"}
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
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-7 h-7 text-danger" />
                </div>
                <h3 className="text-base font-bold text-foreground">Hapus Input Titik?</h3>
                <p className="text-sm text-muted-foreground mt-2">Data untuk <span className="font-semibold text-foreground">&ldquo;{deleteConfirm.nama}&rdquo;</span> akan dihapus permanen.</p>
              </div>
              <div className="flex items-center gap-3 px-6 pb-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)}>Batal</Button>
                <Button variant="danger" size="sm" icon={Trash2} className="flex-1" onClick={handleDelete}>Hapus</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
