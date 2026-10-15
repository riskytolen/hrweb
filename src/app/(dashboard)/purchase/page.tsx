"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ShoppingCart, Plus, Search, Pencil, Trash2, X, RefreshCw, Eye, Paperclip,
  Wallet, Banknote, FileText, CheckCircle2, AlertCircle, SlidersHorizontal,
  CalendarDays, User, Building2, Landmark, Clock, Loader2,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import DatePicker from "@/components/ui/DatePicker";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import Select from "@/components/ui/Select";
import { Skeleton, SkeletonTable, SkeletonList } from "@/components/ui/Skeleton";
import RouteGuard from "@/components/RouteGuard";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PURCHASE_ATTACHMENT_MIME_TYPES,
  PURCHASE_DEFAULT_PAGE_SIZE,
  PURCHASE_MAX_ATTACHMENTS,
  PURCHASE_PAGE_SIZES,
  PURCHASE_PAYMENT_STATUS_META,
  PURCHASE_PROCESS_STATUSES,
  canTransitionPurchaseStatus,
  purchaseAttachmentError,
  purchasePaymentStatus,
  purchaseStatusNeedsReason,
  validatePurchaseForm,
  validatePurchasePayment,
  type PurchasePaymentStatus,
  type PurchaseProcessStatus,
} from "@/lib/purchase";

const inputClass = "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";
const labelClass = "text-xs font-semibold text-foreground mb-1.5 block";
const errClass = "text-[11px] text-danger mt-1";

const TONE_TO_BADGE = {
  info: "info",
  primary: "default",
  warning: "warning",
  success: "success",
  danger: "danger",
  muted: "muted",
} as const;

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function fmtFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan. Silakan coba lagi.");
  return data as T;
}

async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah file.");
  return data as T;
}

// ─── Types ───

interface PurchaseContext {
  canRequest: boolean;
  canManage: boolean;
  isSuperAdmin: boolean;
  hasAccess: boolean;
  employeeId: string | null;
  employeeName: string;
  jabatanId: number | null;
  jabatanNama: string;
}

interface PoListItem {
  id: number;
  po_no: string;
  title: string;
  amount: number;
  vendor_name: string;
  process_status: PurchaseProcessStatus;
  total_paid: number;
  submitted_at: string;
  submitted_by: string;
  requester_name: string;
  requester_jabatan_id: number | null;
  requester_jabatan_nama: string;
  payment_status: PurchasePaymentStatus;
  remaining: number;
}

interface PoDetail extends PoListItem {
  detail: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  purpose: string;
}

interface PoPayment {
  id: number;
  payment_date: string;
  amount: number;
  notes: string | null;
}

interface PoAttachment {
  id: number;
  file_name: string;
  mime_type: string;
  file_size: number;
  kind: "bukti" | "pembayaran";
  payment_id: number | null;
  created_at: string;
}

interface PoEvent {
  id: number;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
}

interface StatusSummary {
  status: PurchaseProcessStatus;
  label: string;
  count: number;
  poTotal: number;
  paidTotal: number;
  percent: number;
}

interface JabatanSummary {
  jabatan_id: number | null;
  jabatan_nama: string;
  count: number;
  poTotal: number;
  paidTotal: number;
  remaining: number;
}

interface SummaryData {
  mode: "submit" | "pay";
  totalOrders?: number;
  poTotal?: number;
  paidTotal?: number;
  remaining?: number;
  count?: number;
  byStatus?: StatusSummary[];
  byJabatan?: JabatanSummary[];
}

interface Toast { id: number; type: "success" | "error"; msg: string }

let toastId = 1;
let idemCounter = 0;
function newIdempotencyKey(): string {
  idemCounter += 1;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `po-${Date.now()}-${idemCounter}-${Math.random().toString(36).slice(2)}`;
}

function statusLabel(value: string): string {
  return PURCHASE_PROCESS_STATUSES.find((s) => s.value === value)?.label || value;
}

function statusTone(value: string): keyof typeof TONE_TO_BADGE {
  return PURCHASE_PROCESS_STATUSES.find((s) => s.value === value)?.tone || "muted";
}

function eventLabel(e: PoEvent): string {
  switch (e.event_type) {
    case "created": return "PO dibuat";
    case "edited": return "Pengajuan diubah";
    case "status_change": return `Status: ${statusLabel(e.from_status || "")} → ${statusLabel(e.to_status || "")}`;
    case "note": return "Catatan Purchasing";
    case "payment": return "Pembayaran dicatat";
    case "attachment": return "Lampiran ditambahkan";
    default: return e.event_type;
  }
}

const EMPTY_FORM = {
  title: "", detail: "", amount: 0, vendor_name: "", bank_name: "",
  account_number: "", account_name: "", purpose: "",
};

type StagedFile = { key: number; file: File; status: "idle" | "uploading" | "done" | "error"; error?: string };
let stagedKey = 0;

export default function PurchasePage() {
  const [ctx, setCtx] = useState<PurchaseContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);
  const [ctxError, setCtxError] = useState("");
  const [tab, setTab] = useState<"dashboard" | "list" | "settings">("dashboard");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: "success" | "error", msg: string) => {
    const id = toastId++;
    setToasts((prev) => [...prev.slice(-3), { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const fetchContext = useCallback(async () => {
    setCtxLoading(true);
    setCtxError("");
    try {
      const data = await api<PurchaseContext>("/api/purchase/context");
      setCtx(data);
    } catch (err) {
      setCtxError(err instanceof Error ? err.message : "Gagal memuat akses.");
    } finally {
      setCtxLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => { await fetchContext(); })();
  }, [fetchContext]);

  return (
    <RouteGuard permission="dashboard">
      <PageHeader
        title="Purchase"
        description="Pengajuan PO internal, proses Purchasing, dan pembayaran"
        icon={ShoppingCart}
      />
      {ctxLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card rounded-2xl border border-border p-5"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-32 mt-2" /></div>
            ))}
          </div>
          <SkeletonList rows={5} cols={4} />
        </div>
      ) : ctxError || !ctx ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <AlertCircle className="w-10 h-10 text-danger mx-auto" />
          <p className="text-sm font-semibold text-foreground mt-3">{ctxError || "Gagal memuat akses."}</p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => void fetchContext()}>
            <RefreshCw className="w-3.5 h-3.5" /> Coba lagi
          </Button>
        </div>
      ) : !ctx.hasAccess ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-sm font-semibold text-foreground mt-3">Anda belum memiliki akses modul Purchase</p>
          <p className="text-xs text-muted-foreground mt-1">Akses ditentukan dari jabatan pegawai. Hubungi Super Admin untuk pengaturan jabatan pengaju.</p>
        </div>
      ) : (
        <PurchaseBody ctx={ctx} tab={tab} setTab={setTab} addToast={addToast} />
      )}
      <div className="fixed bottom-4 right-4 z-[70] space-y-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white", t.type === "success" ? "bg-success" : "bg-danger")}>
            {t.msg}
          </div>
        ))}
      </div>
    </RouteGuard>
  );
}

// ─── Body (tabs) ───

function PurchaseBody({ ctx, tab, setTab, addToast }: {
  ctx: PurchaseContext;
  tab: "dashboard" | "list" | "settings";
  setTab: (t: "dashboard" | "list" | "settings") => void;
  addToast: (type: "success" | "error", msg: string) => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  return (
    <div>
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border w-fit mb-4" role="tablist" aria-label="Navigasi Purchase">
        {([
          { key: "dashboard", label: "Dashboard" },
          { key: "list", label: "Daftar PO" },
          ...(ctx.isSuperAdmin ? [{ key: "settings", label: "Pengaturan" }] : []),
        ] as { key: "dashboard" | "list" | "settings"; label: string }[]).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[36px]",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "dashboard" && <DashboardView ctx={ctx} refreshKey={refreshKey} onOpenList={() => setTab("list")} />}
      {tab === "list" && <ListView ctx={ctx} refreshKey={refreshKey} addToast={addToast} onChanged={refresh} />}
      {tab === "settings" && ctx.isSuperAdmin && <SettingsView addToast={addToast} />}
    </div>
  );
}

// ─── Dashboard ───

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function DashboardView({ ctx, refreshKey, onOpenList }: {
  ctx: PurchaseContext;
  refreshKey: number;
  onOpenList: () => void;
}) {
  const [mode, setMode] = useState<"submit" | "pay">("submit");
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchSummary = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [y, m] = month.split("-");
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      const params = new URLSearchParams({
        mode,
        date_from: `${month}-01`,
        date_to: `${month}-${String(lastDay).padStart(2, "0")}`,
      });
      const res = await api<SummaryData>(`/api/purchase/summary?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat ringkasan.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, month]);

  useEffect(() => {
    (async () => { await fetchSummary(true); })();
  }, [fetchSummary, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border w-fit" role="tablist" aria-label="Basis periode">
          {([{ key: "submit", label: "Periode Pengajuan" }, { key: "pay", label: "Periode Pembayaran" }] as const).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={mode === t.key}
              onClick={() => setMode(t.key)}
              className={cn("px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[36px]", mode === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-card text-sm text-foreground outline-none focus:border-primary"
            aria-label="Pilih bulan"
          />
          {refreshing && <span className="text-[11px] text-muted-foreground">Memperbarui…</span>}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-5"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-32 mt-2" /></div>
          ))}
        </div>
      ) : error || !data ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <AlertCircle className="w-10 h-10 text-danger mx-auto" />
          <p className="text-sm font-semibold text-foreground mt-3">{error || "Gagal memuat ringkasan."}</p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => void fetchSummary(true)}>
            <RefreshCw className="w-3.5 h-3.5" /> Coba lagi
          </Button>
        </div>
      ) : data.mode === "pay" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard label="Transaksi Pembayaran" value={String(data.count || 0)} sub="Periode pembayaran aktual" icon={<Banknote className="w-4 h-4 text-success" />} />
          <KpiCard label="Total Dibayarkan" value={formatCurrency(data.paidTotal || 0)} sub="Kas keluar periode ini" icon={<Wallet className="w-4 h-4 text-primary" />} tone="success" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total Pengajuan" value={String(data.totalOrders || 0)} sub="PO pada periode" icon={<FileText className="w-4 h-4 text-primary" />} onClick={onOpenList} />
            <KpiCard label="Nilai PO" value={formatCurrency(data.poTotal || 0)} sub="Total nominal diajukan" icon={<ShoppingCart className="w-4 h-4 text-accent" />} tone="primary" />
            <KpiCard label="Terbayar" value={formatCurrency(data.paidTotal || 0)} sub="Pembayaran aktual kohort" icon={<CheckCircle2 className="w-4 h-4 text-success" />} tone="success" />
            <KpiCard label="Sisa" value={formatCurrency(data.remaining || 0)} sub="Belum dibayarkan" icon={<Clock className="w-4 h-4 text-warning" />} tone="warning" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="p-4 border-b border-border">
                <h2 className="text-sm font-bold text-foreground">Ringkasan Status</h2>
                <p className="text-[11px] text-muted-foreground">Jumlah & nominal PO per status proses</p>
              </div>
              <div className="p-4 space-y-3">
                {(data.byStatus || []).map((s) => (
                  <div key={s.status}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 min-w-0">
                        <StatusBadge status={s.status} />
                        <span className="text-muted-foreground tabular-nums">{s.count} PO</span>
                      </span>
                      <span className="font-semibold text-foreground tabular-nums">{formatCurrency(s.poTotal)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden" role="progressbar" aria-valuenow={Math.round(s.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${s.label} ${s.percent.toFixed(1)} persen`}>
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, s.percent)}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">{s.percent.toFixed(1)}% • terbayar {formatCurrency(s.paidTotal)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="p-4 border-b border-border">
                <h2 className="text-sm font-bold text-foreground">Rekap per Jabatan</h2>
                <p className="text-[11px] text-muted-foreground">{ctx.canManage ? "Seluruh jabatan" : `Jabatan ${ctx.jabatanNama || "Anda"}`}</p>
              </div>
              {(data.byJabatan || []).length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">Belum ada pengajuan pada periode ini.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 font-semibold">Jabatan</th>
                        <th className="px-4 py-3 font-semibold text-right">PO</th>
                        <th className="px-4 py-3 font-semibold text-right">Nilai</th>
                        <th className="px-4 py-3 font-semibold text-right">Terbayar</th>
                        <th className="px-4 py-3 font-semibold text-right">Sisa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {data.byJabatan!.map((j) => (
                        <tr key={j.jabatan_id === null ? "none" : j.jabatan_id} className="hover:bg-muted/20">
                          <td className="px-4 py-3 font-medium text-foreground">{j.jabatan_nama}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{j.count}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(j.poTotal)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-success">{formatCurrency(j.paidTotal)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-warning">{formatCurrency(j.remaining)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, icon, tone, onClick }: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  tone?: "primary" | "success" | "warning"; onClick?: () => void;
}) {
  const valueClass = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "primary" ? "text-primary" : "text-foreground";
  const card = (
    <div className={cn("bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm", onClick && "cursor-pointer hover:border-primary/40 transition-colors")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">{icon}</div>
      </div>
      <p className={cn("text-xl sm:text-2xl font-bold mt-1.5 tabular-nums", valueClass)}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </div>
  );
  if (!onClick) return card;
  return <button type="button" onClick={onClick} className="text-left" aria-label={`Lihat ${label}`}>{card}</button>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={TONE_TO_BADGE[statusTone(status)]}>{statusLabel(status)}</Badge>;
}

function PayBadge({ status }: { status: PurchasePaymentStatus }) {
  const meta = PURCHASE_PAYMENT_STATUS_META[status];
  return <Badge variant={meta.tone === "warning" ? "warning" : meta.tone === "success" ? "success" : "muted"}>{meta.label}</Badge>;
}

// ─── Daftar PO ───

interface ListFilters {
  q: string;
  process_status: string;
  pay_status: string;
  jabatan_id: string;
  date_from: string;
  date_to: string;
  sort: string;
  dir: "asc" | "desc";
}

const EMPTY_FILTERS: ListFilters = {
  q: "", process_status: "", pay_status: "", jabatan_id: "",
  date_from: "", date_to: "", sort: "submitted_at", dir: "desc",
};

function readInitialFilters(): { filters: ListFilters; page: number; pageSize: number } {
  if (typeof window === "undefined") return { filters: EMPTY_FILTERS, page: 1, pageSize: PURCHASE_DEFAULT_PAGE_SIZE };
  const sp = new URLSearchParams(window.location.search);
  const pick = (k: keyof ListFilters, fallback: string) => sp.get(k) || fallback;
  return {
    filters: {
      q: sp.get("q") || "",
      process_status: pick("process_status", ""),
      pay_status: pick("pay_status", ""),
      jabatan_id: pick("jabatan_id", ""),
      date_from: pick("date_from", ""),
      date_to: pick("date_to", ""),
      sort: ["submitted_at", "amount", "po_no"].includes(sp.get("sort") || "") ? (sp.get("sort") as string) : "submitted_at",
      dir: sp.get("dir") === "asc" ? "asc" : "desc",
    },
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: PURCHASE_PAGE_SIZES.includes(Number(sp.get("pageSize")) as 10) ? Number(sp.get("pageSize")) : PURCHASE_DEFAULT_PAGE_SIZE,
  };
}

function ListView({ ctx, refreshKey, addToast, onChanged }: {
  ctx: PurchaseContext;
  refreshKey: number;
  addToast: (t: "success" | "error", m: string) => void;
  onChanged: () => void;
}) {
  const initial = useMemo(() => readInitialFilters(), []);
  const [filters, setFilters] = useState<ListFilters>(initial.filters);
  const [qInput, setQInput] = useState(initial.filters.q);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState<number>(initial.pageSize);
  const [items, setItems] = useState<PoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PoDetail | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput }));
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const fetchList = useCallback(async (initialLoad: boolean) => {
    if (initialLoad) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        q: filters.q,
        process_status: filters.process_status,
        pay_status: filters.pay_status,
        jabatan_id: filters.jabatan_id,
        date_from: filters.date_from,
        date_to: filters.date_to,
        sort: filters.sort,
        dir: filters.dir,
      });
      const res = await api<{ items: PoListItem[]; total: number }>(`/api/purchase/orders?${params.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat daftar PO.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    (async () => { await fetchList(true); })();
  }, [fetchList, refreshKey]);

  // Sinkron filter ke URL.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.process_status) params.set("process_status", filters.process_status);
    if (filters.pay_status) params.set("pay_status", filters.pay_status);
    if (filters.jabatan_id) params.set("jabatan_id", filters.jabatan_id);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    if (filters.sort !== "submitted_at") params.set("sort", filters.sort);
    if (filters.dir !== "desc") params.set("dir", filters.dir);
    if (page !== 1) params.set("page", String(page));
    if (pageSize !== PURCHASE_DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSize));
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/purchase?${qs}` : "/purchase");
  }, [filters, page, pageSize]);

  const setFilter = (patch: Partial<ListFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setQInput("");
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const openCreate = () => {
    if (!ctx.employeeId) {
      addToast("error", "Akun Anda belum terhubung ke pegawai aktif.");
      return;
    }
    setEditingOrder(null);
    setFormOpen(true);
  };

  const openEdit = async (item: PoListItem) => {
    try {
      const res = await api<{ item: PoDetail }>(`/api/purchase/orders/${item.id}`);
      setEditingOrder(res.item);
      setFormOpen(true);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Gagal membuka PO.");
    }
  };

  const activeFilterCount = [filters.process_status, filters.pay_status, filters.jabatan_id, filters.date_from, filters.date_to, filters.q].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-border shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Cari nomor, judul, pengaju, vendor…"
              className="bg-transparent outline-none text-sm flex-1 placeholder:text-muted-foreground/60 text-foreground"
              aria-label="Cari PO"
            />
            {qInput && (
              <button onClick={() => setQInput("")} className="p-1 rounded hover:bg-card text-muted-foreground" aria-label="Bersihkan pencarian">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
              Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
            {ctx.canRequest && (
              <Button size="sm" icon={Plus} onClick={openCreate}>Buat PO</Button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-1">
            <div>
              <label className={labelClass} htmlFor="flt-status">Status Proses</label>
              <Select
                value={filters.process_status}
                onChange={(v) => setFilter({ process_status: v })}
                placeholder="Semua status"
                options={[{ value: "", label: "Semua status" }, ...PURCHASE_PROCESS_STATUSES.map((s) => ({ value: s.value, label: s.label }))]}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="flt-pay">Status Bayar</label>
              <Select
                value={filters.pay_status}
                onChange={(v) => setFilter({ pay_status: v })}
                placeholder="Semua"
                options={[
                  { value: "", label: "Semua" },
                  { value: "unpaid", label: "Belum Dibayar" },
                  { value: "installment", label: "Installment" },
                  { value: "paid", label: "Paid" },
                ]}
              />
            </div>
            <div>
              <label className={labelClass}>Dari Tanggal</label>
              <DatePicker value={filters.date_from} onChange={(v) => setFilter({ date_from: v })} maxDate={filters.date_to || undefined} />
            </div>
            <div>
              <label className={labelClass}>Sampai Tanggal</label>
              <DatePicker value={filters.date_to} onChange={(v) => setFilter({ date_to: v })} minDate={filters.date_from || undefined} />
            </div>
            <div>
              <label className={labelClass}>Urutkan</label>
              <Select
                value={`${filters.sort}:${filters.dir}`}
                onChange={(v) => {
                  const [sort, dir] = v.split(":");
                  setFilter({ sort, dir: (dir === "asc" ? "asc" : "desc") as "asc" | "desc" });
                }}
                options={[
                  { value: "submitted_at:desc", label: "Terbaru" },
                  { value: "submitted_at:asc", label: "Terlama" },
                  { value: "amount:desc", label: "Nominal terbesar" },
                  { value: "amount:asc", label: "Nominal terkecil" },
                  { value: "po_no:asc", label: "Nomor PO A–Z" },
                ]}
              />
            </div>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={resetFilters} disabled={activeFilterCount === 0 && filters.sort === "submitted_at"}>
                Reset filter
              </Button>
            </div>
          </div>
        )}
        {refreshing && <p className="text-[11px] text-muted-foreground">Memperbarui…</p>}
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full"><tbody><SkeletonTable rows={8} cols={6} /></tbody></table>
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <AlertCircle className="w-10 h-10 text-danger mx-auto" />
            <p className="text-sm font-semibold text-foreground mt-3">{error}</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => void fetchList(true)}>
              <RefreshCw className="w-3.5 h-3.5" /> Coba lagi
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <ShoppingCart className="w-10 h-10 text-muted-foreground/50 mx-auto" />
            <p className="text-sm font-semibold text-foreground mt-3">
              {activeFilterCount > 0 ? "Tidak ada PO yang cocok dengan filter" : "Belum ada pengajuan PO"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {activeFilterCount > 0 ? "Ubah kata kunci atau reset filter." : ctx.canRequest ? "Klik Buat PO untuk pengajuan pertama." : "Pengajuan akan tampil di sini."}
            </p>
            {activeFilterCount > 0 && (
              <Button size="sm" variant="outline" className="mt-4" onClick={resetFilters}>Reset filter</Button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Nomor / Judul</th>
                    <th className="px-4 py-3 font-semibold">Pengaju</th>
                    <th className="px-4 py-3 font-semibold">Tanggal</th>
                    <th className="px-4 py-3 font-semibold text-right">Nominal</th>
                    <th className="px-4 py-3 font-semibold">Proses</th>
                    <th className="px-4 py-3 font-semibold">Bayar</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <p className="text-xs font-bold text-primary font-mono">{item.po_no}</p>
                        <p className="text-sm font-medium text-foreground truncate max-w-[260px]" title={item.title}>{item.title}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium text-foreground">{item.requester_name}</p>
                        <p className="text-[11px] text-muted-foreground">{item.requester_jabatan_nama || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(item.submitted_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <p className="text-sm font-bold text-foreground tabular-nums">{formatCurrency(item.amount)}</p>
                        {item.remaining > 0 && <p className="text-[11px] text-warning tabular-nums">sisa {formatCurrency(item.remaining)}</p>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={item.process_status} /></td>
                      <td className="px-4 py-3"><PayBadge status={item.payment_status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setDetailId(item.id)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Lihat detail" aria-label={`Detail ${item.po_no}`}>
                            <Eye className="w-4 h-4" />
                          </button>
                          {item.process_status === "po_masuk" && ctx.canManage === false && (
                            <button onClick={() => void openEdit(item)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit pengajuan" aria-label={`Edit ${item.po_no}`}>
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={page}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => setPageSize(s)}
              pageSizeOptions={[...PURCHASE_PAGE_SIZES]}
            />
          </>
        )}
      </div>

      {formOpen && (
        <PoFormModal
          ctx={ctx}
          editing={editingOrder}
          addToast={addToast}
          onClose={() => { setFormOpen(false); setEditingOrder(null); }}
          onSaved={() => {
            setFormOpen(false);
            setEditingOrder(null);
            onChanged();
            void fetchList(false);
          }}
        />
      )}
      {detailId !== null && (
        <PoDetailModal
          ctx={ctx}
          orderId={detailId}
          addToast={addToast}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            onChanged();
            void fetchList(false);
          }}
          onEdit={(detail) => {
            setDetailId(null);
            setEditingOrder(detail);
            setFormOpen(true);
          }}
        />
      )}
    </div>
  );
}

// ─── Form modal (buat + edit pengaju) ───

function PoFormModal({ ctx, editing, addToast, onClose, onSaved }: {
  ctx: PurchaseContext;
  editing: PoDetail | null;
  addToast: (t: "success" | "error", m: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ ...(editing ? {
    title: editing.title, detail: editing.detail, amount: editing.amount,
    vendor_name: editing.vendor_name, bank_name: editing.bank_name,
    account_number: editing.account_number, account_name: editing.account_name,
    purpose: editing.purpose,
  } : EMPTY_FORM) });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savePhase, setSavePhase] = useState<"sending" | "uploading">("sending");
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [createdInfo, setCreatedInfo] = useState<{ id: number; po_no: string } | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [idemKey] = useState(() => newIdempotencyKey());
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const blurValidate = (key: keyof typeof form) => {
    const errors = validatePurchaseForm({ ...form });
    setFieldErrors((prev) => ({ ...prev, [key]: errors[key] || "" }));
  };

  const attemptClose = () => {
    if (saving) return;
    if (createdInfo || (!dirty && staged.length === 0)) {
      onClose();
      return;
    }
    setConfirmDiscard(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) attemptClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setUploadError("");
    const avail = PURCHASE_MAX_ATTACHMENTS - staged.length;
    if (avail <= 0) {
      setUploadError(`Maksimal ${PURCHASE_MAX_ATTACHMENTS} lampiran.`);
      return;
    }
    const picked = Array.from(files).slice(0, avail);
    for (const file of picked) {
      const err = purchaseAttachmentError({ type: file.type, size: file.size, name: file.name }, staged.length);
      if (err) {
        setUploadError(err);
        continue;
      }
      stagedKey += 1;
      const key = stagedKey;
      setStaged((prev) => [...prev, { key, file, status: "idle" }]);
    }
    setDirty(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const uploadStaged = async (orderId: number): Promise<string[]> => {
    const failures: string[] = [];
    const pending = staged.filter((s) => s.status !== "done");
    setUploadProgress({ done: 0, total: pending.length });
    let done = 0;
    for (const s of pending) {
      setStaged((prev) => prev.map((x) => (x.key === s.key ? { ...x, status: "uploading" as const, error: undefined } : x)));
      try {
        const fd = new FormData();
        fd.append("file", s.file);
        fd.append("kind", "bukti");
        await apiForm(`/api/purchase/orders/${orderId}/attachments`, fd);
        setStaged((prev) => prev.map((x) => (x.key === s.key ? { ...x, status: "done" as const } : x)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Gagal mengunggah.";
        failures.push(`${s.file.name}: ${msg}`);
        setStaged((prev) => prev.map((x) => (x.key === s.key ? { ...x, status: "error" as const, error: msg } : x)));
      }
      done += 1;
      setUploadProgress({ done, total: pending.length });
    }
    return failures;
  };

  const retryUploads = async () => {
    if (!createdInfo || saving) return;
    setSaving(true);
    setSavePhase("uploading");
    setGlobalError("");
    const failures = await uploadStaged(createdInfo.id);
    setSaving(false);
    if (failures.length === 0) {
      addToast("success", `Seluruh lampiran PO ${createdInfo.po_no} berhasil diunggah.`);
      onSaved();
    } else {
      setGlobalError(`${failures.length} lampiran masih gagal diunggah. Periksa koneksi lalu coba lagi.`);
    }
  };

  const save = async () => {
    const errors = validatePurchaseForm({ ...form });
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(errors)) if (v) mapped[k] = v;
    setFieldErrors(mapped);
    if (Object.keys(mapped).length > 0) {
      setGlobalError("Periksa kembali field yang ditandai.");
      return;
    }
    setSaving(true);
    setSavePhase("sending");
    setGlobalError("");
    try {
      if (editing) {
        await api(`/api/purchase/orders/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "edit", ...form }),
        });
        addToast("success", `PO ${editing.po_no} diperbarui.`);
        onSaved();
        return;
      }
      const res = await api<{ item: { id: number; po_no: string }; duplicate?: boolean }>(
        "/api/purchase/orders",
        { method: "POST", body: JSON.stringify({ ...form, idempotency_key: idemKey }) },
      );
      const orderId = res.item.id;
      const pendingUploads = staged.filter((s) => s.status !== "done");
      if (pendingUploads.length > 0) {
        setSavePhase("uploading");
        const failures = await uploadStaged(orderId);
        if (failures.length > 0) {
          // PO sudah tercatat — tahan modal agar lampiran bisa dicoba lagi
          // tanpa membuat PO baru.
          setCreatedInfo({ id: orderId, po_no: res.item.po_no });
          setGlobalError(
            `PO ${res.item.po_no} berhasil dibuat, tetapi ${failures.length} lampiran gagal diunggah. Periksa koneksi lalu tekan "Coba lagi".`,
          );
          setSaving(false);
          return;
        }
      }
      addToast("success", res.duplicate ? `PO ${res.item.po_no} sudah pernah dibuat.` : `PO ${res.item.po_no} berhasil diajukan.`);
      onSaved();
    } catch (err) {
      const withFields = err as { fieldErrors?: Record<string, string> };
      if (withFields && typeof withFields.fieldErrors === "object") {
        setFieldErrors(withFields.fieldErrors);
      }
      setGlobalError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, required: boolean, node: React.ReactNode) => (
    <div>
      <label className={labelClass}>{label} {required && <span className="text-danger">*</span>}</label>
      {node}
      {fieldErrors[key] && <p className={errClass} role="alert">{fieldErrors[key]}</p>}
    </div>
  );

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={editing ? "Edit pengajuan PO" : "Buat pengajuan PO"}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={attemptClose} />
        <div className="relative w-full max-w-2xl bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
          <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent flex-shrink-0">
            <button onClick={attemptClose} disabled={saving} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-40" aria-label="Tutup"><X className="w-4 h-4" /></button>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/20">
                <ShoppingCart className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">{editing ? `Edit ${editing.po_no}` : "Buat Pengajuan PO"}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{ctx.employeeName} • {ctx.jabatanNama || "—"}</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto" inert={saving}>
            {saving && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20" role="status" aria-live="polite">
                <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">
                    {savePhase === "uploading"
                      ? `Mengunggah lampiran ${Math.min(uploadProgress.done + 1, uploadProgress.total)} dari ${uploadProgress.total}…`
                      : editing ? "Menyimpan perubahan…" : "Mengirim pengajuan…"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Mohon tunggu, pengajuan sedang diproses. Jangan tutup halaman ini.</p>
                </div>
              </div>
            )}
            {createdInfo && !saving && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl bg-warning-light text-warning text-xs font-medium" role="alert">
                <span className="flex-1">PO {createdInfo.po_no} sudah tercatat. Lampiran yang gagal bisa dicoba lagi tanpa membuat PO baru.</span>
                <Button size="sm" variant="outline" onClick={() => void retryUploads()}>Coba lagi</Button>
              </div>
            )}
            {globalError && <div className="p-3 rounded-xl bg-danger-light text-danger text-xs font-medium" role="alert">{globalError}</div>}

            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Kebutuhan</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  {field("title", "Judul Kebutuhan", true, (
                    <input value={form.title} onChange={(e) => set({ title: e.target.value })} onBlur={() => blurValidate("title")} placeholder="cth. Pengadaan ATK operasional" className={cn(inputClass, fieldErrors.title && "border-danger")} maxLength={160} />
                  ))}
                </div>
                <div className="sm:col-span-2">
                  {field("detail", "Detail PO / Item", true, (
                    <textarea value={form.detail} onChange={(e) => set({ detail: e.target.value })} onBlur={() => blurValidate("detail")} rows={3} placeholder="Rincian barang/jasa, jumlah, spesifikasi…" className={cn(inputClass, fieldErrors.detail && "border-danger")} />
                  ))}
                </div>
                <div>
                  {field("amount", "Nominal PO (Rp)", true, (
                    <CurrencyInput value={form.amount} onChange={(v) => set({ amount: v })} placeholder="0" className={cn(fieldErrors.amount && "border-danger")} />
                  ))}
                </div>
                <div>
                  {field("purpose", "Keterangan Pembayaran", true, (
                    <input value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} onBlur={() => blurValidate("purpose")} placeholder="Untuk pembayaran apa" className={cn(inputClass, fieldErrors.purpose && "border-danger")} />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Penerima & Rekening Tujuan</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  {field("vendor_name", "Nama Penerima / Vendor", true, (
                    <input value={form.vendor_name} onChange={(e) => set({ vendor_name: e.target.value })} onBlur={() => blurValidate("vendor_name")} placeholder="Nama pihak dibayar" className={cn(inputClass, fieldErrors.vendor_name && "border-danger")} />
                  ))}
                </div>
                <div>
                  {field("bank_name", "Bank Tujuan", true, (
                    <input value={form.bank_name} onChange={(e) => set({ bank_name: e.target.value })} onBlur={() => blurValidate("bank_name")} placeholder="cth. BCA" className={cn(inputClass, fieldErrors.bank_name && "border-danger")} />
                  ))}
                </div>
                <div>
                  {field("account_number", "Nomor Rekening", true, (
                    <input value={form.account_number} onChange={(e) => set({ account_number: e.target.value })} onBlur={() => blurValidate("account_number")} placeholder="cth. 1234567890" inputMode="numeric" className={cn(inputClass, fieldErrors.account_number && "border-danger")} />
                  ))}
                </div>
                <div>
                  {field("account_name", "Atas Nama", true, (
                    <input value={form.account_name} onChange={(e) => set({ account_name: e.target.value })} onBlur={() => blurValidate("account_name")} placeholder="Nama pemilik rekening" className={cn(inputClass, fieldErrors.account_name && "border-danger")} />
                  ))}
                </div>
              </div>
            </div>

            {!editing && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Lampiran Bukti (opsional)</p>
                <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => addFiles(e.target.files)} />
                <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border text-xs font-semibold text-muted-foreground hover:border-primary/50 hover:text-foreground w-full justify-center" disabled={staged.length >= PURCHASE_MAX_ATTACHMENTS}>
                  <Paperclip className="w-4 h-4" /> Pilih file (PDF/JPG/PNG, maks 10 MB, {PURCHASE_MAX_ATTACHMENTS} file)
                </button>
                {uploadError && <p className={errClass} role="alert">{uploadError}</p>}
                {staged.length > 0 && (
                  <ul className="space-y-1.5 mt-2">
                    {staged.map((s) => (
                      <li key={s.key} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 border border-border/50 text-xs">
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="flex-1 min-w-0 truncate">{s.file.name} <span className="text-muted-foreground">({fmtFileSize(s.file.size)})</span></span>
                        {s.status === "uploading" && <span className="text-muted-foreground">Mengunggah…</span>}
                        {s.status === "done" && <CheckCircle2 className="w-4 h-4 text-success" />}
                        {s.status === "error" && <span className="text-danger">Gagal</span>}
                        {s.status !== "uploading" && s.status !== "done" && (
                          <button onClick={() => setStaged((prev) => prev.filter((x) => x.key !== s.key))} className="p-1 rounded hover:bg-card text-muted-foreground" aria-label={`Hapus ${s.file.name}`}>
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-muted-foreground">Format: {PURCHASE_ATTACHMENT_MIME_TYPES.join(", ")}</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={attemptClose} disabled={saving}>{createdInfo ? "Tutup" : "Batal"}</Button>
            {!createdInfo && (
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
                {saving ? (savePhase === "uploading" ? "Mengunggah…" : "Mengirim…") : editing ? "Simpan Perubahan" : "Kirim Pengajuan"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Buang perubahan?"
          message="Formulir belum disimpan. Perubahan akan hilang."
          confirmLabel="Buang"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={onClose}
        />
      )}
    </Portal>
  );
}

function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }: {
  title: string; message: string; confirmLabel: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
        <div className="relative w-full max-w-xs bg-card rounded-2xl shadow-2xl p-5 animate-scale-in">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{message}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={onCancel}>Batal</Button>
            <Button variant="danger" size="sm" onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Detail modal ───

function PoDetailModal({ ctx, orderId, addToast, onClose, onChanged, onEdit }: {
  ctx: PurchaseContext;
  orderId: number;
  addToast: (t: "success" | "error", m: string) => void;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (detail: PoDetail) => void;
}) {
  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [payments, setPayments] = useState<PoPayment[]>([]);
  const [attachments, setAttachments] = useState<PoAttachment[]>([]);
  const [events, setEvents] = useState<PoEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [statusTo, setStatusTo] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState("");

  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  const [payForm, setPayForm] = useState({ payment_date: "", amount: 0, notes: "" });
  const [payReceipt, setPayReceipt] = useState<File | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState("");

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [confirmDeleteAtt, setConfirmDeleteAtt] = useState<PoAttachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ item: PoDetail; payments: PoPayment[]; attachments: PoAttachment[]; events: PoEvent[] }>(
        `/api/purchase/orders/${orderId}`,
      );
      setDetail(res.item);
      setPayments(res.payments);
      setAttachments(res.attachments);
      setEvents(res.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat detail.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    (async () => { await fetchDetail(); })();
  }, [fetchDetail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reload = async () => {
    await fetchDetail();
    onChanged();
  };

  const submitStatus = async () => {
    if (!statusTo) return;
    setStatusSaving(true);
    setStatusError("");
    try {
      await api(`/api/purchase/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "status", to: statusTo, note: statusNote }),
      });
      addToast("success", `Status diubah ke ${statusLabel(statusTo)}.`);
      setStatusTo("");
      setStatusNote("");
      await reload();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setStatusSaving(false);
    }
  };

  const submitNote = async () => {
    if (!noteText.trim()) return;
    setNoteSaving(true);
    try {
      await api(`/api/purchase/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "note", note: noteText.trim() }),
      });
      addToast("success", "Catatan ditambahkan.");
      setNoteText("");
      await reload();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Gagal menambah catatan.");
    } finally {
      setNoteSaving(false);
    }
  };

  const submitPayment = async () => {
    if (!detail) return;
    const clientError = validatePurchasePayment(
      { payment_date: payForm.payment_date, amount: payForm.amount },
      detail.amount,
      detail.total_paid,
    );
    if (clientError) {
      setPayError(clientError);
      return;
    }
    if (payReceipt) {
      const err = purchaseAttachmentError({ type: payReceipt.type, size: payReceipt.size, name: payReceipt.name }, 0);
      if (err) {
        setPayError(`Bukti transfer: ${err}`);
        return;
      }
    }
    setPaySaving(true);
    setPayError("");
    try {
      const res = await api<{ payment_id: number }>(`/api/purchase/orders/${orderId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          payment_date: payForm.payment_date,
          amount: Math.round(payForm.amount),
          notes: payForm.notes.trim() || undefined,
          idempotency_key: newIdempotencyKey(),
        }),
      });
      if (payReceipt) {
        try {
          const fd = new FormData();
          fd.append("file", payReceipt);
          fd.append("kind", "pembayaran");
          fd.append("payment_id", String(res.payment_id));
          await apiForm(`/api/purchase/orders/${orderId}/attachments`, fd);
        } catch (err) {
          addToast("error", `Pembayaran tercatat, tetapi bukti gagal diunggah: ${err instanceof Error ? err.message : ""}`);
        }
      }
      addToast("success", "Pembayaran dicatat.");
      setPayForm({ payment_date: "", amount: 0, notes: "" });
      setPayReceipt(null);
      if (receiptRef.current) receiptRef.current.value = "";
      await reload();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Gagal mencatat pembayaran.");
    } finally {
      setPaySaving(false);
    }
  };

  const uploadBukti = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError("");
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const err = purchaseAttachmentError({ type: file.type, size: file.size, name: file.name }, attachments.length);
        if (err) {
          setUploadError(`${file.name}: ${err}`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "bukti");
        try {
          await apiForm(`/api/purchase/orders/${orderId}/attachments`, fd);
        } catch (err) {
          setUploadError(`${file.name}: ${err instanceof Error ? err.message : "gagal"}`);
        }
      }
      await fetchDetail();
      onChanged();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openAttachment = async (att: PoAttachment) => {
    try {
      const res = await api<{ url: string }>(`/api/purchase/attachments/${att.id}`);
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Gagal membuka lampiran.");
    }
  };

  const deleteAttachment = async () => {
    if (!confirmDeleteAtt) return;
    try {
      const res = await fetch(`/api/purchase/attachments/${confirmDeleteAtt.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Gagal menghapus.");
      addToast("success", "Lampiran dihapus.");
      setConfirmDeleteAtt(null);
      await fetchDetail();
      onChanged();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Gagal menghapus lampiran.");
    }
  };

  const allowedNext = detail
    ? (["po_diterima", "on_process", "waiting_list", "pending_payment", "non_approve", "cancel"] as PurchaseProcessStatus[]).filter((s) =>
        canTransitionPurchaseStatus(detail.process_status, s, { hasPayments: detail.total_paid > 0 }),
      )
    : [];
  const needsReason = statusTo ? purchaseStatusNeedsReason(statusTo as PurchaseProcessStatus) : false;
  const payStatus = detail ? purchasePaymentStatus(detail.amount, detail.total_paid) : "unpaid";
  const canUploadBukti = ctx.canManage || (detail !== null && detail.process_status === "po_masuk");

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Detail PO">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-2xl bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
          <div className="flex items-center justify-between px-5 py-4 bg-muted/30 flex-shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0"><ShoppingCart className="w-4 h-4 text-primary" /></div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-foreground font-mono truncate">{detail?.po_no || "Memuat…"}</h2>
                <p className="text-[11px] text-muted-foreground truncate">{detail?.title || ""}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground flex-shrink-0" aria-label="Tutup"><X className="w-4 h-4" /></button>
          </div>

          <div className="p-5 space-y-5 flex-1 overflow-y-auto">
            {loading ? (
              <SkeletonList rows={6} cols={3} />
            ) : error || !detail ? (
              <div className="text-center py-8">
                <AlertCircle className="w-8 h-8 text-danger mx-auto" />
                <p className="text-sm font-semibold mt-2">{error || "PO tidak ditemukan."}</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => void fetchDetail()}>Coba lagi</Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={detail.process_status} />
                  <PayBadge status={payStatus} />
                  {detail.submitted_by && (
                    <span className="text-[11px] text-muted-foreground ml-auto">Diajukan {fmtDate(detail.submitted_at)}</span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-muted/40 border border-border p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Nominal PO</p>
                    <p className="text-sm font-bold text-foreground tabular-nums mt-0.5">{formatCurrency(detail.amount)}</p>
                  </div>
                  <div className="rounded-xl bg-muted/40 border border-border p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Terbayar</p>
                    <p className="text-sm font-bold text-success tabular-nums mt-0.5">{formatCurrency(detail.total_paid)}</p>
                  </div>
                  <div className="rounded-xl bg-muted/40 border border-border p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Sisa</p>
                    <p className="text-sm font-bold text-warning tabular-nums mt-0.5">{formatCurrency(detail.remaining)}</p>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <DetailRow icon={<User className="w-3.5 h-3.5" />} label="Pengaju" value={`${detail.requester_name} • ${detail.requester_jabatan_nama || "—"}`} />
                  <DetailRow icon={<FileText className="w-3.5 h-3.5" />} label="Detail" value={detail.detail} multiline />
                  <DetailRow icon={<Building2 className="w-3.5 h-3.5" />} label="Penerima" value={detail.vendor_name} />
                  <DetailRow icon={<Landmark className="w-3.5 h-3.5" />} label="Rekening" value={`${detail.bank_name} • ${detail.account_number} a.n. ${detail.account_name}`} mono />
                  <DetailRow icon={<Wallet className="w-3.5 h-3.5" />} label="Keterangan" value={detail.purpose} multiline />
                </div>

                {detail.process_status === "po_masuk" && (
                  <Button variant="outline" size="sm" onClick={() => onEdit(detail)}>
                    <Pencil className="w-3.5 h-3.5" /> Edit Pengajuan
                  </Button>
                )}

                {ctx.canManage && (
                  <div className="rounded-xl border border-border p-4 space-y-3">
                    <p className="text-xs font-bold text-foreground">Kelola Status (Purchasing)</p>
                    {statusError && <p className="text-[11px] text-danger" role="alert">{statusError}</p>}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Select
                        value={statusTo}
                        onChange={setStatusTo}
                        placeholder="Pilih status berikutnya"
                        className="flex-1"
                        options={[{ value: "", label: "Pilih status…" }, ...allowedNext.map((s) => ({ value: s, label: statusLabel(s) }))]}
                      />
                      <Button size="sm" onClick={() => void submitStatus()} disabled={!statusTo || statusSaving || (needsReason && !statusNote.trim())}>
                        {statusSaving ? "Menyimpan…" : "Ubah Status"}
                      </Button>
                    </div>
                    {needsReason && (
                      <textarea value={statusNote} onChange={(e) => setStatusNote(e.target.value)} rows={2} placeholder="Alasan wajib diisi" className={inputClass} aria-label="Alasan status" />
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} placeholder="Tambah catatan perkembangan…" className={cn(inputClass, "flex-1")} aria-label="Catatan Purchasing" />
                      <Button size="sm" variant="outline" onClick={() => void submitNote()} disabled={!noteText.trim() || noteSaving} className="self-start">
                        {noteSaving ? "Menyimpan…" : "Kirim Catatan"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Pembayaran ({payments.length})</p>
                  {payments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Belum ada pembayaran.</p>
                  ) : (
                    payments.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/40 border border-border/50 text-sm">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold tabular-nums">{formatCurrency(p.amount)}</p>
                          <p className="text-[11px] text-muted-foreground">{fmtDate(p.payment_date)}{p.notes ? ` • ${p.notes}` : ""}</p>
                        </div>
                      </div>
                    ))
                  )}
                  {ctx.canManage && detail.process_status !== "non_approve" && detail.process_status !== "cancel" && detail.remaining > 0 && (
                    <div className="rounded-xl border border-border p-3 space-y-2">
                      {payError && <p className="text-[11px] text-danger" role="alert">{payError}</p>}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={labelClass}>Tanggal <span className="text-danger">*</span></label>
                          <DatePicker value={payForm.payment_date} onChange={(v) => setPayForm({ ...payForm, payment_date: v })} />
                        </div>
                        <div>
                          <label className={labelClass}>Nominal (Rp) <span className="text-danger">*</span></label>
                          <CurrencyInput value={payForm.amount} onChange={(v) => setPayForm({ ...payForm, amount: v })} placeholder="0" />
                        </div>
                      </div>
                      <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} placeholder="Catatan pembayaran (opsional)" className={inputClass} maxLength={500} aria-label="Catatan pembayaran" />
                      <div className="flex items-center gap-2">
                        <input ref={receiptRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => setPayReceipt(e.target.files?.[0] || null)} />
                        <Button variant="outline" size="sm" onClick={() => receiptRef.current?.click()}>
                          <Paperclip className="w-3.5 h-3.5" /> {payReceipt ? payReceipt.name : "Bukti transfer"}
                        </Button>
                        {payReceipt && (
                          <button onClick={() => { setPayReceipt(null); if (receiptRef.current) receiptRef.current.value = ""; }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Hapus bukti">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <Button size="sm" onClick={() => void submitPayment()} disabled={paySaving || !payForm.payment_date || payForm.amount <= 0} className="ml-auto">
                          {paySaving ? "Menyimpan…" : "Catat Bayar"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Lampiran ({attachments.length}/{PURCHASE_MAX_ATTACHMENTS})</p>
                    {canUploadBukti && attachments.length < PURCHASE_MAX_ATTACHMENTS && (
                      <>
                        <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => void uploadBukti(e.target.files)} />
                        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                          <Paperclip className="w-3.5 h-3.5" /> {uploading ? "Mengunggah…" : "Tambah"}
                        </Button>
                      </>
                    )}
                  </div>
                  {uploadError && <p className="text-[11px] text-danger" role="alert">{uploadError}</p>}
                  {attachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Belum ada lampiran.</p>
                  ) : (
                    attachments.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 border border-border/50 text-xs">
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <button onClick={() => void openAttachment(a)} className="flex-1 min-w-0 text-left hover:underline" title="Buka lampiran">
                          <span className="font-medium text-foreground truncate block">{a.file_name}</span>
                          <span className="text-muted-foreground">{fmtFileSize(a.file_size)} • {a.kind === "pembayaran" ? "bukti bayar" : "bukti PO"}</span>
                        </button>
                        {(ctx.canManage || detail.process_status === "po_masuk") && (
                          <button onClick={() => setConfirmDeleteAtt(a)} className="p-1.5 rounded-lg hover:bg-danger-light text-muted-foreground hover:text-danger flex-shrink-0" aria-label={`Hapus ${a.file_name}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Timeline</p>
                  {events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Belum ada aktivitas.</p>
                  ) : (
                    <ol className="space-y-2">
                      {events.map((e) => (
                        <li key={e.id} className="flex gap-2.5 text-xs">
                          <span className="mt-1 w-2 h-2 rounded-full bg-primary flex-shrink-0" aria-hidden />
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{eventLabel(e)}</p>
                            {e.note && <p className="text-muted-foreground break-words">{e.note}</p>}
                            <p className="text-muted-foreground/70 text-[10px]">{fmtDate(e.created_at)}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {confirmDeleteAtt && (
        <ConfirmDialog
          title="Hapus lampiran?"
          message={`${confirmDeleteAtt.file_name} akan dihapus permanen.`}
          confirmLabel="Hapus"
          onCancel={() => setConfirmDeleteAtt(null)}
          onConfirm={() => void deleteAttachment()}
        />
      )}
    </Portal>
  );
}

function DetailRow({ icon, label, value, multiline, mono }: {
  icon: React.ReactNode; label: string; value: string; multiline?: boolean; mono?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
        <p className={cn("text-foreground", multiline ? "whitespace-pre-wrap break-words" : "truncate", mono && "font-mono text-[13px]")} title={value}>{value}</p>
      </div>
    </div>
  );
}

// ─── Pengaturan (Super Admin) ───

interface JabatanOption { id: number; nama: string }

function SettingsView({ addToast }: { addToast: (t: "success" | "error", m: string) => void }) {
  const [jabatan, setJabatan] = useState<JabatanOption[]>([]);
  const [requesters, setRequesters] = useState<Set<number>>(new Set());
  const [managers, setManagers] = useState<Set<number>>(new Set());
  const [savedReq, setSavedReq] = useState<Set<number>>(new Set());
  const [savedMgr, setSavedMgr] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ jabatan: JabatanOption[]; rules: { jabatan_id: number; can_request: boolean; can_manage: boolean }[] }>("/api/purchase/settings");
      setJabatan(res.jabatan);
      const req = new Set<number>();
      const mgr = new Set<number>();
      for (const r of res.rules) {
        if (r.can_request) req.add(r.jabatan_id);
        if (r.can_manage) mgr.add(r.jabatan_id);
      }
      setRequesters(req);
      setManagers(mgr);
      setSavedReq(new Set(req));
      setSavedMgr(new Set(mgr));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat pengaturan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => { await fetchSettings(); })();
  }, [fetchSettings]);

  const dirty = useMemo(() => {
    if (requesters.size !== savedReq.size || managers.size !== savedMgr.size) return true;
    for (const v of requesters) if (!savedReq.has(v)) return true;
    for (const v of managers) if (!savedMgr.has(v)) return true;
    return false;
  }, [requesters, managers, savedReq, savedMgr]);

  const toggle = (set: Set<number>, apply: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/purchase/settings", {
        method: "PUT",
        body: JSON.stringify({
          requester_jabatan_ids: Array.from(requesters),
          manager_jabatan_ids: Array.from(managers),
        }),
      });
      setSavedReq(new Set(requesters));
      setSavedMgr(new Set(managers));
      addToast("success", "Pengaturan akses jabatan disimpan.");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  };

  const filtered = jabatan.filter((j) => j.nama.toLowerCase().includes(search.trim().toLowerCase()));

  if (loading) return <SkeletonList rows={6} cols={3} />;
  if (error) {
    return (
      <div className="bg-card rounded-2xl border border-border p-10 text-center">
        <AlertCircle className="w-10 h-10 text-danger mx-auto" />
        <p className="text-sm font-semibold mt-3">{error}</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={() => void fetchSettings()}>Coba lagi</Button>
      </div>
    );
  }

  const list = (kind: "req" | "mgr") => {
    const set = kind === "req" ? requesters : managers;
    const apply = kind === "req" ? setRequesters : setManagers;
    return (
      <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
        {filtered.length === 0 && <p className="text-xs text-muted-foreground p-3">Tidak ada jabatan yang cocok.</p>}
        {filtered.map((j) => (
          <label key={j.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-border hover:bg-muted/30 cursor-pointer">
            <input
              type="checkbox"
              checked={set.has(j.id)}
              onChange={() => toggle(set, apply, j.id)}
              className="w-4 h-4 rounded accent-primary"
              aria-label={j.nama}
            />
            <span className="text-sm font-medium text-foreground">{j.nama}</span>
          </label>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-border shadow-sm p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari jabatan…" className="bg-transparent outline-none text-sm flex-1 text-foreground" aria-label="Cari jabatan" />
          </div>
          <Button size="sm" icon={SlidersHorizontal} onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? "Menyimpan…" : `Simpan${dirty ? " *" : ""}`}
          </Button>
        </div>
        {dirty && <p className="text-[11px] text-warning mt-2">Ada perubahan belum disimpan.</p>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-bold text-foreground">Jabatan Pengaju PO ({requesters.size})</h2>
            <p className="text-[11px] text-muted-foreground">Boleh membuat pengajuan dan melihat PO sendiri</p>
          </div>
          <div className="p-4">{list("req")}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-bold text-foreground">Jabatan Pengelola Purchasing ({managers.size})</h2>
            <p className="text-[11px] text-muted-foreground">Melihat seluruh PO, memproses, dan mencatat pembayaran</p>
          </div>
          <div className="p-4">{list("mgr")}</div>
        </div>
      </div>
    </div>
  );
}
