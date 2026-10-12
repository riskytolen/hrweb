"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Lock, LockOpen, ChevronLeft, ChevronRight, History, Eye, FileDown,
  Wallet, TrendingUp, TrendingDown, PiggyBank, AlertTriangle, X, CheckCircle2,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Portal from "@/components/ui/Portal";
import RouteGuard from "@/components/RouteGuard";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { DbFinanceCompanySettings } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";
import { downloadCsv, monthLabel } from "@/lib/finance";
import {
  FINANCE_BOOKS_START_MONTH,
  computeClosingPreview,
  fetchMonthEvents,
  fetchMonthStatuses,
  isMonthEnded,
  monthEndOf,
  monthStartOf,
  nextMonthStart,
  parseFinanceDbError,
  prevMonthStart,
  type DbFinanceMonthEvent,
  type DbFinanceMonthStatus,
} from "@/lib/finance-closing";

interface Toast { id: number; type: "success" | "error"; msg: string }

export default function FinanceTutupBukuPage() {
  const { getPermissionLevel, isSuperAdmin } = useAuth();
  const permLevel = getPermissionLevel("finance");
  const canClose = permLevel === "edit";

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [settings, setSettings] = useState<DbFinanceCompanySettings | null>(null);
  const [invoices, setInvoices] = useState<{ id: number; invoice_no: string; invoice_date: string; due_date: string | null; total_amount: number; subtotal: number | null; ppn_amount: number | null; pph_amount: number | null; clientName: string | null }[]>([]);
  const [payments, setPayments] = useState<{ invoice_id: number; payment_date: string; amount: number }[]>([]);
  const [expenses, setExpenses] = useState<{ expense_date: string; amount: number }[]>([]);
  const [adjustments, setAdjustments] = useState<{ adjustment_date: string; type: "Masuk" | "Keluar"; amount: number }[]>([]);
  const [statuses, setStatuses] = useState<DbFinanceMonthStatus[]>([]);
  const [events, setEvents] = useState<DbFinanceMonthEvent[]>([]);

  const [showClose, setShowClose] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState("");
  const [viewEvent, setViewEvent] = useState<DbFinanceMonthEvent | null>(null);

  const addToast = useCallback((type: "success" | "error", msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const PAGE = 1000;
      async function fetchPaged(table: string, select: string) {
        const all: Record<string, unknown>[] = [];
        let offset = 0;
        for (;;) {
          const { data, error } = await (supabase.from(table as never).select(select) as unknown as {
            range(from: number, to: number): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
          }).range(offset, offset + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = data ?? [];
          all.push(...rows);
          if (rows.length < PAGE) break;
          offset += PAGE;
          if (offset > 20000) break;
        }
        return all;
      }
      const rpcClient = supabase as unknown as Parameters<typeof fetchMonthStatuses>[0];
      const [settingsRes, invRaw, payRaw, expRaw, adjRaw, st, ev] = await Promise.all([
        supabase.from("finance_company_settings").select("*").eq("id", 1).maybeSingle(),
        fetchPaged("finance_invoices", "id, invoice_no, invoice_date, due_date, total_amount, subtotal, ppn_amount, pph_amount, client:finance_clients(contact_name, company_name)"),
        fetchPaged("finance_invoice_payments", "invoice_id, payment_date, amount"),
        fetchPaged("finance_expenses", "expense_date, amount"),
        fetchPaged("finance_cash_adjustments", "adjustment_date, type, amount"),
        fetchMonthStatuses(rpcClient).catch(() => [] as DbFinanceMonthStatus[]),
        fetchMonthEvents(rpcClient).catch(() => [] as DbFinanceMonthEvent[]),
      ]);
      const sData = (settingsRes as { data: DbFinanceCompanySettings | null }).data;
      if (sData) setSettings(sData);
      setInvoices(
        (invRaw as unknown as { id: number; invoice_no: string; invoice_date: string; due_date: string | null; total_amount: number; subtotal: number | null; ppn_amount: number | null; pph_amount: number | null; client: { contact_name: string; company_name: string | null } | null }[]).map((r) => ({
          id: r.id,
          invoice_no: r.invoice_no,
          invoice_date: r.invoice_date,
          due_date: r.due_date,
          total_amount: Number(r.total_amount) || 0,
          subtotal: r.subtotal == null ? null : Number(r.subtotal),
          ppn_amount: r.ppn_amount == null ? null : Number(r.ppn_amount),
          pph_amount: r.pph_amount == null ? null : Number(r.pph_amount),
          clientName: r.client ? r.client.company_name || r.client.contact_name : null,
        })),
      );
      setPayments(
        (payRaw as unknown as { invoice_id: number; payment_date: string; amount: number }[]).map((p) => ({
          invoice_id: p.invoice_id,
          payment_date: p.payment_date,
          amount: Number(p.amount) || 0,
        })),
      );
      setExpenses(
        (expRaw as unknown as { expense_date: string; amount: number }[]).map((e) => ({
          expense_date: e.expense_date,
          amount: Number(e.amount) || 0,
        })),
      );
      setAdjustments(
        (adjRaw as unknown as { adjustment_date: string; type: "Masuk" | "Keluar"; amount: number }[]).map((a) => ({
          adjustment_date: a.adjustment_date,
          type: a.type,
          amount: Number(a.amount) || 0,
        })),
      );
      setStatuses(st);
      setEvents(ev);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Gagal memuat data tutup buku.");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    (async () => { await fetchAll(); })();
  }, [fetchAll]);

  const periodStart = useMemo(
    () => `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`,
    [viewYear, viewMonth],
  );
  const periodEnd = useMemo(() => monthEndOf(periodStart), [periodStart]);
  const todayStr = useMemo(() => localDateStr(), []);
  const booksStart = settings?.books_start_month || FINANCE_BOOKS_START_MONTH;
  const initialBalance = Number(settings?.initial_cash_balance) || 0;

  const statusRow = useMemo(
    () => statuses.find((s) => s.period_start === periodStart) ?? null,
    [statuses, periodStart],
  );
  const state: "open" | "closed" | "reopened" = !statusRow ? "open" : statusRow.state === "close" ? "closed" : "reopened";

  const prevStatus = useMemo(
    () => statuses.find((s) => s.period_start === prevMonthStart(periodStart)) ?? null,
    [statuses, periodStart],
  );

  const preview = useMemo(() => {
    const isFirst = periodStart === monthStartOf(booksStart);
    const openingPrev = isFirst
      ? null
      : prevStatus && prevStatus.state === "close"
        ? Number(prevStatus.ending_cash_balance) || 0
        : null;
    // Bila bulan sebelumnya belum closed dan bukan bulan pertama, preview tetap
    // dihitung dengan opening null agar UI dapat menampilkan peringatan urutan.
    return computeClosingPreview({
      periodStart,
      invoices,
      payments,
      expenses,
      adjustments,
      openingPrevBalance: isFirst ? null : openingPrev,
      initialCashBalance: initialBalance,
    });
  }, [periodStart, booksStart, prevStatus, invoices, payments, expenses, adjustments, initialBalance]);

  const expectedNext = useMemo(() => {
    if (statuses.length === 0) return monthStartOf(booksStart);
    const sorted = [...statuses].sort((a, b) => (a.period_start < b.period_start ? -1 : 1));
    const latest = sorted[sorted.length - 1];
    if (latest.state === "reopen") return latest.period_start;
    return nextMonthStart(latest.period_start);
  }, [statuses, booksStart]);

  const latestClosed = useMemo(() => {
    const closed = statuses.filter((s) => s.state === "close").sort((a, b) => (a.period_start < b.period_start ? -1 : 1));
    return closed.length ? closed[closed.length - 1].period_start : null;
  }, [statuses]);

  const ended = isMonthEnded(periodStart, todayStr);
  const isFirstMonth = periodStart === monthStartOf(booksStart);
  const prevClosed = isFirstMonth || (prevStatus?.state === "close");
  const canClosePeriod = canClose && state !== "closed" && ended && periodStart === expectedNext && prevClosed;
  const closeBlockedReason = !canClose
    ? "Butuh hak Finance penuh untuk tutup buku."
    : state === "closed"
      ? "Bulan ini sudah ditutup."
      : !ended
        ? `Bulan belum berakhir (berakhir ${periodEnd}).`
        : periodStart !== expectedNext
          ? `Tutup bulan ${expectedNext.slice(0, 7)} terlebih dulu agar berurutan.`
          : !prevClosed
            ? "Bulan sebelumnya belum ditutup."
            : "";
  const canReopenPeriod = isSuperAdmin && state === "closed" && latestClosed === periodStart;

  const periodEvents = useMemo(
    () => events.filter((e) => e.period_start === periodStart).sort((a, b) => a.event_seq - b.event_seq),
    [events, periodStart],
  );
  const activeClose = useMemo(
    () => (state === "closed" ? periodEvents.filter((e) => e.event_type === "close").slice(-1)[0] ?? null : null),
    [state, periodEvents],
  );

  const shiftMonth = (dir: 1 | -1) => {
    let m = viewMonth + dir;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const doClose = async () => {
    if (!closeConfirm) {
      setCloseError("Centang konfirmasi untuk melanjutkan tutup buku.");
      return;
    }
    setWorking(true);
    setCloseError("");
    try {
      const rpcClient = supabase as unknown as Parameters<typeof fetchMonthStatuses>[0];
      const { closeMonthRpc } = await import("@/lib/finance-closing");
      const row = await closeMonthRpc(rpcClient, periodStart);
      await logAudit({ supabase, action: "create", entityType: "finance_month_events", entityId: row.id, entityLabel: `Tutup buku ${periodStart.slice(0, 7)}`, newData: { period_start: row.period_start, source_hash: row.source_hash } }).catch(() => {});
      addToast("success", `Bulan ${periodStart.slice(0, 7)} berhasil ditutup.`);
      setShowClose(false);
      setCloseConfirm(false);
      await fetchAll();
    } catch (err) {
      setCloseError(parseFinanceDbError(err));
    } finally {
      setWorking(false);
    }
  };

  const doReopen = async () => {
    if (!reopenReason.trim()) {
      setReopenError("Alasan reopen wajib diisi.");
      return;
    }
    setWorking(true);
    setReopenError("");
    try {
      const rpcClient = supabase as unknown as Parameters<typeof fetchMonthStatuses>[0];
      const { reopenMonthRpc } = await import("@/lib/finance-closing");
      const row = await reopenMonthRpc(rpcClient, periodStart, reopenReason.trim());
      await logAudit({ supabase, action: "update", entityType: "finance_month_events", entityId: row.id, entityLabel: `Reopen ${periodStart.slice(0, 7)}`, metadata: { reason: reopenReason.trim() } }).catch(() => {});
      addToast("success", `Bulan ${periodStart.slice(0, 7)} dibuka kembali.`);
      setShowReopen(false);
      setReopenReason("");
      await fetchAll();
    } catch (err) {
      setReopenError(parseFinanceDbError(err));
    } finally {
      setWorking(false);
    }
  };

  const exportSnapshotCsv = () => {
    const src = activeClose;
    const totals = src
      ? {
        pendapatan: Number(src.revenue_total) || 0,
        pengeluaran: Number(src.expense_total) || 0,
        laba: Number(src.net_profit) || 0,
        kasMasuk: Number(src.cash_in) || 0,
        labaOnHand: Number(src.cash_on_hand_profit) || 0,
        saldoAwal: Number(src.opening_cash_balance) || 0,
        saldoAkhir: Number(src.ending_cash_balance) || 0,
        piutangAwal: Number(src.opening_receivable) || 0,
        piutangAkhir: Number(src.closing_receivable) || 0,
      }
      : {
        pendapatan: preview.revenue_total,
        pengeluaran: preview.expense_total,
        laba: preview.net_profit,
        kasMasuk: preview.cash_in,
        labaOnHand: preview.cash_on_hand_profit,
        saldoAwal: preview.opening_cash_balance,
        saldoAkhir: preview.ending_cash_balance,
        piutangAwal: preview.opening_receivable,
        piutangAkhir: preview.closing_receivable,
      };
    const snap = (src?.snapshot_data ?? {}) as Record<string, unknown>;
    const recList = (snap["receivables_as_of_end"] ?? []) as { invoice_no: string; invoice_date: string; due_date: string | null; total: number; paid: number; remaining: number; status_as_of_end: string }[];
    const rows: (string | number | null | undefined)[][] = [
      [`Tutup Buku — ${periodStart.slice(0, 7)}${src ? ` • Snapshot v${src.event_seq} • ${src.source_hash?.slice(0, 8)}` : " • Preview (belum closing)"}`],
      [],
      ["Pendapatan (total tagihan)", totals.pendapatan],
      ["Pengeluaran", totals.pengeluaran],
      ["Laba Bersih", totals.laba],
      ["Kas masuk (payment_date)", totals.kasMasuk],
      ["Laba On Hand (kas masuk − pengeluaran)", totals.labaOnHand],
      ["Saldo awal (setelah reset defisit)", totals.saldoAwal],
      ["Saldo akhir", totals.saldoAkhir],
      ["Piutang awal", totals.piutangAwal],
      ["Piutang akhir", totals.piutangAkhir],
      [],
      ["Piutang Per Closing (immutable)"],
      ["No", "Invoice", "Tanggal", "Jatuh Tempo", "Total", "Dibayar s.d. akhir", "Sisa", "Status"],
      ...(recList.length > 0
        ? recList.map((r, i) => [i + 1, r.invoice_no, r.invoice_date, r.due_date || "—", r.total, r.paid, r.remaining, r.status_as_of_end] as (string | number)[])
        : preview.receivables.map((r, i) => [i + 1, r.invoice_no, r.invoice_date, r.due_date || "—", r.total, r.paid, r.remaining, r.status] as (string | number)[])),
    ];
    downloadCsv(`tutup-buku-${periodStart.slice(0, 7)}.csv`, rows);
  };

  const stateBadge = state === "closed"
    ? "bg-success-light text-success"
    : state === "reopened"
      ? "bg-warning-light text-warning"
      : "bg-muted text-muted-foreground";

  return (
    <RouteGuard permission="finance">
      <PageHeader
        title="Tutup Buku"
        description="Closing bulanan immutable: laba, kas, dan piutang per akhir periode"
        icon={Lock}
        actions={
          <div className="flex items-center gap-2">
            <span className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold", stateBadge)}>
              {state === "closed" ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
              {state === "closed" ? `Ditutup${activeClose ? ` • v${activeClose.event_seq}` : ""}` : state === "reopened" ? "Dibuka Kembali" : "Terbuka"}
            </span>
            <button onClick={exportSnapshotCsv} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted">
              <FileDown className="w-4 h-4" /> CSV
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <button onClick={() => shiftMonth(-1)} className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-4 py-2 rounded-xl border border-border text-sm font-bold text-foreground min-w-[150px] text-center">
            {monthLabel(viewYear, viewMonth)}
          </span>
          <button onClick={() => shiftMonth(1)} className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">
          Periode {periodStart} – {periodEnd} • Bulan awal pembukuan {booksStart} • Berikutnya: {expectedNext.slice(0, 7)}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4 mb-4">
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Laba Bersih</p>
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center"><PiggyBank className="w-4 h-4 text-primary" /></div>
              </div>
              <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", preview.net_profit >= 0 ? "text-foreground" : "text-danger")}>{formatCurrency(preview.net_profit)}</p>
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">{formatCurrency(preview.revenue_total)} − {formatCurrency(preview.expense_total)}</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Laba On Hand</p>
                <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center"><Wallet className="w-4 h-4 text-success" /></div>
              </div>
              <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", preview.cash_on_hand_profit >= 0 ? "text-success" : "text-danger")}>{formatCurrency(preview.cash_on_hand_profit)}</p>
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">Kas {formatCurrency(preview.cash_in)} − {formatCurrency(preview.expense_total)}</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Saldo On Hand Akhir</p>
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center"><TrendingUp className="w-4 h-4 text-primary" /></div>
              </div>
              <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", preview.ending_cash_balance < 0 ? "text-danger" : "text-foreground")}>{formatCurrency(preview.ending_cash_balance)}</p>
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                Awal {formatCurrency(preview.opening_cash_balance)}
                {preview.deficit_reset > 0 && ` • Reset defisit ${formatCurrency(preview.deficit_reset)}`}
              </p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Piutang Akhir</p>
                <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center"><TrendingDown className="w-4 h-4 text-warning" /></div>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-warning mt-1.5 tabular-nums">{formatCurrency(preview.closing_receivable)}</p>
              <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">Awal {formatCurrency(preview.opening_receivable)} • {preview.receivables.length} invoice</p>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden mb-4">
            <div className="p-4 border-b border-border flex flex-wrap items-center gap-2">
              <div>
                <h2 className="text-sm font-bold text-foreground">Ringkasan {monthLabel(viewYear, viewMonth)}</h2>
                <p className="text-[11px] text-muted-foreground">
                  {preview.invoice_count} invoice • {preview.payment_count} pembayaran • {preview.expense_count} pengeluaran • {preview.adjustment_count} penyesuaian
                  {preview.opening_prev_balance !== null && preview.opening_prev_balance < 0 && ` • Saldo bulan lalu ${formatCurrency(preview.opening_prev_balance)} di-nol-kan`}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {canClosePeriod && (
                  <Button size="sm" onClick={() => { setCloseError(""); setCloseConfirm(false); setShowClose(true); }}>
                    <Lock className="w-3.5 h-3.5" /> Tutup Bulan
                  </Button>
                )}
                {canReopenPeriod && (
                  <Button size="sm" variant="outline" onClick={() => { setReopenError(""); setReopenReason(""); setShowReopen(true); }}>
                    <LockOpen className="w-3.5 h-3.5" /> Buka Kembali
                  </Button>
                )}
              </div>
            </div>
            <div className="divide-y divide-border/50 text-sm">
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Pendapatan (total tagihan, invoice_date)</span>
                <span className="font-bold text-success tabular-nums">{formatCurrency(preview.revenue_total)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Pengeluaran (expense_date)</span>
                <span className="font-bold text-danger tabular-nums">{formatCurrency(preview.expense_total)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Kas masuk (payment_date)</span>
                <span className="font-bold text-success tabular-nums">{formatCurrency(preview.cash_in)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Penyesuaian masuk / keluar</span>
                <span className="font-semibold tabular-nums">+{formatCurrency(preview.adjustment_in)} / −{formatCurrency(preview.adjustment_out)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-muted-foreground">Pajak: subtotal / PPN / PPh</span>
                <span className="font-semibold tabular-nums">{formatCurrency(preview.revenue_subtotal)} / {formatCurrency(preview.ppn_amount)} / {formatCurrency(preview.pph_amount)}</span>
              </div>
              {!canClosePeriod && closeBlockedReason && (
                <div className="flex items-start gap-2 px-5 py-3 text-xs text-muted-foreground bg-muted/30">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  {closeBlockedReason}
                  {state === "reopened" && " Reclose akan membuat versi snapshot baru tanpa menghapus histori."}
                </div>
              )}
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center"><History className="w-4 h-4 text-muted-foreground" /></div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Riwayat Closing</h2>
                <p className="text-[11px] text-muted-foreground">Append-only: reopen tidak menghapus snapshot lama</p>
              </div>
            </div>
            {events.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground text-center">Belum ada closing. Bulan pertama yang harus ditutup: {monthStartOf(booksStart).slice(0, 7)}.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Bulan</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Event</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Saldo Akhir</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Piutang</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Aktor</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...events].sort((a, b) => (a.period_start < b.period_start ? 1 : a.period_start > b.period_start ? -1 : b.event_seq - a.event_seq)).slice(0, 30).map((e) => (
                      <tr key={e.id} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2.5 font-semibold">{e.period_start.slice(0, 7)} <span className="text-[11px] text-muted-foreground font-normal">v{e.event_seq}</span></td>
                        <td className="px-4 py-2.5">
                          <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold", e.event_type === "close" ? "bg-success-light text-success" : "bg-warning-light text-warning")}>
                            {e.event_type === "close" ? "Closed" : "Reopened"}
                          </span>
                          {e.event_type === "reopen" && e.reason && <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[260px] truncate" title={e.reason}>{e.reason}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{e.ending_cash_balance == null ? "—" : formatCurrency(Number(e.ending_cash_balance))}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{e.closing_receivable == null ? "—" : formatCurrency(Number(e.closing_receivable))}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.actor_name || e.actor_email || "—"}</td>
                        <td className="px-4 py-2.5 text-right">
                          {e.event_type === "close" && (
                            <button onClick={() => setViewEvent(e)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border hover:bg-muted">
                              <Eye className="w-3.5 h-3.5" /> Snapshot
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showClose && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !working && setShowClose(false)} />
            <div className="relative w-full max-w-lg bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden">
              <div className="px-6 pt-6 pb-4">
                <h2 className="text-base font-bold text-foreground">Tutup Bulan {periodStart.slice(0, 7)}?</h2>
                <p className="text-xs text-muted-foreground mt-1">Snapshot immutable. Transaksi bertanggal {periodStart} – {periodEnd} akan dikunci.</p>
              </div>
              <div className="px-6 pb-4 text-sm space-y-2">
                {closeError && <div className="p-3 rounded-xl bg-danger-light text-danger text-xs font-medium">{closeError}</div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Laba Bersih</span><b className="tabular-nums">{formatCurrency(preview.net_profit)}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Laba On Hand</span><b className="tabular-nums">{formatCurrency(preview.cash_on_hand_profit)}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Saldo awal → akhir</span><b className="tabular-nums">{formatCurrency(preview.opening_cash_balance)} → {formatCurrency(preview.ending_cash_balance)}</b></div>
                {preview.deficit_reset > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Reset defisit pembukaan</span><b className="tabular-nums">{formatCurrency(preview.deficit_reset)}</b></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Piutang awal → akhir</span><b className="tabular-nums">{formatCurrency(preview.opening_receivable)} → {formatCurrency(preview.closing_receivable)}</b></div>
                <label className="flex items-start gap-2 pt-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={closeConfirm} onChange={(e) => setCloseConfirm(e.target.checked)} className="mt-0.5" />
                  Saya memahami angka bulan ini dibekukan dan transaksi bertanggal periode tersebut akan ditolak database.
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20">
                <Button variant="outline" size="sm" onClick={() => setShowClose(false)} disabled={working}>Batal</Button>
                <Button size="sm" onClick={doClose} disabled={working || !closeConfirm}>{working ? "Menutup..." : "Tutup Bulan"}</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {showReopen && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !working && setShowReopen(false)} />
            <div className="relative w-full max-w-md bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden">
              <div className="px-6 pt-6 pb-4">
                <h2 className="text-base font-bold text-foreground">Buka Kembali {periodStart.slice(0, 7)}?</h2>
                <p className="text-xs text-muted-foreground mt-1">Hanya Super Admin. Snapshot lama tetap tersimpan; reclose membuat versi baru.</p>
              </div>
              <div className="px-6 pb-4 space-y-3">
                {reopenError && <div className="p-3 rounded-xl bg-danger-light text-danger text-xs font-medium">{reopenError}</div>}
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1.5 block">Alasan <span className="text-danger">*</span></label>
                  <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={3} placeholder="Mis. koreksi tanggal pembayaran yang salah input" className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary text-foreground" />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20">
                <Button variant="outline" size="sm" onClick={() => setShowReopen(false)} disabled={working}>Batal</Button>
                <Button size="sm" variant="danger" onClick={doReopen} disabled={working || !reopenReason.trim()}>{working ? "Membuka..." : "Buka Kembali"}</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {viewEvent && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewEvent(null)} />
            <div className="relative w-full max-w-2xl bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="px-6 pt-6 pb-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center"><CheckCircle2 className="w-5 h-5 text-success" /></div>
                <div className="flex-1">
                  <h2 className="text-base font-bold text-foreground">Snapshot {viewEvent.period_start.slice(0, 7)} • v{viewEvent.event_seq}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ditutup {new Date(viewEvent.created_at).toLocaleString("id-ID")} • {viewEvent.actor_name || viewEvent.actor_email || "—"} • Hash {viewEvent.source_hash?.slice(0, 12)}
                  </p>
                </div>
                <button onClick={() => setViewEvent(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="px-6 pb-6 overflow-y-auto text-sm space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {[["Pendapatan", viewEvent.revenue_total], ["Pengeluaran", viewEvent.expense_total], ["Laba Bersih", viewEvent.net_profit], ["Laba On Hand", viewEvent.cash_on_hand_profit], ["Saldo Awal", viewEvent.opening_cash_balance], ["Saldo Akhir", viewEvent.ending_cash_balance], ["Piutang Awal", viewEvent.opening_receivable], ["Piutang Akhir", viewEvent.closing_receivable]].map(([label, v]) => (
                    <div key={label as string} className="p-3 rounded-xl bg-muted/40 border border-border/50">
                      <p className="text-[11px] text-muted-foreground">{label}</p>
                      <p className="font-bold tabular-nums">{formatCurrency(Number(v) || 0)}</p>
                    </div>
                  ))}
                </div>
                {viewEvent.deficit_reset != null && Number(viewEvent.deficit_reset) > 0 && (
                  <p className="text-xs text-muted-foreground">Reset defisit pembukaan: {formatCurrency(Number(viewEvent.deficit_reset))} (tidak dihitung sebagai pendapatan/laba).</p>
                )}
                <p className="text-[11px] text-muted-foreground">Piutang per closing bersifat immutable. Status terkini invoice dapat berbeda setelah pembayaran bulan berikutnya.</p>
              </div>
            </div>
          </div>
        </Portal>
      )}

      <div className="fixed bottom-4 right-4 z-[60] space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn("px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white", t.type === "success" ? "bg-success" : "bg-danger")}>
            {t.msg}
          </div>
        ))}
      </div>
    </RouteGuard>
  );
}
