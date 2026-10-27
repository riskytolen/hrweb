"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Settings2,
  Tag,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Portal from "@/components/ui/Portal";
import { DEFAULT_FORECAST_EXPENSE_CATEGORY } from "@/lib/finance-forecast";
import type { DbFinanceForecastCategory } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface ForecastCategorySettingsModalProps {
  categories: DbFinanceForecastCategory[];
  canEdit: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<DbFinanceForecastCategory>;
  onRename: (id: number, name: string) => Promise<DbFinanceForecastCategory>;
}

const inputClass =
  "w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:ring-2 focus:ring-primary/10 aria-invalid:border-danger aria-invalid:focus:border-danger aria-invalid:focus:ring-danger/10";

function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function sortCategories(categories: DbFinanceForecastCategory[]): DbFinanceForecastCategory[] {
  return [...categories].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "id"),
  );
}

export default function ForecastCategorySettingsModal({
  categories,
  canEdit,
  onClose,
  onCreate,
  onRename,
}: ForecastCategorySettingsModalProps) {
  const focusDialog = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);
  const [search, setSearch] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [addError, setAddError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState("");

  const busy = creating || savingRename;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  const filteredCategories = useMemo(() => {
    const query = normalizeCategoryName(search);
    const ordered = sortCategories(categories);
    if (!query) return ordered;
    return ordered.filter((category) => normalizeCategoryName(category.name).includes(query));
  }, [categories, search]);

  const canRename = (category: DbFinanceForecastCategory) =>
    canEdit &&
    category.id > 0 &&
    normalizeCategoryName(category.name) !== DEFAULT_FORECAST_EXPENSE_CATEGORY;

  const handleAdd = async () => {
    if (!canEdit || busy) return;
    const name = normalizeCategoryName(newCategory);
    setAddError("");
    if (!name) {
      setAddError("Nama kategori wajib diisi.");
      return;
    }
    if (name.length > 60) {
      setAddError("Nama kategori maksimal 60 karakter.");
      return;
    }
    if (categories.some((category) => normalizeCategoryName(category.name) === name)) {
      setAddError("Kategori tersebut sudah ada.");
      return;
    }

    setCreating(true);
    try {
      await onCreate(name);
      setNewCategory("");
      setSearch("");
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Gagal menambahkan kategori.");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (category: DbFinanceForecastCategory) => {
    if (busy || !canRename(category)) return;
    setEditingId(category.id);
    setEditName(category.name);
    setRenameError("");
  };

  const cancelEdit = () => {
    if (savingRename) return;
    setEditingId(null);
    setEditName("");
    setRenameError("");
  };

  const handleRename = async () => {
    if (!canEdit || savingRename || editingId == null) return;
    const current = categories.find((category) => category.id === editingId);
    if (!current) {
      cancelEdit();
      return;
    }
    const name = normalizeCategoryName(editName);
    setRenameError("");
    if (!name) {
      setRenameError("Nama kategori wajib diisi.");
      return;
    }
    if (name.length > 60) {
      setRenameError("Nama kategori maksimal 60 karakter.");
      return;
    }
    if (name === current.name) {
      cancelEdit();
      return;
    }
    if (
      categories.some(
        (category) =>
          category.id !== editingId &&
          normalizeCategoryName(category.name) === name,
      )
    ) {
      setRenameError("Nama kategori sudah digunakan.");
      return;
    }

    setSavingRename(true);
    try {
      await onRename(editingId, name);
      setEditingId(null);
      setEditName("");
      setRenameError("");
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Gagal mengubah kategori.");
    } finally {
      setSavingRename(false);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
        <div
          className="absolute inset-0 bg-black/45 backdrop-blur-sm"
          onClick={close}
          aria-hidden="true"
        />
        <div
          ref={focusDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="forecast-category-settings-title"
          tabIndex={-1}
          className="relative flex max-h-[92dvh] w-full max-w-xl animate-slide-up flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl outline-none sm:max-h-[88vh] sm:animate-scale-in sm:rounded-2xl"
        >
          <div className="relative shrink-0 border-b border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-5 pb-4 pt-5">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
              aria-label="Tutup pengaturan kategori"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-3 pr-8">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white shadow-lg shadow-primary/20">
                <Settings2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="rounded-full bg-primary-light px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-primary">
                  Master Kategori
                </span>
                <h2
                  id="forecast-category-settings-title"
                  className="mt-0.5 text-base font-bold text-foreground"
                >
                  Atur Kategori Pengeluaran
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  Kelola nama kategori. Pemilihan kategori dilakukan saat mengisi pengeluaran.
                </p>
              </div>
            </div>
          </div>

          {canEdit ? (
            <div className="shrink-0 border-b border-border px-5 py-4">
              <label
                htmlFor="forecast-new-category"
                className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
              >
                Tambah Kategori Baru
              </label>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAdd();
                }}
                className="flex flex-col gap-2 sm:flex-row"
              >
                <input
                  id="forecast-new-category"
                  value={newCategory}
                  onChange={(event) => {
                    setNewCategory(event.target.value.toUpperCase());
                    setAddError("");
                  }}
                  maxLength={60}
                  disabled={busy}
                  placeholder="Contoh: BIAYA OPERASIONAL CABANG"
                  className={cn(
                    inputClass,
                    "min-w-0 flex-1 py-2 text-xs font-semibold",
                  )}
                  aria-invalid={Boolean(addError)}
                />
                <Button
                  type="submit"
                  size="sm"
                  icon={creating ? Loader2 : Plus}
                  disabled={busy || !newCategory.trim()}
                  className={creating ? "[&_svg]:animate-spin" : ""}
                >
                  {creating ? "Menambah..." : "Tambah Kategori"}
                </Button>
              </form>
              {addError ? (
                <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-danger">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {addError}
                </p>
              ) : (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Kategori baru langsung tersedia di pilihan pengeluaran, rekap bulanan, dan ekspor Forecast.
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 border-b border-border bg-muted/20 px-5 py-3 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Anda hanya dapat melihat daftar kategori. Perubahan memerlukan akses input/edit Finance.
            </div>
          )}

          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
            <div>
              <p className="text-xs font-bold text-foreground">Daftar Kategori</p>
              <p className="text-[10px] text-muted-foreground">
                {search.trim()
                  ? `${filteredCategories.length} dari ${categories.length} kategori`
                  : `${categories.length} kategori aktif`}
              </p>
            </div>
            {canEdit && (
              <span className="text-[10px] font-medium text-muted-foreground">
                Berlaku di semua bulan
              </span>
            )}
          </div>

          <div className="shrink-0 px-5 pb-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari kategori..."
                aria-label="Cari kategori"
                className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Hapus pencarian"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {filteredCategories.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <Tag className="mx-auto h-6 w-6 text-muted-foreground/40" />
                <p className="mt-2 text-xs font-semibold text-foreground">
                  {search.trim() ? "Kategori tidak ditemukan" : "Belum ada kategori"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {search.trim()
                    ? "Coba kata kunci lain."
                    : canEdit
                      ? "Tambahkan kategori baru melalui form di atas."
                      : "Belum ada kategori yang dapat ditampilkan."}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredCategories.map((category) => {
                  const isDefault =
                    normalizeCategoryName(category.name) === DEFAULT_FORECAST_EXPENSE_CATEGORY;
                  const editing = editingId === category.id;
                  return (
                    <div
                      key={category.id}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 transition-colors",
                        editing
                          ? "border-primary/30 bg-primary-light/30"
                          : "border-border bg-card hover:bg-muted/20",
                      )}
                    >
                      {editing ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <input
                              value={editName}
                              onChange={(event) => {
                                setEditName(event.target.value.toUpperCase());
                                setRenameError("");
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  cancelEdit();
                                  return;
                                }
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleRename();
                                }
                              }}
                              disabled={savingRename}
                              maxLength={60}
                              autoFocus
                              aria-label={`Nama baru untuk kategori ${category.name}`}
                              className={cn(
                                inputClass,
                                "min-w-0 flex-1 py-1.5 text-xs font-semibold",
                              )}
                              aria-invalid={Boolean(renameError)}
                            />
                            <button
                              type="button"
                              onClick={() => void handleRename()}
                              disabled={savingRename || !editName.trim()}
                              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-[10px] font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
                              title="Simpan nama kategori"
                            >
                              {savingRename ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              Simpan
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={savingRename}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                              title="Batal ubah nama"
                              aria-label="Batal ubah nama"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {renameError ? (
                            <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-danger">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              {renameError}
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              Nama baru otomatis dipakai seluruh pengeluaran terkait.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-light">
                            <Tag className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-xs font-bold text-foreground"
                              title={category.name}
                            >
                              {category.name}
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {isDefault
                                ? "Kategori fallback sistem"
                                : "Berlaku di semua bulan Forecast"}
                            </p>
                          </div>
                          {isDefault ? (
                            <span
                              title="Kategori fallback sistem tidak dapat diubah namanya"
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[9px] font-semibold text-muted-foreground"
                            >
                              <Lock className="h-2.5 w-2.5" />
                              Sistem
                            </span>
                          ) : canRename(category) ? (
                            <button
                              type="button"
                              onClick={() => startEdit(category)}
                              disabled={busy}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 text-[10px] font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-primary-light/40 disabled:opacity-40"
                              title={`Ubah nama ${category.name}`}
                            >
                              <Pencil className="h-2.5 w-2.5" />
                              Ubah
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 pt-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
          >
            <p className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
              <Info className="h-3 w-3 shrink-0" />
              Perubahan nama memperbarui rekap dan ekspor; nominal dan saldo tidak berubah.
            </p>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-40 sm:w-auto"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
