"use client";

import { useState, useEffect } from "react";
import {
  Wallet,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  CircleCheckBig,
  Filter,
  Check,
  Users,
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

// Batch form row
type BatchRow = {
  employee_id: string;
  nama: string;
  division_id: number;
  role: "Driver" | "Helper";
  jumlah_titik: string;
};

const PAGE_SIZE = 15;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

export default function IncomePage() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterDate, setFilterDate] = useState(() => new Date().toISOString().slice(0, 7));

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [divisions, setDivisions] = useState<DivisionLite[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);

  // ─── Batch Input State ───
  const [showBatch, setShowBatch] = useState(false);
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);

  // ─── Edit single row ───
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ role: "Driver", jumlah_titik: "" });

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

  useEffect(() => { fetchDeliveries(); }, [filterDate]);

  useEffect(() => {
    if (showBatch || showEditForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showBatch, showEditForm]);

  // ─── Batch handlers ───
  const openBatch = () => {
    setBatchDate(new Date().toISOString().slice(0, 10));
    setBatchRows(employees.map((e) => ({ employee_id: e.id, nama: e.nama, division_id: divisions[0]?.id || 0, role: "Driver" as const, jumlah_titik: "" })));
    setBatchSearch("");
    setShowBatch(true);
  };

  const handleBatchRowChange = (empId: string, field: "division_id" | "role" | "jumlah_titik", value: string | number) => {
    setBatchRows((prev) => prev.map((r) => r.employee_id === empId ? { ...r, [field]: value } : r));
  };

  const handleBatchSave = async () => {
    if (!batchDate) return;

    const validRows = batchRows.filter((r) => r.jumlah_titik && parseInt(r.jumlah_titik) > 0 && r.division_id);
    if (validRows.length === 0) return;

    setBatchSaving(true);

    // Lookup all rates at once
    const { data: allRates } = await supabase.from("point_rates").select("division_id, role, rate_per_point").eq("status", "Aktif");
    const rateMap = new Map<string, number>();
    allRates?.forEach((r) => rateMap.set(`${r.division_id}-${r.role}`, r.rate_per_point));

    const inserts = validRows.map((r) => ({
      employee_id: r.employee_id,
      division_id: r.division_id,
      role: r.role,
      tanggal: batchDate,
      jumlah_titik: parseInt(r.jumlah_titik),
      rate_per_point: rateMap.get(`${r.division_id}-${r.role}`) || 0,
    }));

    const { error } = await supabase.from("delivery_points").insert(inserts);
    setBatchSaving(false);

    if (error) {
      showSuccess("Gagal Menyimpan", error.message);
      return;
    }

    showSuccess("Input Titik Berhasil", `${validRows.length} data pegawai berhasil disimpan.`);
    setShowBatch(false);
    fetchDeliveries();
  };

  // ─── Edit single ───
  const openEdit = (row: DeliveryRow) => {
    setEditForm({ role: row.role, jumlah_titik: String(row.jumlah_titik) });
    setEditingId(row.id);
    setShowEditForm(true);
  };

  const handleEditSave = async () => {
    if (!editingId || !editForm.jumlah_titik) return;
    const row = deliveries.find((d) => d.id === editingId);
    if (!row) return;

    // Re-lookup rate
    const { data: rateData } = await supabase.from("point_rates").select("rate_per_point").eq("division_id", row.division_id).eq("role", editForm.role).eq("status", "Aktif").single();

    await supabase.from("delivery_points").update({
      role: editForm.role,
      jumlah_titik: parseInt(editForm.jumlah_titik),
      rate_per_point: rateData?.rate_per_point || row.rate_per_point,
    }).eq("id", editingId);

    showSuccess("Data Diperbarui", "Input titik telah disimpan.");
    setShowEditForm(false);
    fetchDeliveries();
  };

  // ─── Delete ───
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await supabase.from("delivery_points").delete().eq("id", deleteConfirm.id);
    setDeleteConfirm(null);
    showSuccess("Data Dihapus", "Input titik telah dihapus.");
    fetchDeliveries();
  };

  // ─── Filter & paginate ───
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
  const totalEntri = deliveries.length;

  // Batch filtered
  const batchFiltered = batchRows.filter((r) => r.nama.toLowerCase().includes(batchSearch.toLowerCase()));
  const batchFilled = batchRows.filter((r) => r.jumlah_titik && parseInt(r.jumlah_titik) > 0).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Pendapatan Pegawai"
        description="Input titik pengantaran harian driver & helper"
        icon={Wallet}
        actions={<Button icon={Plus} size="sm" onClick={openBatch}>Input Titik</Button>}
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
              <div><p className="text-xs text-muted-foreground font-medium">Total Titik</p><p className="text-xs text-muted-foreground">bulan ini</p></div>
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
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5 flex-1">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Cari nama, divisi, atau posisi..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Total</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <SkeletonTable rows={6} cols={8} />
              ) : paged.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data ditemukan</td></tr>
              ) : paged.map((row, idx) => (
                <tr key={row.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-5 py-3.5 text-sm text-foreground">{row.tanggal}</td>
                  <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{row.employeeNama}</p></td>
                  <td className="px-5 py-3.5"><span className="text-xs font-medium text-accent bg-accent-light px-2 py-1 rounded-md">{row.divisionNama}</span></td>
                  <td className="px-5 py-3.5"><span className={cn("text-xs font-semibold px-2.5 py-1 rounded-lg", row.role === "Driver" ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" : "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400")}>{row.role}</span></td>
                  <td className="px-5 py-3.5 text-right text-sm font-bold text-foreground">{row.jumlah_titik}</td>
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

      {/* ═══ BATCH INPUT MODAL ═══ */}
      {showBatch && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !batchSaving && setShowBatch(false)} />
            <div className="relative w-full max-w-3xl bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Input Titik Batch</h2>
                    <p className="text-[11px] text-muted-foreground">Isi jumlah titik per pegawai, kosongkan yang tidak antar</p>
                  </div>
                </div>
                <button onClick={() => !batchSaving && setShowBatch(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>

              {/* Tanggal */}
              <div className="px-6 py-4 border-b border-border bg-muted/20">
                <div className="max-w-xs">
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal <span className="text-danger">*</span></label>
                  <input type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} className={inputClass} />
                </div>
              </div>

              {/* Search pegawai */}
              <div className="px-6 py-3 border-b border-border">
                <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                  <Search className="w-3.5 h-3.5 text-muted-foreground" />
                  <input type="text" placeholder="Cari pegawai..." value={batchSearch} onChange={(e) => setBatchSearch(e.target.value)}
                    className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/50 text-foreground" />
                  {batchFilled > 0 && (
                    <span className="text-[10px] font-bold text-primary bg-primary-light px-2 py-0.5 rounded-md whitespace-nowrap">{batchFilled} terisi</span>
                  )}
                </div>
              </div>

              {/* Batch table */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-2.5 w-12">#</th>
                      <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-2.5">Nama Pegawai</th>
                      <th className="text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-2.5 w-36">Divisi</th>
                      <th className="text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-2.5 w-24">Posisi</th>
                      <th className="text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-2.5 w-24">Titik</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {batchFiltered.map((row, idx) => {
                      const hasTitik = row.jumlah_titik && parseInt(row.jumlah_titik) > 0;
                      return (
                        <tr key={row.employee_id} className={cn("transition-colors", hasTitik ? "bg-success-light/30" : "hover:bg-muted/30")}>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-4 py-2">
                            <p className={cn("text-sm", hasTitik ? "font-semibold text-foreground" : "text-muted-foreground")}>{row.nama}</p>
                          </td>
                          <td className="px-4 py-2">
                            <select
                              value={row.division_id}
                              onChange={(e) => handleBatchRowChange(row.employee_id, "division_id", parseInt(e.target.value))}
                              className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-card outline-none focus:border-primary text-foreground"
                            >
                              {divisions.map((d) => (
                                <option key={d.id} value={d.id}>{d.nama}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleBatchRowChange(row.employee_id, "role", "Driver")}
                                className={cn("px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors",
                                  row.role === "Driver" ? "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400" : "text-muted-foreground hover:bg-muted"
                                )}
                              >D</button>
                              <button
                                type="button"
                                onClick={() => handleBatchRowChange(row.employee_id, "role", "Helper")}
                                className={cn("px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors",
                                  row.role === "Helper" ? "bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400" : "text-muted-foreground hover:bg-muted"
                                )}
                              >H</button>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min={0}
                              placeholder="0"
                              value={row.jumlah_titik}
                              onChange={(e) => handleBatchRowChange(row.employee_id, "jumlah_titik", e.target.value)}
                              className="w-full text-center px-2 py-1.5 rounded-lg border border-border bg-card text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  {batchFilled > 0 ? <span className="font-semibold text-foreground">{batchFilled} pegawai</span> : "Belum ada data"} yang akan disimpan
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowBatch(false)} disabled={batchSaving}>Batal</Button>
                  <Button size="sm" icon={Check} onClick={handleBatchSave} disabled={batchSaving || batchFilled === 0 || !batchDate}>
                    {batchSaving ? "Menyimpan..." : "Simpan Semua"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ═══ EDIT SINGLE MODAL ═══ */}
      {showEditForm && editingId && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowEditForm(false)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
                <h2 className="text-sm font-bold text-foreground">Edit Input Titik</h2>
                <button onClick={() => setShowEditForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Posisi</label>
                  <Select value={editForm.role} onChange={(val) => setEditForm({ ...editForm, role: val })} options={[{ value: "Driver", label: "Driver" }, { value: "Helper", label: "Helper" }]} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Jumlah Titik</label>
                  <input type="number" min={1} value={editForm.jumlah_titik} onChange={(e) => setEditForm({ ...editForm, jumlah_titik: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
                <Button variant="outline" size="sm" onClick={() => setShowEditForm(false)}>Batal</Button>
                <Button size="sm" icon={Check} onClick={handleEditSave} disabled={!editForm.jumlah_titik}>Simpan</Button>
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
                <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-danger" /></div>
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
