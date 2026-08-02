"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  TrendingDown, Plus, Search, Pencil, Trash2, X, RefreshCw, ChevronDown, Tag,
  FileDown, AlertTriangle, ListPlus,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import RouteGuard from "@/components/RouteGuard";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { DbFinanceExpense, DbFinanceExpenseCategory } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import { EXPENSE_METHODS, downloadCsv, fmtDate } from "@/lib/finance";

type Tab = "expenses" | "categories";

interface ExpenseRow extends DbFinanceExpense {
  category?: DbFinanceExpenseCategory | null;
}

interface Toast { id: number; type: "success" | "error"; msg: string }

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

const CATEGORY_COLORS = [
  "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#ec4899",
  "#06b6d4", "#f97316", "#6366f1", "#14b8a6", "#84cc16", "#eab308",
  "#a855f7", "#0ea5e9", "#d946ef", "#64748b",
];

export default function FinancePengeluaranPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("finance");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [tab, setTab] = useState<Tab>("expenses");
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<DbFinanceExpenseCategory[]>([]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("Semua");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: "success" | "error", msg: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  // ─── Expense form ───
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [form, setForm] = useState({ expense_date: localDateStr(), category_id: 0, description: "", vendor: "", method: "Tunai", amount: 0, notes: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // ─── Category form ───
  const [showCatForm, setShowCatForm] = useState(false);
  const [editingCat, setEditingCat] = useState<DbFinanceExpenseCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: "", color: "#6b7280" });
  const [catSaving, setCatSaving] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<{ kind: "expense" | "category"; id: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: expData }, { data: catData }] = await Promise.all([
        supabase.from("finance_expenses").select("*, category:finance_expense_categories(*)").order("expense_date", { ascending: false }).order("id", { ascending: false }),
        supabase.from("finance_expense_categories").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true }),
      ]);
      if (expData) setExpenses(expData as ExpenseRow[]);
      if (catData) setCategories(catData as DbFinanceExpenseCategory[]);
    } catch {
      addToast("error", "Gagal memuat data pengeluaran.");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    (async () => { await fetchAll(); })();
  }, [fetchAll]);

  const openNew = () => {
    setEditing(null);
    setFormError("");
    const firstCat = categories.find((c) => c.status === "Aktif");
    setForm({ expense_date: localDateStr(), category_id: firstCat?.id || 0, description: "", vendor: "", method: "Tunai", amount: 0, notes: "" });
    setShowForm(true);
  };

  const openEdit = (e: ExpenseRow) => {
    setEditing(e);
    setFormError("");
    setForm({ expense_date: e.expense_date, category_id: e.category_id || 0, description: e.description, vendor: e.vendor || "", method: e.method || "Tunai", amount: e.amount, notes: e.notes || "" });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.expense_date || !form.description.trim() || form.amount <= 0) {
      setFormError("Lengkapi field wajib (tanggal, deskripsi, nominal > 0).");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      expense_date: form.expense_date,
      category_id: form.category_id || null,
      description: form.description.trim(),
      vendor: form.vendor || null,
      method: form.method,
      amount: form.amount,
      notes: form.notes || null,
    };
    try {
      if (editing) {
        const { error } = await supabase.from("finance_expenses").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ supabase, action: "update", entityType: "finance_expenses", entityId: editing.id, entityLabel: payload.description, newData: payload });
        addToast("success", "Pengeluaran diperbarui.");
      } else {
        const { error } = await supabase.from("finance_expenses").insert(payload);
        if (error) throw error;
        await logAudit({ supabase, action: "create", entityType: "finance_expenses", entityLabel: payload.description, newData: payload });
        addToast("success", "Pengeluaran dicatat.");
      }
      setShowForm(false);
      fetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan pengeluaran.");
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = async (id: number) => {
    setDeleting(true);
    try {
      const { error } = await supabase.from("finance_expenses").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ supabase, action: "delete", entityType: "finance_expenses", entityId: id, entityLabel: "Pengeluaran" });
      addToast("success", "Pengeluaran dihapus.");
      fetchAll();
    } catch {
      addToast("error", "Gagal menghapus pengeluaran.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const saveCategory = async () => {
    if (!catForm.name.trim()) return;
    setCatSaving(true);
    try {
      if (editingCat) {
        const { error } = await supabase.from("finance_expense_categories").update({ name: catForm.name.trim(), color: catForm.color }).eq("id", editingCat.id);
        if (error) throw error;
        await logAudit({ supabase, action: "update", entityType: "finance_expense_categories", entityId: editingCat.id, entityLabel: catForm.name.trim() });
        addToast("success", "Kategori diperbarui.");
      } else {
        const { error } = await supabase.from("finance_expense_categories").insert({ name: catForm.name.trim(), color: catForm.color, sort_order: categories.length + 1 });
        if (error) throw error;
        await logAudit({ supabase, action: "create", entityType: "finance_expense_categories", entityLabel: catForm.name.trim() });
        addToast("success", "Kategori ditambahkan.");
      }
      setShowCatForm(false);
      fetchAll();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Gagal menyimpan kategori.");
    } finally {
      setCatSaving(false);
    }
  };

  const deleteCategory = async (id: number) => {
    setDeleting(true);
    try {
      const { error } = await supabase.from("finance_expense_categories").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ supabase, action: "delete", entityType: "finance_expense_categories", entityId: id, entityLabel: "Kategori" });
      addToast("success", "Kategori dihapus.");
      fetchAll();
    } catch {
      addToast("error", "Gagal menghapus kategori. Pastikan tidak dipakai pengeluaran.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const filteredExpenses = useMemo(() => {
    const s = search.toLowerCase();
    return expenses.filter((e) => {
      const matchSearch = !s || e.description.toLowerCase().includes(s) || (e.vendor || "").toLowerCase().includes(s) || (e.category?.name || "").toLowerCase().includes(s);
      const matchCat = filterCategory === "Semua" || e.category_id === Number(filterCategory);
      return matchSearch && matchCat;
    });
  }, [expenses, search, filterCategory]);

  const summary = useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const byCat = new Map<number, number>();
    expenses.forEach((e) => {
      if (e.category_id) byCat.set(e.category_id, (byCat.get(e.category_id) || 0) + e.amount);
    });
    return { total, byCat };
  }, [expenses]);

  const exportCsv = () => {
    const rows: (string | number | null | undefined)[][] = [
      ["No", "Tanggal", "Kategori", "Deskripsi", "Vendor", "Metode", "Nominal", "Catatan"],
      ...filteredExpenses.map((e, i) => [i + 1, e.expense_date, e.category?.name || "", e.description, e.vendor || "", e.method || "", e.amount, e.notes || ""]),
    ];
    downloadCsv("pengeluaran.csv", rows);
  };

  return (
    <RouteGuard permission="finance">
      <PageHeader
        title="Pengeluaran"
        description="Kelola pengeluaran operasional dan kategori"
        icon={TrendingDown}
        actions={
          <button onClick={exportCsv} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted">
            <FileDown className="w-4 h-4" />
            Export CSV
          </button>
        }
      />

      <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit mb-4">
        {([
          { key: "expenses" as Tab, label: "Pengeluaran", icon: TrendingDown, count: expenses.length },
          { key: "categories" as Tab, label: "Kategori", icon: Tag, count: categories.length },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(""); }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-semibold", tab === t.key ? "bg-primary/10 text-primary" : "bg-muted-foreground/10 text-muted-foreground")}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Summary by category */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4 mb-4">
        <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Total Pengeluaran</p>
          <p className="text-lg font-bold text-danger mt-1 tabular-nums">{formatCurrency(summary.total)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{expenses.length} transaksi</p>
        </div>
        {Array.from(summary.byCat.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([catId, total]) => {
            const cat = categories.find((c) => c.id === catId);
            return (
              <div key={catId} className="bg-card rounded-2xl border border-border p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat?.color || "#6b7280" }} />
                  <p className="text-xs font-semibold text-muted-foreground truncate">{cat?.name || "Tanpa kategori"}</p>
                </div>
                <p className="text-lg font-bold text-foreground mt-1 tabular-nums">{formatCurrency(total)}</p>
              </div>
            );
          })}
      </div>

      {/* ══════════ EXPENSES ══════════ */}
      {tab === "expenses" && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 max-w-sm">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Cari deskripsi, vendor, kategori..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm outline-none w-full text-foreground placeholder:text-muted-foreground/60" />
            </div>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none">
              <option value="Semua">Semua Kategori</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button onClick={fetchAll} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Refresh"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
              {canInput && (
                <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm">
                  <Plus className="w-4 h-4" /> Catat Pengeluaran
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
            ) : filteredExpenses.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground text-sm">Belum ada pengeluaran tercatat.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Tanggal</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Deskripsi</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Kategori</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Vendor</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Metode</th>
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Nominal</th>
                    {canEdit && <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((e) => (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(e.expense_date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-foreground">{e.description}</p>
                        {e.notes && <p className="text-[11px] text-muted-foreground">{e.notes}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${e.category?.color || "#6b7280"}18`, color: e.category?.color || "#6b7280" }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: e.category?.color || "#6b7280" }} />
                          {e.category?.name || "Tanpa kategori"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{e.vendor || "—"}</td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium">{e.method || "—"}</span></td>
                      <td className="px-4 py-3 text-right font-bold text-danger tabular-nums">{formatCurrency(e.amount)}</td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(e)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => setDeleteConfirm({ kind: "expense", id: e.id, label: e.description })} className="p-2 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════ CATEGORIES ══════════ */}
      {tab === "categories" && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">{categories.length} kategori pengeluaran</p>
            {canInput && (
              <button onClick={() => { setEditingCat(null); setCatForm({ name: "", color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length] }); setShowCatForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm">
                <ListPlus className="w-4 h-4" /> Tambah Kategori
              </button>
            )}
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              <div className="col-span-full flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
            ) : (
              categories.map((c) => {
                const total = summary.byCat.get(c.id) || 0;
                return (
                  <div key={c.id} className={cn("flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-muted/20", c.status === "Tidak Aktif" && "opacity-60")}>
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: c.color }}>
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {formatCurrency(total)}
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold" style={{ backgroundColor: c.status === "Aktif" ? "#10b98118" : "#ef444418", color: c.status === "Aktif" ? "#10b981" : "#ef4444" }}>
                          {c.status}
                        </span>
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => { setEditingCat(c); setCatForm({ name: c.name, color: c.color }); setShowCatForm(true); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setDeleteConfirm({ kind: "category", id: c.id, label: c.name })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ─── MODAL: EXPENSE ─── */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setShowForm(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-danger/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !saving && setShowForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-danger to-rose-600 flex items-center justify-center shadow-lg shadow-danger/20">
                    <TrendingDown className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{editing ? "Edit Pengeluaran" : "Catat Pengeluaran"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Input pengeluaran operasional</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                {formError && <div className="p-3 rounded-xl bg-danger-light text-danger text-xs font-medium">{formError}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal <span className="text-danger">*</span></label>
                    <DatePicker value={form.expense_date} onChange={(v) => setForm({ ...form, expense_date: v })} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Kategori</label>
                    <div className="relative">
                      <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: Number(e.target.value) })} className={inputClass + " appearance-none pr-8"}>
                        <option value={0}>— Tanpa kategori —</option>
                        {categories.filter((c) => c.status === "Aktif").map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi <span className="text-danger">*</span></label>
                  <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mis. Isi BBM truk H-1234" className={inputClass} autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Vendor</label>
                    <input type="text" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Opsional" className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Metode</label>
                    <div className="relative">
                      <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inputClass + " appearance-none pr-8"}>
                        {EXPENSE_METHODS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nominal (Rp) <span className="text-danger">*</span></label>
                  <CurrencyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opsional" className={inputClass} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>Batal</Button>
                <Button size="sm" onClick={save} disabled={saving || !form.description.trim() || form.amount <= 0}>
                  {saving ? "Menyimpan..." : editing ? "Simpan" : "Simpan"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ─── MODAL: CATEGORY ─── */}
      {showCatForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !catSaving && setShowCatForm(false)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                  <Tag className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">{editingCat ? "Edit Kategori" : "Tambah Kategori"}</h2>
                  <p className="text-xs text-muted-foreground">Kategori pengeluaran</p>
                </div>
                <button onClick={() => !catSaving && setShowCatForm(false)} className="ml-auto p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Kategori <span className="text-danger">*</span></label>
                  <input type="text" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} className={inputClass} autoFocus />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Warna</label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORY_COLORS.map((color) => (
                      <button key={color} type="button" onClick={() => setCatForm({ ...catForm, color })} className={cn(
                        "w-7 h-7 rounded-lg transition-all",
                        catForm.color === color && "ring-2 ring-offset-2 ring-offset-card ring-foreground scale-110"
                      )} style={{ backgroundColor: color }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-6">
                <Button variant="outline" size="sm" onClick={() => setShowCatForm(false)} disabled={catSaving}>Batal</Button>
                <Button size="sm" onClick={saveCategory} disabled={catSaving || !catForm.name.trim()}>
                  {catSaving ? "Menyimpan..." : editingCat ? "Simpan" : "Tambah"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ─── CONFIRM DELETE ─── */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-danger-light flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6 text-danger" />
              </div>
              <h3 className="text-base font-bold text-foreground mt-4">Hapus {deleteConfirm.kind === "expense" ? "Pengeluaran" : "Kategori"}?</h3>
              <p className="text-sm text-muted-foreground mt-1.5">&quot;{deleteConfirm.label}&quot; akan dihapus permanen.</p>
              <div className="flex gap-2 mt-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                <Button size="sm" variant="danger" className="flex-1" onClick={() => deleteConfirm.kind === "expense" ? deleteExpense(deleteConfirm.id) : deleteCategory(deleteConfirm.id)} disabled={deleting}>
                  {deleting ? "Menghapus..." : "Hapus"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      <div className="fixed bottom-4 right-4 z-[60] space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn("px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white animate-fade-in", t.type === "success" ? "bg-success" : "bg-danger")}>
            {t.msg}
          </div>
        ))}
      </div>
    </RouteGuard>
  );
}
