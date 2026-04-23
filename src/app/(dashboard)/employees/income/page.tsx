"use client";

import { useState, useEffect, useCallback } from "react";
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
  GripVertical,
  Save,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase, type DbDeliveryPoint } from "@/lib/supabase";

type EmployeeLite = { id: string; nama: string };
type DivisionLite = { id: number; nama: string };
type DeliveryRow = DbDeliveryPoint & { employeeNama?: string; divisionNama?: string };

// Batch form row
type BatchRow = {
  rowKey: string;
  employee_id: string;
  nama: string;
  division_id: number;
  role: "Driver" | "Helper" | "";
  jumlah_titik: string;
  catatan: string;
};

let rowKeyCounter = 0;
const nextRowKey = () => `row-${++rowKeyCounter}`;

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
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const TEMPLATE_KEY = "batch_employee_order";

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
    // Hitung hari terakhir bulan yang benar
    const [year, month] = filterDate.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const { data } = await supabase
      .from("delivery_points")
      .select("*, pegawai(nama), divisions(nama)")
      .gte("tanggal", `${filterDate}-01`)
      .lte("tanggal", `${filterDate}-${String(lastDay).padStart(2, "0")}`)
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
    Promise.all([fetchEmployees(), fetchDivisions(), fetchDeliveries()]).then(() => setLoading(false));
  }, []);

  useEffect(() => { fetchDeliveries(); }, [filterDate]);

  useEffect(() => {
    if (showBatch || showEditForm) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showBatch, showEditForm]);

  // ─── Batch handlers ───
  const getOrderedEmployees = useCallback((emps: EmployeeLite[]) => {
    try {
      const saved = localStorage.getItem(TEMPLATE_KEY);
      if (saved) {
        const order: string[] = JSON.parse(saved);
        const empMap = new Map(emps.map((e) => [e.id, e]));
        const ordered: EmployeeLite[] = [];
        order.forEach((id) => { const e = empMap.get(id); if (e) { ordered.push(e); empMap.delete(id); } });
        empMap.forEach((e) => ordered.push(e)); // pegawai baru yang belum ada di template
        return ordered;
      }
    } catch {}
    return emps;
  }, []);

  const openBatch = () => {
    setBatchDate(new Date().toISOString().slice(0, 10));
    const ordered = getOrderedEmployees(employees);
    setBatchRows(ordered.map((e) => ({ rowKey: nextRowKey(), employee_id: e.id, nama: e.nama, division_id: 0, role: "" as "Driver" | "Helper", jumlah_titik: "", catatan: "" })));
    setBatchSearch("");
    setDragIdx(null);
    setDragOverIdx(null);
    setShowBatch(true);
  };

  const handleBatchRowChange = (rowKey: string, field: "division_id" | "role" | "jumlah_titik" | "catatan", value: string | number) => {
    setBatchRows((prev) => prev.map((r) => r.rowKey === rowKey ? { ...r, [field]: value } : r));
  };

  const addExtraRow = (afterRowKey: string) => {
    setBatchRows((prev) => {
      const idx = prev.findIndex((r) => r.rowKey === afterRowKey);
      if (idx === -1) return prev;
      const source = prev[idx];
      const newRow: BatchRow = { rowKey: nextRowKey(), employee_id: source.employee_id, nama: source.nama, division_id: 0, role: "" as "Driver" | "Helper", jumlah_titik: "", catatan: "" };
      const arr = [...prev];
      arr.splice(idx + 1, 0, newRow);
      return arr;
    });
  };

  const removeExtraRow = (rowKey: string) => {
    setBatchRows((prev) => {
      // Jangan hapus jika ini satu-satunya baris untuk pegawai ini
      const row = prev.find((r) => r.rowKey === rowKey);
      if (!row) return prev;
      const sameEmpRows = prev.filter((r) => r.employee_id === row.employee_id);
      if (sameEmpRows.length <= 1) return prev;
      return prev.filter((r) => r.rowKey !== rowKey);
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

  const saveTemplate = () => {
    const order = batchRows.map((r) => r.employee_id);
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(order));
    showSuccess("Template Disimpan", "Urutan pegawai akan digunakan saat input titik berikutnya.");
  };

  const resetTemplate = () => {
    localStorage.removeItem(TEMPLATE_KEY);
    setBatchRows(employees.map((e) => ({ rowKey: nextRowKey(), employee_id: e.id, nama: e.nama, division_id: 0, role: "" as "Driver" | "Helper", jumlah_titik: "", catatan: "" })));
    showSuccess("Template Direset", "Urutan pegawai kembali ke default (A-Z).");
  };

  const hasBatchData = batchRows.some((r) => r.jumlah_titik || r.division_id || r.role);

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

  const handleBatchSave = async () => {
    if (!batchDate) return;

    const validRows = batchRows.filter((r) => r.jumlah_titik && parseInt(r.jumlah_titik) > 0 && r.division_id && r.role);
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
      catatan: r.catatan || null,
    }));

    const { error } = await supabase.from("delivery_points").insert(inserts);
    setBatchSaving(false);

    if (error) {
      showSuccess("Gagal Menyimpan", error.message);
      return;
    }

    showSuccess("Input Titik Berhasil", `${validRows.length} data pegawai berhasil disimpan.`);
    setShowBatch(false);
    // Sync filter ke bulan dari tanggal batch agar data langsung terlihat
    const batchMonth = batchDate.slice(0, 7);
    if (filterDate !== batchMonth) {
      setFilterDate(batchMonth); // useEffect akan trigger fetchDeliveries
    } else {
      fetchDeliveries();
    }
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
  const batchFilled = batchRows.filter((r) => r.jumlah_titik && parseInt(r.jumlah_titik) > 0 && r.division_id && r.role).length;
  // Baris yang setengah terisi (ada salah satu field tapi tidak lengkap)
  const batchIncomplete = batchRows.filter((r) => {
    const hasTitik = r.jumlah_titik && parseInt(r.jumlah_titik) > 0;
    const hasDiv = !!r.division_id;
    const hasRole = !!r.role;
    const touched = hasTitik || hasDiv || hasRole;
    const complete = hasTitik && hasDiv && hasRole;
    return touched && !complete;
  });
  // Deteksi duplikat: pegawai + divisi + role yang sama
  const batchDuplicateKeys = new Set<string>();
  const seenCombos = new Map<string, string>(); // combo -> rowKey pertama
  batchRows.forEach((r) => {
    if (!r.division_id || !r.role) return;
    const combo = `${r.employee_id}-${r.division_id}-${r.role}`;
    if (seenCombos.has(combo)) {
      batchDuplicateKeys.add(r.rowKey);
      batchDuplicateKeys.add(seenCombos.get(combo)!);
    } else {
      seenCombos.set(combo, r.rowKey);
    }
  });
  const batchCanSave = batchFilled > 0 && batchIncomplete.length === 0 && batchDuplicateKeys.size === 0 && !!batchDate;

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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative w-full max-w-5xl bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in flex flex-col" style={{ height: "calc(100vh - 1.5rem)", maxHeight: "calc(100vh - 1.5rem)" }}>

              {/* ── Header: Title + Tanggal + Search + Counter ── */}
              <div className="px-5 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
                <div className="flex items-center gap-4">
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
                  <div className="w-48 flex-shrink-0">
                    <DatePicker value={batchDate} onChange={(val) => setBatchDate(val)} placeholder="Pilih tanggal" />
                  </div>

                  {/* Search */}
                  <div className="flex-1 flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2 border border-border focus-within:border-primary">
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
                  <button onClick={tryCloseBatch} disabled={batchSaving} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-50 flex-shrink-0"><X className="w-4 h-4" /></button>
                </div>
              </div>

              {/* ── Reorder toolbar ── */}
              <div className="px-5 py-1.5 border-b border-border flex items-center justify-between bg-muted/20">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <GripVertical className="w-3 h-3" />Drag untuk ubah urutan
                </p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={saveTemplate} className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-primary hover:bg-primary-light px-2 py-1 rounded-md transition-colors">
                    <Save className="w-3 h-3" />Simpan
                  </button>
                  <button type="button" onClick={resetTemplate} className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-danger hover:bg-danger-light px-2 py-1 rounded-md transition-colors">
                    <RotateCcw className="w-3 h-3" />Reset
                  </button>
                </div>
              </div>

              {/* ── Batch List ── */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-card border-b-2 border-border shadow-sm">
                      <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-14">#</th>
                      <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2">Pegawai</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-40">Divisi</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-24">Posisi</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-20">Titik</th>
                      <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-32">Catatan</th>
                      <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchFiltered.map((row, idx) => {
                      const hasTitik = row.jumlah_titik && parseInt(row.jumlah_titik) > 0;
                      const hasDiv = !!row.division_id;
                      const hasRole = !!row.role;
                      const touched = hasTitik || hasDiv || hasRole;
                      const isComplete = hasTitik && hasDiv && hasRole;
                      const isIncomplete = touched && !isComplete;
                      const isDuplicate = batchDuplicateKeys.has(row.rowKey);
                      const isDragging = dragIdx === idx;
                      const isDropTarget = dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;

                      // Cek apakah ini baris pertama untuk pegawai ini (untuk tampilkan nama + grip)
                      const isFirstRow = idx === 0 || batchFiltered[idx - 1]?.employee_id !== row.employee_id;
                      const isLastRow = idx === batchFiltered.length - 1 || batchFiltered[idx + 1]?.employee_id !== row.employee_id;
                      const sameEmpCount = batchFiltered.filter((r) => r.employee_id === row.employee_id).length;

                      return (
                        <tr
                          key={row.rowKey}
                          draggable={isFirstRow}
                          onDragStart={(e) => isFirstRow && handleDragStart(e, idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDrop={() => handleDrop(idx)}
                          onDragEnd={handleDragEnd}
                          className={cn(
                            "transition-all duration-200 relative",
                            isDragging
                              ? "opacity-30 scale-[0.98] bg-primary/5 border-b border-primary/30"
                              : isDropTarget
                                ? "border-b border-border/40"
                                : isFirstRow ? "border-b border-border/40" : "border-b border-border/20",
                            !isDragging && !isDropTarget && (isDuplicate ? "bg-danger/[0.06]" : isComplete ? "bg-success/[0.06]" : isIncomplete ? "bg-danger/[0.04]" : "hover:bg-muted/40"),
                            !isFirstRow && "bg-muted/[0.02]"
                          )}
                          style={isDropTarget ? { boxShadow: "inset 0 3px 0 0 var(--color-primary, #3b82f6)" } : undefined}
                        >
                          {/* # + Grip */}
                          <td className="px-4 py-1.5">
                            {isFirstRow ? (
                              <div className="flex items-center gap-1">
                                <div className={cn("p-0.5 rounded cursor-grab active:cursor-grabbing transition-colors", isDragging ? "text-primary" : "text-muted-foreground/30 hover:text-muted-foreground")}>
                                  <GripVertical className="w-3.5 h-3.5" />
                                </div>
                                <span className={cn("text-[10px] font-mono", isComplete ? "text-success font-bold" : isIncomplete ? "text-danger font-bold" : "text-muted-foreground")}>{idx + 1}</span>
                              </div>
                            ) : (
                              <span className="text-[10px] font-mono text-muted-foreground/40 pl-5">{idx + 1}</span>
                            )}
                          </td>

                          {/* Nama */}
                          <td className="px-4 py-1.5">
                            {isFirstRow ? (
                              <div className="flex items-center gap-2">
                                <div className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold flex-shrink-0",
                                  isComplete ? "bg-success/10 text-success" : isIncomplete ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground"
                                )}>
                                  {row.nama.charAt(0)}
                                </div>
                                <span className={cn("text-xs", isComplete || isIncomplete ? "font-semibold text-foreground" : "text-foreground/70")}>{row.nama}</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/50 pl-8">↳ divisi lain</span>
                            )}
                          </td>

                          {/* Divisi */}
                          <td className="px-4 py-1.5">
                            <select
                              value={row.division_id || ""}
                              onChange={(e) => handleBatchRowChange(row.rowKey, "division_id", parseInt(e.target.value) || 0)}
                              className={cn(
                                "w-full text-[11px] px-2 py-1.5 rounded-md border outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20",
                                isDuplicate ? "border-danger bg-danger/[0.05] text-danger" : row.division_id ? "border-border bg-card text-foreground" : isIncomplete && !hasDiv ? "border-danger/50 bg-danger/[0.03] text-muted-foreground" : "border-dashed border-border bg-transparent text-muted-foreground"
                              )}
                            >
                              <option value="">Pilih divisi</option>
                              {divisions.map((d) => (
                                <option key={d.id} value={d.id}>{d.nama}</option>
                              ))}
                            </select>
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

                          {/* Catatan */}
                          <td className="px-4 py-1.5">
                            <input type="text" placeholder="..." value={row.catatan}
                              onChange={(e) => handleBatchRowChange(row.rowKey, "catatan", e.target.value)}
                              className="w-full text-[11px] px-2 py-1.5 rounded-md border border-dashed border-border bg-transparent outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/30 text-foreground" />
                          </td>

                          {/* Aksi: + / - */}
                          <td className="px-2 py-1.5">
                            <div className="flex items-center justify-center gap-0.5">
                              {isLastRow && (
                                <button type="button" onClick={() => addExtraRow(row.rowKey)} title="Tambah divisi lain"
                                  className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold text-primary hover:bg-primary-light transition-colors">+</button>
                              )}
                              {sameEmpCount > 1 && (
                                <button type="button" onClick={() => removeExtraRow(row.rowKey)} title="Hapus baris ini"
                                  className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold text-danger hover:bg-danger-light transition-colors">&minus;</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Footer ── */}
              <div className="px-5 py-3 border-t border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {batchDuplicateKeys.size > 0 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                        <span className="text-danger text-xs font-medium">Ada divisi + posisi yang sama dalam satu pegawai</span>
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

      {/* ═══ CLOSE CONFIRM DIALOG ═══ */}
      {showCloseConfirm && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
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
