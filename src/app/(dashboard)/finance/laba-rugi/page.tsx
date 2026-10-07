"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { PieChart, FileDown, TrendingUp, TrendingDown, PiggyBank, Percent, ChevronLeft, ChevronRight, Scale, Wallet } from "lucide-react";
import {
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import PageHeader from "@/components/ui/PageHeader";
import RouteGuard from "@/components/RouteGuard";
import { cn, formatCurrency, formatNumber, localDateStr } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { downloadCsv, monthLabel, periodEndDate, periodStartDate, receivableReferenceDate, summarizeCashOnHand, summarizeReceivables } from "@/lib/finance";

interface CategoryAgg { name: string; color: string; total: number }

interface LabaRugiInvoice {
  id: number;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number;
  client?: { contact_name: string; company_name: string | null } | null;
}

interface LabaRugiPayment { invoice_id: number; payment_date: string; amount: number }

export default function FinanceLabaRugiPage() {
  const [loading, setLoading] = useState(true);
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState<number | null>(new Date().getMonth());
  const [invoices, setInvoices] = useState<LabaRugiInvoice[]>([]);
  const [payments, setPayments] = useState<LabaRugiPayment[]>([]);
  const [expenses, setExpenses] = useState<{ expense_date: string; amount: number; category: { name: string; color: string } | null }[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: invData }, { data: payData }, { data: expData }] = await Promise.all([
        supabase.from("finance_invoices").select("id, invoice_no, invoice_date, due_date, total_amount, client:finance_clients(contact_name, company_name)"),
        supabase.from("finance_invoice_payments").select("invoice_id, payment_date, amount"),
        supabase.from("finance_expenses").select("expense_date, amount, category:finance_expense_categories(name, color)"),
      ]);
      if (invData) setInvoices(invData as unknown as LabaRugiInvoice[]);
      if (payData) setPayments(payData as unknown as LabaRugiPayment[]);
      if (expData) setExpenses(expData as unknown as typeof expenses);
    } catch {
      setToast({ type: "error", msg: "Gagal memuat data laba rugi." });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => { await fetchAll(); })();
  }, [fetchAll]);

  const yearData = useMemo(() => {
    const map = new Map<string, { pendapatan: number; pengeluaran: number }>();
    for (let m = 0; m < 12; m++) map.set(monthLabel(viewYear, m), { pendapatan: 0, pengeluaran: 0 });
    invoices.forEach((inv) => {
      const d = new Date(inv.invoice_date + "T00:00:00");
      if (d.getFullYear() === viewYear) {
        const key = monthLabel(viewYear, d.getMonth());
        const cur = map.get(key)!;
        cur.pendapatan += inv.total_amount;
        map.set(key, cur);
      }
    });
    expenses.forEach((e) => {
      const d = new Date(e.expense_date + "T00:00:00");
      if (d.getFullYear() === viewYear) {
        const key = monthLabel(viewYear, d.getMonth());
        const cur = map.get(key)!;
        cur.pengeluaran += e.amount;
        map.set(key, cur);
      }
    });
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
  }, [invoices, expenses, viewYear]);

  const period = useMemo(() => {
    const prefix = viewMonth === null ? String(viewYear) : `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
    const pInvoices = invoices.filter((i) => i.invoice_date.startsWith(prefix));
    const pExpenses = expenses.filter((e) => e.expense_date.startsWith(prefix));
    const pendapatan = pInvoices.reduce((s, i) => s + i.total_amount, 0);
    const pengeluaran = pExpenses.reduce((s, e) => s + e.amount, 0);
    const laba = pendapatan - pengeluaran;
    const margin = pendapatan > 0 ? (laba / pendapatan) * 100 : 0;

    const byCat = new Map<string, CategoryAgg>();
    pExpenses.forEach((e) => {
      const name = e.category?.name || "Tanpa Kategori";
      const color = e.category?.color || "#64748b";
      const cur = byCat.get(name) || { name, color, total: 0 };
      cur.total += e.amount;
      byCat.set(name, cur);
    });
    const categories = Array.from(byCat.values()).sort((a, b) => b.total - a.total);
    const topExpense = categories[0]?.total || 0;
    const expenseShare = pengeluaran > 0 ? categories.map((c) => ({ ...c, pct: (c.total / pengeluaran) * 100 })) : [];

    return { prefix, pendapatan, pengeluaran, laba, margin, categories, topExpense, expenseShare, countInv: pInvoices.length, countExp: pExpenses.length };
  }, [invoices, expenses, viewYear, viewMonth]);

  // Piutang murni per periode terpilih: hanya invoice yang terbit dalam periode
  // dikurangi pembayaran yang diterima dalam periode yang sama. Tanpa membawa
  // saldo bulan sebelumnya. Keterlambatan memakai akhir periode untuk periode
  // lampau dan hari ini untuk periode berjalan.
  const periodStart = useMemo(() => periodStartDate(viewYear, viewMonth), [viewYear, viewMonth]);
  const periodEnd = useMemo(() => periodEndDate(viewYear, viewMonth), [viewYear, viewMonth]);
  const cashOnHand = useMemo(
    () => summarizeCashOnHand(payments, expenses, periodStart, periodEnd),
    [payments, expenses, periodStart, periodEnd]
  );
  const receivables = useMemo(() => summarizeReceivables(
    invoices.map((i) => ({
      id: i.id,
      invoice_no: i.invoice_no,
      invoice_date: i.invoice_date,
      due_date: i.due_date,
      total_amount: i.total_amount,
      clientName: i.client ? (i.client.company_name || i.client.contact_name) : null,
    })),
    payments,
    periodStart,
    periodEnd,
    receivableReferenceDate(localDateStr(), periodEnd),
  ), [invoices, payments, periodStart, periodEnd]);

  const periodLabel = viewMonth === null
    ? `Tahun ${viewYear}`
    : `${monthLabel(viewYear, viewMonth)}`;

  const prevPeriod = useMemo(() => {
    let prevYear = viewYear;
    let prevMonth: number | null = viewMonth;
    if (viewMonth === null) {
      prevYear = viewYear - 1;
      prevMonth = null;
    } else if (viewMonth === 0) {
      prevYear = viewYear - 1;
      prevMonth = 11;
    } else {
      prevMonth = viewMonth - 1;
    }
    const prefix = prevMonth === null ? String(prevYear) : `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}`;
    const pendapatan = invoices.filter((i) => i.invoice_date.startsWith(prefix)).reduce((s, i) => s + i.total_amount, 0);
    const pengeluaran = expenses.filter((e) => e.expense_date.startsWith(prefix)).reduce((s, e) => s + e.amount, 0);
    return { pendapatan, pengeluaran, laba: pendapatan - pengeluaran };
  }, [invoices, expenses, viewYear, viewMonth]);

  const shiftPeriod = (dir: 1 | -1) => {
    if (viewMonth === null) {
      setViewYear(viewYear + dir);
      return;
    }
    let m = viewMonth + dir;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const exportCsv = () => {
    const rows: (string | number | null | undefined)[][] = [
      [`Laporan Laba Rugi — ${periodLabel}`],
      [],
      ["Pendapatan (invoice date)", formatCurrency(period.pendapatan)],
      ["Pengeluaran (expense date)", formatCurrency(period.pengeluaran)],
      ["Laba Bersih", formatCurrency(period.laba)],
      ["Margin Laba", `${period.margin.toFixed(2)}%`],
      [],
      ["Laba On Hand (berbasis kas)"],
      ["Pembayaran benar-benar diterima", formatCurrency(cashOnHand.received)],
      ["Pengeluaran periode", formatCurrency(cashOnHand.expenses)],
      ["Laba On Hand", formatCurrency(cashOnHand.profit)],
      ["Margin On Hand", `${cashOnHand.margin.toFixed(2)}%`],
      [],
      [`Piutang periode ${periodLabel} (tanpa saldo bulan sebelumnya)`],
      ["Invoice periode ini", formatCurrency(receivables.totalInvoiced)],
      ["Diterima periode ini", formatCurrency(receivables.totalPaid)],
      ["Piutang periode ini", formatCurrency(receivables.totalReceivable)],
      ["Invoice belum lunas", receivables.unpaidCount],
      ["Piutang jatuh tempo", `${receivables.overdueCount} invoice • ${formatCurrency(receivables.overdueAmount)}`],
      [],
      ["Rincian Piutang Belum Lunas"],
      ["No", "No. Invoice", "Klien", "Jatuh Tempo", "Total", "Dibayar", "Sisa", "Status"],
      ...receivables.items.map((r, idx) => [idx + 1, r.invoice_no, r.clientName, r.due_date || "—", r.total, r.paid, r.remaining, r.bucket]),
      [],
      ["Pengeluaran per Kategori"],
      ["Kategori", "Nominal", "Persentase"],
      ...period.expenseShare.map((c) => [c.name, c.total, `${c.pct.toFixed(2)}%`]),
      [],
      ["Rincian Pendapatan"],
      ["No", "Tanggal", "Nominal"],
      ...invoices.filter((i) => i.invoice_date.startsWith(period.prefix)).map((i, idx) => [idx + 1, i.invoice_date, i.total_amount]),
    ];
    downloadCsv(`laba-rugi-${period.prefix}.csv`, rows);
  };

  const profitTone = period.laba >= 0 ? "success" : "danger";
  const cashProfitTone = cashOnHand.profit >= 0 ? "success" : "danger";
  const deltaIncome = prevPeriod.pendapatan > 0 ? ((period.pendapatan - prevPeriod.pendapatan) / prevPeriod.pendapatan) * 100 : 0;
  const deltaExpense = prevPeriod.pengeluaran > 0 ? ((period.pengeluaran - prevPeriod.pengeluaran) / prevPeriod.pengeluaran) * 100 : 0;

  return (
    <RouteGuard permission="finance">
      <PageHeader
        title="Laba Rugi"
        description="Perbandingan pendapatan dan pengeluaran"
        icon={PieChart}
        actions={
          <button onClick={exportCsv} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted">
            <FileDown className="w-4 h-4" />
            Export CSV
          </button>
        }
      />

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl">
          {["Tahunan", "Bulanan"].map((mode, i) => (
            <button
              key={mode}
              onClick={() => { if (i === 0) setViewMonth(null); else setViewMonth(new Date().getMonth()); }}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                (i === 0 && viewMonth === null) || (i === 1 && viewMonth !== null) ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => shiftPeriod(-1)} className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-4 py-2 rounded-xl border border-border text-sm font-bold text-foreground min-w-[130px] text-center">
            {periodLabel}
          </span>
          <button onClick={() => shiftPeriod(1)} className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => { setViewYear(new Date().getFullYear()); setViewMonth(new Date().getMonth()); }} className="px-3 py-2 rounded-xl text-xs font-semibold text-primary hover:bg-primary/5">
            Hari ini
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-5 mb-4">
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Pendapatan</p>
                <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center"><TrendingUp className="w-4 h-4 text-success" /></div>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-success mt-1.5 tabular-nums">{formatCurrency(period.pendapatan)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {period.countInv} invoice
                {prevPeriod.pendapatan > 0 && (
                  <span className={cn("ml-1.5 font-semibold", deltaIncome >= 0 ? "text-success" : "text-danger")}>
                    {deltaIncome >= 0 ? "▲" : "▼"} {Math.abs(deltaIncome).toFixed(1)}%
                  </span>
                )}
              </p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Pengeluaran</p>
                <div className="w-8 h-8 rounded-lg bg-danger-light flex items-center justify-center"><TrendingDown className="w-4 h-4 text-danger" /></div>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-danger mt-1.5 tabular-nums">{formatCurrency(period.pengeluaran)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {period.countExp} transaksi
                {prevPeriod.pengeluaran > 0 && (
                  <span className={cn("ml-1.5 font-semibold", deltaExpense <= 0 ? "text-success" : "text-danger")}>
                    {deltaExpense >= 0 ? "▲" : "▼"} {Math.abs(deltaExpense).toFixed(1)}%
                  </span>
                )}
              </p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Laba Bersih</p>
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center"><PiggyBank className="w-4 h-4 text-primary" /></div>
              </div>
              <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", period.laba >= 0 ? "text-foreground" : "text-danger")}>
                {formatCurrency(period.laba)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Pendapatan − Pengeluaran</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Laba On Hand</p>
                <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center"><Wallet className="w-4 h-4 text-success" /></div>
              </div>
              <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", cashOnHand.profit >= 0 ? "text-success" : "text-danger")}>
                {formatCurrency(cashOnHand.profit)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Diterima − Pengeluaran</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Margin Laba</p>
                <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center"><Percent className="w-4 h-4 text-warning" /></div>
              </div>
              <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", period.laba >= 0 ? "text-foreground" : "text-danger")}>
                {period.margin.toFixed(1)}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Laba ÷ Pendapatan</p>
            </div>
          </div>

          {/* Ringkasan Piutang — murni periode terpilih, tanpa saldo bulan sebelumnya */}
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-4">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center">
                <Wallet className="w-4 h-4 text-warning" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Ringkasan Piutang</h2>
                <p className="text-[11px] text-muted-foreground">Invoice terbit {periodLabel} • tanpa saldo bulan sebelumnya</p>
              </div>
              <Link href="/finance/pendapatan" className="ml-auto text-xs font-semibold text-primary hover:underline">
                Lihat semua
              </Link>
            </div>
            <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4 p-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Invoice periode ini</p>
                <p className="text-lg font-bold text-foreground mt-1 tabular-nums">{formatCurrency(receivables.totalInvoiced)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Diterima periode ini</p>
                <p className="text-lg font-bold text-success mt-1 tabular-nums">{formatCurrency(receivables.totalPaid)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Piutang periode ini</p>
                <p className="text-lg font-bold text-warning mt-1 tabular-nums">{formatCurrency(receivables.totalReceivable)}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{receivables.unpaidCount} invoice belum lunas</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Jatuh tempo</p>
                <p className="text-lg font-bold text-danger mt-1 tabular-nums">{formatCurrency(receivables.overdueAmount)}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{receivables.overdueCount} invoice terlambat</p>
              </div>
            </div>
            {receivables.items.length > 0 && (
              <div className="overflow-x-auto border-t border-border/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Invoice</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Jatuh Tempo</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Sisa</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receivables.items.slice(0, 8).map((r) => (
                      <tr key={r.id} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-foreground">{r.invoice_no}</p>
                          <p className="text-[11px] text-muted-foreground truncate max-w-[220px]">{r.clientName}</p>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                          {r.due_date || "—"}
                          {r.overdueDays > 0 && <span className="text-danger font-semibold"> • {r.overdueDays} hari</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-warning tabular-nums">{formatCurrency(r.remaining)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold",
                            r.overdueDays > 0 ? "bg-danger-light text-danger" : "bg-warning-light text-warning"
                          )}>
                            {r.bucket}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {receivables.items.length > 8 && (
                  <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border/50">
                    Menampilkan 8 dari {receivables.items.length} invoice belum lunas — rincian lengkap dan pencatatan pembayaran ada di halaman Pendapatan.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Pie pengeluaran per kategori */}
            <div className="bg-card rounded-2xl border border-border shadow-sm p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-danger-light flex items-center justify-center"><PieChart className="w-4 h-4 text-danger" /></div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Pengeluaran per Kategori</h2>
                  <p className="text-[11px] text-muted-foreground">{periodLabel}</p>
                </div>
              </div>
              {period.categories.length === 0 ? (
                <div className="text-center py-16 text-sm text-muted-foreground">Tidak ada pengeluaran pada periode ini.</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <RePieChart>
                      <Pie data={period.categories} dataKey="total" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2} strokeWidth={0}>
                        {period.categories.map((c) => <Cell key={c.name} fill={c.color} />)}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </RePieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {period.expenseShare.slice(0, 6).map((c) => (
                      <div key={c.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                        <span className="text-foreground font-medium truncate">{c.name}</span>
                        <span className="text-muted-foreground ml-auto tabular-nums">{formatCurrency(c.total)}</span>
                        <span className="text-muted-foreground w-12 text-right tabular-nums">{c.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Grafik tahunan */}
            <div className="bg-card rounded-2xl border border-border shadow-sm p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center"><Scale className="w-4 h-4 text-primary" /></div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Tren {viewYear}</h2>
                  <p className="text-[11px] text-muted-foreground">Pendapatan vs pengeluaran per bulan</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={yearData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval={1} />
                  <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={64} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="pendapatan" name="Pendapatan" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="pengeluaran" name="Pengeluaran" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ringkasan */}
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Ringkasan {periodLabel}</h2>
            </div>
            <div className="divide-y divide-border/50">
              <div className="flex items-center justify-between px-5 py-3.5 text-sm">
                <span className="text-muted-foreground flex items-center gap-2"><TrendingUp className="w-4 h-4 text-success" /> Pendapatan</span>
                <span className="font-bold text-success tabular-nums">{formatCurrency(period.pendapatan)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5 text-sm">
                <span className="text-muted-foreground flex items-center gap-2"><TrendingDown className="w-4 h-4 text-danger" /> Pengeluaran</span>
                <span className="font-bold text-danger tabular-nums">{formatCurrency(period.pengeluaran)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5 text-sm">
                <span className="text-muted-foreground flex items-center gap-2"><Wallet className="w-4 h-4 text-success" /> Pembayaran diterima (on hand)</span>
                <span className="font-bold text-success tabular-nums">{formatCurrency(cashOnHand.received)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5 text-sm">
                <span className="text-muted-foreground flex items-center gap-2"><Wallet className="w-4 h-4 text-warning" /> Piutang periode ini (belum menjadi kas)</span>
                <span className="font-bold text-warning tabular-nums">{formatCurrency(receivables.totalReceivable)}</span>
              </div>
              <div className={cn("flex items-center justify-between px-5 py-4 text-sm font-bold", cashProfitTone === "success" ? "bg-success/[0.04]" : "bg-danger/[0.04]")}>
                <span className={cn("flex items-center gap-2", cashProfitTone === "success" ? "text-success" : "text-danger")}>
                  <Wallet className="w-4 h-4" /> Laba On Hand
                </span>
                <span className={cn("tabular-nums text-base", cashProfitTone === "success" ? "text-success" : "text-danger")}>
                  {formatCurrency(cashOnHand.profit)}
                </span>
              </div>
              <div className={cn("flex items-center justify-between px-5 py-4 text-sm font-bold", profitTone === "success" ? "bg-success/[0.04]" : "bg-danger/[0.04]")}>
                <span className={cn("flex items-center gap-2", profitTone === "success" ? "text-success" : "text-danger")}>
                  <PiggyBank className="w-4 h-4" /> Laba Bersih
                </span>
                <span className={cn("tabular-nums text-base", profitTone === "success" ? "text-success" : "text-danger")}>
                  {formatCurrency(period.laba)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white bg-danger">
          {toast.msg}
        </div>
      )}
    </RouteGuard>
  );
}
