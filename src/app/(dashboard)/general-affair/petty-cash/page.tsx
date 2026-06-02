"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Wallet, Plus, Search, Pencil, Trash2, X, Check, CircleCheckBig, AlertTriangle,
  ChevronLeft, ChevronRight, ChevronDown, Download, FileText, Filter, ArrowDownToLine,
  Calendar, Settings, TrendingUp, TrendingDown, BarChart3, Coins, ArrowUpRight, ArrowDownRight,
  Briefcase, Layers, Tag,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase, type DbPettyCashTransaction, type DbPettyCashCategory, type DbPettyCashBagian, type DbPettyCashUnit, type DbPettyCashSettings, type DbPegawai } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type Transaction = DbPettyCashTransaction & {
  category?: DbPettyCashCategory;
  bagian?: DbPettyCashBagian;
  unit?: DbPettyCashUnit;
  runningBalance?: number;
};

type CategoryLite = { id: number; nama: string; color: string; icon: string | null; type: "income" | "expense" | "both" };
type BagianLite = { id: number; nama: string; status: string };
type UnitLite = { id: number; bagian_id: number; nama: string; status: string };
type SettingsLite = DbPettyCashSettings & { custodian?: DbPegawai };

const PAGE_SIZE = 15;
const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

function fmtDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function PettyCashPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("petty-cash");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"tabel" | "ringkasan">("tabel");
  const [page, setPage] = useState(1);

  const [settings, setSettings] = useState<SettingsLite | null>(null);
  const [categories, setCategories] = useState<CategoryLite[]>([]);
  const [bagians, setBagians] = useState<BagianLite[]>([]);
  const [units, setUnits] = useState<UnitLite[]>([]);
  const [employees, setEmployees] = useState<{ id: string; nama: string }[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Filter
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [filterCategory, setFilterCategory] = useState("Semua");
  const [filterBagian, setFilterBagian] = useState("Semua");
  const [search, setSearch] = useState("");

  // Add/Edit form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    tanggal: localDateStr(), category_id: 0, bagian_id: 0, unit_id: 0, keterangan: "", cash_in: 0, cash_out: 0,
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Top-up modal
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpForm, setTopUpForm] = useState({ tanggal: localDateStr(), nominal: 0, keterangan: "Top-up saldo petty cash dari finance" });
  const [topUpSaving, setTopUpSaving] = useState(false);

  // Settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ initial_balance: 0, low_balance_threshold: 0, custodian_id: "", catatan: "" });
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Master data inline editors
  const [masterTab, setMasterTab] = useState<"kategori" | "bagian" | "unit">("kategori");
  const [newCategory, setNewCategory] = useState({ nama: "", type: "expense" as "income" | "expense" | "both", color: "#6b7280" });
  const [newBagian, setNewBagian] = useState("");
  const [newUnit, setNewUnit] = useState({ bagian_id: 0, nama: "" });

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Export menu
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Toast
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExportMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (showForm || showTopUp || showSettingsModal) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [showForm, showTopUp, showSettingsModal]);

  // ─── Fetch ───
  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from("petty_cash_settings")
      .select("*, custodian:petty_cash_settings_custodian_id_fkey(id, nama)")
      .eq("id", 1)
      .maybeSingle();
    if (data) {
      setSettings(data as SettingsLite);
      setSettingsForm({
        initial_balance: data.initial_balance,
        low_balance_threshold: data.low_balance_threshold,
        custodian_id: data.custodian_id || "",
        catatan: data.catatan || "",
      });
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    const { data } = await supabase.from("petty_cash_categories").select("id, nama, color, icon, type, urutan, status").eq("status", "Aktif").order("urutan");
    if (data) setCategories(data as CategoryLite[]);
  }, []);

  const fetchBagians = useCallback(async () => {
    const { data } = await supabase.from("petty_cash_bagians").select("id, nama, status").eq("status", "Aktif").order("urutan");
    if (data) setBagians(data as BagianLite[]);
  }, []);

  const fetchUnits = useCallback(async () => {
    const { data } = await supabase.from("petty_cash_units").select("id, bagian_id, nama, status").eq("status", "Aktif").order("urutan");
    if (data) setUnits(data as UnitLite[]);
  }, []);

  const fetchEmployees = useCallback(async () => {
    const { data } = await supabase.from("pegawai").select("id, nama").eq("status", "Aktif").order("nama");
    if (data) setEmployees(data);
  }, []);

  const fetchTransactions = useCallback(async () => {
    const PAGE = 1000;
    let all: any[] = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      let q = supabase
        .from("petty_cash_transactions")
        .select("*, category:petty_cash_categories(id, nama, color, icon, type), bagian:petty_cash_bagians(id, nama), unit:petty_cash_units(id, nama)")
        .order("tanggal", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (dateStart) q = q.gte("tanggal", dateStart);
      if (dateEnd) q = q.lte("tanggal", dateEnd);
      const { data, error } = await q;
      if (error || !data) break;
      all = all.concat(data);
      hasMore = data.length === PAGE;
      from += PAGE;
    }
    setTransactions(all as Transaction[]);
  }, [dateStart, dateEnd]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchSettings(), fetchCategories(), fetchBagians(), fetchUnits(), fetchEmployees()]);
      setLoading(false);
    })();
  }, [fetchSettings, fetchCategories, fetchBagians, fetchUnits, fetchEmployees]);

  useEffect(() => {
    if (!loading) fetchTransactions();
  }, [loading, fetchTransactions]);

  useEffect(() => { setPage(1); }, [search, filterCategory, filterBagian, dateStart, dateEnd]);

  // ─── Computed: running balance + filtered + stats ───
  const transactionsWithBalance = useMemo(() => {
    let bal = 0;
    return transactions.map((t) => {
      bal += t.cash_in - t.cash_out;
      return { ...t, runningBalance: bal };
    });
  }, [transactions]);

  // Filter & search applied on TOP of running balance (so filter doesn't break the running)
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return transactionsWithBalance.filter((t) => {
      const matchCat = filterCategory === "Semua" || t.category_id === Number(filterCategory);
      const matchBag = filterBagian === "Semua" || t.bagian_id === Number(filterBagian);
      const matchSearch = !q
        || t.keterangan.toLowerCase().includes(q)
        || (t.category?.nama || "").toLowerCase().includes(q)
        || (t.bagian?.nama || "").toLowerCase().includes(q)
        || (t.unit?.nama || "").toLowerCase().includes(q);
      return matchCat && matchBag && matchSearch;
    });
  }, [transactionsWithBalance, filterCategory, filterBagian, search]);

  // Reverse for display (newest first), but keep running balance correct
  const displayed = useMemo(() => {
    return [...filtered].reverse();
  }, [filtered]);

  const paged = useMemo(
    () => displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [displayed, page]
  );

  const stats = useMemo(() => {
    const totalIn = filtered.reduce((s, t) => s + t.cash_in, 0);
    const totalOut = filtered.reduce((s, t) => s + t.cash_out, 0);
    const txCount = filtered.length;
    const lastBalance = filtered.length > 0 ? filtered[filtered.length - 1].runningBalance ?? 0 : 0;
    const currentBalance = settings?.initial_balance != null
      ? settings.initial_balance + transactions.reduce((s, t) => s + t.cash_in - t.cash_out, 0)
      : 0;
    return { totalIn, totalOut, txCount, lastBalance, currentBalance };
  }, [filtered, settings, transactions]);

  // Per-kategori breakdown
  const perCategory = useMemo(() => {
    const map = new Map<number, { nama: string; color: string; total: number; count: number }>();
    filtered.forEach((t) => {
      if (t.cash_out === 0) return;
      const key = t.category_id;
      const cat = t.category;
      if (!cat) return;
      const existing = map.get(key);
      if (existing) {
        existing.total += t.cash_out;
        existing.count += 1;
      } else {
        map.set(key, { nama: cat.nama, color: cat.color, total: t.cash_out, count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  // Per-bagian breakdown
  const perBagian = useMemo(() => {
    const map = new Map<number, { nama: string; total: number; count: number }>();
    filtered.forEach((t) => {
      if (t.cash_out === 0) return;
      const key = t.bagian_id;
      const bag = t.bagian;
      if (!bag) return;
      const existing = map.get(key);
      if (existing) {
        existing.total += t.cash_out;
        existing.count += 1;
      } else {
        map.set(key, { nama: bag.nama, total: t.cash_out, count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  // Units filtered by selected bagian (in form)
  const unitsForBagian = useMemo(() => {
    if (!form.bagian_id) return [];
    return units.filter((u) => u.bagian_id === form.bagian_id);
  }, [form.bagian_id, units]);

  // ─── Form handlers ───
  const openAdd = () => {
    setForm({ tanggal: localDateStr(), category_id: categories[0]?.id || 0, bagian_id: bagians[0]?.id || 0, unit_id: 0, keterangan: "", cash_in: 0, cash_out: 0 });
    setEditingId(null);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (t: Transaction) => {
    setForm({
      tanggal: t.tanggal,
      category_id: t.category_id,
      bagian_id: t.bagian_id,
      unit_id: t.unit_id || 0,
      keterangan: t.keterangan,
      cash_in: t.cash_in,
      cash_out: t.cash_out,
    });
    setEditingId(t.id);
    setFormError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.tanggal) return setFormError("Tanggal wajib diisi.");
    if (!form.category_id) return setFormError("Kategori wajib dipilih.");
    if (!form.bagian_id) return setFormError("Bagian wajib dipilih.");
    if (!form.keterangan.trim()) return setFormError("Keterangan wajib diisi.");
    if (form.cash_in === 0 && form.cash_out === 0) return setFormError("Isi nominal Cash In atau Cash Out.");
    if (form.cash_in > 0 && form.cash_out > 0) return setFormError("Transaksi hanya boleh Cash In atau Cash Out, bukan keduanya.");

    setFormSaving(true);
    const payload = {
      tanggal: form.tanggal,
      category_id: form.category_id,
      bagian_id: form.bagian_id,
      unit_id: form.unit_id || null,
      keterangan: form.keterangan.trim(),
      cash_in: form.cash_in,
      cash_out: form.cash_out,
    };

    if (editingId) {
      const { data: oldRow } = await supabase.from("petty_cash_transactions").select("*").eq("id", editingId).maybeSingle();
      const { error } = await supabase.from("petty_cash_transactions").update(payload).eq("id", editingId);
      if (error) { setFormError(error.message); setFormSaving(false); return; }
      await logAudit({
        supabase, action: "update", entityType: "petty_cash_transactions", entityId: String(editingId),
        entityLabel: `${form.keterangan} (${form.tanggal})`, oldData: oldRow, newData: payload,
      });
      showToast("success", "Transaksi Diperbarui", `Data transaksi berhasil diperbarui.`);
    } else {
      const { data: inserted, error } = await supabase.from("petty_cash_transactions").insert(payload).select("id").single();
      if (error) { setFormError(error.message); setFormSaving(false); return; }
      await logAudit({
        supabase, action: "create", entityType: "petty_cash_transactions", entityId: String(inserted?.id || ""),
        entityLabel: `${form.keterangan} (${form.tanggal})`, newData: payload,
      });
      showToast("success", "Transaksi Disimpan", `Data transaksi berhasil ditambahkan.`);
    }
    setFormSaving(false);
    setShowForm(false);
    setEditingId(null);
    await fetchTransactions();
  };

  const handleTopUp = async () => {
    if (topUpForm.nominal <= 0) {
      showToast("error", "Nominal Tidak Valid", "Nominal top-up harus lebih dari 0.");
      return;
    }
    setTopUpSaving(true);
    const topUpCat = categories.find((c) => c.type === "income");
    if (!topUpCat) {
      showToast("error", "Kategori Top-up Tidak Ditemukan", "Tambah kategori dengan type=income dulu.");
      setTopUpSaving(false);
      return;
    }
    const gaBagian = bagians.find((b) => b.nama === "GA") || bagians[0];
    if (!gaBagian) {
      showToast("error", "Bagian GA Tidak Ditemukan", "Tambah master bagian dulu.");
      setTopUpSaving(false);
      return;
    }
    const payload = {
      tanggal: topUpForm.tanggal,
      category_id: topUpCat.id,
      bagian_id: gaBagian.id,
      unit_id: null,
      keterangan: topUpForm.keterangan.trim() || "Top-up saldo petty cash",
      cash_in: topUpForm.nominal,
      cash_out: 0,
    };
    const { data: inserted, error } = await supabase.from("petty_cash_transactions").insert(payload).select("id").single();
    if (error) { showToast("error", "Gagal Top-up", error.message); setTopUpSaving(false); return; }
    await logAudit({
      supabase, action: "create", entityType: "petty_cash_transactions", entityId: String(inserted?.id || ""),
      entityLabel: `Top-up ${formatCurrency(topUpForm.nominal)} (${topUpForm.tanggal})`, newData: payload,
    });
    showToast("success", "Top-up Berhasil", `Saldo bertambah ${formatCurrency(topUpForm.nominal)}.`);
    setTopUpSaving(false);
    setShowTopUp(false);
    setTopUpForm({ tanggal: localDateStr(), nominal: 0, keterangan: "Top-up saldo petty cash dari finance" });
    await fetchTransactions();
  };

  const handleSaveSettings = async () => {
    if (settingsForm.initial_balance < 0 || settingsForm.low_balance_threshold < 0) {
      showToast("error", "Nilai Tidak Valid", "Imprest dan threshold tidak boleh negatif.");
      return;
    }
    setSettingsSaving(true);
    const payload = {
      initial_balance: settingsForm.initial_balance,
      low_balance_threshold: settingsForm.low_balance_threshold,
      custodian_id: settingsForm.custodian_id || null,
      catatan: settingsForm.catatan.trim() || null,
    };
    const { data: oldRow } = await supabase.from("petty_cash_settings").select("*").eq("id", 1).maybeSingle();
    const { error } = await supabase.from("petty_cash_settings").update(payload).eq("id", 1);
    if (error) { showToast("error", "Gagal Menyimpan", error.message); setSettingsSaving(false); return; }
    await logAudit({
      supabase, action: "update", entityType: "petty_cash_settings", entityId: "1",
      entityLabel: "Pengaturan Petty Cash", oldData: oldRow, newData: payload,
    });
    showToast("success", "Pengaturan Disimpan", "Konfigurasi petty cash berhasil diperbarui.");
    setSettingsSaving(false);
    setShowSettingsModal(false);
    await fetchSettings();
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    const { data: oldRow } = await supabase.from("petty_cash_transactions").select("*").eq("id", deleteConfirm.id).maybeSingle();
    const { error } = await supabase.from("petty_cash_transactions").delete().eq("id", deleteConfirm.id);
    if (error) { showToast("error", "Gagal Menghapus", error.message); setDeleting(false); return; }
    await logAudit({
      supabase, action: "delete", entityType: "petty_cash_transactions", entityId: String(deleteConfirm.id),
      entityLabel: deleteConfirm.label, oldData: oldRow,
    });
    showToast("success", "Transaksi Dihapus", "Data transaksi berhasil dihapus.");
    setDeleting(false);
    setDeleteConfirm(null);
    await fetchTransactions();
  };

  // ─── Master data inline add ───
  const handleAddCategory = async () => {
    if (!newCategory.nama.trim()) return;
    const { error } = await supabase.from("petty_cash_categories").insert({
      nama: newCategory.nama.trim(), type: newCategory.type, color: newCategory.color,
      urutan: categories.length + 1, status: "Aktif",
    });
    if (error) { showToast("error", "Gagal", error.message); return; }
    showToast("success", "Kategori Ditambahkan");
    setNewCategory({ nama: "", type: "expense", color: "#6b7280" });
    await fetchCategories();
  };

  const handleAddBagian = async () => {
    if (!newBagian.trim()) return;
    const { error } = await supabase.from("petty_cash_bagians").insert({
      nama: newBagian.trim(), urutan: bagians.length + 1, status: "Aktif",
    });
    if (error) { showToast("error", "Gagal", error.message); return; }
    showToast("success", "Bagian Ditambahkan");
    setNewBagian("");
    await fetchBagians();
  };

  const handleAddUnit = async () => {
    if (!newUnit.bagian_id || !newUnit.nama.trim()) return;
    const { error } = await supabase.from("petty_cash_units").insert({
      bagian_id: newUnit.bagian_id, nama: newUnit.nama.trim(), urutan: 0, status: "Aktif",
    });
    if (error) { showToast("error", "Gagal", error.message); return; }
    showToast("success", "Unit Ditambahkan");
    setNewUnit({ bagian_id: 0, nama: "" });
    await fetchUnits();
  };

  const handleToggleStatus = async (table: "petty_cash_categories" | "petty_cash_bagians" | "petty_cash_units", id: number, current: string) => {
    const newStatus = current === "Aktif" ? "Tidak Aktif" : "Aktif";
    const { error } = await supabase.from(table).update({ status: newStatus }).eq("id", id);
    if (error) { showToast("error", "Gagal", error.message); return; }
    showToast("success", `Status Diubah ke ${newStatus}`);
    if (table === "petty_cash_categories") await fetchCategories();
    else if (table === "petty_cash_bagians") await fetchBagians();
    else await fetchUnits();
  };

  // ─── Export ───
  const exportCSV = () => {
    if (displayed.length === 0) return;
    const headers = ["Tanggal", "Kategori", "Bagian", "Unit", "Keterangan", "Cash In", "Cash Out", "Balance"];
    const rows: string[] = [headers.join(",")];
    displayed.forEach((t) => {
      rows.push([
        t.tanggal,
        `"${t.category?.nama || ""}"`,
        `"${t.bagian?.nama || ""}"`,
        `"${t.unit?.nama || ""}"`,
        `"${t.keterangan.replace(/"/g, "'")}"`,
        t.cash_in, t.cash_out, t.runningBalance ?? 0,
      ].join(","));
    });
    rows.push(["", "", "", "", "TOTAL", stats.totalIn, stats.totalOut, stats.currentBalance].join(","));
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Petty_Cash_${dateStart || "all"}_${dateEnd || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const exportPDF = async () => {
    if (displayed.length === 0) return;
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Petty Cash", pw / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const dateRange = dateStart && dateEnd ? `${dateStart} – ${dateEnd}` : "Semua periode";
    doc.text(`Periode: ${dateRange}`, pw / 2, 21, { align: "center" });
    doc.text(`Saldo Saat Ini: ${formatCurrency(stats.currentBalance)}`, pw / 2, 27, { align: "center" });
    doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, pw / 2, 33, { align: "center" });

    const body = displayed.map((t) => [
      fmtDate(t.tanggal), t.category?.nama || "-", t.bagian?.nama || "-", t.unit?.nama || "-",
      t.keterangan, t.cash_in > 0 ? formatCurrency(t.cash_in) : "-", t.cash_out > 0 ? formatCurrency(t.cash_out) : "-",
      formatCurrency(t.runningBalance ?? 0),
    ]);
    body.push(["TOTAL", "", "", "", `${displayed.length} transaksi`, formatCurrency(stats.totalIn), formatCurrency(stats.totalOut), formatCurrency(stats.currentBalance)]);

    autoTable(doc, {
      startY: 39,
      head: [["Tanggal", "Kategori", "Bagian", "Unit", "Keterangan", "Cash In", "Cash Out", "Balance"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 7 },
      columnStyles: { 0: { halign: "center", cellWidth: 22 }, 1: { cellWidth: 24 }, 2: { cellWidth: 22 }, 3: { cellWidth: 22 }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right", fontStyle: "bold" } },
      margin: { left: 12, right: 12 },
      didParseCell: (data) => {
        if (data.row.index === body.length - 1) {
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    doc.save(`Petty_Cash_${dateStart || "all"}_${dateEnd || "all"}.pdf`);
    setShowExportMenu(false);
  };

  const isLowBalance = settings && stats.currentBalance < settings.low_balance_threshold;
  const custName = settings?.custodian?.nama || "—";

  return (
    <RouteGuard permission="petty-cash">
      <div className="space-y-4 animate-fade-in">
        <PageHeader
          title="Patty Cash"
          description="Catat transaksi kas kecil harian (metode Imprest)"
          icon={Wallet}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" icon={Settings} onClick={() => setShowSettingsModal(true)}>Pengaturan</Button>
              {canInput && <Button variant="outline" size="sm" icon={ArrowDownToLine} onClick={() => setShowTopUp(true)}>Top-up</Button>}
              {canInput && <Button icon={Plus} size="sm" onClick={openAdd}>Transaksi</Button>}
            </div>
          }
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

        {/* Low balance alert */}
        {isLowBalance && (
          <div className="bg-warning/10 border border-warning/30 rounded-2xl p-4 flex items-center gap-3 animate-fade-in">
            <div className="w-10 h-10 rounded-xl bg-warning/20 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">Saldo Rendah</p>
              <p className="text-xs text-muted-foreground mt-0.5">Saldo saat ini <strong className="text-warning">{formatCurrency(stats.currentBalance)}</strong> di bawah threshold <strong>{formatCurrency(settings?.low_balance_threshold || 0)}</strong>. Segera lakukan top-up dari finance.</p>
            </div>
            {canInput && <Button size="sm" icon={ArrowDownToLine} onClick={() => setShowTopUp(true)}>Top-up Sekarang</Button>}
          </div>
        )}

        {/* Balance cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={cn("rounded-2xl border p-4", isLowBalance ? "bg-warning/5 border-warning/30" : "bg-card border-border")}>
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Saldo Saat Ini</p>
                <p className={cn("text-xl font-bold mt-1 truncate", isLowBalance ? "text-warning" : "text-foreground")}>{loading ? "-" : formatCurrency(stats.currentBalance)}</p>
              </div>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", isLowBalance ? "bg-warning/20" : "bg-primary/10")}>
                <Wallet className={cn("w-5 h-5", isLowBalance ? "text-warning" : "text-primary")} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 truncate">Imprest: {settings ? formatCurrency(settings.initial_balance) : "—"}</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Cash In (Periode)</p>
                <p className="text-xl font-bold text-success mt-1">{loading ? "-" : formatCurrency(stats.totalIn)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">top-up & pemasukan</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Cash Out (Periode)</p>
                <p className="text-xl font-bold text-danger mt-1">{loading ? "-" : formatCurrency(stats.totalOut)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0">
                <TrendingDown className="w-5 h-5 text-danger" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">pengeluaran</p>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Penanggung Jawab</p>
                <p className="text-sm font-bold text-foreground mt-1 truncate">{custName}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Briefcase className="w-5 h-5 text-blue-500" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 truncate">{stats.txCount} transaksi (periode ini)</p>
          </div>
        </div>

        {/* View toggle + toolbar */}
        <div className="flex items-center gap-1 bg-muted rounded-xl p-1 w-fit">
          <button onClick={() => setViewMode("tabel")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              viewMode === "tabel" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Layers className="w-3.5 h-3.5" />Tabel
          </button>
          <button onClick={() => setViewMode("ringkasan")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              viewMode === "ringkasan" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <BarChart3 className="w-3.5 h-3.5" />Ringkasan
          </button>
        </div>

        {/* Filter toolbar */}
        <div className="bg-card rounded-2xl border border-border p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-shrink-0">
              <DatePicker value={dateStart} onChange={setDateStart} placeholder="Dari tanggal" />
              <span className="text-xs text-muted-foreground">–</span>
              <DatePicker value={dateEnd} onChange={setDateEnd} placeholder="Sampai tanggal" />
              {(dateStart || dateEnd) && (
                <button onClick={() => { setDateStart(""); setDateEnd(""); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Reset filter tanggal">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <Select
              value={filterCategory}
              onChange={(v) => setFilterCategory(v)}
              options={[{ value: "Semua", label: "Semua Kategori" }, ...categories.map((c) => ({ value: String(c.id), label: c.nama }))]}
              className="w-44"
            />
            <Select
              value={filterBagian}
              onChange={(v) => setFilterBagian(v)}
              options={[{ value: "Semua", label: "Semua Bagian" }, ...bagians.map((b) => ({ value: String(b.id), label: b.nama }))]}
              className="w-40"
            />
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input type="text" placeholder="Cari keterangan / kategori / bagian..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
            </div>
            <div ref={exportRef} className="relative flex-shrink-0">
              <Button variant="outline" size="sm" icon={Download} onClick={() => setShowExportMenu(!showExportMenu)} disabled={displayed.length === 0}>
                Export <ChevronDown className="w-3 h-3 ml-0.5" />
              </Button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-44 bg-card rounded-xl border border-border shadow-xl z-10 overflow-hidden animate-scale-in">
                  <button onClick={exportPDF} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                    <FileText className="w-3.5 h-3.5 text-danger" />Export PDF
                  </button>
                  <button onClick={exportCSV} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors border-t border-border">
                    <FileText className="w-3.5 h-3.5 text-success" />Export CSV
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ TABEL VIEW ═══ */}
        {viewMode === "tabel" && (
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Tanggal</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Kategori</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Bagian</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Unit</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Keterangan</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-32">Cash In</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-32">Cash Out</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-32">Balance</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-24">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? <SkeletonTable rows={8} cols={10} /> : paged.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-12 text-sm text-muted-foreground">
                      {transactions.length === 0 ? "Belum ada transaksi. Klik tombol Transaksi atau Top-up untuk mulai." : "Tidak ada transaksi yang cocok dengan filter."}
                    </td></tr>
                  ) : paged.map((row, idx) => {
                    const cat = row.category;
                    return (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                        <td className="px-5 py-3 text-xs text-foreground whitespace-nowrap">{fmtDate(row.tanggal)}</td>
                        <td className="px-5 py-3">
                          {cat ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md" style={{ backgroundColor: `${cat.color}15`, color: cat.color }}>
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                              {cat.nama}
                            </span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="px-5 py-3 text-xs text-foreground">{row.bagian?.nama || "-"}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{row.unit?.nama || "-"}</td>
                        <td className="px-5 py-3 text-xs text-foreground max-w-[280px]">{row.keterangan}</td>
                        <td className="px-5 py-3 text-right text-sm font-semibold text-success whitespace-nowrap">
                          {row.cash_in > 0 ? formatCurrency(row.cash_in) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-sm font-semibold text-danger whitespace-nowrap">
                          {row.cash_out > 0 ? formatCurrency(row.cash_out) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-sm font-bold text-foreground whitespace-nowrap">
                          {formatCurrency(row.runningBalance ?? 0)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {canEdit && <button onClick={() => openEdit(row)} title="Edit" className="p-1.5 rounded-lg hover:bg-primary-light text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>}
                            {canEdit && <button onClick={() => setDeleteConfirm({ id: row.id, label: `${row.keterangan} (${row.tanggal})` })} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination currentPage={page} totalItems={displayed.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </div>
        )}

        {/* ═══ RINGKASAN VIEW ═══ */}
        {viewMode === "ringkasan" && (
          <div className="space-y-4">
            {/* Per Kategori */}
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Pengeluaran per Kategori</h3>
                </div>
                <p className="text-[10px] text-muted-foreground">{perCategory.length} kategori</p>
              </div>
              {loading ? <SkeletonTable rows={3} cols={4} /> : perCategory.length === 0 ? (
                <div className="text-center py-10 text-sm text-muted-foreground">Belum ada data cash out di periode ini.</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {perCategory.map((c) => {
                    const pct = stats.totalOut > 0 ? (c.total / stats.totalOut) * 100 : 0;
                    return (
                      <div key={c.nama} className="px-5 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                            <span className="text-xs font-semibold text-foreground">{c.nama}</span>
                            <span className="text-[10px] text-muted-foreground">{c.count}x transaksi</span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-foreground">{formatCurrency(c.total)}</p>
                            <p className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</p>
                          </div>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: c.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Per Bagian */}
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Pengeluaran per Bagian</h3>
                </div>
                <p className="text-[10px] text-muted-foreground">{perBagian.length} bagian</p>
              </div>
              {loading ? <SkeletonTable rows={3} cols={4} /> : perBagian.length === 0 ? (
                <div className="text-center py-10 text-sm text-muted-foreground">Belum ada data cash out di periode ini.</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-12">#</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5">Bagian</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-24">Transaksi</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-32">Total</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-2.5 w-24">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {perBagian.map((b, i) => {
                      const pct = stats.totalOut > 0 ? (b.total / stats.totalOut) * 100 : 0;
                      return (
                        <tr key={b.nama}>
                          <td className="px-5 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                          <td className="px-5 py-2.5 text-xs font-semibold text-foreground">{b.nama}</td>
                          <td className="px-5 py-2.5 text-center text-xs text-muted-foreground">{b.count}</td>
                          <td className="px-5 py-2.5 text-right text-sm font-semibold text-foreground">{formatCurrency(b.total)}</td>
                          <td className="px-5 py-2.5 text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Master data tabs */}
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Master Data</h3>
                <div className="ml-3 flex items-center gap-1 bg-muted rounded-lg p-0.5">
                  {(["kategori", "bagian", "unit"] as const).map((t) => (
                    <button key={t} onClick={() => setMasterTab(t)}
                      className={cn("px-2.5 py-1 rounded text-[11px] font-semibold capitalize transition-all",
                        masterTab === t ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-4">
                {masterTab === "kategori" && (
                  <div className="space-y-2">
                    {categories.map((c) => (
                      <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                          <span className="text-xs font-semibold text-foreground truncate">{c.nama}</span>
                          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", c.type === "income" ? "bg-success/10 text-success" : c.type === "expense" ? "bg-danger/10 text-danger" : "bg-blue-500/10 text-blue-500")}>{c.type}</span>
                        </div>
                      </div>
                    ))}
                    {canEdit && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        <input type="text" placeholder="Kategori baru..." value={newCategory.nama} onChange={(e) => setNewCategory({ ...newCategory, nama: e.target.value })} className={cn(inputClass, "flex-1 text-xs py-2")} />
                        <select value={newCategory.type} onChange={(e) => setNewCategory({ ...newCategory, type: e.target.value as "income" | "expense" | "both" })} className="px-2 py-2 rounded-xl border border-border bg-muted/30 text-xs outline-none text-foreground">
                          <option value="expense">Expense</option>
                          <option value="income">Income</option>
                          <option value="both">Both</option>
                        </select>
                        <input type="color" value={newCategory.color} onChange={(e) => setNewCategory({ ...newCategory, color: e.target.value })} className="w-8 h-8 rounded-lg border border-border cursor-pointer" />
                        <Button size="sm" icon={Plus} onClick={handleAddCategory}>Tambah</Button>
                      </div>
                    )}
                  </div>
                )}
                {masterTab === "bagian" && (
                  <div className="space-y-2">
                    {bagians.map((b) => (
                      <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30">
                        <span className="text-xs font-semibold text-foreground">{b.nama}</span>
                      </div>
                    ))}
                    {canEdit && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        <input type="text" placeholder="Bagian baru..." value={newBagian} onChange={(e) => setNewBagian(e.target.value)} className={cn(inputClass, "flex-1 text-xs py-2")} />
                        <Button size="sm" icon={Plus} onClick={handleAddBagian}>Tambah</Button>
                      </div>
                    )}
                  </div>
                )}
                {masterTab === "unit" && (
                  <div className="space-y-2">
                    {bagians.map((b) => {
                      const us = units.filter((u) => u.bagian_id === b.id);
                      return (
                        <div key={b.id} className="px-3 py-2 rounded-lg bg-muted/30">
                          <p className="text-xs font-bold text-foreground mb-1.5">{b.nama}</p>
                          {us.length === 0 ? <p className="text-[10px] text-muted-foreground italic">Belum ada unit</p> : (
                            <div className="flex flex-wrap gap-1.5">
                              {us.map((u) => <span key={u.id} className="text-[10px] font-medium px-2 py-0.5 rounded bg-card border border-border text-foreground">{u.nama}</span>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {canEdit && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        <select value={newUnit.bagian_id || ""} onChange={(e) => setNewUnit({ ...newUnit, bagian_id: Number(e.target.value) })} className="px-2 py-2 rounded-xl border border-border bg-muted/30 text-xs outline-none text-foreground">
                          <option value="">Pilih bagian...</option>
                          {bagians.map((b) => <option key={b.id} value={b.id}>{b.nama}</option>)}
                        </select>
                        <input type="text" placeholder="Unit baru..." value={newUnit.nama} onChange={(e) => setNewUnit({ ...newUnit, nama: e.target.value })} className={cn(inputClass, "flex-1 text-xs py-2")} />
                        <Button size="sm" icon={Plus} onClick={handleAddUnit}>Tambah</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ ADD/EDIT TRANSACTION MODAL ═══ */}
        {showForm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
              <div className="relative w-full max-w-xl bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <h3 className="text-base font-bold text-foreground">{editingId ? "Edit Transaksi" : "Tambah Transaksi"}</h3>
                  <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {formError && (
                    <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger">{formError}</div>
                  )}
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Tanggal *</label>
                    <DatePicker value={form.tanggal} onChange={(v) => setForm({ ...form, tanggal: v })} placeholder="Pilih tanggal" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Kategori *</label>
                    <Select
                      value={String(form.category_id)}
                      onChange={(v) => setForm({ ...form, category_id: Number(v) })}
                      options={categories.map((c) => ({ value: String(c.id), label: c.nama }))}
                      placeholder="Pilih kategori"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Bagian *</label>
                      <Select
                        value={String(form.bagian_id)}
                        onChange={(v) => setForm({ ...form, bagian_id: Number(v), unit_id: 0 })}
                        options={bagians.map((b) => ({ value: String(b.id), label: b.nama }))}
                        placeholder="Pilih bagian"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Unit <span className="text-muted-foreground/50 font-normal">(opsional)</span></label>
                      <Select
                        value={String(form.unit_id)}
                        onChange={(v) => setForm({ ...form, unit_id: Number(v) })}
                        options={[{ value: "0", label: "—" }, ...unitsForBagian.map((u) => ({ value: String(u.id), label: u.nama }))]}
                        placeholder="Pilih unit"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Keterangan *</label>
                    <input type="text" placeholder="Misal: Beli snack rapat Mingguan" value={form.keterangan}
                      onChange={(e) => setForm({ ...form, keterangan: e.target.value })}
                      className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-success mb-1.5 block">Cash In (masuk)</label>
                      <input type="number" min={0} placeholder="0" value={form.cash_in || ""}
                        onChange={(e) => setForm({ ...form, cash_in: e.target.value === "" ? 0 : Number(e.target.value), cash_out: e.target.value === "" || Number(e.target.value) === 0 ? form.cash_out : 0 })}
                        className={cn(inputClass, "text-success font-semibold")} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-danger mb-1.5 block">Cash Out (keluar)</label>
                      <input type="number" min={0} placeholder="0" value={form.cash_out || ""}
                        onChange={(e) => setForm({ ...form, cash_out: e.target.value === "" ? 0 : Number(e.target.value), cash_in: e.target.value === "" || Number(e.target.value) === 0 ? form.cash_in : 0 })}
                        className={cn(inputClass, "text-danger font-semibold")} />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Isi salah satu: Cash In untuk top-up/pemasukan, Cash Out untuk pengeluaran.</p>
                </div>
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                  <Button size="sm" icon={Check} onClick={handleSave} disabled={formSaving}>{formSaving ? "Menyimpan..." : "Simpan"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* ═══ TOP-UP MODAL ═══ */}
        {showTopUp && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTopUp(false)} />
              <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center"><ArrowDownToLine className="w-5 h-5 text-success" /></div>
                    <h3 className="text-base font-bold text-foreground">Top-up Saldo</h3>
                  </div>
                  <button onClick={() => setShowTopUp(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-xs text-muted-foreground">Top-up akan menambahkan saldo petty cash. Otomatis tercatat ke kategori "Top-up" dan bagian "GA".</p>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Tanggal *</label>
                    <DatePicker value={topUpForm.tanggal} onChange={(v) => setTopUpForm({ ...topUpForm, tanggal: v })} placeholder="Pilih tanggal" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Nominal *</label>
                    <input type="number" min={0} placeholder="500000" value={topUpForm.nominal || ""}
                      onChange={(e) => setTopUpForm({ ...topUpForm, nominal: e.target.value === "" ? 0 : Number(e.target.value) })}
                      className={cn(inputClass, "text-lg font-bold text-success")} />
                    <p className="text-[10px] text-muted-foreground mt-1">{topUpForm.nominal > 0 ? formatCurrency(topUpForm.nominal) : "Isi nominal top-up"}</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Keterangan</label>
                    <input type="text" placeholder="Top-up saldo petty cash" value={topUpForm.keterangan}
                      onChange={(e) => setTopUpForm({ ...topUpForm, keterangan: e.target.value })}
                      className={inputClass} />
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowTopUp(false)} disabled={topUpSaving}>Batal</Button>
                  <Button size="sm" icon={ArrowDownToLine} onClick={handleTopUp} disabled={topUpSaving || topUpForm.nominal <= 0}>{topUpSaving ? "Menyimpan..." : "Top-up"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* ═══ SETTINGS MODAL ═══ */}
        {showSettingsModal && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSettingsModal(false)} />
              <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><Settings className="w-5 h-5 text-primary" /></div>
                    <h3 className="text-base font-bold text-foreground">Pengaturan Petty Cash</h3>
                  </div>
                  <button onClick={() => setShowSettingsModal(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Modal Awal (Imprest) *</label>
                    <input type="number" min={0} value={settingsForm.initial_balance || ""}
                      onChange={(e) => setSettingsForm({ ...settingsForm, initial_balance: e.target.value === "" ? 0 : Number(e.target.value) })}
                      className={inputClass} />
                    <p className="text-[10px] text-muted-foreground mt-1">Saldo awal yang di-set saat sistem diaktifkan. Saldo berjalan = modal + SUM(cash_in) − SUM(cash_out).</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Threshold Saldo Rendah *</label>
                    <input type="number" min={0} value={settingsForm.low_balance_threshold || ""}
                      onChange={(e) => setSettingsForm({ ...settingsForm, low_balance_threshold: e.target.value === "" ? 0 : Number(e.target.value) })}
                      className={inputClass} />
                    <p className="text-[10px] text-muted-foreground mt-1">Sistem akan menampilkan peringatan saat saldo di bawah nilai ini.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Penanggung Jawab</label>
                    <Select
                      value={settingsForm.custodian_id}
                      onChange={(v) => setSettingsForm({ ...settingsForm, custodian_id: v })}
                      options={[{ value: "", label: "—" }, ...employees.map((e) => ({ value: e.id, label: e.nama }))]}
                      placeholder="Pilih penanggung jawab"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Catatan</label>
                    <textarea rows={3} placeholder="Catatan konfigurasi..." value={settingsForm.catatan}
                      onChange={(e) => setSettingsForm({ ...settingsForm, catatan: e.target.value })}
                      className={cn(inputClass, "resize-none")} />
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowSettingsModal(false)} disabled={settingsSaving}>Batal</Button>
                  <Button size="sm" icon={Check} onClick={handleSaveSettings} disabled={settingsSaving}>{settingsSaving ? "Menyimpan..." : "Simpan"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}

        {/* ═══ DELETE CONFIRM ═══ */}
        {deleteConfirm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
              <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0"><Trash2 className="w-5 h-5 text-danger" /></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-foreground">Hapus Transaksi?</h3>
                    <p className="text-xs text-muted-foreground mt-1">"{deleteConfirm.label}" akan dihapus permanen dan saldo akan dihitung ulang.</p>
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
