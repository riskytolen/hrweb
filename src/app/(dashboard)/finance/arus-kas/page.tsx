"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Landmark, Plus, Search, Pencil, Trash2, X, RefreshCw, FileDown,
  AlertTriangle, ArrowUpRight, ArrowDownRight, Wallet, Scale,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import RouteGuard from "@/components/RouteGuard";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { DbFinanceCashAdjustment } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import { buildCashFlow, downloadCsv, fmtDate } from "@/lib/finance";

interface Toast { id: number; type: "success" | "error"; msg: string }

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

export default function FinanceArusKasPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("finance");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [loading, setLoading] = useState(true);
  const [initialBalance, setInitialBalance] = useState(0);
  const [payments, setPayments] = useState<{ payment_date: string; amount: number; method: string | null; invoice_no: string; client_name: string | null }[]>([]);
  const [expenses, setExpenses] = useState<{ expense_date: string; amount: number; method: string | null; description: string; category_name: string | null }[]>([]);
  const [adjustments, setAdjustments] = useState<DbFinanceCashAdjustment[]>([]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("Semua");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: "success" | "error", msg: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  // ─── Adjustment form ───
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DbFinanceCashAdjustment | null>(null);
  const [form, setForm] = useState({ adjustment_date: localDateStr(), type: "Masuk" as "Masuk" | "Keluar", amount: 0, description: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: settingsData }, { data: payData }, { data: expData }, { data: adjData }] = await Promise.all([
        supabase.from("finance_company_settings").select("initial_cash_balance").eq("id", 1).maybeSingle(),
        supabase.from("finance_invoice_payments").select("payment_date, amount, method, invoice:finance_invoices(invoice_no, client:finance_clients(contact_name, company_name))").order("payment_date", { ascending: true }),
        supabase.from("finance_expenses").select("expense_date, amount, method, description, category:finance_expense_categories(name)").order("expense_date", { ascending: true }),
        supabase.from("finance_cash_adjustments").select("*").order("adjustment_date", { ascending: true }).order("id", { ascending: true }),
      ]);
      if (settingsData) setInitialBalance(Number(settingsData.initial_cash_balance) || 0);
      if (payData) {
        setPayments((payData as unknown as { payment_date: string; amount: number; method: string | null; invoice: { invoice_no: string; client: { contact_name: string; company_name: string | null } | null } | null }[]).map((p) => ({
          payment_date: p.payment_date,
          amount: p.amount,
          method: p.method,
          invoice_no: p.invoice?.invoice_no ?? "Invoice",
          client_name: p.invoice?.client ? (p.invoice.client.company_name || p.invoice.client.contact_name) : null,
        })));
      }
      if (expData) {
        setExpenses((expData as unknown as { expense_date: string; amount: number; method: string | null; description: string; category: { name: string } | null }[]).map((e) => ({
          expense_date: e.expense_date,
          amount: e.amount,
          method: e.method,
          description: e.description,
          category_name: e.category?.name ?? null,
        })));
      }
      if (adjData) setAdjustments(adjData as DbFinanceCashAdjustment[]);
    } catch {
      addToast("error", "Gagal memuat data arus kas.");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    (async () => { await fetchAll(); })();
  }, [fetchAll]);

  const flow = useMemo(() => buildCashFlow(initialBalance, payments, expenses, adjustments), [initialBalance, payments, expenses, adjustments]);

  const stats = useMemo(() => {
    const totalIn = flow.reduce((s, e) => s + e.masuk, 0);
    const totalOut = flow.reduce((s, e) => s + e.keluar, 0);
    return {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      balance: flow.length > 0 ? flow[flow.length - 1].balance : initialBalance,
      countIn: flow.filter((e) => e.masuk > 0).length,
      countOut: flow.filter((e) => e.keluar > 0).length,
    };
  }, [flow, initialBalance]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return flow.filter((e) => {
      const matchSearch = !s || e.label.toLowerCase().includes(s) || e.detail.toLowerCase().includes(s) || (e.method || "").toLowerCase().includes(s);
      const matchType = filterType === "Semua" || (filterType === "Masuk" ? e.masuk > 0 : filterType === "Keluar" ? e.keluar > 0 : true);
      return matchSearch && matchType;
    });
  }, [flow, search, filterType]);

  const openNew = () => {
    setEditing(null);
    setFormError("");
    setForm({ adjustment_date: localDateStr(), type: "Masuk", amount: 0, description: "", notes: "" });
    setShowForm(true);
  };

  const openEdit = (a: DbFinanceCashAdjustment) => {
    setEditing(a);
    setFormError("");
    setForm({ adjustment_date: a.adjustment_date, type: a.type, amount: a.amount, description: a.description, notes: a.notes || "" });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.adjustment_date || !form.description.trim() || form.amount <= 0) {
      setFormError("Lengkapi field wajib (tanggal, deskripsi, nominal > 0).");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = { adjustment_date: form.adjustment_date, type: form.type, amount: form.amount, description: form.description.trim(), notes: form.notes || null };
    try {
      if (editing) {
        const { error } = await supabase.from("finance_cash_adjustments").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ supabase, action: "update", entityType: "finance_cash_adjustments", entityId: editing.id, entityLabel: payload.description, newData: payload });
        addToast("success", "Penyesuaian diperbarui.");
      } else {
        const { error } = await supabase.from("finance_cash_adjustments").insert(payload);
        if (error) throw error;
        await logAudit({ supabase, action: "create", entityType: "finance_cash_adjustments", entityLabel: payload.description, newData: payload });
        addToast("success", "Penyesuaian kas dicatat.");
      }
      setShowForm(false);
      fetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan penyesuaian.");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: number) => {
    setDeleting(true);
    try {
      const { error } = await supabase.from("finance_cash_adjustments").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ supabase, action: "delete", entityType: "finance_cash_adjustments", entityId: id, entityLabel: "Penyesuaian kas" });
      addToast("success", "Penyesuaian dihapus.");
      fetchAll();
    } catch {
      addToast("error", "Gagal menghapus penyesuaian.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const exportCsv = () => {
    const rows: (string | number | null | undefined)[][] = [
      ["No", "Tanggal", "Jenis", "Keterangan", "Detail", "Metode", "Masuk (Rp)", "Keluar (Rp)", "Saldo (Rp)"],
      ...filtered.map((e, i) => [i + 1, e.tanggal, e.type === "payment" ? "Pembayaran" : e.type === "expense" ? "Pengeluaran" : "Penyesuaian", e.label, e.detail, e.method || "", e.masuk, e.keluar, e.balance]),
    ];
    downloadCsv("arus-kas.csv", rows);
  };

  return (
    <RouteGuard permission="finance">
      <PageHeader
        title="Arus Kas"
        description="Mutasi kas masuk & keluar dengan saldo berjalan"
        icon={Landmark}
        actions={
          <button onClick={exportCsv} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted">
            <FileDown className="w-4 h-4" />
            Export CSV
          </button>
        }
      />

      {/* KPI */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4 mb-4">
        <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Saldo Kas</p>
            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center"><Wallet className="w-4 h-4 text-primary" /></div>
          </div>
          <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", stats.balance < 0 ? "text-danger" : "text-foreground")}>{formatCurrency(stats.balance)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">Saldo awal {formatCurrency(initialBalance)}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Total Kas Masuk</p>
            <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center"><ArrowUpRight className="w-4 h-4 text-success" /></div>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-success mt-1.5 tabular-nums">{formatCurrency(stats.totalIn)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{stats.countIn} transaksi</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Total Kas Keluar</p>
            <div className="w-8 h-8 rounded-lg bg-danger-light flex items-center justify-center"><ArrowDownRight className="w-4 h-4 text-danger" /></div>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-danger mt-1.5 tabular-nums">{formatCurrency(stats.totalOut)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{stats.countOut} transaksi</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Selisih Bersih</p>
            <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center"><Scale className="w-4 h-4 text-warning" /></div>
          </div>
          <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", stats.net >= 0 ? "text-success" : "text-danger")}>
            {stats.net >= 0 ? "+" : "−"}{formatCurrency(Math.abs(stats.net))}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Kas masuk − kas keluar</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 max-w-sm">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Cari keterangan, invoice, metode..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm outline-none w-full text-foreground placeholder:text-muted-foreground/60" />
          </div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none">
            {["Semua", "Masuk", "Keluar"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-2 sm:ml-auto">
            <button onClick={fetchAll} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Refresh"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
            {canInput && (
              <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm">
                <Plus className="w-4 h-4" /> Penyesuaian Kas
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground text-sm">Belum ada transaksi arus kas.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Tanggal</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Jenis</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Keterangan</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Metode</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Masuk</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Keluar</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Saldo</th>
                  {canEdit && <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(e.tanggal)}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
                        e.type === "payment" ? "bg-success-light text-success" : e.type === "expense" ? "bg-danger-light text-danger" : "bg-warning-light text-warning"
                      )}>
                        {e.type === "payment" ? <ArrowUpRight className="w-3 h-3" /> : e.type === "expense" ? <ArrowDownRight className="w-3 h-3" /> : <Scale className="w-3 h-3" />}
                        {e.type === "payment" ? "Pembayaran" : e.type === "expense" ? "Pengeluaran" : "Penyesuaian"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{e.label}</p>
                      <p className="text-[11px] text-muted-foreground">{e.detail}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{e.method || "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-success tabular-nums">{e.masuk > 0 ? formatCurrency(e.masuk) : "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-danger tabular-nums">{e.keluar > 0 ? formatCurrency(e.keluar) : "—"}</td>
                    <td className={cn("px-4 py-3 text-right font-bold tabular-nums", e.balance < 0 ? "text-danger" : "text-foreground")}>{formatCurrency(e.balance)}</td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {e.type === "adjustment" && e.id != null && (
                            <>
                              <button onClick={() => { const a = adjustments.find((x) => x.id === e.id); if (a) openEdit(a); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => { const a = adjustments.find((x) => x.id === e.id); if (a) setDeleteConfirm({ id: a.id, label: a.description }); }} className="p-2 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus"><Trash2 className="w-4 h-4" /></button>
                            </>
                          )}
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

      {/* ─── MODAL: ADJUSTMENT ─── */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setShowForm(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-warning/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !saving && setShowForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                    <Scale className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{editing ? "Edit Penyesuaian" : "Penyesuaian Kas"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Koreksi saldo kas manual</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                {formError && <div className="p-3 rounded-xl bg-danger-light text-danger text-xs font-medium">{formError}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal <span className="text-danger">*</span></label>
                    <DatePicker value={form.adjustment_date} onChange={(v) => setForm({ ...form, adjustment_date: v })} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tipe <span className="text-danger">*</span></label>
                    <div className="flex gap-1.5">
                      {(["Masuk", "Keluar"] as const).map((t) => (
                        <button key={t} type="button" onClick={() => setForm({ ...form, type: t })} className={cn(
                          "flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all",
                          form.type === t ? (t === "Masuk" ? "bg-success/10 border-success/30 text-success" : "bg-danger/10 border-danger/30 text-danger") : "border-border text-muted-foreground hover:bg-muted"
                        )}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi <span className="text-danger">*</span></label>
                  <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Mis. Koreksi saldo bank" className={inputClass} autoFocus />
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

      {/* ─── CONFIRM DELETE ─── */}
      {deleteConfirm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl animate-scale-in p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-danger-light flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6 text-danger" />
              </div>
              <h3 className="text-base font-bold text-foreground mt-4">Hapus Penyesuaian?</h3>
              <p className="text-sm text-muted-foreground mt-1.5">&quot;{deleteConfirm.label}&quot; akan dihapus permanen.</p>
              <div className="flex gap-2 mt-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                <Button size="sm" variant="danger" className="flex-1" onClick={() => del(deleteConfirm.id)} disabled={deleting}>
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
