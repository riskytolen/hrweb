"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PieChart, FileDown, TrendingUp, TrendingDown, PiggyBank, Percent, ChevronLeft, ChevronRight, Scale } from "lucide-react";
import {
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import PageHeader from "@/components/ui/PageHeader";
import RouteGuard from "@/components/RouteGuard";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { downloadCsv, monthLabel } from "@/lib/finance";

interface CategoryAgg { name: string; color: string; total: number }

export default function FinanceLabaRugiPage() {
  const [loading, setLoading] = useState(true);
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState<number | null>(new Date().getMonth());
  const [invoices, setInvoices] = useState<{ invoice_date: string; total_amount: number }[]>([]);
  const [expenses, setExpenses] = useState<{ expense_date: string; amount: number; category: { name: string; color: string } | null }[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: invData }, { data: expData }] = await Promise.all([
        supabase.from("finance_invoices").select("invoice_date, total_amount"),
        supabase.from("finance_expenses").select("expense_date, amount, category:finance_expense_categories(name, color)"),
      ]);
      if (invData) setInvoices(invData as typeof invoices);
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
          <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4 mb-4">
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
                <p className="text-xs font-semibold text-muted-foreground">Margin Laba</p>
                <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center"><Percent className="w-4 h-4 text-warning" /></div>
              </div>
              <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", period.laba >= 0 ? "text-foreground" : "text-danger")}>
                {period.margin.toFixed(1)}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Laba ÷ Pendapatan</p>
            </div>
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
