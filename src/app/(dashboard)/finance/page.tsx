"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Wallet, TrendingUp, TrendingDown, PiggyBank, ReceiptText, ArrowUpRight, ArrowDownRight,
  AlertTriangle, RefreshCw, LineChart as LineChartIcon, FileDown,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import PageHeader from "@/components/ui/PageHeader";
import RouteGuard from "@/components/RouteGuard";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { DbFinanceCompanySettings } from "@/lib/supabase";
import {
  invoiceStatus, statusColor, monthLabel, buildCashFlow,
} from "@/lib/finance";

interface InvoiceRow {
  id: number;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  client_id: number | null;
  description: string | null;
  subtotal: number;
  ppn_percent: number;
  ppn_amount: number;
  total_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client?: { contact_name: string; company_name: string | null } | null;
  paid?: number;
  status?: "Lunas" | "Sebagian" | "Belum Lunas";
}

interface ExpenseRow {
  id: number;
  expense_date: string;
  category_id: number | null;
  description: string;
  vendor: string | null;
  method: string | null;
  amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  category?: { name: string; color: string } | null;
}

const CURR_YEAR = new Date().getFullYear();
const CURR_MONTH = new Date().getMonth();

function statCard(icon: React.ReactNode, label: string, value: string, sub?: string, tone?: "success" | "danger" | "primary" | "warning") {
  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
          tone === "success" && "bg-success-light text-success",
          tone === "danger" && "bg-danger-light text-danger",
          tone === "warning" && "bg-warning-light text-warning",
          (!tone || tone === "primary") && "bg-primary-light text-primary",
        )}>
          {icon}
        </div>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-foreground mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export default function FinanceDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<DbFinanceCompanySettings | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [adjustments, setAdjustments] = useState<{ id: number; adjustment_date: string; type: "Masuk" | "Keluar"; amount: number; description: string }[]>([]);
  const [payments, setPayments] = useState<{ payment_date: string; amount: number; method: string | null; invoice_id: number; invoice_no: string; client_name: string | null }[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: "success" | "error", msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, msg });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: settingsData }, { data: invoicesData }, { data: paymentsData }, { data: expensesData }, { data: adjData }] = await Promise.all([
        supabase.from("finance_company_settings").select("*").eq("id", 1).maybeSingle(),
        supabase.from("finance_invoices").select("*, client:finance_clients(contact_name, company_name)").order("invoice_date", { ascending: false }),
        supabase.from("finance_invoice_payments").select("*, invoice:finance_invoices(invoice_no, client:finance_clients(contact_name, company_name))").order("payment_date", { ascending: false }),
        supabase.from("finance_expenses").select("*, category:finance_expense_categories(name, color)").order("expense_date", { ascending: false }),
        supabase.from("finance_cash_adjustments").select("*").order("adjustment_date", { ascending: false }),
      ]);
      if (settingsData) setSettings(settingsData as DbFinanceCompanySettings);
      if (invoicesData) setInvoices((invoicesData as InvoiceRow[]).map((inv) => {
        const paid = paymentsData
          ?.filter((p) => p.invoice_id === inv.id)
          .reduce((s, p) => s + (p.amount || 0), 0) ?? 0;
        return { ...inv, paid, status: invoiceStatus(inv.total_amount, paid) };
      }));
      if (paymentsData) {
        setPayments((paymentsData as typeof payments).map((p) => {
          const inv = (p as { invoice?: { invoice_no: string; client: { contact_name: string; company_name: string | null } | null } | null }).invoice;
          return {
            payment_date: p.payment_date,
            amount: p.amount,
            method: p.method,
            invoice_id: p.invoice_id,
            invoice_no: inv?.invoice_no ?? `Invoice #${p.invoice_id}`,
            client_name: inv?.client ? (inv.client.company_name || inv.client.contact_name) : null,
          };
        }));
      }
      if (expensesData) setExpenses(expensesData as ExpenseRow[]);
      if (adjData) setAdjustments(adjData as typeof adjustments);
    } catch {
      showToast("error", "Gagal memuat data finance.");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    (async () => { await fetchAll(); })();
  }, [fetchAll]);

  const chartData = useMemo(() => {
    const map = new Map<string, { pendapatan: number; pengeluaran: number }>();
    for (let m = 0; m < 12; m++) {
      map.set(monthLabel(CURR_YEAR, m), { pendapatan: 0, pengeluaran: 0 });
    }
    invoices.forEach((inv) => {
      const d = new Date(inv.invoice_date + "T00:00:00");
      if (d.getFullYear() === CURR_YEAR) {
        const key = monthLabel(CURR_YEAR, d.getMonth());
        const cur = map.get(key) || { pendapatan: 0, pengeluaran: 0 };
        cur.pendapatan += inv.total_amount;
        map.set(key, cur);
      }
    });
    expenses.forEach((e) => {
      const d = new Date(e.expense_date + "T00:00:00");
      if (d.getFullYear() === CURR_YEAR) {
        const key = monthLabel(CURR_YEAR, d.getMonth());
        const cur = map.get(key) || { pendapatan: 0, pengeluaran: 0 };
        cur.pengeluaran += e.amount;
        map.set(key, cur);
      }
    });
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
  }, [invoices, expenses]);

  const cashFlow = useMemo(
    () => buildCashFlow(settings?.initial_cash_balance ?? 0, payments, expenses as unknown as { expense_date: string; amount: number; method: string | null; description: string; category_name: string | null }[], adjustments),
    [settings, payments, expenses, adjustments]
  );
  const currentBalance = cashFlow.length > 0 ? cashFlow[cashFlow.length - 1].balance : (settings?.initial_cash_balance ?? 0);

  const monthKey = `${CURR_YEAR}-${String(CURR_MONTH + 1).padStart(2, "0")}`;
  const monthIncome = invoices
    .filter((i) => i.invoice_date.startsWith(monthKey))
    .reduce((s, i) => s + i.total_amount, 0);
  const monthExpense = expenses
    .filter((e) => e.expense_date.startsWith(monthKey))
    .reduce((s, e) => s + e.amount, 0);
  const totalPiutang = invoices.reduce((s, i) => s + (i.total_amount - (i.paid ?? 0)), 0);
  const piutangCount = invoices.filter((i) => (i.status === "Sebagian" || i.status === "Belum Lunas") && i.total_amount > (i.paid ?? 0)).length;

  const recent = useMemo(() => {
    const items: { tanggal: string; label: string; detail: string; amount: number; isIn: boolean }[] = [];
    payments.slice(0, 6).forEach((p) => items.push({ tanggal: p.payment_date, label: p.invoice_no, detail: p.client_name || "Klien", amount: p.amount, isIn: true }));
    expenses.slice(0, 6).forEach((e) => items.push({ tanggal: e.expense_date, label: e.description, detail: e.category?.name || "Pengeluaran", amount: e.amount, isIn: false }));
    return items.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1)).slice(0, 8);
  }, [payments, expenses]);

  return (
    <RouteGuard permission="finance">
      <PageHeader
        title="Dashboard Finance"
        description="Ringkasan keuangan perusahaan"
        icon={Wallet}
        actions={
          <>
            <button
              onClick={fetchAll}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
              title="Refresh"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
            <Link
              href="/finance/arus-kas"
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted"
            >
              <FileDown className="w-4 h-4" />
              Export
            </Link>
          </>
        }
      />

      {/* KPI */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4">
        {statCard(<Wallet className="w-4 h-4" />, "Saldo Kas Saat Ini", formatCurrency(currentBalance), `${formatCurrency(settings?.initial_cash_balance ?? 0)} saldo awal`, currentBalance < 0 ? "danger" : "primary")}
        {statCard(<TrendingUp className="w-4 h-4" />, `Pendapatan ${monthLabel(CURR_YEAR, CURR_MONTH)}`, formatCurrency(monthIncome), `${invoices.filter((i) => i.invoice_date.startsWith(monthKey)).length} invoice`, "success")}
        {statCard(<TrendingDown className="w-4 h-4" />, `Pengeluaran ${monthLabel(CURR_YEAR, CURR_MONTH)}`, formatCurrency(monthExpense), `${expenses.filter((e) => e.expense_date.startsWith(monthKey)).length} transaksi`, "danger")}
        {statCard(<PiggyBank className="w-4 h-4" />, "Total Piutang", formatCurrency(totalPiutang), `${piutangCount} invoice belum lunas`, totalPiutang > 0 ? "warning" : "success")}
      </div>

      {/* Grafik */}
      <div className="bg-card rounded-2xl border border-border shadow-sm p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
            <LineChartIcon className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Pendapatan vs Pengeluaran {CURR_YEAR}</h2>
            <p className="text-[11px] text-muted-foreground">Total per bulan (invoice date & expense date)</p>
          </div>
        </div>
        {loading ? (
          <div className="h-72 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={288}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval={1} />
              <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={70} />
              <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="pendapatan" name="Pendapatan" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="pengeluaran" name="Pengeluaran" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Piutang */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-warning" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Piutang Belum Lunas</h2>
              <p className="text-[11px] text-muted-foreground">{piutangCount} invoice menunggu pembayaran</p>
            </div>
            <Link href="/finance/pendapatan" className="ml-auto text-xs font-semibold text-primary hover:underline">
              Lihat semua
            </Link>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Memuat...</div>
            ) : piutangCount === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Tidak ada piutang. Semua invoice lunas.
              </div>
            ) : (
              invoices
                .filter((i) => i.total_amount > (i.paid ?? 0))
                .slice(0, 10)
                .map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{inv.invoice_no}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {inv.client ? (inv.client.company_name || inv.client.contact_name) : "—"} · {inv.invoice_date}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-foreground tabular-nums">
                        {formatCurrency(inv.total_amount - (inv.paid ?? 0))}
                      </p>
                      <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold", statusColor(inv.status || "Belum Lunas"))}>
                        {inv.status}
                      </span>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Transaksi terbaru */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-border">
            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
              <ReceiptText className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Transaksi Terbaru</h2>
              <p className="text-[11px] text-muted-foreground">Pembayaran & pengeluaran terakhir</p>
            </div>
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Memuat...</div>
            ) : recent.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Belum ada transaksi. Mulai dari halaman Pendapatan atau Pengeluaran.
              </div>
            ) : (
              recent.map((t, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                    t.isIn ? "bg-success-light text-success" : "bg-danger-light text-danger"
                  )}>
                    {t.isIn ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{t.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{t.detail} · {t.tanggal}</p>
                  </div>
                  <p className={cn("text-sm font-bold tabular-nums flex-shrink-0", t.isIn ? "text-success" : "text-danger")}>
                    {t.isIn ? "+" : "−"}{formatCurrency(t.amount)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className={cn(
          "fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white",
          toast.type === "success" ? "bg-success" : "bg-danger"
        )}>
          {toast.msg}
        </div>
      )}
    </RouteGuard>
  );
}
