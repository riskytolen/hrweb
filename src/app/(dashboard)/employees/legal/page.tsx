"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Scale, Plus, Search, Pencil, Trash2, X, Check, FileText,
  AlertTriangle, CircleCheckBig, Clock, ShieldCheck,
  CalendarDays, Download,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase, type DbLegalDocument, type DbLegalSetting } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";
import { generatePKWT, generateSP, generateNomorSP } from "@/lib/legal-pdf";

type EmployeeLite = { id: string; nama: string };
type LegalRow = DbLegalDocument & { employeeNama?: string };

const PAGE_SIZE = 10;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

const KATEGORI_OPTIONS = [
  { value: "PKWT", label: "PKWT", color: "#3b82f6" },
  { value: "SP", label: "Surat Peringatan", color: "#ef4444" },
];

const STATUS_OPTIONS = [
  { value: "Aktif", label: "Aktif", color: "#10b981" },
  { value: "Segera Berakhir", label: "Segera Berakhir", color: "#f59e0b" },
  { value: "Berakhir", label: "Berakhir", color: "#ef4444" },
];

const SP_OPTIONS = [
  { value: "SP-1", label: "SP-1 (Peringatan Pertama)" },
  { value: "SP-2", label: "SP-2 (Peringatan Kedua)" },
  { value: "SP-3", label: "SP-3 (Peringatan Ketiga)" },
];

function formatTanggal(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function computeStatus(tanggalBerakhir: string | null): "Aktif" | "Segera Berakhir" | "Berakhir" {
  if (!tanggalBerakhir) return "Aktif";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(tanggalBerakhir + "T00:00:00");
  if (end < today) return "Berakhir";
  const diffDays = Math.floor((end.getTime() - today.getTime()) / 86400000);
  if (diffDays <= 30) return "Segera Berakhir";
  return "Aktif";
}

export default function LegalPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("legal");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterKategori, setFilterKategori] = useState("Semua");
  const [filterStatus, setFilterStatus] = useState("Semua");

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [list, setList] = useState<LegalRow[]>([]);
  const [legalSettings, setLegalSettings] = useState<DbLegalSetting[]>([]);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    employee_id: "", kategori: "PKWT" as "PKWT" | "SP",
    nomor_kontrak: "", kontrak_ke: "1",
    tingkat_sp: "SP-1", pelanggaran: "",
    tanggal_terbit: "", tanggal_berakhir: "",
    catatan: "",
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

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

  const fetchLegalSettings = async () => {
    const { data } = await supabase.from("legal_settings").select("*").order("id");
    if (data) setLegalSettings(data);
  };

  const fetchList = useCallback(async () => {
    const { data, error } = await supabase
      .from("legal_documents")
      .select("*, pegawai(nama)")
      .order("created_at", { ascending: false });
    if (error) { showToast("error", "Gagal Memuat Data", error.message); return; }
    if (data) {
      // Auto-update status berdasarkan tanggal
      const rows: LegalRow[] = data.map((d: any) => {
        const computedStatus = computeStatus(d.tanggal_berakhir);
        return { ...d, employeeNama: d.pegawai?.nama || d.employee_id, status: computedStatus };
      });
      setList(rows);

      // Batch update status di DB jika berubah
      const updates = data.filter((d: any) => {
        const computed = computeStatus(d.tanggal_berakhir);
        return computed !== d.status;
      });
      if (updates.length > 0) {
        for (const u of updates) {
          const newStatus = computeStatus(u.tanggal_berakhir);
          await supabase.from("legal_documents").update({ status: newStatus }).eq("id", u.id);
        }
      }
    }
  }, [showToast]);

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchList(), fetchLegalSettings()]).then(() => setLoading(false));
  }, []);

  // Summary
  const statusCounts: Record<string, number> = { Aktif: 0, "Segera Berakhir": 0, Berakhir: 0 };
  list.forEach((r) => { if (r.status in statusCounts) statusCounts[r.status]++; });
  const pkwtCount = list.filter((r) => r.kategori === "PKWT").length;
  const spCount = list.filter((r) => r.kategori === "SP").length;

  // Filter
  const filtered = list.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = (r.employeeNama || "").toLowerCase().includes(q) ||
      (r.nomor_kontrak || "").toLowerCase().includes(q) ||
      (r.pelanggaran || "").toLowerCase().includes(q);
    const matchKategori = filterKategori === "Semua" || r.kategori === filterKategori;
    const matchStatus = filterStatus === "Semua" || r.status === filterStatus;
    return matchSearch && matchKategori && matchStatus;
  });
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Helper: hitung tanggal berakhir dari tanggal terbit + masa berlaku setting
  const getAutoTanggalBerakhir = (tanggalTerbit: string, kategori: string, tingkatSp?: string): string => {
    if (!tanggalTerbit) return "";
    const kode = kategori === "PKWT" ? "PKWT" : (tingkatSp || "SP-1");
    const setting = legalSettings.find((s) => s.kode === kode);
    if (!setting) return "";
    const date = new Date(tanggalTerbit + "T00:00:00");
    date.setMonth(date.getMonth() + setting.masa_berlaku_bulan);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // Helper: generate nomor otomatis
  const getAutoNomor = (kategori: string, tingkatSp?: string): string => {
    const today = new Date().toISOString().split("T")[0];
    if (kategori === "SP") {
      // Hitung jumlah SP yang sudah ada di bulan ini
      const currentMonth = today.slice(0, 7); // YYYY-MM
      const spThisMonth = list.filter(r => r.kategori === "SP" && r.tanggal_terbit.startsWith(currentMonth)).length;
      return generateNomorSP(tingkatSp || "SP-1", spThisMonth + 1, today);
    }
    // PKWT: format serupa
    const currentMonth = today.slice(0, 7);
    const pkwtThisMonth = list.filter(r => r.kategori === "PKWT" && r.tanggal_terbit.startsWith(currentMonth)).length;
    return generateNomorSP("PKWT", pkwtThisMonth + 1, today);
  };

  // Open form
  const openAdd = () => {
    const autoNomor = getAutoNomor("PKWT");
    setForm({ employee_id: "", kategori: "PKWT", nomor_kontrak: autoNomor, kontrak_ke: "1", tingkat_sp: "SP-1", pelanggaran: "", tanggal_terbit: "", tanggal_berakhir: "", catatan: "" });
    setFormError("");
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (row: LegalRow) => {
    setForm({
      employee_id: row.employee_id, kategori: row.kategori,
      nomor_kontrak: row.nomor_kontrak || "", kontrak_ke: String(row.kontrak_ke || 1),
      tingkat_sp: row.tingkat_sp || "SP-1", pelanggaran: row.pelanggaran || "",
      tanggal_terbit: row.tanggal_terbit, tanggal_berakhir: row.tanggal_berakhir || "",
      catatan: row.catatan || "",
    });
    setFormError("");
    setEditingId(row.id);
    setShowForm(true);
  };

  // Save
  const handleSave = async () => {
    setFormError("");
    if (!form.employee_id) { setFormError("Pilih pegawai."); return; }
    if (!form.nomor_kontrak.trim()) { setFormError("Nomor surat wajib diisi."); return; }
    if (!form.tanggal_terbit) { setFormError("Pilih tanggal terbit."); return; }
    if (!form.tanggal_berakhir) { setFormError("Pilih tanggal berakhir."); return; }
    if (form.tanggal_berakhir < form.tanggal_terbit) { setFormError("Tanggal berakhir harus setelah tanggal terbit."); return; }
    if (form.kategori === "SP" && !form.pelanggaran.trim()) { setFormError("Isi deskripsi pelanggaran."); return; }

    setFormSaving(true);
    const status = computeStatus(form.tanggal_berakhir);
    const payload: Record<string, unknown> = {
      employee_id: form.employee_id,
      kategori: form.kategori,
      nomor_kontrak: form.nomor_kontrak.trim() || null,
      kontrak_ke: form.kategori === "PKWT" ? (parseInt(form.kontrak_ke) || 1) : null,
      tingkat_sp: form.kategori === "SP" ? form.tingkat_sp : null,
      pelanggaran: form.kategori === "SP" ? (form.pelanggaran.trim() || null) : null,
      tanggal_terbit: form.tanggal_terbit,
      tanggal_berakhir: form.tanggal_berakhir,
      catatan: form.catatan.trim() || null,
      status,
    };

    try {
      if (editingId) {
        const { error } = await supabase.from("legal_documents").update(payload).eq("id", editingId);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Dokumen Diperbarui");
      } else {
        const { error } = await supabase.from("legal_documents").insert(payload);
        if (error) { setFormError(error.message); setFormSaving(false); return; }
        showToast("success", "Dokumen Ditambahkan", `${form.kategori === "PKWT" ? "PKWT" : form.tingkat_sp} berhasil ditambahkan.`);
      }
      setShowForm(false);
      await fetchList();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setFormSaving(false);
    }
  };

  // Download PDF
  const handleDownloadPDF = async (row: LegalRow) => {
    // Fetch data pegawai lengkap dengan jabatan via join
    const { data: emp } = await supabase
      .from("pegawai")
      .select("id, nama, no_ktp, alamat_domisili, jabatan_id, jabatan:jabatan_id(nama)")
      .eq("id", row.employee_id)
      .single();
    const employeeInfo = {
      id: emp?.id || row.employee_id,
      nama: emp?.nama || row.employeeNama || "-",
      no_ktp: emp?.no_ktp || undefined,
      alamat: emp?.alamat_domisili || undefined,
      jabatan: (emp?.jabatan as any)?.nama || undefined,
    };

    if (row.kategori === "PKWT") {
      await generatePKWT(row, employeeInfo);
    } else {
      await generateSP(row, employeeInfo);
    }
    showToast("success", "PDF Berhasil Dibuat", `File ${row.kategori === "SP" ? row.tingkat_sp : "PKWT"} telah diunduh.`);
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { error } = await supabase.from("legal_documents").delete().eq("id", deleteConfirm.id);
    if (error) showToast("error", "Gagal Menghapus", error.message);
    else {
      showToast("success", "Dokumen Dihapus");
      setList((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
    }
    setDeleting(false);
    setDeleteConfirm(null);
  };

  return (
    <RouteGuard permission="legal">
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Legal & Administrasi"
        description="Kelola PKWT dan Surat Peringatan pegawai"
        icon={Scale}
        actions={canInput ? <Button icon={Plus} size="sm" onClick={openAdd}>Tambah Dokumen</Button> : undefined}
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">Total</p>
              <p className="text-lg font-bold text-foreground">{loading ? "-" : list.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Scale className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">PKWT</p>
              <p className="text-lg font-bold text-blue-600">{loading ? "-" : pkwtCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">SP</p>
              <p className="text-lg font-bold text-danger">{loading ? "-" : spCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">Segera Berakhir</p>
              <p className="text-lg font-bold text-warning">{loading ? "-" : statusCounts["Segera Berakhir"]}</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase">Aktif</p>
              <p className="text-lg font-bold text-success">{loading ? "-" : statusCounts["Aktif"]}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Alert jika ada yang segera berakhir */}
      {!loading && (statusCounts["Segera Berakhir"] > 0 || statusCounts["Berakhir"] > 0) && (
        <div className="bg-warning/[0.06] border border-warning/20 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">Perhatian</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Terdapat {statusCounts["Segera Berakhir"]} dokumen segera berakhir dan {statusCounts["Berakhir"]} dokumen sudah berakhir. Segera lakukan perpanjangan atau tindak lanjut.
            </p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-card rounded-2xl border border-border p-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" placeholder="Cari pegawai, nomor kontrak, pelanggaran..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {/* Kategori filter */}
          {[{ label: "Semua", color: "#6b7280" }, ...KATEGORI_OPTIONS.map(k => ({ label: k.value, color: k.color }))].map((item) => {
            const isActive = filterKategori === item.label;
            return (
              <button key={item.label} onClick={() => { setFilterKategori(item.label); setPage(1); }}
                className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  isActive ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted")}>
                {item.label !== "Semua" && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />}
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="h-4 w-px bg-border" />
          {/* Status filter */}
          {[{ label: "Semua", color: "#6b7280" }, ...STATUS_OPTIONS.map(s => ({ label: s.value, color: s.color }))].map((item) => {
            const isActive = filterStatus === item.label;
            return (
              <button key={`s-${item.label}`} onClick={() => { setFilterStatus(item.label); setPage(1); }}
                className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                  isActive ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-muted")}>
                {item.label !== "Semua" && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />}
                <span>{item.label}</span>
              </button>
            );
          })}
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
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Kategori</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Detail</th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Periode</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-32">Status</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-28">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? <SkeletonTable rows={5} cols={7} /> : paged.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Tidak ada dokumen legal</td></tr>
              ) : paged.map((row, idx) => {
                const kc = KATEGORI_OPTIONS.find((k) => k.value === row.kategori);
                const sc = STATUS_OPTIONS.find((s) => s.value === row.status);
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{row.employeeNama}</p></td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${kc?.color}20`, color: kc?.color }}>
                        {row.kategori === "SP" ? row.tingkat_sp : "PKWT"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {row.kategori === "PKWT" ? (
                        <div>
                          <p className="text-sm text-foreground">{row.nomor_kontrak || <span className="italic text-muted-foreground">Tanpa nomor</span>}</p>
                          <p className="text-[10px] text-muted-foreground">Kontrak ke-{row.kontrak_ke || 1}</p>
                        </div>
                      ) : (
                        <p className="text-sm text-foreground max-w-[200px] truncate">{row.pelanggaran || "-"}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-foreground">{formatTanggal(row.tanggal_terbit)}</p>
                      {row.tanggal_berakhir && (
                        <p className="text-[10px] text-muted-foreground">s/d {formatTanggal(row.tanggal_berakhir)}</p>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-center">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: `${sc?.color}20`, color: sc?.color }}>{row.status}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleDownloadPDF(row)} title="Download PDF" className="p-1.5 rounded-lg hover:bg-success-light text-muted-foreground hover:text-success"><Download className="w-3.5 h-3.5" /></button>
                        {canEdit && (
                          <button onClick={() => openEdit(row)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                        )}
                        {canEdit && (
                          <button onClick={() => setDeleteConfirm({ id: row.id, nama: `${row.employeeNama} (${row.kategori === "SP" ? row.tingkat_sp : "PKWT"})` })}
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
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </div>

      {/* ═══ FORM MODAL ═══ */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !formSaving && setShowForm(false)} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              {/* Header */}
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !formSaving && setShowForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                    {editingId ? <Pencil className="w-5 h-5 text-white" /> : <Scale className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{editingId ? "Edit Dokumen" : "Tambah Dokumen Legal"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">PKWT atau Surat Peringatan</p>
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
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Kategori <span className="text-danger">*</span></label>
                  <div className="flex items-center gap-2">
                    {KATEGORI_OPTIONS.map((k) => {
                      const active = form.kategori === k.value;
                      return (
                        <button key={k.value} type="button" onClick={() => {
                          const newKategori = k.value as "PKWT" | "SP";
                          const autoEnd = form.tanggal_terbit ? getAutoTanggalBerakhir(form.tanggal_terbit, newKategori, form.tingkat_sp) : "";
                          const autoNomor = !editingId ? getAutoNomor(newKategori, form.tingkat_sp) : form.nomor_kontrak;
                          setForm({ ...form, kategori: newKategori, tanggal_berakhir: autoEnd || form.tanggal_berakhir, nomor_kontrak: autoNomor });
                        }}
                          className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border-2",
                            active ? "shadow-md" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                          )}
                          style={active ? { borderColor: k.color, backgroundColor: `${k.color}15`, color: k.color, boxShadow: `0 4px 12px ${k.color}20` } : undefined}>
                          {k.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Nomor Surat (wajib untuk semua kategori) */}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nomor Surat <span className="text-danger">*</span></label>
                  <input type="text" placeholder="01/V/JAMS/2026" value={form.nomor_kontrak}
                    onChange={(e) => setForm({ ...form, nomor_kontrak: e.target.value })} className={inputClass} />
                  <p className="text-[10px] text-muted-foreground mt-1">Otomatis di-generate. Bisa diubah manual.</p>
                </div>

                {/* PKWT fields */}
                {form.kategori === "PKWT" && (
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Kontrak Ke-</label>
                    <input type="number" min={1} value={form.kontrak_ke}
                      onChange={(e) => setForm({ ...form, kontrak_ke: e.target.value })} className={inputClass} />
                  </div>
                )}

                {/* SP fields */}
                {form.kategori === "SP" && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1.5 block">Tingkat SP <span className="text-danger">*</span></label>
                      <Select value={form.tingkat_sp} onChange={(val) => {
                        const autoEnd = form.tanggal_terbit ? getAutoTanggalBerakhir(form.tanggal_terbit, "SP", val) : "";
                        setForm({ ...form, tingkat_sp: val, tanggal_berakhir: autoEnd || form.tanggal_berakhir });
                      }}
                        options={SP_OPTIONS.map(s => ({ value: s.value, label: s.label }))} placeholder="Pilih tingkat" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground mb-1.5 block">Pelanggaran <span className="text-danger">*</span></label>
                      <textarea rows={2} placeholder="Deskripsi pelanggaran..." value={form.pelanggaran}
                        onChange={(e) => setForm({ ...form, pelanggaran: e.target.value })} className={cn(inputClass, "resize-none")} />
                    </div>
                  </>
                )}

                {/* Tanggal */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal Terbit <span className="text-danger">*</span></label>
                    <DatePicker value={form.tanggal_terbit} onChange={(val) => {
                      const autoEnd = getAutoTanggalBerakhir(val, form.kategori, form.tingkat_sp);
                      setForm({ ...form, tanggal_terbit: val, tanggal_berakhir: autoEnd || form.tanggal_berakhir });
                      setFormError("");
                    }} placeholder="Tanggal terbit" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal Berakhir <span className="text-danger">*</span></label>
                    <DatePicker value={form.tanggal_berakhir} onChange={(val) => { setForm({ ...form, tanggal_berakhir: val }); setFormError(""); }} placeholder="Tanggal berakhir" />
                    {form.tanggal_terbit && form.tanggal_berakhir && (
                      <p className="text-[10px] text-muted-foreground mt-1">Otomatis dari pengaturan masa berlaku. Bisa diubah manual.</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></label>
                  <textarea rows={2} placeholder="Catatan tambahan..." value={form.catatan}
                    onChange={(e) => setForm({ ...form, catatan: e.target.value })} className={cn(inputClass, "resize-none")} />
                </div>


              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                <Button size="sm" icon={editingId ? Check : Plus} onClick={handleSave} disabled={formSaving}>
                  {formSaving ? "Menyimpan..." : editingId ? "Simpan" : "Tambah"}
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
                <h3 className="text-base font-bold text-foreground">Hapus Dokumen?</h3>
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
