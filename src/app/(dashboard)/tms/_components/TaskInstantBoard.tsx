"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
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
} from "lucide-react";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type {
  FleetTaskInstantItem,
  FleetTaskTimelinePoint,
  LatLng,
} from "@/lib/fleet-task-track";
import { normalizeRouteList } from "@/lib/fleet-task-track";
import TaskStatusBadge from "./TaskStatusBadge";

type StatusFilter = "ALL" | "SCHEDULED" | "STARTED" | "ENDED" | "CANCELED";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "SCHEDULED", label: "Dijadwalkan" },
  { key: "STARTED", label: "Berjalan" },
  { key: "ENDED", label: "Selesai" },
  { key: "CANCELED", label: "Batal" },
];

const STATUS_META: Record<string, { label: string; color: string }> = {
  SCHEDULED: { label: "Dijadwalkan", color: "#64748b" },
  STARTED: { label: "Berjalan", color: "#0284c7" },
  ENDED: { label: "Selesai", color: "#16a34a" },
  CANCELED: { label: "Dibatalkan", color: "#ea580c" },
  DRAFT: { label: "Draf", color: "#94a3b8" },
};

interface BoardTask {
  id: string;
  number: string | null;
  statusRaw: string;
  vehicleId: number | null;
  licensePlate: string | null;
  driverName: string | null;
  expectedStartedOn: string | null;
  actualStartedOn: string | null;
  actualArrivalOn: string | null;
  timeline: FleetTaskTimelinePoint[];
  plannedRoutes: LatLng[][];
  actualRoutes: LatLng[][];
  terminalAt: string | null;
  trackId: string | null;
  frozen: boolean;
  windowStartedAt: string;
  visibleUntil: string;
}

interface BoardGroup {
  id: string;
  name: string;
  color: string;
  windowLabel: string;
  tasks: BoardTask[];
}

interface BoardApiResponse {
  data?: {
    id: string;
    name: string;
    color: string;
    windowLabel: string;
    tasks: {
      id: string;
      number: string | null;
      statusRaw: string | null;
      vehicleId: number | null;
      licensePlate: string | null;
      driverName: string | null;
      expectedStartedOn: string | null;
      actualStartedOn: string | null;
      actualArrivalOn: string | null;
      timeline: unknown;
      plannedRoutes: unknown;
      actualRoutes: unknown;
      terminalAt: string | null;
      trackId: string | null;
      frozen: boolean;
      windowStartedAt: string;
      visibleUntil: string;
    }[];
  }[];
  error?: string;
  meta?: { lastSyncedAt?: string | null };
}

/** Interval auto-refresh board (ms). */
const BOARD_POLL_MS = 30_000;

function normalizeTimeline(value: unknown): FleetTaskTimelinePoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is FleetTaskTimelinePoint => !!item && typeof item === "object",
  );
}

function visitedCount(timeline: FleetTaskTimelinePoint[]): number {
  return timeline.filter((p) => !!p.arrivalActual || !!p.departureActual).length;
}

function toFleetTaskItem(task: BoardTask): FleetTaskInstantItem {
  const meta = STATUS_META[task.statusRaw] ?? { label: task.statusRaw, color: "#64748b" };
  const total = task.timeline.length;
  // ENDED selalu 100% agar konsisten dengan panel detail.
  const done = task.statusRaw === "ENDED" ? total : visitedCount(task.timeline);
  return {
    id: task.id,
    number: task.number,
    statusRaw: task.statusRaw,
    statusName: meta.label,
    statusColor: meta.color,
    vehicleId: task.vehicleId,
    licensePlate: task.licensePlate,
    driverName: task.driverName,
    expectedStartedOn: task.expectedStartedOn,
    expectedArrivalOn: null,
    estimatedArrivalOn: null,
    actualStartedOn: task.actualStartedOn,
    actualArrivalOn: task.actualArrivalOn,
    totalPoint: total,
    currentPoint: done,
    currentPointName: null,
    currentPointStatus: null,
    trackLink: null,
    trackId: task.trackId,
    createdOn: null,
    timeline: task.timeline,
    plannedRoutes: task.plannedRoutes,
    actualRoutes: task.actualRoutes,
    terminalAt: task.terminalAt,
  };
}

function formatClock(iso: string | null): string {
  if (!iso) return "–";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(parsed));
}

function KpiCard({
  icon: Icon,
  tileClass,
  label,
  value,
  caption,
}: {
  icon: typeof Truck;
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

interface TaskInstantBoardProps {
  selectedId: string | null;
  onSelect: (item: FleetTaskInstantItem) => void;
}

export default function TaskInstantBoard({ selectedId, onSelect }: TaskInstantBoardProps) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [groups, setGroups] = useState<BoardGroup[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBoard = useCallback(async (term: string, background: boolean) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams();
      if (term.trim()) params.set("search", term.trim());
      const suffix = params.toString();
      const response = await fetch(`/api/tms/live-track-board${suffix ? `?${suffix}` : ""}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = (await response.json()) as BoardApiResponse;
      if (requestRef.current !== requestId) return;
      if (!response.ok) throw new Error(payload.error ?? "Gagal memuat board Live Track.");
      const next: BoardGroup[] = (Array.isArray(payload.data) ? payload.data : []).map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color,
        windowLabel: group.windowLabel,
        tasks: group.tasks.map((task) => ({
          id: task.id,
          number: task.number,
          statusRaw: (task.statusRaw ?? "SCHEDULED").toUpperCase(),
          vehicleId: task.vehicleId,
          licensePlate: task.licensePlate,
          driverName: task.driverName,
          expectedStartedOn: task.expectedStartedOn,
          actualStartedOn: task.actualStartedOn,
          actualArrivalOn: task.actualArrivalOn,
          timeline: normalizeTimeline(task.timeline),
          plannedRoutes: normalizeRouteList(task.plannedRoutes),
          actualRoutes: normalizeRouteList(task.actualRoutes),
          terminalAt: task.terminalAt,
          trackId: task.trackId,
          frozen: task.frozen,
          windowStartedAt: task.windowStartedAt,
          visibleUntil: task.visibleUntil,
        })),
      }));
      setGroups(next);
      setLastSyncedAt(payload.meta?.lastSyncedAt ?? null);
      setStale(false);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (requestRef.current !== requestId) return;
      // Background gagal: pertahankan data lama + tandai stale.
      if (background && groups.length > 0) {
        setStale(true);
        return;
      }
      setError(err instanceof Error && err.message ? err.message : "Gagal memuat board Live Track.");
    } finally {
      if (requestRef.current === requestId && !background) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBoard(search, false);
    const timer = setInterval(() => void fetchBoard(search, true), BOARD_POLL_MS);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchInput);
  };

  const handleRefresh = () => {
    if (!loading) void fetchBoard(search, false);
  };

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          tasks:
            statusFilter === "ALL" ? group.tasks : group.tasks.filter((t) => t.statusRaw === statusFilter),
        }))
        .filter((group) => group.tasks.length > 0),
    [groups, statusFilter],
  );

  const allTasks = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const countFor = useCallback(
    (status: StatusFilter): number =>
      status === "ALL" ? allTasks.length : allTasks.filter((t) => t.statusRaw === status).length,
    [allTasks],
  );

  const toggleCollapse = useCallback((groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // Kirim snapshot terbaru ke panel detail saat board diperbarui.
  useEffect(() => {
    if (!selectedId) return;
    const updated = allTasks.find((entry) => entry.id === selectedId);
    if (updated) onSelect(toFleetTaskItem(updated));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, selectedId]);

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
              Live Track Task
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              FO per kelompok customer sesuai jam operasional kontrak.
              {lastSyncedAt && (
                <span className="tabular-nums"> · sinkron {formatClock(lastSyncedAt)}</span>
              )}
              {stale && <span className="font-semibold text-amber-600"> · data mungkin basi</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <span className="sr-only">Cari FO, kendaraan, atau driver</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cari FO, nopol, atau driver…"
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
                <span className={cn("ml-1.5", active ? "opacity-70" : "opacity-60")}>
                  {countFor(filter.key).toLocaleString("id-ID")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={ClipboardList} tileClass="bg-[#2563eb]" label="Total FO" value={allTasks.length.toLocaleString("id-ID")} caption="dalam window aktif" />
        <KpiCard icon={Truck} tileClass="bg-[#16a34a]" label="Berjalan" value={countFor("STARTED").toLocaleString("id-ID")} caption="task started" />
        <KpiCard icon={CircleCheckBig} tileClass="bg-[#0284c7]" label="Selesai" value={countFor("ENDED").toLocaleString("id-ID")} caption="sampai window berakhir" />
        <KpiCard icon={X} tileClass="bg-[#ea580c]" label="Dibatalkan" value={countFor("CANCELED").toLocaleString("id-ID")} caption="task dibatalkan" />
      </div>

      {/* Board per kelompok */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : visibleGroups.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Tidak ada FO dalam window aktif. Periksa konfigurasi kelompok dan jam operasional di Pengaturan Live Track.
        </p>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((group) => {
            const isCollapsed = collapsed.has(group.id);
            return (
              <section key={group.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => toggleCollapse(group.id)}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/40"
                  aria-expanded={!isCollapsed}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: group.color }}
                  >
                    <Truck className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">{group.name}</span>
                    <span className="block text-[11px] tabular-nums text-muted-foreground">
                      {group.windowLabel} · {group.tasks.length} FO
                    </span>
                  </span>
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
                {!isCollapsed && (
                  <ol className="divide-y divide-border border-t border-border">
                    {group.tasks.map((task) => {
                      const active = selectedId === task.id;
                      const meta = STATUS_META[task.statusRaw] ?? { label: task.statusRaw, color: "#64748b" };
                      const totalPoints = task.timeline.length;
                      const done = task.statusRaw === "ENDED" ? totalPoints : visitedCount(task.timeline);
                      const percent = totalPoints > 0 ? Math.min(100, Math.round((done / totalPoints) * 100)) : 0;
                      return (
                        <li key={task.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(toFleetTaskItem(task))}
                            className={cn(
                              "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                              active && "bg-primary-light/40",
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-foreground">
                                  {task.number ?? task.id.slice(0, 8)}
                                </span>
                                <TaskStatusBadge color={meta.color} label={meta.label} />
                                {task.frozen && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                    Beku s.d. {formatClock(task.visibleUntil)}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {[task.licensePlate, task.driverName].filter(Boolean).join(" • ") || "–"}
                              </p>
                              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                                {totalPoints > 0 ? `Titik ${done}/${totalPoints} (${percent}%)` : "Titik –"}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}

      {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
