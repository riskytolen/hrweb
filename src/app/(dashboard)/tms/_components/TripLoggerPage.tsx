"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  Search,
  Store,
  Thermometer,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import RouteGuard from "@/components/RouteGuard";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import TmsClientSelector, { TMS_CLIENT_CHANGED_EVENT, readTmsClientParam } from "./TmsClientSelector";

/* ─── Tipe data ─── */

type TempStatus = "NORMAL" | "WASPADA" | "TINGGI";
type VisitStateFilter = "ALL" | "ONGOING" | "COMPLETED" | "INCOMPLETE" | "PENDING";

interface TripLogRow {
  id: string;
  taskId: string;
  taskNumber: string | null;
  taskStatus: string | null;
  unit: string | null;
  driver: string | null;
  routeSequence: number;
  pointType: string | null;
  store: string | null;
  address: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  temperatureC: number | null;
}

interface VisitCounts {
  completed: number;
  ongoing: number;
  incomplete: number;
  pending: number;
}

interface ListResponse {
  data?: TripLogRow[];
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    counts?: VisitCounts | null;
    lastSyncedAt?: string | null;
  };
}

const VISIT_FILTERS: { key: VisitStateFilter; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "ONGOING", label: "Di lokasi" },
  { key: "COMPLETED", label: "Selesai" },
  { key: "INCOMPLETE", label: "Waktu tak lengkap" },
  { key: "PENDING", label: "Belum dikunjungi" },
];

const PAGE_SIZE = 15;

/* ─── Helper ─── */

function jakartaDate(offsetDays = 0): string {
  const target = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
}

function getTempStatus(tempC: number): TempStatus {
  if (tempC > -5) return "TINGGI";
  if (tempC > -12) return "WASPADA";
  return "NORMAL";
}

function formatTime(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(parsed));
}

function formatDate(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(parsed));
}

function formatDateTimeShort(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(parsed),
  );
}

function durationSeconds(enteredAt: string | null, exitedAt: string | null): number | null {
  if (!enteredAt || !exitedAt) return null;
  const diff = Date.parse(exitedAt) - Date.parse(enteredAt);
  if (Number.isNaN(diff) || diff < 0) return null;
  return Math.round(diff / 1000);
}

function ongoingSeconds(enteredAt: string | null, nowMs: number): number | null {
  if (!enteredAt) return null;
  const start = Date.parse(enteredAt);
  if (Number.isNaN(start) || nowMs < start) return null;
  return Math.floor((nowMs - start) / 1000);
}

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return "–";
  if (totalSeconds < 60) return `${totalSeconds} dtk`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} mnt`;
}

function formatTemp(tempC: number | null): string {
  if (tempC === null) return "–";
  return `${tempC.toFixed(1).replace(".", ",")}°C`;
}

function KpiCard({
  icon: Icon,
  tileClass,
  label,
  value,
  sub,
}: {
  icon: typeof Truck;
  tileClass: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white", tileClass)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block text-2xl font-extrabold tabular-nums text-foreground">{value}</span>
        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

function TempBadge({ tempC }: { tempC: number | null }) {
  if (tempC === null) return <span className="text-xs text-muted-foreground">–</span>;
  const status = getTempStatus(tempC);
  return (
    <Badge variant={status === "NORMAL" ? "success" : status === "WASPADA" ? "warning" : "danger"}>
      <Thermometer className="h-3 w-3" />
      {formatTemp(tempC)}
    </Badge>
  );
}

function VisitStateBadge({ row }: { row: TripLogRow }) {
  if (row.enteredAt && row.exitedAt) {
    return durationSeconds(row.enteredAt, row.exitedAt) === null ? (
      <Badge variant="warning">Waktu tak lengkap</Badge>
    ) : (
      <Badge variant="success">Selesai</Badge>
    );
  }
  if (row.enteredAt) return <Badge variant="info">Di lokasi</Badge>;
  if (row.exitedAt) return <Badge variant="warning">Waktu tak lengkap</Badge>;
  return <Badge variant="muted">Belum dikunjungi</Badge>;
}

/* ─── Halaman ─── */

export default function TripLoggerPage() {
  const [rows, setRows] = useState<TripLogRow[]>([]);
  const [counts, setCounts] = useState<VisitCounts | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [visitState, setVisitState] = useState<VisitStateFilter>("ALL");
  const [dateFrom, setDateFrom] = useState(() => jakartaDate(-6));
  const [dateTo, setDateTo] = useState(() => jakartaDate(0));
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [clientTick, setClientTick] = useState(0);

  useEffect(() => {
    const onClientChanged = () => {
      setPage(1);
      setClientTick((tick) => tick + 1);
    };
    window.addEventListener(TMS_CLIENT_CHANGED_EVENT, onClientChanged);
    return () => window.removeEventListener(TMS_CLIENT_CHANGED_EVENT, onClientChanged);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        dateFrom,
        dateTo,
      });
      if (visitState !== "ALL") params.set("visitState", visitState);
      if (appliedSearch) params.set("search", appliedSearch);
      const clientParam = readTmsClientParam();
      if (clientParam) params.set("client", clientParam);

      const response = await fetch(`/api/tms/logger-trips?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as ListResponse;
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal memuat Logger Trips.");
        // Reset agar tidak tampil error + sisa angka/list dari filter sebelumnya.
        setRows([]);
        setTotal(0);
        setCounts(null);
        return;
      }
      setRows(Array.isArray(payload.data) ? payload.data : []);
      setCounts(payload.meta?.counts ?? null);
      setTotal(payload.meta?.total ?? 0);
      setLastSyncedAt(payload.meta?.lastSyncedAt ?? null);
    } catch {
      setError("Gagal memuat Logger Trips.");
      setRows([]);
      setTotal(0);
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, dateFrom, dateTo, page, visitState]);

  useEffect(() => {
    // clientTick memicu muat ulang saat pilihan client berubah.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, clientTick]);

  // Perbarui durasi berjalan tiap 30 detik.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const handleSearch = useCallback(() => {
    setPage(1);
    setAppliedSearch(search.trim());
  }, [search]);

  return (
    <RouteGuard permission="tms.logger-trips">
      <div className="space-y-5">
        <PageHeader
          title="Logger Trips"
          description="Waktu masuk dan keluar unit di setiap titik kunjungan beserta suhu kargo"
          icon={Clock3}
          actions={
            <div className="flex items-center gap-2">
              <TmsClientSelector compact />
              <Button size="sm" variant="outline" icon={RefreshCw} disabled={loading} onClick={() => void load()}>
                Muat ulang
              </Button>
            </div>
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard icon={Store} tileClass="bg-sky-500" label="Total kunjungan" value={String(total)} sub={lastSyncedAt ? `Sinkron ${formatDateTimeShort(lastSyncedAt)}` : "Sinkronisasi McEasy"} />
          <KpiCard icon={Truck} tileClass="bg-violet-500" label="Sedang di lokasi" value={String(counts?.ongoing ?? 0)} sub="sudah masuk, belum keluar" />
          <KpiCard icon={CheckCircle2} tileClass="bg-emerald-500" label="Kunjungan selesai" value={String(counts?.completed ?? 0)} sub="masuk & keluar tercatat" />
          <KpiCard icon={AlertTriangle} tileClass={(counts?.incomplete ?? 0) > 0 ? "bg-amber-500" : "bg-slate-400"} label="Waktu tak lengkap" value={String(counts?.incomplete ?? 0)} sub="perlu validasi data" />
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-xs"
                  placeholder="Cari unit, toko, driver, atau nomor FO"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleSearch();
                  }}
                />
              </div>
              <Button size="sm" variant="outline" onClick={handleSearch}>
                Cari
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                aria-label="Tanggal mulai"
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
              />
              <span className="text-muted-foreground">s.d.</span>
              <input
                type="date"
                aria-label="Tanggal akhir"
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                value={dateTo}
                min={dateFrom}
                max={jakartaDate(0)}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
            {VISIT_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => {
                  setVisitState(filter.key);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  visitState === filter.key ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : error ? (
            <p className="px-4 py-10 text-center text-sm text-danger">{error}</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Belum ada catatan kunjungan pada rentang ini. Sinkronisasi McEasy berjalan setiap 2 menit.
            </p>
          ) : (
            <>
              {/* Tabel desktop */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">Unit</th>
                      <th className="px-4 py-3 font-semibold">Nama Toko</th>
                      <th className="px-4 py-3 font-semibold">Driver</th>
                      <th className="px-4 py-3 font-semibold">Masuk Toko</th>
                      <th className="px-4 py-3 font-semibold">Keluar Toko</th>
                      <th className="px-4 py-3 font-semibold">Durasi di Toko</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Suhu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const inProgress = !!row.enteredAt && !row.exitedAt;
                      const secs = inProgress
                        ? ongoingSeconds(row.enteredAt, nowMs)
                        : durationSeconds(row.enteredAt, row.exitedAt);
                      return (
                        <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-bold tabular-nums text-foreground">{row.unit ?? "–"}</p>
                            <p className="text-[11px] text-muted-foreground">{row.taskNumber ?? "–"}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-semibold text-foreground">{row.store ?? `Titik ${row.routeSequence}`}</p>
                            <p className="max-w-56 truncate text-[11px] text-muted-foreground" title={row.address ?? undefined}>
                              {row.address ?? "–"}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground">{row.driver ?? "–"}</td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-extrabold tabular-nums text-foreground">{formatTime(row.enteredAt)}</p>
                            <p className="text-[11px] text-muted-foreground">{formatDate(row.enteredAt)}</p>
                          </td>
                          <td className="px-4 py-3">
                            {row.exitedAt ? (
                              <>
                                <p className="text-sm font-extrabold tabular-nums text-foreground">{formatTime(row.exitedAt)}</p>
                                <p className="text-[11px] text-muted-foreground">{formatDate(row.exitedAt)}</p>
                              </>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                                Di lokasi
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-semibold tabular-nums text-foreground">{formatDuration(secs)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <VisitStateBadge row={row} />
                          </td>
                          <td className="px-4 py-3">
                            <TempBadge tempC={row.temperatureC} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Kartu mobile */}
              <div className="space-y-2.5 p-4 lg:hidden">
                {rows.map((row) => {
                  const inProgress = !!row.enteredAt && !row.exitedAt;
                  const secs = inProgress
                    ? ongoingSeconds(row.enteredAt, nowMs)
                    : durationSeconds(row.enteredAt, row.exitedAt);
                  return (
                    <article key={row.id} className="rounded-xl border border-border bg-background p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{row.store ?? `Titik ${row.routeSequence}`}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{row.address ?? row.taskNumber ?? "–"}</p>
                        </div>
                        <VisitStateBadge row={row} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Truck className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-mono font-semibold tabular-nums text-foreground">{row.unit ?? "–"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-foreground">{row.driver ?? "–"}</span>
                        </div>
                        <div className="col-span-2 flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-2">
                          <span className="tabular-nums text-foreground">
                            Masuk <strong className="text-sm">{formatTime(row.enteredAt)}</strong>
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="tabular-nums text-foreground">
                            {row.exitedAt ? <>Keluar <strong className="text-sm">{formatTime(row.exitedAt)}</strong></> : <strong className="text-sky-600">Di lokasi</strong>}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Durasi</span>
                          <span className="font-semibold tabular-nums text-foreground">{formatDuration(secs)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Suhu</span>
                          <TempBadge tempC={row.temperatureC} />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  Halaman {page} dari {totalPages} · {total} kunjungan
                </span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            </>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Waktu masuk/keluar berasal dari timeline Fleet Task McEasy. Suhu hanya tampil bila ada hasil capture perangkat; jika kosong berarti belum ada snapshot suhu untuk titik tersebut.
        </p>
      </div>
    </RouteGuard>
  );
}
