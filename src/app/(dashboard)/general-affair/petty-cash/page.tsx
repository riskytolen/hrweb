"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Wallet, Plus, Search, Pencil, Trash2, X, Check, CircleCheckBig, AlertTriangle,
  ChevronLeft, ChevronRight, ChevronDown, Download, FileText, Filter, ArrowDownToLine,
  Calendar, Settings, TrendingUp, TrendingDown, BarChart3, Coins, ArrowUpRight, ArrowDownRight,
  Briefcase, Layers, Tag, ListPlus, Rows3, Copy,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase, type DbPettyCashTransaction, type DbPettyCashCategory, type DbPettyCashBagian, type DbPettyCashUnit, type DbPettyCashSettings, type DbPegawai } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";

type Transaction = DbPettyCashTransaction & {
  category?: DbPettyCashCategory;
  bagian?: DbPettyCashBagian;
  runningBalance?: number;
};

type CategoryLite = { id: number; nama: string; color: string; icon: string | null; type: "income" | "expense" | "both" };
type BagianLite = { id: number; nama: string; status: string };
type UnitLite = { id: number; nama: string; status: string };
type SettingsLite = DbPettyCashSettings & { custodian?: DbPegawai };
type BulkRow = {
  key: string;
  tanggal: string;
  category_id: number;
  bagian_id: number;
  unit: string;
  keterangan: string;
  cash_in: number;
  cash_out: number;
};

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
  const [viewMode, setViewMode] = useState<"tabel" | "laporan" | "master">("tabel");
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
  const [filterUnit, setFilterUnit] = useState("");
  const [search, setSearch] = useState("");

  // Laporan: per-row filters (setiap kategori punya filter bagian & unit sendiri)
  const [rowFilters, setRowFilters] = useState<Record<number, { bagian: string; unit: string }>>({});
  const updateRowFilter = (catId: number, field: "bagian" | "unit", value: string) => {
    setRowFilters((prev) => ({ ...prev, [catId]: { ...prev[catId] || { bagian: "", unit: "" }, [field]: value } }));
  };
  const resetAllRowFilters = () => setRowFilters({});

  // Add/Edit form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formMode, setFormMode] = useState<"single" | "bulk">("single");
  const [form, setForm] = useState({
    tanggal: localDateStr(), category_id: 0, bagian_id: 0, unit: "", keterangan: "", cash_in: 0, cash_out: 0,
  });
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
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
  const [masterPageKat, setMasterPageKat] = useState(1);
  const [masterPageBag, setMasterPageBag] = useState(1);
  const [masterPageUnit, setMasterPageUnit] = useState(1);
  const MASTER_PAGE_SIZE = 10;
  const [newCategory, setNewCategory] = useState({ nama: "", type: "expense" as "income" | "expense" | "both", color: "#6b7280" });
  const [newBagian, setNewBagian] = useState("");
  const [newUnit, setNewUnit] = useState("");

  // Master delete confirm
  const [masterDelete, setMasterDelete] = useState<{ table: "categories" | "bagians" | "units"; id: number; label: string } | null>(null);
  const [masterDeleting, setMasterDeleting] = useState(false);

  // Master inline edit state
  const [masterEdit, setMasterEdit] = useState<{ type: "kategori" | "bagian" | "unit"; id: number; data: { nama: string; type?: string; color?: string } } | null>(null);
  const [masterEditSaving, setMasterEditSaving] = useState(false);

  // Delete confirm (transactions)
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
    const { data } = await supabase.from("petty_cash_units").select("id, nama, status").eq("status", "Aktif").order("urutan");
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
        .select("*, category:petty_cash_categories(id, nama, color, icon, type), bagian:petty_cash_bagians(id, nama)")
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

  useEffect(() => { setPage(1); }, [search, filterCategory, filterBagian, filterUnit, dateStart, dateEnd]);
  useEffect(() => { setMasterPageKat(1); setMasterPageBag(1); setMasterPageUnit(1); }, [masterTab]);

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
      const matchUnit = !filterUnit || (t.unit || "").toUpperCase() === filterUnit.toUpperCase();
      const matchSearch = !q
        || t.keterangan.toLowerCase().includes(q)
        || (t.category?.nama || "").toLowerCase().includes(q)
        || (t.bagian?.nama || "").toLowerCase().includes(q)
        || (t.unit || "").toLowerCase().includes(q);
      return matchCat && matchBag && matchUnit && matchSearch;
    });
  }, [transactionsWithBalance, filterCategory, filterBagian, filterUnit, search]);

  // Reverse for display (newest first), but keep running balance correct
  const displayed = useMemo(() => {
    return [...filtered].reverse();
  }, [filtered]);

  const paged = useMemo(
    () => displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [displayed, page]
  );

  const pagedKategori = useMemo(
    () => categories.slice((masterPageKat - 1) * MASTER_PAGE_SIZE, masterPageKat * MASTER_PAGE_SIZE),
    [categories, masterPageKat]
  );
  const pagedBagian = useMemo(
    () => bagians.slice((masterPageBag - 1) * MASTER_PAGE_SIZE, masterPageBag * MASTER_PAGE_SIZE),
    [bagians, masterPageBag]
  );
  const pagedUnit = useMemo(
    () => units.slice((masterPageUnit - 1) * MASTER_PAGE_SIZE, masterPageUnit * MASTER_PAGE_SIZE),
    [units, masterPageUnit]
  );

  const stats = useMemo(() => {
    const totalIn = filtered.reduce((s, t) => s + t.cash_in, 0);
    const totalOut = filtered.reduce((s, t) => s + t.cash_out, 0);
    const countIn = filtered.filter((t) => t.cash_in > 0).length;
    const countOut = filtered.filter((t) => t.cash_out > 0).length;
    const txCount = filtered.length;
    const currentBalance = settings?.initial_balance != null
      ? settings.initial_balance + filtered.reduce((s, t) => s + t.cash_in - t.cash_out, 0)
      : 0;
    return { totalIn, totalOut, countIn, countOut, txCount, currentBalance };
  }, [filtered, settings]);

  const getMatchingTransactions = useCallback(
    (categoryId: number, rowFilter: { bagian: string; unit: string }) => {
      return filtered.filter((t) => {
        if (t.category_id !== categoryId) return false;
        if (rowFilter.bagian) {
          if (rowFilter.bagian === "0") {
            if (t.bagian_id !== null) return false;
          } else if (t.bagian_id !== Number(rowFilter.bagian)) return false;
        }
        if (rowFilter.unit) {
          if (rowFilter.unit === "0") {
            if (t.unit) return false;
          } else if ((t.unit || "").toUpperCase() !== rowFilter.unit.toUpperCase()) return false;
        }
        return true;
      });
    },
    [filtered]
  );

  const reportData = useMemo(() => {
    return categories.map((cat) => {
      const rf = rowFilters[cat.id] || { bagian: "", unit: "" };
      const matchingTrx = getMatchingTransactions(cat.id, rf);
      const trxCount = matchingTrx.length;
      const totalCost = matchingTrx.reduce((s, t) => s + t.cash_out, 0);
      return { cat, trxCount, totalCost };
    });
  }, [categories, rowFilters, getMatchingTransactions]);

  // ─── Form handlers ───
  const makeEmptyBulkRow = (): BulkRow => ({
    key: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tanggal: localDateStr(),
    category_id: categories[0]?.id || 0,
    bagian_id: 0,
    unit: "",
    keterangan: "",
    cash_in: 0,
    cash_out: 0,
  });

  const openAdd = () => {
    setForm({ tanggal: localDateStr(), category_id: categories[0]?.id || 0, bagian_id: 0, unit: "", keterangan: "", cash_in: 0, cash_out: 0 });
    setEditingId(null);
    setFormMode("single");
    setFormError("");
    setShowForm(true);
  };
  const addBulkRows = (count: number) => {
    setBulkRows((prev) => [...prev, ...Array.from({ length: count }, () => makeEmptyBulkRow())]);
  };

  const removeBulkRow = (key: string) => {
    setBulkRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  };

  const updateBulkRow = (key: string, patch: Partial<BulkRow>) => {
    setBulkRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const duplicateBulkRow = (key: string) => {
    setBulkRows((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx === -1) return prev;
      const src = prev[idx];
      const copy: BulkRow = { ...src, key: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const bulkTotals = useMemo(() => {
    const outTotal = bulkRows.reduce((s, r) => s + (r.cash_out || 0), 0);
    return { outTotal, count: bulkRows.length };
  }, [bulkRows]);

  const openEdit = (t: Transaction) => {
    setForm({
      tanggal: t.tanggal,
      category_id: t.category_id,
      bagian_id: t.bagian_id,
      unit: t.unit || "",
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

    // Bulk mode validation & insert
    if (formMode === "bulk" && !editingId) {
      const invalidRows: number[] = [];
        bulkRows.forEach((r, i) => {
          if (!r.tanggal) { invalidRows.push(i + 1); return; }
          if (!r.category_id) { invalidRows.push(i + 1); return; }
          if (r.cash_out === 0) { invalidRows.push(i + 1); return; }
        });
        if (invalidRows.length > 0) {
          return setFormError(`Baris ${invalidRows.join(", ")} belum lengkap. Periksa tanggal, kategori, dan nominal.`);
        }
        const validRows = bulkRows.filter((r) => r.tanggal && r.category_id && r.cash_out > 0);
        if (validRows.length === 0) return setFormError("Minimal 1 baris harus valid.");

      setFormSaving(true);
      const payload = validRows.map((r) => ({
        tanggal: r.tanggal,
        category_id: r.category_id,
        bagian_id: r.bagian_id || null,
        unit: r.unit.trim() || null,
        keterangan: r.keterangan.trim(),
        cash_in: r.cash_in,
        cash_out: r.cash_out,
      }));
      const { data: inserted, error } = await supabase.from("petty_cash_transactions").insert(payload).select("id");
      if (error) { setFormError(error.message); setFormSaving(false); return; }
      await logAudit({
        supabase, action: "create", entityType: "petty_cash_transactions",
        entityLabel: `Bulk insert ${payload.length} transaksi`,
          metadata: { count: payload.length, total_out: bulkTotals.outTotal, ids: inserted?.map((d) => d.id) },
        });
        showToast("success", `${payload.length} Transaksi Disimpan`, `Total cash out ${formatCurrency(bulkTotals.outTotal)}.`);
      setFormSaving(false);
      setShowForm(false);
      setBulkRows([]);
      await fetchTransactions();
      return;
    }

    // Single mode (add or edit)
    if (!form.tanggal) return setFormError("Tanggal wajib diisi.");
    if (!form.category_id) return setFormError("Kategori wajib dipilih.");
    if (form.cash_out === 0) return setFormError("Nominal pengeluaran wajib diisi.");

    setFormSaving(true);
    const payload = {
      tanggal: form.tanggal,
      category_id: form.category_id,
      bagian_id: form.bagian_id || null,
      unit: form.unit.trim() || null,
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
      unit: null,
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
    if (!newUnit.trim()) { showToast("error", "Gagal", "Nama unit tidak boleh kosong."); return; }
    const { error } = await supabase.from("petty_cash_units").insert({
      nama: newUnit.trim().toUpperCase(), urutan: 0, status: "Aktif",
    });
    if (error) { showToast("error", "Gagal", error.message); return; }
    showToast("success", "Unit Ditambahkan");
    setNewUnit("");
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

  // ─── Master data: Edit ───
  const startEditCategory = (c: CategoryLite) => setMasterEdit({ type: "kategori", id: c.id, data: { nama: c.nama, type: c.type, color: c.color } });
  const startEditBagian = (b: BagianLite) => setMasterEdit({ type: "bagian", id: b.id, data: { nama: b.nama } });
  const startEditUnit = (u: UnitLite) => setMasterEdit({ type: "unit", id: u.id, data: { nama: u.nama } });
  const cancelMasterEdit = () => setMasterEdit(null);

  const saveMasterEdit = async () => {
    if (!masterEdit) return;
    setMasterEditSaving(true);
    const { type, id, data } = masterEdit;
    let table: "petty_cash_categories" | "petty_cash_bagians" | "petty_cash_units";
    let updates: Record<string, unknown> = {};
    let oldRow: Record<string, unknown> | null = null;
    let entityLabel = "";

    if (type === "kategori") {
      if (!data.nama?.trim()) { showToast("error", "Gagal", "Nama kategori tidak boleh kosong."); setMasterEditSaving(false); return; }
      table = "petty_cash_categories";
      updates = { nama: data.nama.trim(), type: data.type, color: data.color };
      entityLabel = data.nama.trim();
    } else if (type === "bagian") {
      if (!data.nama?.trim()) { showToast("error", "Gagal", "Nama bagian tidak boleh kosong."); setMasterEditSaving(false); return; }
      table = "petty_cash_bagians";
      updates = { nama: data.nama.trim() };
      entityLabel = data.nama.trim();
    } else {
      if (!data.nama?.trim()) { showToast("error", "Gagal", "Nama unit tidak boleh kosong."); setMasterEditSaving(false); return; }
      table = "petty_cash_units";
      updates = { nama: data.nama.trim().toUpperCase() };
      entityLabel = data.nama.trim().toUpperCase();
    }

    const { data: prev } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    oldRow = prev as Record<string, unknown> | null;
    const { error } = await supabase.from(table).update(updates).eq("id", id);
    if (error) { showToast("error", "Gagal", error.message); setMasterEditSaving(false); return; }

    await logAudit({
      supabase, action: "update", entityType: table, entityId: String(id),
      entityLabel, oldData: oldRow, newData: updates,
    });
    showToast("success", "Master Diperbarui");
    setMasterEdit(null);
    if (type === "kategori") await fetchCategories();
    else if (type === "bagian") await fetchBagians();
    else await fetchUnits();
    setMasterEditSaving(false);
  };

  // ─── Master data: Delete ───
  const confirmMasterDelete = async () => {
    if (!masterDelete) return;
    setMasterDeleting(true);
    const { table, id, label } = masterDelete;
    const tableName = table === "categories" ? "petty_cash_categories" : table === "bagians" ? "petty_cash_bagians" : "petty_cash_units";
    const fkColumn = table === "categories" ? "category_id" : table === "bagians" ? "bagian_id" : null;

    let usageCount = 0;
    if (fkColumn) {
      const { count } = await supabase
        .from("petty_cash_transactions")
        .select("id", { count: "exact", head: true })
        .eq(fkColumn, id);
      usageCount = count ?? 0;
    } else {
      const { count } = await supabase
        .from("petty_cash_transactions")
        .select("id", { count: "exact", head: true })
        .eq("unit", label);
      usageCount = count ?? 0;
    }

    if (usageCount > 0) {
      showToast("error", "Tidak Bisa Dihapus", `"${label}" dipakai di ${usageCount} transaksi. Nonaktifkan saja (toggle off).`);
      setMasterDelete(null);
      setMasterDeleting(false);
      return;
    }

    const { data: oldRow } = await supabase.from(tableName).select("*").eq("id", id).maybeSingle();
    const { error } = await supabase.from(tableName).delete().eq("id", id);
    if (error) { showToast("error", "Gagal", error.message); setMasterDeleting(false); return; }

    await logAudit({
      supabase, action: "delete", entityType: tableName, entityId: String(id),
      entityLabel: label, oldData: oldRow,
    });
    showToast("success", "Master Dihapus");
    setMasterDelete(null);
    if (table === "categories") await fetchCategories();
    else if (table === "bagians") await fetchBagians();
    else await fetchUnits();
    setMasterDeleting(false);
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
        `"${t.unit || ""}"`,
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
    const dateRange = dateStart && dateEnd ? `${dateStart} — ${dateEnd}` : "Semua periode";
    doc.text(`Periode: ${dateRange}`, pw / 2, 21, { align: "center" });
    doc.text(`Saldo Saat Ini: ${formatCurrency(stats.currentBalance)}`, pw / 2, 27, { align: "center" });
    doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, pw / 2, 33, { align: "center" });

    const body = displayed.map((t) => [
      fmtDate(t.tanggal), t.category?.nama || "-", t.bagian?.nama || "-", t.unit || "-",
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
          title="Petty Cash"
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
          <button onClick={() => setViewMode("laporan")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              viewMode === "laporan" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <FileText className="w-3.5 h-3.5" />Laporan
          </button>
          <button onClick={() => setViewMode("master")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              viewMode === "master" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Settings className="w-3.5 h-3.5" />Master Data
          </button>
        </div>

        {/* Filter toolbar */}
        <div className="bg-card rounded-2xl border border-border p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-shrink-0">
              <DatePicker value={dateStart} onChange={setDateStart} placeholder="Dari tanggal" />
              <span className="text-xs text-muted-foreground">—</span>
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
            <Select
              value={filterUnit}
              onChange={(v) => setFilterUnit(v)}
              options={[{ value: "", label: "Semua Unit" }, ...units.map((u) => ({ value: u.nama, label: u.nama }))]}
              className="w-40"
              placeholder="Semua Unit"
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
                        <td className="px-5 py-3 text-xs text-muted-foreground uppercase">{row.unit || "-"}</td>
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

        {/* ═══ LAPORAN VIEW (Tabel Interaktif) ═══ */}
        {viewMode === "laporan" && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-card rounded-2xl border border-border p-4">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Total Cash In</p>
                <p className="text-lg font-bold text-success mt-1">{formatCurrency(stats.totalIn)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{stats.countIn}x transaksi</p>
              </div>
              <div className="bg-card rounded-2xl border border-border p-4">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Total Cash Out</p>
                <p className="text-lg font-bold text-danger mt-1">{formatCurrency(stats.totalOut)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{stats.countOut}x transaksi</p>
              </div>
              <div className="bg-card rounded-2xl border border-border p-4">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Saldo Saat Ini</p>
                <p className={cn("text-lg font-bold mt-1", stats.currentBalance >= 0 ? "text-foreground" : "text-danger")}>{formatCurrency(stats.currentBalance)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{filtered.length} transaksi</p>
              </div>
            </div>

            {/* Interactive report table */}
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Laporan per Kategori</h3>
                  <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{categories.length} kategori</span>
                </div>
                <button onClick={resetAllRowFilters} className="text-[10px] text-muted-foreground hover:text-primary font-semibold transition-colors px-2 py-1 rounded-lg hover:bg-muted">
                  Reset Filter
                </button>
              </div>
              <div className="overflow-x-auto">
                {loading ? <SkeletonTable rows={5} cols={6} /> : categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic px-5 py-8 text-center">Belum ada kategori di Master Data</p>
                ) : (
                  <table className="w-full">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider w-10">#</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider min-w-[140px]">Kategori</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider min-w-[160px]">Bagian</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider min-w-[160px]">Unit</th>
                        <th className="px-3 py-2.5 text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider w-16">Trx</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-wider min-w-[130px]">Detail Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {reportData.map(({ cat, trxCount, totalCost }, idx) => {
                        const rf = rowFilters[cat.id] || { bagian: "", unit: "" };
                        return (
                          <tr key={cat.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                                <span className="text-xs font-semibold text-foreground">{cat.nama}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <select
                                value={rf.bagian}
                                onChange={(e) => updateRowFilter(cat.id, "bagian", e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg border border-border bg-muted/30 text-xs outline-none focus:border-primary text-foreground cursor-pointer"
                              >
                                <option value="">Semua Bagian</option>
                                <option value="0">Tanpa Bagian</option>
                                {bagians.map((b) => (
                                  <option key={b.id} value={String(b.id)}>{b.nama}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2.5">
                              <select
                                value={rf.unit}
                                onChange={(e) => updateRowFilter(cat.id, "unit", e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg border border-border bg-muted/30 text-xs outline-none focus:border-primary text-foreground cursor-pointer uppercase"
                              >
                                <option value="">Semua Unit</option>
                                <option value="0">Tanpa Unit</option>
                                {units.map((u) => (
                                  <option key={u.id} value={u.nama}>{u.nama}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">{trxCount > 0 ? `${trxCount}x` : "-"}</td>
                            <td className={cn("px-3 py-2.5 text-right text-sm font-bold tabular-nums", totalCost > 0 ? "text-danger" : "text-muted-foreground/40")}>
                              {totalCost > 0 ? formatCurrency(totalCost) : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/40 border-t-2 border-border">
                      <tr>
                        <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-foreground">GRAND TOTAL</td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-foreground">
                          {reportData.reduce((sum, { trxCount }) => sum + trxCount, 0)}x
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm font-bold text-danger tabular-nums">
                          {formatCurrency(reportData.reduce((sum, { totalCost }) => sum + totalCost, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ MASTER DATA VIEW ═══ */}
        {viewMode === "master" && (
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
                    {pagedKategori.map((c) => (
                      <div key={c.id}>
                        {masterEdit?.type === "kategori" && masterEdit.id === c.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/30">
                            <input type="color" value={masterEdit.data.color ?? c.color} onChange={(e) => setMasterEdit({ ...masterEdit, data: { ...masterEdit.data, color: e.target.value } })} className="w-7 h-7 rounded-lg border border-border cursor-pointer flex-shrink-0" />
                            <input type="text" value={masterEdit.data.nama} onChange={(e) => setMasterEdit({ ...masterEdit, data: { ...masterEdit.data, nama: e.target.value } })} className={cn(inputClass, "flex-1 text-xs py-2")} />
                            <select value={masterEdit.data.type} onChange={(e) => setMasterEdit({ ...masterEdit, data: { ...masterEdit.data, type: e.target.value } })} className="px-2 py-2 rounded-xl border border-border bg-muted/30 text-xs outline-none text-foreground">
                              <option value="expense">Expense</option>
                              <option value="income">Income</option>
                              <option value="both">Both</option>
                            </select>
                            <button onClick={saveMasterEdit} disabled={masterEditSaving} title="Simpan" className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={cancelMasterEdit} title="Batal" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                              <span className="text-xs font-semibold text-foreground truncate">{c.nama}</span>
                              <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", c.type === "income" ? "bg-success/10 text-success" : c.type === "expense" ? "bg-danger/10 text-danger" : "bg-blue-500/10 text-blue-500")}>{c.type}</span>
                            </div>
                            {canEdit && (
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                <button onClick={() => startEditCategory(c)} title="Edit" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setMasterDelete({ table: "categories", id: c.id, label: c.nama })} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        <input type="color" value={newCategory.color} onChange={(e) => setNewCategory({ ...newCategory, color: e.target.value })} className="w-8 h-8 rounded-lg border border-border cursor-pointer" />
                        <input type="text" placeholder="Kategori baru..." value={newCategory.nama} onChange={(e) => setNewCategory({ ...newCategory, nama: e.target.value })} className={cn(inputClass, "flex-1 text-xs py-2")} />
                        <select value={newCategory.type} onChange={(e) => setNewCategory({ ...newCategory, type: e.target.value as "income" | "expense" | "both" })} className="px-2 py-2 rounded-xl border border-border bg-muted/30 text-xs outline-none text-foreground">
                          <option value="expense">Expense</option>
                          <option value="income">Income</option>
                          <option value="both">Both</option>
                        </select>
                        <Button size="sm" icon={Plus} onClick={handleAddCategory}>Tambah</Button>
                      </div>
                    )}
                    {categories.length > MASTER_PAGE_SIZE && (
                      <Pagination currentPage={masterPageKat} totalItems={categories.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPageKat} />
                    )}
                  </div>
                )}
                {masterTab === "bagian" && (
                  <div className="space-y-2">
                    {pagedBagian.map((b) => (
                      <div key={b.id}>
                        {masterEdit?.type === "bagian" && masterEdit.id === b.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/30">
                            <input type="text" value={masterEdit.data.nama} onChange={(e) => setMasterEdit({ ...masterEdit, data: { ...masterEdit.data, nama: e.target.value } })} className={cn(inputClass, "flex-1 text-xs py-2")} autoFocus />
                            <button onClick={saveMasterEdit} disabled={masterEditSaving} title="Simpan" className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={cancelMasterEdit} title="Batal" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50">
                            <span className="text-xs font-semibold text-foreground">{b.nama}</span>
                            {canEdit && (
                              <div className="flex items-center gap-0.5">
                                <button onClick={() => startEditBagian(b)} title="Edit" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setMasterDelete({ table: "bagians", id: b.id, label: b.nama })} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        <input type="text" placeholder="Bagian baru..." value={newBagian} onChange={(e) => setNewBagian(e.target.value)} className={cn(inputClass, "flex-1 text-xs py-2")} />
                        <Button size="sm" icon={Plus} onClick={handleAddBagian}>Tambah</Button>
                      </div>
                    )}
                    {bagians.length > MASTER_PAGE_SIZE && (
                      <Pagination currentPage={masterPageBag} totalItems={bagians.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPageBag} />
                    )}
                  </div>
                )}
                {masterTab === "unit" && (
                  <div className="space-y-2">
                    {pagedUnit.map((u) => (
                      <div key={u.id}>
                        {masterEdit?.type === "unit" && masterEdit.id === u.id ? (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/30">
                            <input type="text" value={masterEdit.data.nama} onChange={(e) => setMasterEdit({ ...masterEdit, data: { ...masterEdit.data, nama: e.target.value.toUpperCase() } })} className={cn(inputClass, "flex-1 text-xs py-2 uppercase")} autoFocus placeholder="Nopol / nama unit" />
                            <button onClick={saveMasterEdit} disabled={masterEditSaving} title="Simpan" className="p-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={cancelMasterEdit} title="Batal" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50">
                            <span className="text-xs font-semibold text-foreground uppercase">{u.nama}</span>
                            {canEdit && (
                              <div className="flex items-center gap-0.5">
                                <button onClick={() => startEditUnit(u)} title="Edit" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setMasterDelete({ table: "units", id: u.id, label: u.nama })} title="Hapus" className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {units.length === 0 && <p className="text-[10px] text-muted-foreground italic">Belum ada unit</p>}
                    {canEdit && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        <input type="text" placeholder="Nopol / unit baru (cth: B 1234 ABC)..." value={newUnit} onChange={(e) => setNewUnit(e.target.value.toUpperCase())} className={cn(inputClass, "flex-1 text-xs py-2 uppercase")} />
                        <Button size="sm" icon={Plus} onClick={handleAddUnit}>Tambah</Button>
                      </div>
                    )}
                    {units.length > MASTER_PAGE_SIZE && (
                      <Pagination currentPage={masterPageUnit} totalItems={units.length} pageSize={MASTER_PAGE_SIZE} onPageChange={setMasterPageUnit} />
                    )}
                  </div>
                )}
              </div>
            </div>
        )}

        {/* ═══ ADD/EDIT TRANSACTION MODAL ═══ */}
        {showForm && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
              <div className={cn("relative w-full bg-card rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]", formMode === "bulk" && !editingId ? "max-w-5xl" : "max-w-xl")}>
                <div className="flex items-center justify-between p-5 border-b border-border gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <h3 className="text-base font-bold text-foreground whitespace-nowrap">
                      {editingId ? "Edit Transaksi" : formMode === "bulk" ? "Tambah Transaksi (Bulk)" : "Tambah Transaksi"}
                    </h3>
                    {!editingId && (
                      <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                        <button onClick={() => setFormMode("single")}
                          className={cn("flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-all",
                            formMode === "single" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                          <Rows3 className="w-3 h-3" />Tunggal
                        </button>
                        <button onClick={() => { setFormMode("bulk"); if (bulkRows.length === 0) setBulkRows([makeEmptyBulkRow(), makeEmptyBulkRow(), makeEmptyBulkRow()]); }}
                          className={cn("flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-all",
                            formMode === "bulk" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                          <ListPlus className="w-3 h-3" />Bulk
                        </button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground flex-shrink-0"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {formError && (
                    <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 text-xs text-danger">{formError}</div>
                  )}
                  {formMode === "single" || editingId ? (
                    <>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Tanggal *</label>
                        <DatePicker value={form.tanggal} onChange={(v) => setForm({ ...form, tanggal: v })} placeholder="Pilih tanggal" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Kategori *</label>
                        <Select
                          searchable
                          value={String(form.category_id)}
                          onChange={(v) => setForm({ ...form, category_id: Number(v) })}
                          options={[{ value: "0", label: "Pilih kategori..." }, ...categories.map((c) => ({ value: String(c.id), label: c.nama }))]}
                          placeholder="Pilih kategori..."
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Bagian <span className="text-muted-foreground/50 font-normal">(opsional)</span></label>
                          <Select
                            searchable
                            value={String(form.bagian_id)}
                            onChange={(v) => setForm({ ...form, bagian_id: Number(v) })}
                            options={[{ value: "0", label: "— (Tanpa Bagian)" }, ...bagians.map((b) => ({ value: String(b.id), label: b.nama }))]}
                            placeholder="Pilih bagian..."
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Unit <span className="text-muted-foreground/50 font-normal">(opsional)</span></label>
                          <Select
                            searchable
                            value={form.unit}
                            onChange={(v) => setForm({ ...form, unit: v })}
                            options={[{ value: "", label: "— (Tanpa Unit)" }, ...units.map((u) => ({ value: u.nama, label: u.nama }))]}
                            placeholder="Pilih unit..."
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Keterangan <span className="text-muted-foreground/50 font-normal">(opsional)</span></label>
                        <input type="text" placeholder="Misal: Beli snack rapat Mingguan" value={form.keterangan}
                          onChange={(e) => setForm({ ...form, keterangan: e.target.value })}
                          className={inputClass} />
                      </div>
                      <div>
                        <label className={cn("text-[10px] font-semibold mb-1.5 block", form.cash_in > 0 ? "text-success" : "text-danger")}>
                          Nominal {form.cash_in > 0 ? "(Pemasukan)" : "(Pengeluaran)"} *
                        </label>
                        <CurrencyInput 
                          value={form.cash_in > 0 ? form.cash_in : form.cash_out}
                          onChange={(v) => {
                            if (form.cash_in > 0) {
                              setForm({ ...form, cash_in: v, cash_out: 0 });
                            } else {
                              setForm({ ...form, cash_out: v, cash_in: 0 });
                            }
                          }}
                          className={cn("font-semibold", form.cash_in > 0 ? "text-success" : "text-danger")} />
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          {form.cash_in > 0 
                            ? "Edit nominal pemasukan/top-up." 
                            : "Nominal pengeluaran. Untuk top-up saldo, gunakan tombol Top-up."}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-muted-foreground">Tambahkan beberapa transaksi sekaligus. Setiap baris = 1 transaksi.</p>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" icon={Plus} onClick={() => addBulkRows(1)}>Baris</Button>
                          <Button variant="outline" size="sm" icon={Plus} onClick={() => addBulkRows(5)}>+5</Button>
                        </div>
                      </div>
                      <div className="border border-border rounded-xl overflow-hidden">
                        <div className="max-h-[55vh] overflow-auto">
                          <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                              <tr className="border-b border-border">
                                <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 w-8">#</th>
                                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 w-32">Tanggal</th>
                                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 min-w-[140px]">Kategori</th>
                                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 min-w-[120px]">Bagian</th>
                                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 min-w-[130px]">Unit</th>
                                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 min-w-[180px]">Keterangan</th>
                                <th className="text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 w-32">Nominal</th>
                                <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 w-16">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {bulkRows.map((row, idx) => (
                                <tr key={row.key} className="hover:bg-muted/20">
                                  <td className="px-2 py-1.5 text-center text-[10px] text-muted-foreground font-semibold">{idx + 1}</td>
                                  <td className="px-2 py-1.5">
                                    <DatePicker value={row.tanggal} onChange={(v) => updateBulkRow(row.key, { tanggal: v })} placeholder="Tgl" />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Select
                                      searchable
                                      value={String(row.category_id)}
                                      onChange={(v) => updateBulkRow(row.key, { category_id: Number(v) })}
                                      options={[{ value: "0", label: "Kategori..." }, ...categories.map((c) => ({ value: String(c.id), label: c.nama }))]}
                                      placeholder="Kategori..."
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Select
                                      searchable
                                      value={String(row.bagian_id)}
                                      onChange={(v) => updateBulkRow(row.key, { bagian_id: Number(v) })}
                                      options={[{ value: "0", label: "Bagian..." }, ...bagians.map((b) => ({ value: String(b.id), label: b.nama }))]}
                                      placeholder="Bagian..."
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Select
                                      searchable
                                      value={row.unit}
                                      onChange={(v) => updateBulkRow(row.key, { unit: v })}
                                      options={[{ value: "", label: "Unit..." }, ...units.map((u) => ({ value: u.nama, label: u.nama }))]}
                                      placeholder="Unit..."
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <input type="text" placeholder="Keterangan" value={row.keterangan}
                                      onChange={(e) => updateBulkRow(row.key, { keterangan: e.target.value })}
                                      className="w-full px-2 py-2 rounded-lg border border-border bg-muted/30 text-xs outline-none focus:border-primary text-foreground placeholder:text-muted-foreground/50" />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <CurrencyInput size="sm" value={row.cash_out}
                                      onChange={(v) => updateBulkRow(row.key, { cash_out: v, cash_in: 0 })}
                                      className="text-danger font-semibold" />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className="flex items-center justify-center gap-0.5">
                                      <button onClick={() => duplicateBulkRow(row.key)} title="Duplikasi baris" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary"><Copy className="w-3 h-3" /></button>
                                      <button onClick={() => removeBulkRow(row.key)} disabled={bulkRows.length <= 1} title="Hapus baris" className="p-1 rounded hover:bg-danger-light text-muted-foreground hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 className="w-3 h-3" /></button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="sticky bottom-0 bg-muted/80 backdrop-blur-sm border-t-2 border-border">
                              <tr>
                                <td colSpan={6} className="px-2 py-2 text-right text-[10px] font-semibold text-muted-foreground uppercase">Total {bulkTotals.count} baris</td>
                                <td className="px-2 py-2 text-right text-sm font-bold text-danger">{bulkTotals.outTotal > 0 ? formatCurrency(bulkTotals.outTotal) : "-"}</td>
                                <td className="px-2 py-2"></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Baris kosong akan dilewati saat simpan. Hanya baris valid (tanggal + kategori + nominal) yang akan disimpan.</p>
                    </>
                  )}
                </div>
                <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground">
                    {formMode === "bulk" && !editingId
                      ? <>Akan menyimpan <strong className="text-foreground">{bulkTotals.count}</strong> baris. Saldo akhir: <strong className={cn(bulkTotals.outTotal > stats.currentBalance ? "text-danger" : "text-foreground")}>{formatCurrency(stats.currentBalance - bulkTotals.outTotal)}</strong></>
                      : <>&nbsp;</>}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={formSaving}>Batal</Button>
                    <Button size="sm" icon={Check} onClick={handleSave} disabled={formSaving || (formMode === "bulk" && !editingId && bulkRows.length === 0)}>{formSaving ? "Menyimpan..." : formMode === "bulk" && !editingId ? `Simpan ${bulkTotals.count} Baris` : "Simpan"}</Button>
                  </div>
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
                    <CurrencyInput value={topUpForm.nominal}
                      onChange={(v) => setTopUpForm({ ...topUpForm, nominal: v })}
                      className="text-lg font-bold text-success" />
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

        {/* ═══ UNIT DROPDOWN OPTIONS ═══ */}

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
                    <CurrencyInput value={settingsForm.initial_balance}
                      onChange={(v) => setSettingsForm({ ...settingsForm, initial_balance: v })} />
                    <p className="text-[10px] text-muted-foreground mt-1">Saldo awal yang di-set saat sistem diaktifkan. Saldo berjalan = modal + SUM(cash_in) − SUM(cash_out).</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Threshold Saldo Rendah *</label>
                    <CurrencyInput value={settingsForm.low_balance_threshold}
                      onChange={(v) => setSettingsForm({ ...settingsForm, low_balance_threshold: v })} />
                    <p className="text-[10px] text-muted-foreground mt-1">Sistem akan menampilkan peringatan saat saldo di bawah nilai ini.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground mb-1.5 block">Penanggung Jawab</label>
                    <select
                      value={settingsForm.custodian_id}
                      onChange={(e) => setSettingsForm({ ...settingsForm, custodian_id: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-xs outline-none focus:border-primary text-foreground cursor-pointer"
                    >
                      <option value="">— (Tidak ada)</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>{e.nama}</option>
                      ))}
                    </select>
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

        {/* ═══ MASTER DATA DELETE CONFIRM ═══ */}
        {masterDelete && (
          <Portal>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMasterDelete(null)} />
              <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0"><Trash2 className="w-5 h-5 text-danger" /></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-foreground">Hapus Master Data?</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      <strong className="text-foreground">{masterDelete.label}</strong> akan dihapus permanen dari master {masterDelete.table === "categories" ? "Kategori" : masterDelete.table === "bagians" ? "Bagian" : "Unit"}.
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1.5 italic">Item yang sudah dipakai di transaksi tidak bisa dihapus (nonaktifkan saja).</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setMasterDelete(null)} disabled={masterDeleting}>Batal</Button>
                  <Button size="sm" icon={Trash2} onClick={confirmMasterDelete} disabled={masterDeleting} className="bg-danger text-white hover:bg-danger/90">{masterDeleting ? "Menghapus..." : "Hapus"}</Button>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </div>
    </RouteGuard>
  );
}
