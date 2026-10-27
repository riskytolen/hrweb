"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Copy,
  Info,
  Plus,
  ReceiptText,
  Tag,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Portal from "@/components/ui/Portal";
import { fmtDate } from "@/lib/finance";
import type { ForecastWeekNo } from "@/lib/finance-forecast";
import { cn, formatCurrency } from "@/lib/utils";

export interface ForecastCopyIncomeCandidate {
  sourceId: number;
  description: string;
  plannedDate: string;
  weekNo: ForecastWeekNo;
  amount: number;
  previousAmount: number;
  invoiceId: number | null;
  invoiceNo: string | null;
  duplicate: boolean;
  unavailableReason: string | null;
}

export interface ForecastCopyExpenseCandidate {
  sourceId: number;
  description: string;
  plannedDate: string;
  weekNo: ForecastWeekNo;
  amount: number;
  admin: number;
  category: string;
  duplicate: boolean;
}

export interface ForecastCopySelection {
  incomes: ForecastCopyIncomeCandidate[];
  expenses: ForecastCopyExpenseCandidate[];
}

interface ForecastCopyPreviousModalProps {
  previousMonthLabel: string;
  currentMonthLabel: string;
  incomes: ForecastCopyIncomeCandidate[];
  expenses: ForecastCopyExpenseCandidate[];
  onClose: () => void;
  onAdd: (selection: ForecastCopySelection) => void;
}

type CopyTab = "income" | "expense";

function incomeSelectable(item: ForecastCopyIncomeCandidate): boolean {
  return !item.duplicate && !item.unavailableReason && Math.round(item.amount) > 0;
}

function expenseSelectable(item: ForecastCopyExpenseCandidate): boolean {
  return !item.duplicate && Math.round(item.amount) > 0;
}

export default function ForecastCopyPreviousModal({
  previousMonthLabel,
  currentMonthLabel,
  incomes,
  expenses,
  onClose,
  onAdd,
}: ForecastCopyPreviousModalProps) {
  const focusDialog = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);
  const submittedRef = useRef(false);

  const selectableIncomeIds = useMemo(
    () => incomes.filter(incomeSelectable).map((income) => income.sourceId),
    [incomes],
  );
  const selectableExpenseIds = useMemo(
    () => expenses.filter(expenseSelectable).map((expense) => expense.sourceId),
    [expenses],
  );

  const [activeTab, setActiveTab] = useState<CopyTab>(() => {
    if (incomes.some(incomeSelectable)) return "income";
    if (expenses.some(expenseSelectable)) return "expense";
    return incomes.length > 0 ? "income" : "expense";
  });
  const [selectedIncomeIds, setSelectedIncomeIds] = useState<Set<number>>(
    () => new Set(selectableIncomeIds),
  );
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<number>>(
    () => new Set(selectableExpenseIds),
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const selectedIncomeCount = incomes.filter((income) => (
    selectedIncomeIds.has(income.sourceId)
  )).length;
  const selectedExpenseCount = expenses.filter((expense) => (
    selectedExpenseIds.has(expense.sourceId)
  )).length;
  const selectedTotal = selectedIncomeCount + selectedExpenseCount;

  const allIncomeSelected = selectableIncomeIds.length > 0 &&
    selectableIncomeIds.every((id) => selectedIncomeIds.has(id));
  const allExpenseSelected = selectableExpenseIds.length > 0 &&
    selectableExpenseIds.every((id) => selectedExpenseIds.has(id));

  const toggleIncome = (id: number) => {
    setSelectedIncomeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpense = (id: number) => {
    setSelectedExpenseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (activeTab === "income") {
      setSelectedIncomeIds((prev) => {
        const next = new Set(prev);
        if (allIncomeSelected) {
          for (const id of selectableIncomeIds) next.delete(id);
        } else {
          for (const id of selectableIncomeIds) next.add(id);
        }
        return next;
      });
      return;
    }
    setSelectedExpenseIds((prev) => {
      const next = new Set(prev);
      if (allExpenseSelected) {
        for (const id of selectableExpenseIds) next.delete(id);
      } else {
        for (const id of selectableExpenseIds) next.add(id);
      }
      return next;
    });
  };

  const handleAdd = () => {
    if (submittedRef.current) return;
    const chosenIncomes = incomes.filter((income) => selectedIncomeIds.has(income.sourceId));
    const chosenExpenses = expenses.filter((expense) => selectedExpenseIds.has(expense.sourceId));
    if (chosenIncomes.length + chosenExpenses.length === 0) return;
    submittedRef.current = true;
    onAdd({ incomes: chosenIncomes, expenses: chosenExpenses });
  };

  const activeSelectable = activeTab === "income"
    ? selectableIncomeIds.length
    : selectableExpenseIds.length;
  const allActiveSelected = activeTab === "income" ? allIncomeSelected : allExpenseSelected;

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
        <div
          className="absolute inset-0 bg-black/45 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={focusDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="forecast-copy-title"
          tabIndex={-1}
          className="relative flex max-h-[92dvh] w-full max-w-2xl animate-slide-up flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl outline-none sm:max-h-[88vh] sm:animate-scale-in sm:rounded-2xl"
        >
          <div className="relative shrink-0 border-b border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-5 pb-4 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
              aria-label="Tutup salin Forecast"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-3 pr-8">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white shadow-lg shadow-primary/20">
                <Copy className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="rounded-full bg-primary-light px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-primary">
                  {previousMonthLabel}
                </span>
                <h2 id="forecast-copy-title" className="mt-0.5 text-base font-bold text-foreground">
                  Ambil dari Bulan Lalu
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  Salin pemasukan dan pengeluaran ke draft {currentMonthLabel}.
                </p>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-b border-border px-5 py-3">
            <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary-light/30 px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                Sumber: Forecast {previousMonthLabel}. Pembayaran pengeluaran direset ke 0,
                invoice memakai sisa tagihan saat ini, dan tanggal disesuaikan ke{" "}
                {currentMonthLabel}.
              </span>
            </div>
          </div>

          <div className="shrink-0 border-b border-border px-5 py-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
              <button
                type="button"
                onClick={() => setActiveTab("income")}
                aria-pressed={activeTab === "income"}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] transition-all",
                  activeTab === "income"
                    ? "bg-card font-bold text-success shadow-sm"
                    : "font-semibold text-muted-foreground hover:bg-card/60",
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Pemasukan
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums",
                  activeTab === "income" ? "bg-success-light text-success" : "bg-card/70 text-muted-foreground",
                )}>
                  {selectedIncomeCount}/{incomes.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("expense")}
                aria-pressed={activeTab === "expense"}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] transition-all",
                  activeTab === "expense"
                    ? "bg-card font-bold text-danger shadow-sm"
                    : "font-semibold text-muted-foreground hover:bg-card/60",
                )}
              >
                <TrendingDown className="h-3.5 w-3.5" />
                Pengeluaran
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums",
                  activeTab === "expense" ? "bg-danger-light text-danger" : "bg-card/70 text-muted-foreground",
                )}>
                  {selectedExpenseCount}/{expenses.length}
                </span>
              </button>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {activeTab === "income" ? "Daftar pemasukan" : "Daftar pengeluaran"}
            </p>
            <label className={cn(
              "flex items-center gap-1.5 text-[10px] font-semibold text-foreground",
              activeSelectable === 0 && "cursor-not-allowed opacity-50",
            )}>
              <input
                type="checkbox"
                checked={allActiveSelected}
                onChange={toggleAll}
                disabled={activeSelectable === 0}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              Pilih semua yang bisa diambil
            </label>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-4">
            {activeTab === "income" ? (
              incomes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
                  Tidak ada pemasukan di Forecast {previousMonthLabel}.
                </div>
              ) : (
                <div className="space-y-2">
                  {incomes.map((item) => {
                    const selectable = incomeSelectable(item);
                    const checked = selectedIncomeIds.has(item.sourceId);
                    return (
                      <label
                        key={item.sourceId}
                        className={cn(
                          "flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors",
                          checked
                            ? "border-primary/30 bg-primary-light/20"
                            : "border-border bg-card",
                          selectable && "cursor-pointer hover:border-primary/20 hover:bg-muted/20",
                          !selectable && "opacity-65",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!selectable}
                          onChange={() => toggleIncome(item.sourceId)}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p
                              className="truncate text-xs font-bold text-foreground"
                              title={item.description}
                            >
                              {item.description}
                            </p>
                            {item.invoiceId != null && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-primary-light px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                                <ReceiptText className="h-2.5 w-2.5" />
                                Invoice {item.invoiceNo ?? `#${item.invoiceId}`}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays className="h-2.5 w-2.5" />
                              {fmtDate(item.plannedDate)}
                            </span>
                            {item.invoiceId != null && <span>Sisa tagihan saat ini</span>}
                          </div>
                          {item.duplicate ? (
                            <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-warning">
                              <Info className="h-2.5 w-2.5 shrink-0" />
                              {item.invoiceId != null
                                ? "Invoice sudah dipakai di draft bulan ini"
                                : "Sudah ada di draft bulan ini"}
                            </p>
                          ) : item.unavailableReason ? (
                            <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-danger">
                              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                              {item.unavailableReason}
                            </p>
                          ) : Math.round(item.amount) <= 0 ? (
                            <p className="mt-1 text-[10px] font-semibold text-danger">
                              Nominal tidak valid.
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-extrabold tabular-nums text-success">
                            {formatCurrency(item.amount)}
                          </p>
                          {item.invoiceId != null && item.previousAmount !== item.amount && (
                            <p className="mt-0.5 text-[9px] text-muted-foreground line-through">
                              Rencana {formatCurrency(item.previousAmount)}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )
            ) : expenses.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
                Tidak ada pengeluaran di Forecast {previousMonthLabel}.
              </div>
            ) : (
              <div className="space-y-2">
                {expenses.map((item) => {
                  const selectable = expenseSelectable(item);
                  const checked = selectedExpenseIds.has(item.sourceId);
                  return (
                    <label
                      key={item.sourceId}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors",
                        checked
                          ? "border-primary/30 bg-primary-light/20"
                          : "border-border bg-card",
                        selectable && "cursor-pointer hover:border-primary/20 hover:bg-muted/20",
                        !selectable && "opacity-65",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!selectable}
                        onChange={() => toggleExpense(item.sourceId)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-xs font-bold text-foreground"
                          title={item.description}
                        >
                          {item.description}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-2.5 w-2.5" />
                            {fmtDate(item.plannedDate)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-danger-light px-1.5 py-0.5 font-semibold text-danger">
                            <Tag className="h-2.5 w-2.5" />
                            {item.category}
                          </span>
                          {item.admin > 0 && <span>Admin {formatCurrency(item.admin)}</span>}
                        </div>
                        {item.duplicate ? (
                          <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-warning">
                            <Info className="h-2.5 w-2.5 shrink-0" />
                            Sudah ada di draft bulan ini
                          </p>
                        ) : Math.round(item.amount) <= 0 ? (
                          <p className="mt-1 text-[10px] font-semibold text-danger">
                            Nominal tidak valid.
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-extrabold tabular-nums text-danger">
                          {formatCurrency(item.amount)}
                        </p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">
                          Pembayaran 0
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div
            className="flex shrink-0 flex-col gap-2 border-t border-border bg-muted/20 px-5 pt-3 sm:flex-row sm:items-center sm:justify-between"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
          >
            <p className="text-[10px] font-medium text-muted-foreground">
              <span className="font-bold text-foreground">{selectedIncomeCount}</span> pemasukan •{" "}
              <span className="font-bold text-foreground">{selectedExpenseCount}</span> pengeluaran dipilih
            </p>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1 sm:flex-none"
              >
                Batal
              </Button>
              <Button
                type="button"
                icon={Plus}
                onClick={handleAdd}
                disabled={selectedTotal === 0}
                className="flex-1 sm:flex-none"
              >
                Tambahkan ke Draft
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
