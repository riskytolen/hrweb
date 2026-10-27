"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Info,
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import DatePicker from "@/components/ui/DatePicker";
import Portal from "@/components/ui/Portal";
import Select from "@/components/ui/Select";
import {
  DEFAULT_FORECAST_EXPENSE_CATEGORY,
  type ForecastWeek,
} from "@/lib/finance-forecast";
import { cn, formatCurrency, localDateStr } from "@/lib/utils";

export type ForecastEntryMode = "income" | "expense";

export interface ForecastEntryValues {
  mode: ForecastEntryMode;
  plannedDate: string;
  description: string;
  amount: number;
  category: string;
  payment: number;
  admin: number;
}

interface ForecastEntryModalProps {
  mode: ForecastEntryMode;
  week: ForecastWeek;
  categories: string[];
  onClose: () => void;
  onSubmit: (values: ForecastEntryValues) => void;
  onCreateCategory?: (name: string) => Promise<string>;
}

type FieldErrors = Partial<
  Record<"plannedDate" | "description" | "amount" | "category" | "payment" | "admin", string>
>;

const inputClass =
  "w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:ring-2 focus:ring-primary/10";

function initialDate(week: ForecastWeek): string {
  const today = localDateStr();
  return today >= week.start && today <= week.end ? today : week.start;
}

function initialCategory(categories: string[]): string {
  return categories.find((category) => category === DEFAULT_FORECAST_EXPENSE_CATEGORY)
    ?? categories[0]
    ?? DEFAULT_FORECAST_EXPENSE_CATEGORY;
}

export default function ForecastEntryModal({
  mode,
  week,
  categories,
  onClose,
  onSubmit,
  onCreateCategory,
}: ForecastEntryModalProps) {
  const isIncome = mode === "income";
  const dialogRef = useRef<HTMLDivElement>(null);
  const [plannedDate, setPlannedDate] = useState(() => initialDate(week));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState(() => initialCategory(categories));
  const [payment, setPayment] = useState(0);
  const [admin, setAdmin] = useState(0);
  const [attempted, setAttempted] = useState(false);

  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creatingCategory) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [creatingCategory, onClose]);

  const errors = useMemo<FieldErrors>(() => {
    const next: FieldErrors = {};
    if (!plannedDate) {
      next.plannedDate = "Pilih tanggal rencana.";
    } else if (plannedDate < week.start || plannedDate > week.end) {
      next.plannedDate = `Tanggal harus di dalam Minggu ${week.weekNo} (${week.rangeLabel}).`;
    }
    if (!description.trim()) next.description = "Keterangan wajib diisi.";
    if (!Number.isFinite(amount) || Math.round(amount) <= 0) {
      next.amount = "Nominal harus lebih dari 0.";
    }
    if (!isIncome) {
      if (!category.trim()) next.category = "Pilih kategori pengeluaran.";
      if (!Number.isFinite(payment) || payment < 0) {
        next.payment = "Pembayaran tidak boleh negatif.";
      } else if (payment > amount) {
        next.payment = "Pembayaran tidak boleh melebihi nominal.";
      }
      if (!Number.isFinite(admin) || admin < 0) {
        next.admin = "Admin tidak boleh negatif.";
      }
    }
    return next;
  }, [admin, amount, category, description, isIncome, payment, plannedDate, week]);

  const visibleError = (field: keyof FieldErrors) =>
    attempted ? errors[field] : undefined;
  const hasErrors = Object.keys(errors).length > 0;
  const sisa = Math.round(amount) - Math.round(payment);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingCategory) return;
    setAttempted(true);
    if (hasErrors) return;
    onSubmit({
      mode,
      plannedDate,
      description: description.trim(),
      amount: Math.round(amount),
      category: isIncome ? "" : category,
      payment: isIncome ? 0 : Math.round(payment),
      admin: isIncome ? 0 : Math.round(admin),
    });
  };

  const handleAddCategory = async () => {
    if (!onCreateCategory || creatingCategory) return;
    const name = newCategory.trim().toUpperCase();
    setCategoryError("");
    if (!name) {
      setCategoryError("Nama kategori wajib diisi.");
      return;
    }
    setCreatingCategory(true);
    try {
      const savedName = await onCreateCategory(name);
      setCategory(savedName);
      setNewCategory("");
      setCategoryFormOpen(false);
    } catch (error) {
      setCategoryError(
        error instanceof Error ? error.message : "Gagal menambahkan kategori.",
      );
    } finally {
      setCreatingCategory(false);
    }
  };

  const close = () => {
    if (!creatingCategory) onClose();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
        <div
          className="absolute inset-0 bg-black/45 backdrop-blur-sm"
          onClick={close}
          aria-hidden="true"
        />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="forecast-entry-title"
          tabIndex={-1}
          className="relative flex max-h-[92dvh] w-full max-w-xl animate-slide-up flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl outline-none sm:max-h-[88vh] sm:animate-scale-in sm:rounded-2xl"
        >
          <div
            className={cn(
              "relative shrink-0 border-b border-border px-5 pb-4 pt-5",
              isIncome
                ? "bg-gradient-to-br from-success/10 via-success/5 to-transparent"
                : "bg-gradient-to-br from-danger/10 via-danger/5 to-transparent",
            )}
          >
            <button
              type="button"
              onClick={close}
              disabled={creatingCategory}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
              aria-label="Tutup form"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-3 pr-8">
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-lg",
                  isIncome
                    ? "bg-gradient-to-br from-success to-success/70 shadow-success/20"
                    : "bg-gradient-to-br from-danger to-danger/70 shadow-danger/20",
                )}
              >
                {isIncome ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em]",
                      isIncome
                        ? "bg-success-light text-success"
                        : "bg-danger-light text-danger",
                    )}
                  >
                    Minggu {week.weekNo}
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {week.rangeLabel}
                  </span>
                </div>
                <h2 id="forecast-entry-title" className="mt-0.5 text-base font-bold text-foreground">
                  Tambah {isIncome ? "Pemasukan" : "Pengeluaran"}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  Masuk ke draft • belum tersimpan sampai klik Simpan Forecast
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {attempted && hasErrors && (
                <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-light px-3 py-2.5 text-xs font-medium text-danger">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Lengkapi field bertanda merah sebelum menambahkan.
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-foreground">
                    Tanggal Rencana <span className="text-danger">*</span>
                  </label>
                  <DatePicker
                    value={plannedDate}
                    onChange={setPlannedDate}
                    placeholder="Pilih tanggal"
                    minDate={week.start}
                    maxDate={week.end}
                    hasError={Boolean(visibleError("plannedDate"))}
                  />
                  {visibleError("plannedDate") && (
                    <p className="mt-1 text-[10px] font-medium text-danger">
                      {visibleError("plannedDate")}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="forecast-entry-amount"
                    className="mb-1.5 block text-xs font-semibold text-foreground"
                  >
                    Nominal Rencana <span className="text-danger">*</span>
                  </label>
                  <CurrencyInput
                    id="forecast-entry-amount"
                    value={amount}
                    onChange={setAmount}
                    className="border-border bg-muted/30 py-2.5 font-bold"
                    aria-invalid={Boolean(visibleError("amount"))}
                  />
                  {visibleError("amount") ? (
                    <p className="mt-1 text-[10px] font-medium text-danger">
                      {visibleError("amount")}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Nominal rencana, bukan realisasi.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="forecast-entry-description"
                  className="mb-1.5 block text-xs font-semibold text-foreground"
                >
                  Keterangan <span className="text-danger">*</span>
                </label>
                <input
                  id="forecast-entry-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={
                    isIncome
                      ? "Contoh: Pelunasan invoice PT Maju Bersama"
                      : "Contoh: Gaji driver, BBM, tol ..."
                  }
                  className={cn(
                    inputClass,
                    visibleError("description") && "border-danger focus:border-danger focus:ring-danger/10",
                  )}
                  aria-invalid={Boolean(visibleError("description"))}
                />
                {visibleError("description") && (
                  <p className="mt-1 text-[10px] font-medium text-danger">
                    {visibleError("description")}
                  </p>
                )}
              </div>

              {!isIncome && (
                <>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-foreground">
                        Kategori Pengeluaran <span className="text-danger">*</span>
                      </label>
                      {onCreateCategory && (
                        <button
                          type="button"
                          onClick={() => {
                            setCategoryFormOpen((value) => !value);
                            setCategoryError("");
                          }}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary-light"
                        >
                          <Plus className="h-3 w-3" />
                          Kategori baru
                        </button>
                      )}
                    </div>
                    <Select
                      value={category}
                      onChange={setCategory}
                      options={categories.map((item) => ({ value: item, label: item }))}
                      placeholder="Pilih kategori"
                      searchable
                      portal
                      portalMinWidth={300}
                      hasError={Boolean(visibleError("category"))}
                    />
                    {visibleError("category") && (
                      <p className="mt-1 text-[10px] font-medium text-danger">
                        {visibleError("category")}
                      </p>
                    )}

                    {categoryFormOpen && (
                      <div className="mt-2 rounded-xl border border-primary/20 bg-primary-light/30 p-2.5">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            value={newCategory}
                            onChange={(event) => {
                              setNewCategory(event.target.value.toUpperCase());
                              setCategoryError("");
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                event.stopPropagation();
                                setCategoryFormOpen(false);
                                setNewCategory("");
                                setCategoryError("");
                                return;
                              }
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleAddCategory();
                              }
                            }}
                            maxLength={60}
                            disabled={creatingCategory}
                            aria-label="Nama kategori baru"
                            placeholder="Contoh: BIAYA OPERASIONAL CABANG"
                            className={cn(inputClass, "min-w-0 flex-1 py-2 text-xs font-semibold")}
                          />
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              icon={creatingCategory ? Loader2 : Plus}
                              onClick={() => void handleAddCategory()}
                              disabled={creatingCategory || !newCategory.trim()}
                              className={creatingCategory ? "[&_svg]:animate-spin" : ""}
                            >
                              {creatingCategory ? "Menambah..." : "Tambah"}
                            </Button>
                            <button
                              type="button"
                              onClick={() => {
                                setCategoryFormOpen(false);
                                setNewCategory("");
                                setCategoryError("");
                              }}
                              disabled={creatingCategory}
                              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
                              aria-label="Batal tambah kategori"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        {categoryError ? (
                          <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-danger">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            {categoryError}
                          </p>
                        ) : (
                          <p className="mt-1.5 text-[10px] text-muted-foreground">
                            Kategori baru langsung tersedia di rekap dan ekspor Forecast.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-foreground">Rincian Pembayaran</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Opsional • hanya pelacakan pembayaran.
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                          Sisa Kewajiban
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-sm font-extrabold tabular-nums",
                            sisa < 0 ? "text-danger" : sisa === 0 ? "text-muted-foreground" : "text-warning",
                          )}
                        >
                          {amount > 0 ? formatCurrency(sisa) : "—"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="forecast-entry-payment"
                          className="mb-1.5 block text-[11px] font-semibold text-foreground"
                        >
                          Pembayaran
                        </label>
                        <CurrencyInput
                          id="forecast-entry-payment"
                          value={payment}
                          onChange={setPayment}
                          aria-invalid={Boolean(visibleError("payment"))}
                        />
                        {visibleError("payment") && (
                          <p className="mt-1 text-[10px] font-medium text-danger">
                            {visibleError("payment")}
                          </p>
                        )}
                      </div>
                      <div>
                        <label
                          htmlFor="forecast-entry-admin"
                          className="mb-1.5 block text-[11px] font-semibold text-foreground"
                        >
                          Admin
                        </label>
                        <CurrencyInput
                          id="forecast-entry-admin"
                          value={admin}
                          onChange={setAdmin}
                          aria-invalid={Boolean(visibleError("admin"))}
                        />
                        {visibleError("admin") && (
                          <p className="mt-1 text-[10px] font-medium text-danger">
                            {visibleError("admin")}
                          </p>
                        )}
                      </div>
                    </div>

                    <p className="mt-2.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      Pembayaran tidak mengurangi nominal pengeluaran. Admin dihitung pada saldo akhir Forecast.
                    </p>
                  </div>
                </>
              )}

              {isIncome && (
                <div className="flex items-start gap-2 rounded-xl border border-success/20 bg-success-light/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>
                    Pemasukan ini akan menambah saldo Minggu {week.weekNo}. Untuk mengambil sisa tagihan
                    invoice, gunakan tombol <strong className="text-foreground">Invoice</strong> di panel
                    pemasukan.
                  </span>
                </div>
              )}
            </div>

            <div
              className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-muted/20 px-5 pt-3 sm:justify-between"
              style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
            >
              <p className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
                <Info className="h-3 w-3 shrink-0" />
                Data masuk ke draft Forecast.
              </p>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={close}
                  disabled={creatingCategory}
                  className="flex-1 sm:flex-none"
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  variant={isIncome ? "primary" : "danger"}
                  icon={isIncome ? TrendingUp : TrendingDown}
                  className="flex-1 sm:flex-none"
                  disabled={creatingCategory}
                >
                  Tambahkan
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
