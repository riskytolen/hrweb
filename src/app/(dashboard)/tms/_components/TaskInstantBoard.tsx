"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  ClipboardList,
  Loader2,
  RefreshCw,
  Route as RouteIcon,
  Search,
  TriangleAlert,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  normalizeFleetTaskInstantItem,
  type FleetTaskInstantItem,
} from "@/lib/fleet-task-track";
import { formatRelativeTime } from "@/lib/tms-status";
import TaskStatusBadge from "./TaskStatusBadge";

type StatusFilter = "ALL" | "DRAFT" | "SCHEDULED" | "STARTED" | "ENDED" | "CANCELED";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "DRAFT", label: "Draf" },
  { key: "SCHEDULED", label: "Dijadwalkan" },
  { key: "STARTED", label: "Berjalan" },
  { key: "ENDED", label: "Selesai" },
  { key: "CANCELED", label: "Batal" },
];

interface TaskListCounts {
  draft: number | null;
  scheduled: number | null;
  started: number | null;
  ended: number | null;
  canceled: number | null;
}

interface TaskListApiResponse {
  data?: unknown;
  error?: string;
  meta?: {
    total?: number | null;
    page?: number | null;
    counts?: TaskListCounts | null;
  };
}

const PAGE_SIZE = 10;

function countFor(counts: TaskListCounts | null, key: StatusFilter): number | null {
  if (!counts) return null;
  switch (key) {
    case "DRAFT":
      return counts.draft;
    case "SCHEDULED":
      return counts.scheduled;
    case "STARTED":
      return counts.started;
    case "ENDED":
      return counts.ended;
    case "CANCELED":
      return counts.canceled;
    default:
      return null;
  }
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return value.toLocaleString("id-ID");
}

function KpiCard({
  icon: Icon,
  tileClass,
  label,
  value,
  caption,
}: {
  icon: LucideIcon;
  tileClass: string;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white", tileClass)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block text-2xl font-extrabold tabular-nums text-foreground">{value}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{caption}</span>
      </span>
    </div>
  );
}

function pageWindow(current: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, 2, current - 1, current, current + 1, totalPages - 1, totalPages]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
}

interface TaskInstantBoardProps {
  selectedId: string | null;
  onSelect: (item: FleetTaskInstantItem) => void;
}

export default function TaskInstantBoard({ selectedId, onSelect }: TaskInstantBoardProps) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [items, setItems] = useState<FleetTaskInstantItem[]>([]);
  const [counts, setCounts] = useState<TaskListCounts | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async (targetPage: number, term: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("page", String(targetPage));
      params.set("sort", "created_on desc");
      if (term.trim()) params.set("search", term.trim());
      const response = await fetch(`/api/tms/fleet-task-instant?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = (await response.json()) as TaskListApiResponse;
      if (!response.ok) throw new Error(payload.error ?? "Gagal memuat daftar task.");
      const batch: FleetTaskInstantItem[] = [];
      if (Array.isArray(payload.data)) {
        for (const raw of payload.data) {
          const item = normalizeFleetTaskInstantItem(raw);
          if (item) batch.push(item);
        }
      }
      setItems(batch);
      setCounts(payload.meta?.counts ?? null);
      setTotal(payload.meta?.total ?? null);
      setPage(targetPage);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error && err.message ? err.message : "Gagal memuat daftar task.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Muat ulang setiap halaman/search berubah.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPage(page, search);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleRefresh = () => {
    if (!loading) void fetchPage(page, search);
  };

  const visibleItems =
    statusFilter === "ALL" ? items : items.filter((item) => item.statusRaw === statusFilter);

  const totalPages = total !== null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;
  const rangeStart = total !== null && total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = total !== null ? Math.min(page * PAGE_SIZE, total) : 0;

  const activeTasks = (counts?.scheduled ?? 0) + (counts?.started ?? 0);

  return (
    <div className="space-y-4">
      {/* Header + toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-light">
            <RouteIcon className="h-5 w-5 text-primary" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold tracking-tight text-foreground">
              Fleet Task Instant Point List
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Monitor task, titik kunjungan, dan progres pengiriman secara real time.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <span className="sr-only">Cari task, kendaraan, driver, atau lokasi</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search tasks, vehicles, drivers or locations…"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
            />
          </form>
          <Button variant="outline" size="sm" className="h-10" icon={RefreshCw} onClick={handleRefresh} disabled={loading}>
            Refresh
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter status task">
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.key;
            const count = filter.key === "ALL" ? total : countFor(counts, filter.key);
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                aria-pressed={active}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-bold tabular-nums transition-colors",
                  active
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
                )}
              >
                {filter.label}
                {count !== null && count !== undefined && (
                  <span className={cn("ml-1.5", active ? "opacity-70" : "opacity-60")}>
                    {count.toLocaleString("id-ID")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {statusFilter !== "ALL" && (
          <p className="text-[11px] text-muted-foreground">
            Filter status berlaku untuk task yang sudah dimuat di halaman ini.
          </p>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={ClipboardList} tileClass="bg-[#2563eb]" label="Total Tasks" value={formatCount(total)} caption="seluruh task instant" />
        <KpiCard icon={Truck} tileClass="bg-[#16a34a]" label="Active Tasks" value={formatCount(counts ? activeTasks : null)} caption="dijadwalkan + berjalan" />
        <KpiCard icon={CircleCheckBig} tileClass="bg-[#0284c7]" label="Completed" value={formatCount(counts?.ended)} caption="task selesai" />
        <KpiCard icon={X} tileClass="bg-[#ea580c]" label="Canceled" value={formatCount(counts?.canceled)} caption="task dibatalkan" />
      </div>

      {/* Tabel task */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-bold text-foreground">Task List</h3>
          {total !== null && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              Showing {rangeStart.toLocaleString("id-ID")}–{rangeEnd.toLocaleString("id-ID")} of{" "}
              {total.toLocaleString("id-ID")} tasks
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-2 px-4 py-3">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="h-14 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "Tidak ada task ditemukan. Ubah kata kunci pencarian."
              : "Tidak ada task berstatus ini di halaman ini. Coba halaman lain atau ubah filter."}
          </p>
        ) : (
          <>
            {/* Desktop: tabel */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Task ID</th>
                    <th className="px-4 py-2.5 font-semibold">Vehicle</th>
                    <th className="px-4 py-2.5 font-semibold">Driver</th>
                    <th className="px-4 py-2.5 font-semibold">Location</th>
                    <th className="px-4 py-2.5 font-semibold">Instant Point</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleItems.map((item) => {
                    const active = selectedId === item.id;
                    const done = item.currentPoint ?? 0;
                    const totalPoints = item.totalPoint ?? 0;
                    const percent =
                      totalPoints > 0 ? Math.min(100, Math.round((done / totalPoints) * 100)) : 0;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => onSelect(item)}
                        aria-selected={active}
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-muted/60",
                          active && "bg-primary-light/40",
                        )}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-foreground">
                          {item.number ?? item.id.slice(0, 8)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-foreground">
                          {item.licensePlate ?? "–"}
                        </td>
                        <td className="max-w-40 truncate px-4 py-3 text-muted-foreground">
                          {item.driverName ?? "–"}
                        </td>
                        <td className="max-w-52 truncate px-4 py-3 text-muted-foreground" title={item.currentPointName ?? undefined}>
                          {item.currentPointName ?? "–"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {totalPoints > 0 ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                                <span className="block h-full rounded-full bg-[#16a34a]" style={{ width: `${percent}%` }} />
                              </span>
                              <span className="text-xs font-bold tabular-nums text-foreground">
                                {done}/{totalPoints}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <TaskStatusBadge color={item.statusColor} label={item.statusName ?? "–"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: kartu */}
            <ol className="divide-y divide-border lg:hidden">
              {visibleItems.map((item) => {
                const active = selectedId === item.id;
                const done = item.currentPoint ?? 0;
                const totalPoints = item.totalPoint ?? 0;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                        active && "bg-primary-light/40",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-foreground">
                            {item.number ?? item.id.slice(0, 8)}
                          </span>
                          <TaskStatusBadge color={item.statusColor} label={item.statusName ?? "–"} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {[item.licensePlate, item.driverName, item.currentPointName].filter(Boolean).join(" • ") || "–"}
                        </p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                          {totalPoints > 0 ? `Titik ${done}/${totalPoints}` : "Titik –"}
                          {item.estimatedArrivalOn && (
                            <span>
                              {" • ETA "}
                              {formatRelativeTime(item.estimatedArrivalOn)}
                            </span>
                          )}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {/* Pagination bernomor */}
        {!loading && total !== null && totalPages > 1 && (
          <div className="flex items-center justify-end gap-1 border-t border-border px-4 py-3">
            <Button
              size="sm"
              variant="outline"
              icon={ChevronLeft}
              aria-label="Halaman sebelumnya"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <span className="sr-only">Sebelumnya</span>
            </Button>
            {pageWindow(page, totalPages).map((p, index) =>
              p === "…" ? (
                <span key={`gap-${index}`} className="px-1 text-xs text-muted-foreground">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  aria-current={p === page ? "page" : undefined}
                  className={cn(
                    "h-8 min-w-8 rounded-lg px-2 text-xs font-bold tabular-nums transition-colors",
                    p === page
                      ? "bg-primary text-white"
                      : "text-muted-foreground ring-1 ring-border hover:text-foreground",
                  )}
                >
                  {p}
                </button>
              ),
            )}
            <Button
              size="sm"
              variant="outline"
              icon={ChevronRight}
              aria-label="Halaman berikutnya"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <span className="sr-only">Berikutnya</span>
            </Button>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        )}
      </div>
    </div>
  );
}
