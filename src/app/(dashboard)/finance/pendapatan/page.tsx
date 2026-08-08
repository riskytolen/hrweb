"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ReceiptText, Plus, Search, Pencil, Trash2, X, RefreshCw, ChevronDown, Banknote,
  Users, FileDown, AlertTriangle, Wallet,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import RouteGuard from "@/components/RouteGuard";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { DbFinanceInvoice, DbFinanceInvoicePayment, DbFinanceClient } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import {
  totalPaid, invoiceStatus, statusColor, generateInvoiceNo, computePpn, PAYMENT_METHODS,
  downloadCsv, fmtDate,
} from "@/lib/finance";

type Tab = "invoices" | "payments" | "clients";
type InvStatus = "Lunas" | "Sebagian" | "Belum Lunas";

interface InvoiceRow extends DbFinanceInvoice {
  paid?: number;
  status?: InvStatus;
  client?: DbFinanceClient | null;
  payments?: DbFinanceInvoicePayment[];
}

interface PaymentRow extends DbFinanceInvoicePayment {
  invoice?: Pick<DbFinanceInvoice, "id" | "invoice_no" | "total_amount"> | null;
}

interface Toast { id: number; type: "success" | "error"; msg: string }

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

export default function FinancePendapatanPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("finance");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";

  const [tab, setTab] = useState<Tab>("invoices");
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [clients, setClients] = useState<DbFinanceClient[]>([]);
  const [ppnDefault, setPpnDefault] = useState(0);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("Semua");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: "success" | "error", msg: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  // ─── Invoice form ───
  const [showInvForm, setShowInvForm] = useState(false);
  const [editingInv, setEditingInv] = useState<InvoiceRow | null>(null);
  const [invForm, setInvForm] = useState({ invoice_no: "", invoice_date: localDateStr(), due_date: "", client_id: 0, description: "", subtotal: 0, ppn_percent: 0, notes: "" });
  const [invSaving, setInvSaving] = useState(false);
  const [invError, setInvError] = useState("");

  // ─── Payment modal ───
  const [showPayModal, setShowPayModal] = useState(false);
  const [payInvoice, setPayInvoice] = useState<InvoiceRow | null>(null);
  const [payForm, setPayForm] = useState({ payment_date: localDateStr(), amount: 0, method: "Transfer Bank", notes: "" });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState("");

  // ─── Payment list modal ───
  const [showPayList, setShowPayList] = useState(false);
  const [payListInvoice, setPayListInvoice] = useState<InvoiceRow | null>(null);

  // ─── Client form ───
  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClient, setEditingClient] = useState<DbFinanceClient | null>(null);
  const [clientForm, setClientForm] = useState({ contact_name: "", company_name: "", email: "", phone: "", address: "", status: "Aktif" as "Aktif" | "Tidak Aktif" });
  const [clientSaving, setClientSaving] = useState(false);

  // ─── Delete confirms ───
  const [deleteConfirm, setDeleteConfirm] = useState<{ kind: "invoice" | "payment" | "client"; id: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExportMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: invData }, { data: payData }, { data: clData }, { data: settingsData }] = await Promise.all([
        supabase.from("finance_invoices").select("*, client:finance_clients(*)").order("invoice_date", { ascending: false }).order("id", { ascending: false }),
        supabase.from("finance_invoice_payments").select("*, invoice:finance_invoices(id, invoice_no, total_amount)").order("payment_date", { ascending: false }).order("id", { ascending: false }),
        supabase.from("finance_clients").select("*").order("company_name", { ascending: true }),
        supabase.from("finance_company_settings").select("ppn_default").eq("id", 1).maybeSingle(),
      ]);
      if (invData) {
        const payMap = new Map<number, DbFinanceInvoicePayment[]>();
        (payData ?? []).forEach((p) => {
          const list = payMap.get(p.invoice_id) || [];
          list.push(p);
          payMap.set(p.invoice_id, list);
        });
        setInvoices((invData as InvoiceRow[]).map((inv) => {
          const paid = totalPaid(payMap.get(inv.id) || []);
          return { ...inv, paid, status: invoiceStatus(inv.total_amount, paid), payments: payMap.get(inv.id) || [] };
        }));
      }
      if (payData) setPayments(payData as PaymentRow[]);
      if (clData) setClients(clData as DbFinanceClient[]);
      if (settingsData) setPpnDefault(Number(settingsData.ppn_default) || 0);
    } catch {
      addToast("error", "Gagal memuat data pendapatan.");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    (async () => { await fetchAll(); })();
  }, [fetchAll]);

  // ─── Invoice number auto-suggestion ───
  const openNewInvoice = () => {
    setEditingInv(null);
    setInvError("");
    const monthPrefix = localDateStr().slice(0, 7).replace("-", "");
    const last = invoices
      .map((i) => i.invoice_no)
      .filter((n) => n.startsWith(`INV-${monthPrefix}`))
      .map((n) => parseInt(n.split("-").pop() || "0", 10))
      .reduce((a, b) => Math.max(a, b), 0);
    setInvForm({ invoice_no: generateInvoiceNo(localDateStr(), last), invoice_date: localDateStr(), due_date: "", client_id: clients[0]?.id || 0, description: "", subtotal: 0, ppn_percent: ppnDefault, notes: "" });
    setShowInvForm(true);
  };

  const openEditInvoice = (inv: InvoiceRow) => {
    setEditingInv(inv);
    setInvError("");
    setInvForm({ invoice_no: inv.invoice_no, invoice_date: inv.invoice_date, due_date: inv.due_date || "", client_id: inv.client_id || 0, description: inv.description || "", subtotal: inv.subtotal, ppn_percent: Number(inv.ppn_percent), notes: inv.notes || "" });
    setShowInvForm(true);
  };

  const ppnAmount = useMemo(() => computePpn(invForm.subtotal, invForm.ppn_percent), [invForm.subtotal, invForm.ppn_percent]);
  const totalAmount = invForm.subtotal + ppnAmount;

  const saveInvoice = async () => {
    if (!invForm.invoice_no.trim() || !invForm.invoice_date || invForm.subtotal < 0) {
      setInvError("Lengkapi field wajib (nomor, tanggal, nominal).");
      return;
    }
    setInvSaving(true);
    setInvError("");
    const payload = {
      invoice_no: invForm.invoice_no.trim(),
      invoice_date: invForm.invoice_date,
      due_date: invForm.due_date || null,
      client_id: invForm.client_id || null,
      description: invForm.description || null,
      subtotal: invForm.subtotal,
      ppn_percent: invForm.ppn_percent,
      ppn_amount: ppnAmount,
      total_amount: totalAmount,
      notes: invForm.notes || null,
    };
    try {
      if (editingInv) {
        const { error } = await supabase.from("finance_invoices").update(payload).eq("id", editingInv.id);
        if (error) throw error;
        await logAudit({ supabase, action: "update", entityType: "finance_invoices", entityId: editingInv.id, entityLabel: payload.invoice_no, newData: payload });
        addToast("success", `Invoice ${payload.invoice_no} diperbarui.`);
      } else {
        const { error } = await supabase.from("finance_invoices").insert(payload);
        if (error) throw error;
        await logAudit({ supabase, action: "create", entityType: "finance_invoices", entityLabel: payload.invoice_no, newData: payload });
        addToast("success", `Invoice ${payload.invoice_no} dibuat.`);
      }
      setShowInvForm(false);
      fetchAll();
    } catch (err) {
      setInvError(err instanceof Error ? err.message : "Gagal menyimpan invoice.");
    } finally {
      setInvSaving(false);
    }
  };

  // ─── Payments ───
  const openPaymentModal = (inv: InvoiceRow) => {
    setPayInvoice(inv);
    setPayError("");
    const remaining = inv.total_amount - (inv.paid ?? 0);
    setPayForm({ payment_date: localDateStr(), amount: remaining > 0 ? remaining : 0, method: "Transfer Bank", notes: "" });
    setShowPayModal(true);
  };

  const openPayList = (inv: InvoiceRow) => {
    setPayListInvoice(inv);
    setShowPayList(true);
  };

  const savePayment = async () => {
    if (!payInvoice || !payForm.payment_date || payForm.amount <= 0) {
      setPayError("Tanggal dan nominal wajib diisi.");
      return;
    }
    setPaySaving(true);
    setPayError("");
    const remaining = payInvoice.total_amount - (payInvoice.paid ?? 0);
    if (payForm.amount > remaining) {
      setPayError(`Nominal melebihi sisa tagihan (${formatCurrency(remaining)}).`);
      setPaySaving(false);
      return;
    }
    const payload = { invoice_id: payInvoice.id, payment_date: payForm.payment_date, amount: payForm.amount, method: payForm.method, notes: payForm.notes || null };
    try {
      const { error } = await supabase.from("finance_invoice_payments").insert(payload);
      if (error) throw error;
      await logAudit({ supabase, action: "create", entityType: "finance_invoice_payments", entityId: payInvoice.id, entityLabel: `${payInvoice.invoice_no} — ${formatCurrency(payForm.amount)}`, newData: payload });
      addToast("success", `Pembayaran ${formatCurrency(payForm.amount)} untuk ${payInvoice.invoice_no} dicatat.`);
      setShowPayModal(false);
      fetchAll();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Gagal mencatat pembayaran.");
    } finally {
      setPaySaving(false);
    }
  };

  const deletePayment = async (id: number) => {
    setDeleting(true);
    try {
      const { error } = await supabase.from("finance_invoice_payments").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ supabase, action: "delete", entityType: "finance_invoice_payments", entityId: id, entityLabel: `Pembayaran #${id}` });
      addToast("success", "Pembayaran dihapus.");
      fetchAll();
    } catch {
      addToast("error", "Gagal menghapus pembayaran.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  // ─── Clients ───
  const openNewClient = () => {
    setEditingClient(null);
    setClientForm({ contact_name: "", company_name: "", email: "", phone: "", address: "", status: "Aktif" });
    setShowClientForm(true);
  };
  const openEditClient = (c: DbFinanceClient) => {
    setEditingClient(c);
    setClientForm({ contact_name: c.contact_name, company_name: c.company_name || "", email: c.email || "", phone: c.phone || "", address: c.address || "", status: c.status });
    setShowClientForm(true);
  };
  const saveClient = async () => {
    if (!clientForm.contact_name.trim()) return;
    setClientSaving(true);
    const payload = { contact_name: clientForm.contact_name.trim(), company_name: clientForm.company_name || null, email: clientForm.email || null, phone: clientForm.phone || null, address: clientForm.address || null, status: clientForm.status };
    try {
      if (editingClient) {
        const { error } = await supabase.from("finance_clients").update(payload).eq("id", editingClient.id);
        if (error) throw error;
        await logAudit({ supabase, action: "update", entityType: "finance_clients", entityId: editingClient.id, entityLabel: payload.contact_name, newData: payload });
        addToast("success", "Klien diperbarui.");
      } else {
        const { error } = await supabase.from("finance_clients").insert(payload);
        if (error) throw error;
        await logAudit({ supabase, action: "create", entityType: "finance_clients", entityLabel: payload.contact_name, newData: payload });
        addToast("success", "Klien ditambahkan.");
      }
      setShowClientForm(false);
      fetchAll();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Gagal menyimpan klien.");
    } finally {
      setClientSaving(false);
    }
  };

  const deleteClient = async (id: number) => {
    setDeleting(true);
    try {
      const { error } = await supabase.from("finance_clients").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ supabase, action: "delete", entityType: "finance_clients", entityId: id, entityLabel: "Klien" });
      addToast("success", "Klien dihapus.");
      fetchAll();
    } catch {
      addToast("error", "Gagal menghapus klien.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const deleteInvoice = async (id: number) => {
    setDeleting(true);
    try {
      const { error } = await supabase.from("finance_invoices").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ supabase, action: "delete", entityType: "finance_invoices", entityId: id, entityLabel: `Invoice #${id}` });
      addToast("success", "Invoice dihapus.");
      fetchAll();
    } catch {
      addToast("error", "Gagal menghapus invoice.");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  // ─── Filters ───
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const s = search.toLowerCase();
      const matchSearch = !s || inv.invoice_no.toLowerCase().includes(s) || (inv.client?.company_name || inv.client?.contact_name || "").toLowerCase().includes(s);
      const matchStatus = filterStatus === "Semua" || inv.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [invoices, search, filterStatus]);

  const filteredPayments = useMemo(() => {
    const s = search.toLowerCase();
    return payments.filter((p) => !s || (p.invoice?.invoice_no || "").toLowerCase().includes(s) || (p.notes || "").toLowerCase().includes(s));
  }, [payments, search]);

  const filteredClients = useMemo(() => {
    const s = search.toLowerCase();
    return clients.filter((c) => !s || c.contact_name.toLowerCase().includes(s) || (c.company_name || "").toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s));
  }, [clients, search]);

  const exportInvoicesCsv = () => {
    const rows: (string | number | null | undefined)[][] = [
      ["No", "No. Invoice", "Tanggal", "Jatuh Tempo", "Klien", "Subtotal", "PPN %", "PPN", "Total", "Dibayar", "Status", "Deskripsi"],
      ...filteredInvoices.map((inv, i) => [
        i + 1, inv.invoice_no, inv.invoice_date, inv.due_date || "",
        inv.client ? (inv.client.company_name || inv.client.contact_name) : "",
        inv.subtotal, inv.ppn_percent, inv.ppn_amount, inv.total_amount, inv.paid ?? 0, inv.status, inv.description || "",
      ]),
    ];
    downloadCsv("pendapatan-invoices.csv", rows);
  };

  const exportPaymentsCsv = () => {
    const rows: (string | number | null | undefined)[][] = [
      ["No", "No. Invoice", "Tanggal", "Metode", "Nominal", "Catatan"],
      ...filteredPayments.map((p, i) => [i + 1, p.invoice?.invoice_no || "", p.payment_date, p.method || "", p.amount, p.notes || ""]),
    ];
    downloadCsv("pendapatan-pembayaran.csv", rows);
  };

  const summary = useMemo(() => {
    const totalInv = invoices.reduce((s, i) => s + i.total_amount, 0);
    const totalPaidAll = invoices.reduce((s, i) => s + (i.paid ?? 0), 0);
    return {
      totalInv,
      totalPaidAll,
      piutang: totalInv - totalPaidAll,
      lunas: invoices.filter((i) => i.status === "Lunas").length,
      sebagian: invoices.filter((i) => i.status === "Sebagian").length,
      belum: invoices.filter((i) => i.status === "Belum Lunas").length,
    };
  }, [invoices]);

  return (
    <RouteGuard permission="finance">
      <PageHeader
        title="Pendapatan"
        description="Kelola invoice, pembayaran, dan klien"
        icon={ReceiptText}
        actions={
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted"
            >
              <FileDown className="w-4 h-4" />
              Export CSV
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-20">
                <button onClick={() => { exportInvoicesCsv(); setShowExportMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted">
                  Export Invoices
                </button>
                <button onClick={() => { exportPaymentsCsv(); setShowExportMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted">
                  Export Pembayaran
                </button>
              </div>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit mb-4">
        {([
          { key: "invoices" as Tab, label: "Invoices", icon: ReceiptText, count: invoices.length },
          { key: "payments" as Tab, label: "Pembayaran", icon: Banknote, count: payments.length },
          { key: "clients" as Tab, label: "Klien", icon: Users, count: clients.length },
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

      {/* KPI invoices */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4 mb-4">
        <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Total Invoice</p>
          <p className="text-lg font-bold text-foreground mt-1 tabular-nums">{formatCurrency(summary.totalInv)}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Terkumpul</p>
          <p className="text-lg font-bold text-success mt-1 tabular-nums">{formatCurrency(summary.totalPaidAll)}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Piutang</p>
          <p className="text-lg font-bold text-warning mt-1 tabular-nums">{formatCurrency(summary.piutang)}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Status</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="px-2 py-0.5 rounded-full bg-success-light text-success text-[10px] font-semibold">Lunas {summary.lunas}</span>
            <span className="px-2 py-0.5 rounded-full bg-warning-light text-warning text-[10px] font-semibold">Sebagian {summary.sebagian}</span>
            <span className="px-2 py-0.5 rounded-full bg-danger-light text-danger text-[10px] font-semibold">Belum {summary.belum}</span>
          </div>
        </div>
      </div>

      {/* ══════════ INVOICES ══════════ */}
      {tab === "invoices" && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 max-w-sm">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Cari no. invoice atau klien..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm outline-none w-full text-foreground placeholder:text-muted-foreground/60" />
            </div>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-sm text-foreground outline-none">
              {["Semua", "Lunas", "Sebagian", "Belum Lunas"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button onClick={fetchAll} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Refresh"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
              {canInput && (
                <button onClick={openNewInvoice} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm">
                  <Plus className="w-4 h-4" /> Buat Invoice
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground text-sm">Belum ada invoice. Klik &quot;Buat Invoice&quot;.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">No. Invoice</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Tanggal</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Klien</th>
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Total</th>
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Dibayar</th>
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Sisa</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((inv) => {
                    const remaining = inv.total_amount - (inv.paid ?? 0);
                    return (
                      <tr key={inv.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground">{inv.invoice_no}</p>
                          <p className="text-[11px] text-muted-foreground">{inv.description || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {fmtDate(inv.invoice_date)}
                          {inv.due_date && <p className="text-[11px]">Jth tempo {fmtDate(inv.due_date)}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {inv.client ? (
                            <div>
                              <p className="font-medium text-foreground">{inv.client.company_name || inv.client.contact_name}</p>
                              {inv.client.company_name && <p className="text-[11px] text-muted-foreground">{inv.client.contact_name}</p>}
                            </div>
                          ) : <span className="text-xs text-muted-foreground/60 italic">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground tabular-nums">{formatCurrency(inv.total_amount)}</td>
                        <td className="px-4 py-3 text-right text-success tabular-nums">{formatCurrency(inv.paid ?? 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {remaining > 0 ? <span className="font-semibold text-warning">{formatCurrency(remaining)}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold", statusColor(inv.status || "Belum Lunas"))}>
                            {inv.status === "Belum Lunas" && inv.due_date && inv.due_date < localDateStr() && inv.paid === 0 ? "Overdue" : inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canInput && (
                              <button onClick={() => openPaymentModal(inv)} className="p-2 rounded-lg hover:bg-muted text-success hover:text-success" title="Catat Pembayaran">
                                <Banknote className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => openPayList(inv)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Riwayat Pembayaran">
                              <Wallet className="w-4 h-4" />
                            </button>
                            {canEdit && (
                              <>
                                <button onClick={() => openEditInvoice(inv)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit">
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button onClick={() => setDeleteConfirm({ kind: "invoice", id: inv.id, label: inv.invoice_no })} className="p-2 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════ PAYMENTS ══════════ */}
      {tab === "payments" && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 max-w-sm">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Cari no. invoice..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm outline-none w-full text-foreground placeholder:text-muted-foreground/60" />
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button onClick={fetchAll} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Refresh"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
            </div>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
            ) : filteredPayments.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground text-sm">Belum ada pembayaran tercatat.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Tanggal</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">No. Invoice</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Metode</th>
                    <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Nominal</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Catatan</th>
                    {canEdit && <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((p) => (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(p.payment_date)}</td>
                      <td className="px-4 py-3 font-semibold text-foreground">{p.invoice?.invoice_no || `Invoice #${p.invoice_id}`}</td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium">{p.method || "—"}</span></td>
                      <td className="px-4 py-3 text-right font-bold text-success tabular-nums">{formatCurrency(p.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{p.notes || "—"}</td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => setDeleteConfirm({ kind: "payment", id: p.id, label: `Pembayaran ${formatCurrency(p.amount)}` })} className="p-2 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus">
                            <Trash2 className="w-4 h-4" />
                          </button>
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

      {/* ══════════ CLIENTS ══════════ */}
      {tab === "clients" && (
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 max-w-sm">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Cari nama kontak / perusahaan..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm outline-none w-full text-foreground placeholder:text-muted-foreground/60" />
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button onClick={fetchAll} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Refresh"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
              {canInput && (
                <button onClick={openNewClient} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 shadow-sm">
                  <Plus className="w-4 h-4" /> Tambah Klien
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
            ) : filteredClients.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground text-sm">Belum ada klien.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Kontak</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Perusahaan</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Email / Telepon</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Alamat</th>
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
                    {canEdit && <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((c) => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {(c.company_name || c.contact_name).charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-foreground">{c.contact_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-foreground">{c.company_name || <span className="text-xs text-muted-foreground/60 italic">—</span>}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.email && <p>{c.email}</p>}
                        {c.phone && <p>{c.phone}</p>}
                        {!c.email && !c.phone && "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate">{c.address || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", c.status === "Aktif" ? "bg-success-light text-success" : "bg-danger-light text-danger")}>
                          {c.status}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEditClient(c)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => setDeleteConfirm({ kind: "client", id: c.id, label: c.contact_name })} className="p-2 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger" title="Hapus"><Trash2 className="w-4 h-4" /></button>
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

      {/* ─── MODAL: INVOICE ─── */}
      {showInvForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !invSaving && setShowInvForm(false)} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !invSaving && setShowInvForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <ReceiptText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{editingInv ? "Edit Invoice" : "Buat Invoice"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Catat pendapatan yang ditagih ke klien</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                {invError && <div className="p-3 rounded-xl bg-danger-light text-danger text-xs font-medium">{invError}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">No. Invoice <span className="text-danger">*</span></label>
                    <input type="text" value={invForm.invoice_no} onChange={(e) => setInvForm({ ...invForm, invoice_no: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal <span className="text-danger">*</span></label>
                    <DatePicker value={invForm.invoice_date} onChange={(v) => setInvForm({ ...invForm, invoice_date: v })} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Jatuh Tempo</label>
                    <DatePicker value={invForm.due_date} onChange={(v) => setInvForm({ ...invForm, due_date: v })} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Klien</label>
                    <div className="relative">
                      <select value={invForm.client_id} onChange={(e) => setInvForm({ ...invForm, client_id: Number(e.target.value) })} className={inputClass + " appearance-none pr-8"}>
                        <option value={0}>— Tanpa klien —</option>
                        {clients.filter((c) => c.status === "Aktif").map((c) => (
                          <option key={c.id} value={c.id}>{c.company_name || c.contact_name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Deskripsi</label>
                  <input type="text" value={invForm.description} onChange={(e) => setInvForm({ ...invForm, description: e.target.value })} placeholder="Mis. Sewa armada minggu ke-3" className={inputClass} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Subtotal (Rp) <span className="text-danger">*</span></label>
                    <CurrencyInput value={invForm.subtotal} onChange={(v) => setInvForm({ ...invForm, subtotal: v })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">PPN (%)</label>
                    <input type="number" min={0} max={100} step={0.01} value={invForm.ppn_percent} onChange={(e) => setInvForm({ ...invForm, ppn_percent: Number(e.target.value) })} className={inputClass} />
                  </div>
                </div>
                <div className="rounded-xl bg-muted/40 border border-border p-3.5 space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(invForm.subtotal)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>PPN ({invForm.ppn_percent}%)</span><span className="tabular-nums">{formatCurrency(ppnAmount)}</span></div>
                  <div className="flex justify-between font-bold text-foreground pt-1.5 border-t border-border"><span>Total</span><span className="tabular-nums">{formatCurrency(totalAmount)}</span></div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan</label>
                  <textarea value={invForm.notes} onChange={(e) => setInvForm({ ...invForm, notes: e.target.value })} rows={2} className={inputClass} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowInvForm(false)} disabled={invSaving}>Batal</Button>
                <Button size="sm" onClick={saveInvoice} disabled={invSaving || !invForm.invoice_no || !invForm.invoice_date}>
                  {invSaving ? "Menyimpan..." : editingInv ? "Simpan" : "Buat Invoice"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ─── MODAL: CATAT PEMBAYARAN ─── */}
      {showPayModal && payInvoice && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !paySaving && setShowPayModal(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-success/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !paySaving && setShowPayModal(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-success to-emerald-600 flex items-center justify-center shadow-lg shadow-success/20">
                    <Banknote className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">Catat Pembayaran</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{payInvoice.invoice_no} · Total {formatCurrency(payInvoice.total_amount)}</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                {payError && <div className="p-3 rounded-xl bg-danger-light text-danger text-xs font-medium">{payError}</div>}
                <div className="flex items-center justify-between rounded-xl bg-muted/40 border border-border p-3.5 text-sm">
                  <span className="text-muted-foreground">Sudah dibayar</span>
                  <span className="font-semibold text-success tabular-nums">{formatCurrency(payInvoice.paid ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-muted/40 border border-border p-3.5 text-sm">
                  <span className="text-muted-foreground">Sisa tagihan</span>
                  <span className="font-semibold text-warning tabular-nums">{formatCurrency(payInvoice.total_amount - (payInvoice.paid ?? 0))}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Tanggal <span className="text-danger">*</span></label>
                    <DatePicker value={payForm.payment_date} onChange={(v) => setPayForm({ ...payForm, payment_date: v })} className="w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Metode</label>
                    <div className="relative">
                      <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} className={inputClass + " appearance-none pr-8"}>
                        {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nominal (Rp) <span className="text-danger">*</span></label>
                  <CurrencyInput value={payForm.amount} onChange={(v) => setPayForm({ ...payForm, amount: v })} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Catatan</label>
                  <input type="text" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} placeholder="Opsional" className={inputClass} />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowPayModal(false)} disabled={paySaving}>Batal</Button>
                <Button size="sm" onClick={savePayment} disabled={paySaving || payForm.amount <= 0}>
                  {paySaving ? "Menyimpan..." : "Simpan Pembayaran"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ─── MODAL: RIWAYAT PEMBAYARAN ─── */}
      {showPayList && payListInvoice && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPayList(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="flex items-center justify-between px-5 py-4 bg-muted/30 flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center"><Wallet className="w-4 h-4 text-success" /></div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">{payListInvoice.invoice_no}</h2>
                    <p className="text-[11px] text-muted-foreground">Riwayat pembayaran</p>
                  </div>
                </div>
                <button onClick={() => setShowPayList(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-3 flex-1 overflow-y-auto">
                {(payListInvoice.payments?.length || 0) === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">Belum ada pembayaran untuk invoice ini.</div>
                ) : (
                  (payListInvoice.payments || []).map((p) => (
                    <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(p.amount)}</p>
                        <p className="text-[11px] text-muted-foreground">{fmtDate(p.payment_date)} · {p.method || "—"}{p.notes ? ` · ${p.notes}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold", payListInvoice.payments && totalPaid(payListInvoice.payments.slice(0, (payListInvoice.payments || []).indexOf(p) + 1)) >= payListInvoice.total_amount ? "bg-success-light text-success" : "bg-warning-light text-warning")}>
                          {payListInvoice.payments && totalPaid(payListInvoice.payments.slice(0, (payListInvoice.payments || []).indexOf(p) + 1)) >= payListInvoice.total_amount ? "Lunas" : "Parsial"}
                        </span>
                        {canEdit && (
                          <button onClick={() => setDeleteConfirm({ kind: "payment", id: p.id, label: `Pembayaran ${formatCurrency(p.amount)}` })} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <div className="flex items-center justify-between pt-3 border-t border-border text-sm">
                  <span className="text-muted-foreground">Total dibayar</span>
                  <span className="font-bold text-success tabular-nums">{formatCurrency(totalPaid(payListInvoice.payments || []))}</span>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ─── MODAL: KLIEN ─── */}
      {showClientForm && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !clientSaving && setShowClientForm(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
                <button onClick={() => !clientSaving && setShowClientForm(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{editingClient ? "Edit Klien" : "Tambah Klien"}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Data pelanggan yang ditagih</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Kontak <span className="text-danger">*</span></label>
                  <input type="text" value={clientForm.contact_name} onChange={(e) => setClientForm({ ...clientForm, contact_name: e.target.value })} className={inputClass} autoFocus />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Nama Perusahaan</label>
                  <input type="text" value={clientForm.company_name} onChange={(e) => setClientForm({ ...clientForm, company_name: e.target.value })} className={inputClass} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Email</label>
                    <input type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">Telepon</label>
                    <input type="text" value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} className={inputClass} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Alamat</label>
                  <textarea value={clientForm.address} onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })} rows={2} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Status</label>
                  <div className="flex gap-1.5">
                    {(["Aktif", "Tidak Aktif"] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setClientForm({ ...clientForm, status: s })} className={cn(
                        "flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all",
                        clientForm.status === s ? (s === "Aktif" ? "bg-success/10 border-success/30 text-success" : "bg-danger/10 border-danger/30 text-danger") : "border-border text-muted-foreground hover:bg-muted"
                      )}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowClientForm(false)} disabled={clientSaving}>Batal</Button>
                <Button size="sm" onClick={saveClient} disabled={clientSaving || !clientForm.contact_name.trim()}>
                  {clientSaving ? "Menyimpan..." : editingClient ? "Simpan" : "Tambah"}
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
              <h3 className="text-base font-bold text-foreground mt-4">Hapus {deleteConfirm.kind === "invoice" ? "Invoice" : deleteConfirm.kind === "payment" ? "Pembayaran" : "Klien"}?</h3>
              <p className="text-sm text-muted-foreground mt-1.5">
                &quot;{deleteConfirm.label}&quot; akan dihapus permanen.
                {deleteConfirm.kind === "invoice" && " Pembayaran terkait ikut terhapus."}
                {deleteConfirm.kind === "client" && " Invoice lama tidak terhapus, klien jadi tidak tertaut."}
              </p>
              <div className="flex gap-2 mt-6">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Batal</Button>
                <Button size="sm" variant="danger" className="flex-1" onClick={() => deleteConfirm.kind === "invoice" ? deleteInvoice(deleteConfirm.id) : deleteConfirm.kind === "payment" ? deletePayment(deleteConfirm.id) : deleteClient(deleteConfirm.id)} disabled={deleting}>
                  {deleting ? "Menghapus..." : "Hapus"}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Toasts */}
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
