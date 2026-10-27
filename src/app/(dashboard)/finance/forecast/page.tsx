"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange, Plus, Trash2, Save, FileDown, ChevronDown, ChevronLeft, ChevronRight,
  Search, Loader2, CheckCircle2, Maximize2, Minimize2, ReceiptText, X, RefreshCw, Info, Wallet, Tag,
  Link2, AlertTriangle, Copy,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import RouteGuard from "@/components/RouteGuard";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { useAuth } from "@/components/AuthProvider";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type {
  DbFinanceCompanySettings,
  DbFinanceForecastCategory,
  DbFinanceForecastExpense,
  DbFinanceForecastIncome,
  DbFinanceForecastMonth,
} from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { fmtDate } from "@/lib/finance";
import { parseFinanceDbError } from "@/lib/finance-closing";
import {
  buildForecastWeeks,
  chooseDefaultForecastOpening,
  clampDateToWeek,
  computeForecast,
  computeForecastExpenseCategoryTotals,
  FORECAST_EXPENSE_CATEGORIES,
  FORECAST_OPENING_SOURCE_LABELS,
  forecastCopyFingerprint,
  forecastMonthLabel,
  forecastMonthStart,
  mapForecastDateToMonth,
  normalizeForecastExpenseCategory,
  normalizeForecastOpeningSource,
  renameForecastSnapshotCategory,
  savedForecastClosing,
  shiftForecastPeriodKey,
  validateForecastDraft,
  weekNoForDate,
  type ForecastExpenseCategoryTotal,
  type ForecastOpeningSource,
  type ForecastSummary,
  type ForecastWeek,
  type ForecastWeekNo,
} from "@/lib/finance-forecast";
import { exportForecastPdf, exportForecastXlsx } from "@/lib/finance-forecast-export";
import ForecastEntryModal, {
  type ForecastEntryMode,
  type ForecastEntryValues,
} from "./components/forecast-entry-modal";
import ForecastCategorySettingsModal from "./components/forecast-category-settings-modal";
import ForecastCopyPreviousModal, {
  type ForecastCopyExpenseCandidate,
  type ForecastCopyIncomeCandidate,
  type ForecastCopySelection,
} from "./components/forecast-copy-previous-modal";
import ForecastInvoiceContent from "./components/forecast-invoice-content";

interface Toast { id: number; type: "success" | "error"; msg: string }

interface DraftIncome {
  key: string;
  weekNo: ForecastWeekNo;
  plannedDate: string;
  description: string;
  amount: number;
  invoiceId: number | null;
}

interface DraftExpense {
  key: string;
  weekNo: ForecastWeekNo;
  plannedDate: string;
  description: string;
  amount: number;
  payment: number;
  admin: number;
  category: string;
}

interface InvoiceQueryRow {
  id: number;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number;
  subtotal: number;
  description: string | null;
  toll_amount: number | null;
  parking_amount: number | null;
  other_amount: number | null;
  pph_amount: number | null;
  notes: string | null;
  client?: { contact_name: string; company_name: string | null } | null;
}

interface InvoiceOption {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string | null;
  totalAmount: number;
  subtotal: number;
  description: string | null;
  tollAmount: number;
  parkingAmount: number;
  otherAmount: number;
  pphAmount: number;
  notes: string | null;
  paidAmount: number;
  remaining: number;
  clientName: string;
  clientCompany: string;
}

interface OpeningSourceInfo {
  available: boolean;
  value: number | null;
  detail: string;
}

interface OpeningSourcesState {
  previousForecast: OpeningSourceInfo;
}

interface PreviousForecastSource {
  label: string;
  incomes: DbFinanceForecastIncome[];
  expenses: DbFinanceForecastExpense[];
}

async function fetchForecastMonthRows(monthId: number) {
  const [incRes, expRes] = await Promise.all([
    supabase
      .from("finance_forecast_incomes")
      .select("*")
      .eq("month_id", monthId)
      .order("week_no", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("finance_forecast_expenses")
      .select("*")
      .eq("month_id", monthId)
      .order("week_no", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (incRes.error) throw incRes.error;
  if (expRes.error) throw expRes.error;
  return {
    incomes: (incRes.data ?? []) as DbFinanceForecastIncome[],
    expenses: (expRes.data ?? []) as DbFinanceForecastExpense[],
  };
}

function openingSourceUsable(info: OpeningSourceInfo): boolean {
  return info.available && info.value != null && info.value >= 0;
}

function openingSourceOptionLabel(info: OpeningSourceInfo): string {
  if (!info.available || info.value == null) return "Belum ada data";
  if (info.value < 0) return `Defisit ${formatCurrency(info.value)}`;
  return formatCurrency(info.value);
}

function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function draftSnapshot(
  openingBalance: number,
  openingSource: ForecastOpeningSource,
  incomes: DraftIncome[],
  expenses: DraftExpense[],
): string {
  return JSON.stringify({
    openingBalance,
    openingSource,
    incomes: incomes.map((r) => ({
      weekNo: r.weekNo,
      plannedDate: r.plannedDate,
      description: r.description,
      amount: r.amount,
      invoiceId: r.invoiceId,
    })),
    expenses: expenses.map((r) => ({
      weekNo: r.weekNo,
      plannedDate: r.plannedDate,
      description: r.description,
      amount: r.amount,
      payment: r.payment,
      admin: r.admin,
      category: r.category,
    })),
  });
}

const toneClass = {
  default: "text-foreground",
  success: "text-success",
  danger: "text-danger",
  primary: "text-primary",
  warning: "text-warning",
} as const;

function StatCell({
  label,
  value,
  tone = "default",
  strong = false,
  hint,
}: {
  label: string;
  value: string;
  tone?: keyof typeof toneClass;
  strong?: boolean;
  hint?: string;
}) {
  return (
    <div className="bg-card px-2 py-2 sm:px-3">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular-nums mt-0.5",
          strong ? "text-[10px] sm:text-sm font-extrabold" : "text-[10px] sm:text-xs font-bold",
          toneClass[tone],
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="text-[8px] sm:text-[9px] leading-tight text-muted-foreground mt-0.5">{hint}</p>
      )}
    </div>
  );
}

function IncomePanel({
  week,
  rows,
  canInput,
  invoiceById,
  onAdd,
  onAddInvoice,
  onChange,
  onRemove,
}: {
  week: ForecastWeek;
  rows: DraftIncome[];
  canInput: boolean;
  invoiceById: Map<number, InvoiceOption>;
  onAdd: () => void;
  onAddInvoice: () => void;
  onChange: (key: string, patch: Partial<DraftIncome>) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-success-light/50 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          <p className="text-[10px] font-bold tracking-wider uppercase text-success">Pemasukan</p>
          <span className="text-[10px] text-muted-foreground">({rows.length})</span>
        </div>
        {canInput && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAddInvoice}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:bg-primary-light px-2 py-1 rounded-lg transition-colors"
              title="Ambil sisa tagihan invoice"
            >
              <ReceiptText className="w-3 h-3" />
              Invoice
            </button>
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-success hover:bg-success-light px-2 py-1 rounded-lg transition-colors"
            >
              <Plus className="w-3 h-3" />
              Tambah
            </button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto flex-1">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="bg-muted/30 text-[9px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left font-semibold px-3 py-1.5">Keterangan</th>
              <th className="text-left font-semibold px-2 py-1.5 w-[120px]">Tanggal</th>
              <th className="text-right font-semibold px-2 py-1.5 w-[132px]">Nominal</th>
              <th className="w-[36px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((row) => {
              const invoiceDetail = row.invoiceId != null
                ? invoiceById.get(row.invoiceId)
                : undefined;
              return (
                <tr key={row.key} className="hover:bg-muted/20 align-top">
                  <td className="px-2 py-1">
                    {invoiceDetail ? (
                      <div className="px-1.5 py-1.5">
                        <ForecastInvoiceContent
                          view={{
                            invoiceNo: invoiceDetail.invoiceNo,
                            description: invoiceDetail.description,
                            clientLabel: invoiceDetail.clientCompany || invoiceDetail.clientName,
                            clientContact:
                              invoiceDetail.clientCompany &&
                              invoiceDetail.clientName &&
                              invoiceDetail.clientCompany !== invoiceDetail.clientName
                                ? invoiceDetail.clientName
                                : null,
                            tollAmount: invoiceDetail.tollAmount,
                            parkingAmount: invoiceDetail.parkingAmount,
                            otherAmount: invoiceDetail.otherAmount,
                            pphAmount: invoiceDetail.pphAmount,
                            notes: invoiceDetail.notes,
                          }}
                        />
                      </div>
                    ) : (
                      <input
                        value={row.description}
                        onChange={(e) => onChange(row.key, { description: e.target.value })}
                        disabled={!canInput}
                        placeholder="Contoh: Pelunasan invoice ..."
                        className="w-full bg-transparent px-1.5 py-1.5 text-xs outline-none rounded-lg focus:bg-muted/40 text-foreground placeholder:text-muted-foreground/50 disabled:cursor-default"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="date"
                      value={row.plannedDate}
                      min={week.start}
                      max={week.end}
                      onChange={(e) => onChange(row.key, { plannedDate: e.target.value })}
                      disabled={!canInput}
                      className="w-full bg-transparent px-1 py-1.5 text-[11px] outline-none rounded-lg focus:bg-muted/40 text-foreground disabled:cursor-default"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <CurrencyInput
                      size="sm"
                      value={row.amount}
                      onChange={(v) => onChange(row.key, { amount: v })}
                      disabled={!canInput}
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    {canInput && (
                      <button
                        type="button"
                        onClick={() => onRemove(row.key)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-danger hover:bg-danger-light transition-colors"
                        title="Hapus baris"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-5 text-center text-[11px] text-muted-foreground">
                  Belum ada rencana pemasukan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpensePanel({
  week,
  rows,
  categories,
  canInput,
  onAdd,
  onChange,
  onRemove,
}: {
  week: ForecastWeek;
  rows: DraftExpense[];
  categories: string[];
  canInput: boolean;
  onAdd: () => void;
  onChange: (key: string, patch: Partial<DraftExpense>) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-danger-light/50 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-danger" />
          <p className="text-[10px] font-bold tracking-wider uppercase text-danger">Pengeluaran</p>
          <span className="text-[10px] text-muted-foreground">({rows.length})</span>
        </div>
        {canInput && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-[10px] font-bold text-danger hover:bg-danger-light px-2 py-1 rounded-lg transition-colors"
          >
            <Plus className="w-3 h-3" />
            Tambah
          </button>
        )}
      </div>
      <div className="overflow-x-auto flex-1">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="bg-muted/30 text-[9px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left font-semibold px-2 py-1.5 w-[110px]">Tanggal</th>
              <th className="text-left font-semibold px-2 py-1.5">Keterangan & Kategori</th>
              <th className="text-right font-semibold px-2 py-1.5 w-[128px]">Nominal</th>
              <th className="text-right font-semibold px-2 py-1.5 w-[128px]">Pembayaran</th>
              <th className="text-right font-semibold px-2 py-1.5 w-[110px]">Admin</th>
              <th className="text-right font-semibold px-2 py-1.5 w-[118px]">Sisa</th>
              <th className="w-[36px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((row) => {
              const sisa = row.amount - row.payment;
              return (
                <tr key={row.key} className="hover:bg-muted/20">
                  <td className="px-2 py-1">
                    <input
                      type="date"
                      value={row.plannedDate}
                      min={week.start}
                      max={week.end}
                      onChange={(e) => onChange(row.key, { plannedDate: e.target.value })}
                      disabled={!canInput}
                      className="w-full bg-transparent px-1 py-1.5 text-[11px] outline-none rounded-lg focus:bg-muted/40 text-foreground disabled:cursor-default"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={row.description}
                      onChange={(e) => onChange(row.key, { description: e.target.value })}
                      disabled={!canInput}
                      placeholder="Contoh: Gaji driver, BBM, tol ..."
                      className="w-full bg-transparent px-1.5 py-1.5 text-xs outline-none rounded-lg focus:bg-muted/40 text-foreground placeholder:text-muted-foreground/50 disabled:cursor-default"
                    />
                    <div className="mt-0.5 flex items-center gap-1">
                      <Tag className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                      <select
                        value={row.category}
                        onChange={(e) => onChange(row.key, { category: e.target.value })}
                        disabled={!canInput}
                        aria-label={`Kategori ${row.description || "pengeluaran"}`}
                        className="min-w-0 flex-1 rounded-md bg-muted/40 px-1 py-0.5 text-[9px] font-semibold text-muted-foreground outline-none focus:bg-primary/10 focus:text-primary disabled:cursor-default disabled:opacity-70"
                      >
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <CurrencyInput
                      size="sm"
                      value={row.amount}
                      onChange={(v) => onChange(row.key, { amount: v })}
                      disabled={!canInput}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <CurrencyInput
                      size="sm"
                      value={row.payment}
                      onChange={(v) => onChange(row.key, { payment: v })}
                      disabled={!canInput}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <CurrencyInput
                      size="sm"
                      value={row.admin}
                      onChange={(v) => onChange(row.key, { admin: v })}
                      disabled={!canInput}
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <span
                      className={cn(
                        "text-[11px] font-semibold tabular-nums",
                        sisa < 0 ? "text-danger" : sisa > 0 ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {formatCurrency(sisa)}
                    </span>
                  </td>
                  <td className="px-1 py-1 text-center">
                    {canInput && (
                      <button
                        type="button"
                        onClick={() => onRemove(row.key)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-danger hover:bg-danger-light transition-colors"
                        title="Hapus baris"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-5 text-center text-[11px] text-muted-foreground">
                  Belum ada rencana pengeluaran.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecapRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: keyof typeof toneClass;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-[11px] font-semibold tabular-nums", toneClass[tone])}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function MonthlyRecap({
  periodLabel,
  summary,
  categoryTotals,
}: {
  periodLabel: string;
  summary: ForecastSummary;
  categoryTotals: ForecastExpenseCategoryTotal[];
}) {
  const margin = summary.totalAvailable - summary.totalNominalOut;

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
        <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
          <Wallet className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Rekap Bulanan</p>
          <p className="text-[11px] text-muted-foreground">
            {periodLabel} • saldo, pemasukan mingguan, dan pengeluaran per kategori
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border">
        <div className="bg-card flex flex-col">
          <div className="flex items-center justify-between bg-foreground px-3 py-2 text-background">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em]">Total</p>
            <p className="text-[10px] font-bold uppercase tracking-wide">Saldo</p>
          </div>
          <div className="divide-y divide-border/60">
            <RecapRow label="Saldo Awal" value={summary.openingBalance} />
            {summary.weeks.map((week) => (
              <RecapRow
                key={week.weekNo}
                label={`Minggu ${week.weekNo}`}
                value={week.income}
                tone="success"
              />
            ))}
            <RecapRow label="Lainnya" value={0} />
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-primary/20 bg-primary-light/60 px-3 py-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-primary">
              Total Saldo
            </span>
            <span className="text-sm font-extrabold text-primary tabular-nums">
              {formatCurrency(summary.totalAvailable)}
            </span>
          </div>
        </div>

        <div className="bg-card flex flex-col">
          <div className="flex items-center justify-between bg-foreground px-3 py-2 text-background">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em]">Pengeluaran</p>
            <p className="text-[10px] font-bold uppercase tracking-wide">Kategori</p>
          </div>
          <div className="divide-y divide-border/60">
            {categoryTotals.map((item) => (
              <RecapRow key={item.category} label={item.category} value={item.amount} tone="danger" />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-danger/20 bg-danger-light/50 px-3 py-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-danger">
              Total Pengeluaran
            </span>
            <span className="text-sm font-extrabold text-danger tabular-nums">
              {formatCurrency(summary.totalNominalOut)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-danger/20 bg-danger px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em]">Margin Bersih</p>
          <p className="text-[10px] text-white/75">
            Saldo awal + pemasukan − pengeluaran (sebelum admin)
          </p>
        </div>
        <p className="text-xl font-extrabold tabular-nums sm:text-2xl">{formatCurrency(margin)}</p>
      </div>

      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 bg-card px-4 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Admin</span>
          <span className="text-xs font-bold text-foreground tabular-nums">
            {formatCurrency(summary.totalAdmin)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 bg-primary-light/50 px-4 py-2.5">
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-primary">
            Saldo Akhir setelah Admin
          </span>
          <span
            className={cn(
              "text-sm font-extrabold tabular-nums",
              summary.closingBalance < 0 ? "text-danger" : "text-primary",
            )}
          >
            {formatCurrency(summary.closingBalance)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function FinanceForecastPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("finance");
  const canInput = permLevel === "input" || permLevel === "edit";

  const [periodKey, setPeriodKey] = useState(() => localDateStr().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [openingSource, setOpeningSource] = useState<ForecastOpeningSource>("manual");
  const [openingSources, setOpeningSources] = useState<OpeningSourcesState>({
    previousForecast: {
      available: false,
      value: null,
      detail: "Forecast bulan sebelumnya belum tersedia",
    },
  });
  const [incomes, setIncomes] = useState<DraftIncome[]>([]);
  const [expenses, setExpenses] = useState<DraftExpense[]>([]);
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState("");
  const [company, setCompany] = useState<DbFinanceCompanySettings | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceWeek, setInvoiceWeek] = useState<ForecastWeek | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  /** Semua invoice (termasuk yang lunas) agar detail tampil setelah reload. */
  const [invoiceAllById, setInvoiceAllById] = useState<Map<number, InvoiceOption>>(new Map());
  const invoiceLoadingRef = useRef(false);
  const invoicesLoadedRef = useRef(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [entryModal, setEntryModal] = useState<{
    mode: ForecastEntryMode;
    week: ForecastWeek;
  } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyPreparing, setCopyPreparing] = useState(false);
  const [previousForecast, setPreviousForecast] = useState<PreviousForecastSource | null>(null);
  const copyRequestRef = useRef(0);
  const [categoryRows, setCategoryRows] = useState<DbFinanceForecastCategory[]>(() =>
    FORECAST_EXPENSE_CATEGORIES.map((name, index) => ({
      id: -(index + 1),
      name,
      sort_order: (index + 1) * 10,
    })),
  );
  const categories = useMemo(
    () => categoryRows.map((category) => category.name),
    [categoryRows],
  );

  const addToast = useCallback((type: "success" | "error", msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const nextKey = useCallback((prefix: string) => {
    seqRef.current += 1;
    return `${prefix}-${seqRef.current}`;
  }, []);

  const weeks = useMemo(() => buildForecastWeeks(periodKey), [periodKey]);

  const summary = useMemo(
    () =>
      computeForecast(
        openingBalance,
        incomes.map((r) => ({ week_no: r.weekNo, amount: r.amount })),
        expenses.map((r) => ({
          week_no: r.weekNo,
          amount: r.amount,
          payment: r.payment,
          admin: r.admin,
        })),
      ),
    [openingBalance, incomes, expenses],
  );

  const categoryTotals = useMemo(
    () => computeForecastExpenseCategoryTotals(expenses, categories),
    [expenses, categories],
  );

  const currentSnapshot = useMemo(
    () => draftSnapshot(openingBalance, openingSource, incomes, expenses),
    [openingBalance, openingSource, incomes, expenses],
  );
  const dirty = snapshot !== "" && currentSnapshot !== snapshot;

  const activeOpeningSourceInfo = useMemo(() => {
    if (openingSource === "previous_forecast") return openingSources.previousForecast;
    return null;
  }, [openingSource, openingSources]);
  const canApplyOpeningSource =
    activeOpeningSourceInfo?.available === true &&
    activeOpeningSourceInfo.value != null &&
    activeOpeningSourceInfo.value >= 0;
  const openingSourceValueChanged =
    canApplyOpeningSource && openingBalance !== activeOpeningSourceInfo?.value;
  const openingSourceExportLabel = useMemo(() => {
    if (openingSource === "manual") return FORECAST_OPENING_SOURCE_LABELS.manual;
    return activeOpeningSourceInfo?.detail ??
      FORECAST_OPENING_SOURCE_LABELS[openingSource];
  }, [activeOpeningSourceInfo, openingSource]);
  const openingSourceStatus = useMemo(() => {
    if (openingSource === "manual") {
      return {
        tone: "muted" as const,
        text: "Saldo awal diisi manual. Nilai tersimpan tidak berubah otomatis.",
      };
    }
    if (!activeOpeningSourceInfo?.available) {
      return {
        tone: "warning" as const,
        text: `${activeOpeningSourceInfo?.detail ?? "Sumber saldo awal"} • Belum ada data.`,
      };
    }
    if (activeOpeningSourceInfo.value == null) {
      return {
        tone: "warning" as const,
        text: `${activeOpeningSourceInfo.detail} • Belum ada data.`,
      };
    }
    if (activeOpeningSourceInfo.value < 0) {
      return {
        tone: "warning" as const,
        text: `${activeOpeningSourceInfo.detail} • Defisit ${formatCurrency(activeOpeningSourceInfo.value)}; tidak dapat dipakai sebagai saldo awal.`,
      };
    }
    if (openingBalance !== activeOpeningSourceInfo.value) {
      return {
        tone: "warning" as const,
        text: `${activeOpeningSourceInfo.detail} • Nilai sumber ${formatCurrency(activeOpeningSourceInfo.value)}. Klik Ambil ulang untuk memperbarui.`,
      };
    }
    return {
      tone: "success" as const,
      text: `${activeOpeningSourceInfo.detail} • Sesuai nilai sumber ${formatCurrency(activeOpeningSourceInfo.value)}.`,
    };
  }, [activeOpeningSourceInfo, openingBalance, openingSource]);

  const usedInvoiceIds = useMemo(
    () => new Set(incomes.filter((r) => r.invoiceId != null).map((r) => r.invoiceId as number)),
    [incomes],
  );

  const invoiceById = useMemo(
    () => new Map(invoices.map((invoice) => [invoice.id, invoice])),
    [invoices],
  );

  const currentIncomeCopyKeys = useMemo(
    () => new Set(incomes.map((income) => forecastCopyFingerprint(
      income.plannedDate,
      income.description,
      income.amount,
    ))),
    [incomes],
  );

  const currentExpenseCopyKeys = useMemo(
    () => new Set(expenses.map((expense) => forecastCopyFingerprint(
      expense.plannedDate,
      expense.description,
      expense.amount,
    ))),
    [expenses],
  );

  const copyIncomeCandidates = useMemo<ForecastCopyIncomeCandidate[]>(() => {
    if (!previousForecast) return [];
    return previousForecast.incomes.map((row) => {
      const plannedDate = mapForecastDateToMonth(row.planned_date, periodKey);
      const weekNo = weekNoForDate(plannedDate, weeks) ?? (1 as ForecastWeekNo);
      const previousAmount = Number(row.amount) || 0;
      const invoice = row.invoice_id != null ? invoiceById.get(row.invoice_id) : undefined;
      const invoiceDuplicate = row.invoice_id != null && usedInvoiceIds.has(row.invoice_id);
      const manualDuplicate = row.invoice_id == null && currentIncomeCopyKeys.has(
        forecastCopyFingerprint(plannedDate, row.description, previousAmount),
      );
      const duplicate = invoiceDuplicate || manualDuplicate;
      let unavailableReason: string | null = null;
      if (row.invoice_id != null && !invoice) {
        unavailableReason = invoiceLoading
          ? "Memuat sisa tagihan invoice..."
          : !invoicesLoaded
            ? "Data sisa invoice belum tersedia."
            : "Tidak ada sisa tagihan invoice.";
      } else if (invoice && invoice.remaining <= 0) {
        unavailableReason = "Tidak ada sisa tagihan invoice.";
      }
      if (invoiceDuplicate) unavailableReason = "Invoice sudah dipakai di bulan ini.";

      const invoiceDetail = invoiceAllById.get(row.invoice_id as number);
      return {
        sourceId: row.id,
        description: row.description,
        plannedDate,
        weekNo,
        amount: invoice?.remaining ?? previousAmount,
        previousAmount,
        invoiceId: row.invoice_id,
        invoiceNo: invoiceDetail?.invoiceNo ?? null,
        invoiceDetail: invoiceDetail
          ? {
              description: invoiceDetail.description,
              clientLabel: invoiceDetail.clientCompany || invoiceDetail.clientName || null,
              clientContact:
                invoiceDetail.clientCompany && invoiceDetail.clientName &&
                  invoiceDetail.clientCompany !== invoiceDetail.clientName
                  ? invoiceDetail.clientName
                  : null,
              tollAmount: invoiceDetail.tollAmount,
              parkingAmount: invoiceDetail.parkingAmount,
              otherAmount: invoiceDetail.otherAmount,
              pphAmount: invoiceDetail.pphAmount,
              notes: invoiceDetail.notes,
            }
          : null,
        duplicate,
        unavailableReason,
      };
    });
  }, [
    currentIncomeCopyKeys,
    invoiceAllById,
    invoiceById,
    invoiceLoading,
    invoicesLoaded,
    periodKey,
    previousForecast,
    usedInvoiceIds,
    weeks,
  ]);

  const copyExpenseCandidates = useMemo<ForecastCopyExpenseCandidate[]>(() => {
    if (!previousForecast) return [];
    return previousForecast.expenses.map((row) => {
      const plannedDate = mapForecastDateToMonth(row.planned_date, periodKey);
      const weekNo = weekNoForDate(plannedDate, weeks) ?? (1 as ForecastWeekNo);
      const amount = Number(row.amount) || 0;
      return {
        sourceId: row.id,
        description: row.description,
        plannedDate,
        weekNo,
        amount,
        admin: Number(row.admin) || 0,
        category: normalizeForecastExpenseCategory(row.category, categories),
        duplicate: currentExpenseCopyKeys.has(
          forecastCopyFingerprint(plannedDate, row.description, amount),
        ),
      };
    });
  }, [categories, currentExpenseCopyKeys, periodKey, previousForecast, weeks]);

  const previousCopyTotal = previousForecast
    ? previousForecast.incomes.length + previousForecast.expenses.length
    : 0;
  const copyPreviousTitle = !previousForecast
    ? "Forecast bulan sebelumnya belum tersedia"
    : previousCopyTotal === 0
      ? `Forecast ${previousForecast.label} belum memiliki data`
      : `Salin pemasukan dan pengeluaran dari Forecast ${previousForecast.label}`;

  // ─── Muat invoice (rincian lengkap + sisa tagihan) ───

  const loadInvoices = useCallback(async (): Promise<boolean> => {
    if (invoiceLoadingRef.current) return invoicesLoadedRef.current;
    invoiceLoadingRef.current = true;
    setInvoiceLoading(true);
    try {
      const [invRes, payRes] = await Promise.all([
        supabase
          .from("finance_invoices")
          .select(
            "id, invoice_no, invoice_date, due_date, total_amount, subtotal, description, toll_amount, parking_amount, other_amount, pph_amount, notes, client:finance_clients(contact_name, company_name)",
          )
          .order("invoice_date", { ascending: false }),
        supabase.from("finance_invoice_payments").select("invoice_id, amount"),
      ]);
      if (invRes.error) throw invRes.error;
      if (payRes.error) throw payRes.error;

      const paidMap = new Map<number, number>();
      for (const p of (payRes.data ?? []) as { invoice_id: number; amount: number }[]) {
        paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + (Number(p.amount) || 0));
      }

      const allOptions: InvoiceOption[] = ((invRes.data ?? []) as unknown as InvoiceQueryRow[])
        .map((r) => {
          const total = Number(r.total_amount) || 0;
          const paid = paidMap.get(r.id) ?? 0;
          return {
            id: r.id,
            invoiceNo: r.invoice_no,
            invoiceDate: r.invoice_date,
            dueDate: r.due_date,
            totalAmount: total,
            subtotal: Number(r.subtotal) || 0,
            description: r.description ?? null,
            tollAmount: Number(r.toll_amount) || 0,
            parkingAmount: Number(r.parking_amount) || 0,
            otherAmount: Number(r.other_amount) || 0,
            pphAmount: Number(r.pph_amount) || 0,
            notes: r.notes ?? null,
            paidAmount: paid,
            remaining: total - paid,
            clientName: r.client?.contact_name ?? "",
            clientCompany: r.client?.company_name ?? "",
          };
        });
      const invoiceMap = new Map<number, InvoiceOption>(
        allOptions.map((option) => [option.id, option]),
      );

      setInvoiceAllById(invoiceMap);
      setInvoices(allOptions.filter((option) => option.remaining > 0));
      setInvoicesLoaded(true);
      invoicesLoadedRef.current = true;
      return true;
    } catch (err) {
      addToast("error", parseFinanceDbError(err));
      return false;
    } finally {
      invoiceLoadingRef.current = false;
      setInvoiceLoading(false);
    }
  }, [addToast]);

  const load = useCallback(
    async (key: string) => {
      copyRequestRef.current += 1;
      setCopyOpen(false);
      setCopyPreparing(false);
      setPreviousForecast(null);
      setLoading(true);
      try {
        const start = forecastMonthStart(key);
        const previousKey = shiftForecastPeriodKey(key, -1);
        const previousStart = forecastMonthStart(previousKey);
        const [monthRes, companyRes, previousMonthRes, categoryRes] = await Promise.all([
          supabase.from("finance_forecast_months").select("*").eq("period_start", start).maybeSingle(),
          supabase.from("finance_company_settings").select("*").eq("id", 1).maybeSingle(),
          supabase.from("finance_forecast_months").select("*").eq("period_start", previousStart).maybeSingle(),
          supabase
            .from("finance_forecast_categories")
            .select("id, name, sort_order")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true }),
        ]);
        if (monthRes.error) throw monthRes.error;
        if (companyRes.error) throw companyRes.error;
        if (previousMonthRes.error) throw previousMonthRes.error;
        if (categoryRes.error) throw categoryRes.error;

        const month = (monthRes.data ?? null) as DbFinanceForecastMonth | null;
        const previousMonth = (previousMonthRes.data ?? null) as DbFinanceForecastMonth | null;
        const settings = (companyRes.data ?? null) as DbFinanceCompanySettings | null;
        const categoryData = ((categoryRes.data ?? []) as DbFinanceForecastCategory[])
          .filter((row) => Boolean(row.name));
        const activeRows = categoryData.length > 0
          ? categoryData
          : FORECAST_EXPENSE_CATEGORIES.map((name, index) => ({
              id: -(index + 1),
              name,
              sort_order: (index + 1) * 10,
            }));
        const activeCategories = activeRows.map((row) => row.name);
        setCategoryRows(activeRows);
        const [currentRows, previousRows] = await Promise.all([
          month
            ? fetchForecastMonthRows(month.id)
            : Promise.resolve({
                incomes: [] as DbFinanceForecastIncome[],
                expenses: [] as DbFinanceForecastExpense[],
              }),
          previousMonth
            ? fetchForecastMonthRows(previousMonth.id)
            : Promise.resolve({
                incomes: [] as DbFinanceForecastIncome[],
                expenses: [] as DbFinanceForecastExpense[],
              }),
        ]);

        const nextIncomes: DraftIncome[] = currentRows.incomes.map((r) => ({
          key: `db-inc-${r.id}`,
          weekNo: r.week_no as ForecastWeekNo,
          plannedDate: r.planned_date,
          description: r.description,
          amount: Number(r.amount) || 0,
          invoiceId: r.invoice_id,
        }));
        const nextExpenses: DraftExpense[] = currentRows.expenses.map((r) => ({
          key: `db-exp-${r.id}`,
          weekNo: r.week_no as ForecastWeekNo,
          plannedDate: r.planned_date,
          description: r.description,
          amount: Number(r.amount) || 0,
          payment: Number(r.payment) || 0,
          admin: Number(r.admin) || 0,
          category: normalizeForecastExpenseCategory(r.category, activeCategories),
        }));

        // Muat detail invoice untuk baris pemasukan yang terhubung invoice,
        // termasuk invoice yang sudah lunas (detail tetap tampil).
        if (nextIncomes.some((row) => row.invoiceId != null)) {
          void loadInvoices();
        }

        const previousLabel = forecastMonthLabel(previousKey);
        const previousForecastInfo: OpeningSourceInfo = previousMonth
          ? {
              available: true,
              value: savedForecastClosing({
                opening_balance: Number(previousMonth.opening_balance) || 0,
                incomes: previousRows.incomes.map((r) => ({
                  week_no: r.week_no,
                  amount: Number(r.amount) || 0,
                })),
                expenses: previousRows.expenses.map((r) => ({
                  week_no: r.week_no,
                  amount: Number(r.amount) || 0,
                  payment: Number(r.payment) || 0,
                  admin: Number(r.admin) || 0,
                })),
              }),
              detail: `Saldo akhir Forecast ${previousLabel}`,
            }
          : {
              available: false,
              value: null,
              detail: `Forecast ${previousLabel} belum tersedia`,
            };

        setOpeningSources({
          previousForecast: previousForecastInfo,
        });
        setPreviousForecast(
          previousMonth
            ? {
                label: previousLabel,
                incomes: previousRows.incomes,
                expenses: previousRows.expenses,
              }
            : null,
        );

        let opening = Number(month?.opening_balance) || 0;
        let source = normalizeForecastOpeningSource(month?.opening_source);
        if (!month) {
          const fallback = chooseDefaultForecastOpening({
            forecast: previousForecastInfo,
          });
          opening = fallback.value;
          source = fallback.source;
        }

        setOpeningBalance(opening);
        setOpeningSource(source);
        setIncomes(nextIncomes);
        setExpenses(nextExpenses);
        setVersion(month?.version ?? 0);
        setSnapshot(draftSnapshot(opening, source, nextIncomes, nextExpenses));
        setCompany(settings);
      } catch (err) {
        addToast("error", parseFinanceDbError(err));
      } finally {
        setLoading(false);
      }
    },
    [addToast, loadInvoices],
  );

  useEffect(() => {
    (async () => {
      await load(periodKey);
    })();
  }, [load, periodKey]);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExportMenu]);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen]);

  const shiftMonth = (delta: number) => {
    if (saving) return;
    if (dirty && !window.confirm("Ada perubahan forecast yang belum disimpan. Pindah bulan dan buang perubahan?")) {
      return;
    }
    setPeriodKey((prev) => shiftForecastPeriodKey(prev, delta));
  };

  const reload = () => {
    if (saving) return;
    if (dirty && !window.confirm("Buang perubahan yang belum disimpan dan muat ulang forecast?")) return;
    void load(periodKey);
  };

  const openEntryModal = (mode: ForecastEntryMode, week: ForecastWeek) => {
    if (!canInput || saving) return;
    setEntryModal({ mode, week });
  };

  const closeEntryModal = useCallback(() => setEntryModal(null), []);

  const updateIncome = (key: string, patch: Partial<DraftIncome>) => {
    setIncomes((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const updateExpense = (key: string, patch: Partial<DraftExpense>) => {
    setExpenses((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleEntrySubmit = (values: ForecastEntryValues) => {
    const target = entryModal;
    if (!target) return;
    if (values.mode === "income") {
      setIncomes((prev) => [
        ...prev,
        {
          key: nextKey("inc"),
          weekNo: target.week.weekNo,
          plannedDate: values.plannedDate,
          description: values.description,
          amount: values.amount,
          invoiceId: null,
        },
      ]);
    } else {
      setExpenses((prev) => [
        ...prev,
        {
          key: nextKey("exp"),
          weekNo: target.week.weekNo,
          plannedDate: values.plannedDate,
          description: values.description,
          amount: values.amount,
          payment: values.payment,
          admin: values.admin,
          category: normalizeForecastExpenseCategory(values.category, [...categories, values.category]),
        },
      ]);
    }
    setEntryModal(null);
  };

  const createForecastCategory = useCallback(async (rawName: string): Promise<DbFinanceForecastCategory> => {
    const name = normalizeCategoryName(rawName);
    if (!name) throw new Error("Nama kategori wajib diisi.");
    if (name.length > 60) throw new Error("Nama kategori maksimal 60 karakter.");

    const { data, error } = await supabase.rpc("add_finance_forecast_category", {
      p_name: name,
    });
    if (error) throw new Error(parseFinanceDbError(error));

    const result = (data ?? null) as {
      id?: number;
      name?: string;
      sort_order?: number;
      created?: boolean;
    } | null;
    if (typeof result?.id !== "number" || !result.name) {
      throw new Error("Respons kategori baru tidak valid.");
    }

    const row: DbFinanceForecastCategory = {
      id: result.id,
      name: result.name,
      sort_order: Number(result.sort_order) || 0,
    };
    setCategoryRows((prev) => {
      const index = prev.findIndex(
        (category) =>
          category.id === row.id ||
          normalizeCategoryName(category.name) === normalizeCategoryName(row.name),
      );
      if (index < 0) {
        return [...prev, row].sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "id"),
        );
      }
      const next = [...prev];
      next[index] = row;
      return next;
    });

    if (result.created !== false) {
      await logAudit({
        supabase,
        action: "create",
        entityType: "finance_forecast_categories",
        entityId: row.id,
        entityLabel: `Kategori Forecast ${row.name}`,
        newData: { id: row.id, name: row.name, sort_order: row.sort_order },
      });
      addToast("success", `Kategori ${row.name} ditambahkan.`);
    } else {
      addToast("success", `Kategori ${row.name} sudah tersedia.`);
    }
    return row;
  }, [addToast]);

  const renameForecastCategory = useCallback(async (
    id: number,
    rawName: string,
  ): Promise<DbFinanceForecastCategory> => {
    const name = normalizeCategoryName(rawName);
    if (!name) throw new Error("Nama kategori wajib diisi.");
    if (name.length > 60) throw new Error("Nama kategori maksimal 60 karakter.");

    const { data, error } = await supabase.rpc("rename_finance_forecast_category", {
      p_id: id,
      p_name: name,
    });
    if (error) throw new Error(parseFinanceDbError(error));

    const result = (data ?? null) as {
      id?: number;
      name?: string;
      previous_name?: string;
      sort_order?: number;
      updated_expenses?: number;
    } | null;
    if (typeof result?.id !== "number" || !result.name) {
      throw new Error("Respons perubahan kategori tidak valid.");
    }

    const row: DbFinanceForecastCategory = {
      id: result.id,
      name: result.name,
      sort_order: Number(result.sort_order) || 0,
    };
    const previousName = result.previous_name ?? "";
    setCategoryRows((prev) => prev.map((category) => (category.id === row.id ? row : category)));
    if (previousName) {
      setExpenses((prev) => prev.map((expense) => (
        normalizeCategoryName(expense.category) === normalizeCategoryName(previousName)
          ? { ...expense, category: row.name }
          : expense
      )));
      setSnapshot((prev) => renameForecastSnapshotCategory(prev, previousName, row.name));
    }

    await logAudit({
      supabase,
      action: "update",
      entityType: "finance_forecast_categories",
      entityId: row.id,
      entityLabel: `Kategori Forecast ${previousName || row.name}`,
      oldData: { id: row.id, name: previousName },
      newData: {
        id: row.id,
        name: row.name,
        sort_order: row.sort_order,
        updated_expenses: result.updated_expenses ?? 0,
      },
    });
    addToast(
      "success",
      previousName && previousName !== row.name
        ? `Kategori ${previousName} diubah menjadi ${row.name}.`
        : `Kategori ${row.name} diperbarui.`,
    );
    return row;
  }, [addToast]);

  const handleOpeningSourceChange = (source: ForecastOpeningSource) => {
    if (!canInput) return;
    setOpeningSource(source);
    if (source === "manual") return;
    const info = openingSources.previousForecast;
    if (info.available && info.value != null && info.value >= 0) {
      setOpeningBalance(info.value);
    }
  };

  const handleOpeningBalanceChange = (value: number) => {
    setOpeningBalance(value);
    if (openingSource !== "manual") setOpeningSource("manual");
  };

  const applyOpeningSource = () => {
    if (!canInput || !activeOpeningSourceInfo) return;
    if (!activeOpeningSourceInfo.available) {
      addToast("error", "Belum ada data untuk sumber saldo awal ini.");
      return;
    }
    if (activeOpeningSourceInfo.value == null || activeOpeningSourceInfo.value < 0) {
      addToast("error", "Saldo akhir sumber negatif (defisit) sehingga tidak dapat dipakai sebagai saldo awal.");
      return;
    }
    setOpeningBalance(activeOpeningSourceInfo.value);
    addToast("success", `Saldo awal diambil dari ${activeOpeningSourceInfo.detail}.`);
  };

  // ─── Invoice picker ───

  const openInvoicePicker = (week: ForecastWeek) => {
    if (!canInput) return;
    setInvoiceWeek(week);
    setInvoiceSearch("");
    setInvoiceOpen(true);
    if (!invoicesLoaded) void loadInvoices();
  };

  const openCopyPrevious = async () => {
    if (!canInput || saving || copyPreparing || invoiceLoading || !previousForecast) return;
    if (previousForecast.incomes.length + previousForecast.expenses.length === 0) return;

    const needsInvoices = previousForecast.incomes.some(
      (row) => row.invoice_id != null,
    );
    if (!needsInvoices) {
      setCopyOpen(true);
      return;
    }

    const requestId = copyRequestRef.current + 1;
    copyRequestRef.current = requestId;
    setCopyPreparing(true);
    try {
      await loadInvoices();
    } finally {
      if (copyRequestRef.current === requestId) {
        setCopyOpen(true);
        setCopyPreparing(false);
      }
    }
  };

  const handleCopyPrevious = (selection: ForecastCopySelection) => {
    if (!previousForecast) return;

    const newIncomes: DraftIncome[] = selection.incomes.map((item) => ({
      key: nextKey("copy-inc"),
      weekNo: item.weekNo,
      plannedDate: item.plannedDate,
      description: item.description,
      amount: Math.round(item.amount) || 0,
      invoiceId: item.invoiceId,
    }));
    const newExpenses: DraftExpense[] = selection.expenses.map((item) => ({
      key: nextKey("copy-exp"),
      weekNo: item.weekNo,
      plannedDate: item.plannedDate,
      description: item.description,
      amount: Math.round(item.amount) || 0,
      payment: 0,
      admin: Math.round(item.admin) || 0,
      category: normalizeForecastExpenseCategory(item.category, categories),
    }));
    const total = newIncomes.length + newExpenses.length;
    if (total === 0) return;

    if (newIncomes.length > 0) {
      setIncomes((prev) => [...prev, ...newIncomes]);
    }
    if (newExpenses.length > 0) {
      setExpenses((prev) => [...prev, ...newExpenses]);
    }
    setCopyOpen(false);
    addToast(
      "success",
      `${total} baris dari Forecast ${previousForecast.label} ditambahkan ke draft.`,
    );
  };

  const pickInvoice = (inv: InvoiceOption) => {
    if (!invoiceWeek) return;
    if (usedInvoiceIds.has(inv.id)) {
      addToast("error", "Invoice ini sudah dipakai di forecast bulan ini.");
      return;
    }
    const baseDate = inv.dueDate || inv.invoiceDate;
    const plannedDate = clampDateToWeek(baseDate, invoiceWeek);
    const client = inv.clientCompany || inv.clientName;
    setIncomes((prev) => [
      ...prev,
      {
        key: nextKey("invoice"),
        weekNo: invoiceWeek.weekNo,
        plannedDate,
        description: `Invoice ${inv.invoiceNo}${client ? ` — ${client}` : ""}`,
        amount: inv.remaining,
        invoiceId: inv.id,
      },
    ]);
    setInvoiceOpen(false);
    addToast("success", `Invoice ${inv.invoiceNo} ditambahkan ke Minggu ${invoiceWeek.weekNo}.`);
  };

  const filteredInvoices = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (inv) =>
        inv.invoiceNo.toLowerCase().includes(q) ||
        inv.clientName.toLowerCase().includes(q) ||
        inv.clientCompany.toLowerCase().includes(q) ||
        (inv.description ?? "").toLowerCase().includes(q) ||
        (inv.notes ?? "").toLowerCase().includes(q),
    );
  }, [invoices, invoiceSearch]);

  // ─── Save ───

  const handleSave = async () => {
    if (!canInput || saving) return;
    const mappedIncomes = incomes.map((r, i) => ({
      week_no: r.weekNo,
      planned_date: r.plannedDate,
      description: r.description.trim(),
      amount: Math.round(r.amount) || 0,
      invoice_id: r.invoiceId,
      sort_order: i,
    }));
    const mappedExpenses = expenses.map((r, i) => ({
      week_no: r.weekNo,
      planned_date: r.plannedDate,
      description: r.description.trim(),
      amount: Math.round(r.amount) || 0,
      payment: Math.round(r.payment) || 0,
      admin: Math.round(r.admin) || 0,
      category: normalizeForecastExpenseCategory(r.category, categories),
      sort_order: i,
    }));

    const errors = validateForecastDraft({
      periodKey,
      openingBalance,
      incomes: incomes.map((r) => ({
        week_no: r.weekNo,
        planned_date: r.plannedDate,
        description: r.description,
        amount: Math.round(r.amount) || 0,
        invoice_id: r.invoiceId,
      })),
      expenses: expenses.map((r) => ({
        week_no: r.weekNo,
        planned_date: r.plannedDate,
        description: r.description,
        amount: Math.round(r.amount) || 0,
        payment: Math.round(r.payment) || 0,
        admin: Math.round(r.admin) || 0,
        category: normalizeForecastExpenseCategory(r.category, categories),
      })),
    });
    if (errors.length > 0) {
      addToast("error", errors[0]);
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("save_finance_forecast", {
        p_period_start: forecastMonthStart(periodKey),
        p_opening_balance: Math.round(openingBalance),
        p_opening_source: openingSource,
        p_version: version,
        p_notes: null,
        p_incomes: mappedIncomes,
        p_expenses: mappedExpenses,
      });
      if (error) throw error;

      const result = (data ?? null) as { month_id?: number; version?: number } | null;
      const nextVersion = result?.version ?? version + 1;
      setVersion(nextVersion);
      setSnapshot(draftSnapshot(openingBalance, openingSource, incomes, expenses));

      await logAudit({
        supabase,
        action: version === 0 ? "create" : "update",
        entityType: "finance_forecast_months",
        entityId: result?.month_id ?? null,
        entityLabel: `Forecast ${forecastMonthLabel(periodKey)}`,
        newData: {
          period_start: forecastMonthStart(periodKey),
          version: nextVersion,
          opening_balance: Math.round(openingBalance),
          opening_source: openingSource,
          income_count: incomes.length,
          expense_count: expenses.length,
          total_income: summary.totalIncome,
          total_expense: summary.totalNominalOut,
          total_payment: summary.totalPayment,
          total_admin: summary.totalAdmin,
          closing_balance: summary.closingBalance,
        },
      });

      addToast("success", "Forecast berhasil disimpan.");
    } catch (err) {
      addToast("error", parseFinanceDbError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async (kind: "pdf" | "xlsx") => {
    setShowExportMenu(false);
    setExporting(kind);
    try {
      const args = {
        periodKey,
        openingBalance,
        openingSource: openingSourceExportLabel,
        categories,
        incomes: incomes.map((r) => ({
          week_no: r.weekNo,
          planned_date: r.plannedDate,
          description: r.description.trim() || "(tanpa keterangan)",
          amount: Math.round(r.amount) || 0,
          invoice_id: r.invoiceId,
        })),
        expenses: expenses.map((r) => ({
          week_no: r.weekNo,
          planned_date: r.plannedDate,
          description: r.description.trim() || "(tanpa keterangan)",
          amount: Math.round(r.amount) || 0,
          payment: Math.round(r.payment) || 0,
          admin: Math.round(r.admin) || 0,
          category: normalizeForecastExpenseCategory(r.category, categories),
        })),
        company: {
          company_name: company?.company_name || "Perusahaan",
          address: company?.address ?? null,
          phone: company?.phone ?? null,
          email: company?.email ?? null,
          npwp: company?.npwp ?? null,
          logo_url: company?.logo_url ?? null,
        },
      };
      if (kind === "pdf") await exportForecastPdf(args);
      else await exportForecastXlsx(args);
      addToast("success", `Export ${kind.toUpperCase()} berhasil dibuat.`);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Export forecast gagal.");
    } finally {
      setExporting(null);
    }
  };

  const page = (
    <>
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm py-2 mb-4 [&>div]:mb-0">
      <PageHeader
        title="Forecast Finance"
        description="Rencana kas masuk & keluar mingguan — saldo berantai antar minggu"
        icon={CalendarRange}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-muted rounded-xl px-1 py-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                disabled={saving}
                className="p-1.5 rounded-lg hover:bg-card disabled:opacity-40"
                title="Bulan sebelumnya"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-xs font-bold min-w-[118px] text-center text-foreground">
                {forecastMonthLabel(periodKey)}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                disabled={saving}
                className="p-1.5 rounded-lg hover:bg-card disabled:opacity-40"
                title="Bulan berikutnya"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setFullscreen((v) => !v)}
              className="p-2 rounded-xl border border-border hover:bg-muted"
              title={fullscreen ? "Keluar layar penuh" : "Layar penuh"}
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <div className="relative" ref={exportRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu((v) => !v)}
                disabled={exporting !== null}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                {exporting ? `Membuat ${exporting.toUpperCase()}...` : "Export"}
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-30">
                  <button
                    type="button"
                    onClick={() => void handleExport("xlsx")}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted"
                  >
                    Export Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExport("pdf")}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted"
                  >
                    Export PDF
                  </button>
                </div>
              )}
            </div>

            {canInput && (
              <Button
                icon={Save}
                onClick={() => void handleSave()}
                disabled={saving || (!dirty && version !== 0)}
                className={saving ? "[&_svg]:animate-spin" : ""}
              >
                {saving ? "Menyimpan..." : version === 0 ? "Simpan Forecast" : "Simpan"}
              </Button>
            )}
          </div>
        }
      />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Memuat forecast...</span>
        </div>
      ) : (
        <div className="space-y-4 pb-8">
          {/* KPI */}
          <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4">
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Pemasukan Rencana</p>
                <div className="w-8 h-8 rounded-lg bg-success-light flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-success" />
                </div>
              </div>
              <p className="text-lg sm:text-2xl font-bold text-success mt-1.5 tabular-nums">
                {formatCurrency(summary.totalIncome)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">{incomes.length} baris rencana</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Pengeluaran Rencana</p>
                <div className="w-8 h-8 rounded-lg bg-danger-light flex items-center justify-center">
                  <ReceiptText className="w-4 h-4 text-danger" />
                </div>
              </div>
              <p className="text-lg sm:text-2xl font-bold text-danger mt-1.5 tabular-nums">
                {formatCurrency(summary.totalNominalOut)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Sisa kewajiban {formatCurrency(summary.totalSisa)}
              </p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Pembayaran</p>
                <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-warning" />
                </div>
              </div>
              <p className="text-lg sm:text-2xl font-bold text-foreground mt-1.5 tabular-nums">
                {formatCurrency(summary.totalPayment)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">Pelacakan, bukan saldo kas</p>
            </div>
            <div className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">Saldo Akhir Forecast</p>
                <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                  <CalendarRange className="w-4 h-4 text-primary" />
                </div>
              </div>
              <p
                className={cn(
                  "text-lg sm:text-2xl font-bold mt-1.5 tabular-nums",
                  summary.closingBalance < 0 ? "text-danger" : "text-primary",
                )}
              >
                {formatCurrency(summary.closingBalance)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Admin {formatCurrency(summary.totalAdmin)}
              </p>
            </div>
          </div>

          {/* Lembar kerja */}
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center">
                    <CalendarRange className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Lembar Forecast — {forecastMonthLabel(periodKey)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Minggu 1–7, 8–14, 15–21, 22–akhir bulan • nominal rencana
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                  {canInput && (
                    <button
                      type="button"
                      onClick={() => void openCopyPrevious()}
                      disabled={saving || copyPreparing || invoiceLoading || !previousForecast || previousCopyTotal === 0}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                      title={copyPreviousTitle}
                    >
                      {copyPreparing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-primary" />
                      )}
                      {copyPreparing ? "Menyiapkan..." : "Ambil Bulan Lalu"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!saving) setCategoryOpen(true);
                    }}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                    title="Kelola master kategori pengeluaran"
                  >
                    <Tag className="w-3.5 h-3.5 text-danger" />
                    Atur Kategori
                  </button>
                  {dirty && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-warning bg-warning-light px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                      Belum disimpan
                    </span>
                  )}
                  {version > 0 && (
                    <span className="text-[10px] text-muted-foreground font-medium">versi {version}</span>
                  )}
                  <button
                    type="button"
                    onClick={reload}
                    disabled={loading || saving}
                    className="p-2 rounded-xl border border-border hover:bg-muted disabled:opacity-40"
                    title="Muat ulang data"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="px-4 pb-3">
                <div className="rounded-xl border border-border bg-muted/40 p-2.5">
                  <div className="flex flex-col xl:flex-row xl:items-center gap-2">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Link2 className="w-3.5 h-3.5" />
                        Sumber Saldo Awal
                      </span>
                      <select
                        value={openingSource}
                        onChange={(e) => handleOpeningSourceChange(e.target.value as ForecastOpeningSource)}
                        disabled={!canInput}
                        className="w-full sm:w-[270px] rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-foreground outline-none focus:border-primary disabled:cursor-default disabled:opacity-70"
                      >
                        <option value="manual">{FORECAST_OPENING_SOURCE_LABELS.manual}</option>
                        <option
                          value="previous_forecast"
                          disabled={!openingSourceUsable(openingSources.previousForecast)}
                        >
                          {FORECAST_OPENING_SOURCE_LABELS.previous_forecast} — {openingSourceOptionLabel(openingSources.previousForecast)}
                        </option>
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Saldo Awal
                      </span>
                      <CurrencyInput
                        value={openingBalance}
                        onChange={handleOpeningBalanceChange}
                        size="sm"
                        disabled={!canInput}
                        className="w-36 border-border bg-card font-bold"
                      />
                      {openingSource !== "manual" && (
                        <button
                          type="button"
                          onClick={applyOpeningSource}
                          disabled={!canInput || !canApplyOpeningSource || !openingSourceValueChanged}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[10px] font-bold text-foreground hover:bg-muted disabled:cursor-default disabled:opacity-45"
                          title="Ambil ulang saldo akhir dari sumber terpilih"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Ambil ulang
                        </button>
                      )}
                    </div>
                  </div>
                  <p
                    className={cn(
                      "mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed",
                      openingSourceStatus.tone === "warning"
                        ? "text-warning"
                        : openingSourceStatus.tone === "success"
                          ? "text-success"
                          : "text-muted-foreground",
                    )}
                  >
                    {openingSourceStatus.tone === "warning" ? (
                      <AlertTriangle className="mt-0.5 w-3 h-3 shrink-0" />
                    ) : (
                      <Info className="mt-0.5 w-3 h-3 shrink-0" />
                    )}
                    <span>{openingSourceStatus.text}</span>
                  </p>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Saldo awal hanya diambil dari Forecast bulan sebelumnya atau input manual. Nilai tersimpan tidak ditimpa otomatis.
                </p>
              </div>
            </div>

            {weeks.map((week) => {
              const weekSummary = summary.weeks[week.weekNo - 1];
              const weekIncomes = incomes.filter((r) => r.weekNo === week.weekNo);
              const weekExpenses = expenses.filter((r) => r.weekNo === week.weekNo);
              return (
                <section key={week.weekNo} className="border-b border-border last:border-b-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center min-w-8 h-7 px-2 rounded-lg bg-primary text-white text-[10px] font-extrabold">
                        M{week.weekNo}
                      </span>
                      <p className="text-xs font-bold text-foreground">
                        MINGGU {week.weekNo}{" "}
                        <span className="font-medium text-muted-foreground">({week.rangeLabel})</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                      <span className="text-[10px] font-semibold text-success bg-success-light px-2 py-0.5 rounded-full">
                        Masuk {formatCurrency(weekSummary.income)}
                      </span>
                      <span className="text-[10px] font-semibold text-danger bg-danger-light px-2 py-0.5 rounded-full">
                        Keluar {formatCurrency(weekSummary.nominalOut)}
                      </span>
                      <span className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                        weekSummary.closing < 0 ? "bg-danger-light text-danger" : "bg-primary-light text-primary",
                      )}>
                        Saldo {formatCurrency(weekSummary.closing)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 p-3">
                    <IncomePanel
                      week={week}
                      rows={weekIncomes}
                      canInput={canInput}
                      invoiceById={invoiceAllById}
                      onAdd={() => openEntryModal("income", week)}
                      onAddInvoice={() => openInvoicePicker(week)}
                      onChange={updateIncome}
                      onRemove={(key) => setIncomes((prev) => prev.filter((r) => r.key !== key))}
                    />
                    <ExpensePanel
                      week={week}
                      rows={weekExpenses}
                      categories={categories}
                      canInput={canInput}
                      onAdd={() => openEntryModal("expense", week)}
                      onChange={updateExpense}
                      onRemove={(key) => setExpenses((prev) => prev.filter((r) => r.key !== key))}
                    />
                  </div>

                  <div className="border-t border-border">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
                      <div className="bg-card flex flex-col">
                        <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 sm:px-3">
                          <span className="w-1.5 h-1.5 rounded-full bg-success" />
                          <p className="text-[10px] font-bold uppercase tracking-wider text-success">
                            Saldo & Pemasukan
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-px bg-border flex-1">
                          <StatCell label="Saldo Awal" value={formatCurrency(weekSummary.opening)} />
                          <StatCell label="Pemasukan" value={formatCurrency(weekSummary.income)} tone="success" />
                          <StatCell
                            label="Dana Tersedia"
                            value={formatCurrency(weekSummary.available)}
                            tone="primary"
                            strong
                            hint="Saldo awal + pemasukan"
                          />
                        </div>
                      </div>

                      <div className="bg-card flex flex-col">
                        <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 sm:px-3">
                          <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                          <p className="text-[10px] font-bold uppercase tracking-wider text-danger">
                            Pengeluaran & Pembayaran
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-px bg-border flex-1">
                          <StatCell label="Pengeluaran" value={formatCurrency(weekSummary.nominalOut)} tone="danger" />
                          <StatCell
                            label="Dibayar"
                            value={formatCurrency(weekSummary.payment)}
                            hint="Hanya pelacakan"
                          />
                          <StatCell label="Admin" value={formatCurrency(weekSummary.admin)} />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-border bg-primary-light/50 px-4 py-3 text-center">
                      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-primary/80">
                        Saldo Akhir Pekan
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 text-lg sm:text-xl font-extrabold tabular-nums",
                          weekSummary.closing < 0 ? "text-danger" : "text-primary",
                        )}
                      >
                        {formatCurrency(weekSummary.closing)}
                      </p>
                    </div>
                  </div>
                </section>
              );
            })}

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-2.5 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>
                Tombol <span className="font-semibold text-foreground">Invoice</span> pada panel pemasukan mengambil
                sisa tagihan. Invoice yang sama hanya boleh dipakai sekali per bulan. Tombol{" "}
                <span className="font-semibold text-foreground">Tambah</span> membuka form pengisian sebelum data
                masuk ke draft. Kategori pengeluaran dipilih saat mengisi atau mengedit baris.{" "}
                <span className="font-semibold text-foreground">Atur Kategori</span> hanya untuk mengelola master
                kategori. <span className="font-semibold text-foreground">Ambil Bulan Lalu</span> menyalin rencana
                Forecast bulan sebelumnya ke draft; pembayaran pengeluaran direset. Klik{" "}
                <span className="font-semibold text-foreground">Simpan Forecast</span> untuk menyimpan permanen.
              </span>
            </div>
          </div>

          {/* Rekap bulanan format laporan PDF */}
          <MonthlyRecap
            periodLabel={forecastMonthLabel(periodKey)}
            summary={summary}
            categoryTotals={categoryTotals}
          />
        </div>
      )}

      {/* Salin rencana dari Forecast bulan sebelumnya */}
      {copyOpen && previousForecast && (
        <ForecastCopyPreviousModal
          previousMonthLabel={previousForecast.label}
          currentMonthLabel={forecastMonthLabel(periodKey)}
          incomes={copyIncomeCandidates}
          expenses={copyExpenseCandidates}
          onClose={() => setCopyOpen(false)}
          onAdd={handleCopyPrevious}
        />
      )}

      {/* Pengaturan master kategori */}
      {categoryOpen && (
        <ForecastCategorySettingsModal
          categories={categoryRows}
          canEdit={canInput}
          onClose={() => setCategoryOpen(false)}
          onCreate={createForecastCategory}
          onRename={renameForecastCategory}
        />
      )}

      {/* Form tambah pemasukan / pengeluaran */}
      {entryModal && (
        <ForecastEntryModal
          key={`${periodKey}-${entryModal.mode}-${entryModal.week.weekNo}`}
          mode={entryModal.mode}
          week={entryModal.week}
          categories={categories}
          onClose={closeEntryModal}
          onSubmit={handleEntrySubmit}
          onCreateCategory={createForecastCategory}
        />
      )}

      {/* Invoice picker */}
      {invoiceOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setInvoiceOpen(false);
          }}
        >
          <div className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
              <div>
                <p className="text-sm font-bold text-foreground">Ambil Invoice</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Sisa tagihan otomatis diisi ke{" "}
                  {invoiceWeek ? `Minggu ${invoiceWeek.weekNo} (${invoiceWeek.rangeLabel})` : "forecast"}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInvoiceOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-border">
              <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="Cari nomor invoice atau nama klien..."
                  className="bg-transparent text-sm outline-none w-full text-foreground placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {invoiceLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-sm">Memuat invoice...</span>
                </div>
              ) : filteredInvoices.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  {invoices.length === 0
                    ? "Tidak ada invoice dengan sisa tagihan."
                    : "Tidak ada invoice yang cocok dengan pencarian."}
                </div>
              ) : (
                <table className="w-full min-w-[680px]">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="text-left font-semibold px-4 py-2.5">Invoice</th>
                      <th className="text-left font-semibold px-3 py-2.5">Klien</th>
                      <th className="text-left font-semibold px-3 py-2.5">Jatuh Tempo</th>
                      <th className="text-right font-semibold px-3 py-2.5">Sisa Tagihan</th>
                      <th className="text-center font-semibold px-3 py-2.5 w-[110px]">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredInvoices.map((inv) => {
                      const used = usedInvoiceIds.has(inv.id);
                      return (
                        <tr key={inv.id} className="hover:bg-muted/20 align-top">
                          <td className="px-4 py-2.5">
                            <ForecastInvoiceContent
                              view={{
                                invoiceNo: inv.invoiceNo,
                                description: inv.description,
                                tollAmount: inv.tollAmount,
                                parkingAmount: inv.parkingAmount,
                                otherAmount: inv.otherAmount,
                                pphAmount: inv.pphAmount,
                                notes: inv.notes,
                              }}
                            />
                            <p className="mt-1 text-[10px] text-muted-foreground">{fmtDate(inv.invoiceDate)}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="text-xs text-foreground">{inv.clientCompany || inv.clientName || "—"}</p>
                            {inv.clientCompany && inv.clientName && (
                              <p className="text-[10px] text-muted-foreground">{inv.clientName}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {inv.dueDate ? fmtDate(inv.dueDate) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <p className="text-xs font-bold tabular-nums text-primary">{formatCurrency(inv.remaining)}</p>
                            <p className="text-[10px] text-muted-foreground tabular-nums">
                              Total {formatCurrency(inv.totalAmount)}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {used ? (
                              <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-1 rounded-lg">
                                Sudah dipakai
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => pickInvoice(inv)}
                                className="text-[10px] font-bold text-primary bg-primary-light hover:bg-primary/15 px-2.5 py-1.5 rounded-lg"
                              >
                                Ambil
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">
              Kolom sisa = total invoice − pembayaran yang sudah tercatat. Forecast tidak membuat pembayaran baru.
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-4 right-4 z-[80] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white animate-fade-in max-w-sm",
              t.type === "success" ? "bg-success" : "bg-danger",
            )}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );

  return (
    <RouteGuard permission="finance">
      {fullscreen ? (
        <div className="fixed inset-0 z-[55] bg-background overflow-y-auto p-3 sm:p-5">{page}</div>
      ) : (
        page
      )}
    </RouteGuard>
  );
}
