"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  LocateFixed,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import RouteGuard from "@/components/RouteGuard";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  TMS_AUTO_REFRESH_MS,
  TMS_STATUS_META,
  collectVehicleGroups,
  filterFleet,
  formatClockTime,
  formatRelativeTime,
  sortFleet,
  type TmsOperationalStatus,
  type TmsSortKey,
  type TmsVehicleStatus,
} from "@/lib/tms-status";
import FleetSidebar, { type FleetPill } from "./FleetSidebar";
import FleetMap from "./FleetMap";
import VehicleDetailPanel from "./VehicleDetailPanel";

interface FleetApiResponse {
  data?: unknown;
  error?: string;
  meta?: { total?: number; fetchedAt?: string };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Permintaan dibatalkan.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Koneksi ke layanan tracking sedang bermasalah. Coba lagi.";
}

export default function TmsDashboard() {
  const [vehicles, setVehicles] = useState<TmsVehicleStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [query, setQuery] = useState("");
  const [pill, setPill] = useState<FleetPill>("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [sort, setSort] = useState<TmsSortKey>("status");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<"map" | "list">("map");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [secondsToRefresh, setSecondsToRefresh] = useState<number | null>(TMS_AUTO_REFRESH_MS / 1000);
  const [focusNonce, setFocusNonce] = useState(0);
  const [fitAllNonce, setFitAllNonce] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const nextRefreshRef = useRef<number>(0);
  const autoRefreshRef = useRef(autoRefresh);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  const fetchFleet = useCallback(async (isInitial: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isInitial) setLoading(true);
    else setRefreshing(true);

    try {
      const response = await fetch("/api/tms/vehicle-statuses?withAddress=true", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as FleetApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Gagal memuat data armada.");
      }
      const list = Array.isArray(payload.data) ? (payload.data as TmsVehicleStatus[]) : [];
      setVehicles(list);
      setError(null);
      const stamped = Date.now();
      setLastUpdated(stamped);
      setNow(stamped);
      nextRefreshRef.current = stamped + TMS_AUTO_REFRESH_MS;
      setSecondsToRefresh(TMS_AUTO_REFRESH_MS / 1000);
    } catch (fetchError) {
      if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
      setError(normalizeErrorMessage(fetchError));
      // Backoff sederhana agar tidak membanjiri API saat gagal berulang.
      const backoff = Math.min(TMS_AUTO_REFRESH_MS * 2, 5 * 60 * 1000);
      nextRefreshRef.current = Date.now() + backoff;
      setSecondsToRefresh(Math.ceil(backoff / 1000));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load (dijadwalkan agar tidak setState sinkron di body effect).
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) void fetchFleet(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [fetchFleet]);

  // Auto-refresh interval + countdown.
  useEffect(() => {
    const poll = window.setInterval(() => {
      if (!autoRefreshRef.current || document.hidden) return;
      if (abortRef.current) return;
      if (Date.now() >= nextRefreshRef.current) fetchFleet(false);
    }, 5000);
    const countdown = window.setInterval(() => {
      setNow(Date.now());
      if (!autoRefreshRef.current) {
        setSecondsToRefresh(null);
        return;
      }
      setSecondsToRefresh(Math.max(0, Math.ceil((nextRefreshRef.current - Date.now()) / 1000)));
    }, 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(countdown);
    };
  }, [fetchFleet]);

  // Refresh saat tab aktif kembali bila data sudah stale.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && autoRefreshRef.current && !abortRef.current && Date.now() >= nextRefreshRef.current) {
        fetchFleet(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [fetchFleet]);

  // Lacak status fullscreen.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    void mapWrapRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const groups = useMemo(() => collectVehicleGroups(vehicles), [vehicles]);

  const movingCount = useMemo(
    () => vehicles.filter((v) => v.status === "moving").length,
    [vehicles],
  );
  const stoppedCount = vehicles.length - movingCount;

  const filtered = useMemo(() => {
    const pillFiltered =
      pill === "all"
        ? vehicles
        : pill === "moving"
          ? vehicles.filter((v) => v.status === "moving")
          : vehicles.filter((v) => v.status !== "moving");
    const searched = filterFleet(pillFiltered, {
      query,
      status: "all",
      group: groupFilter,
    } satisfies { query: string; status: "all" | TmsOperationalStatus; group: string });
    return sortFleet(searched, sort);
  }, [vehicles, pill, query, groupFilter, sort]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.vehicleId === selectedId) ?? null,
    [vehicles, selectedId],
  );

  const handleSelect = useCallback((vehicleId: number) => {
    setSelectedId(vehicleId);
  }, []);

  const handleFocusMap = useCallback((vehicleId: number) => {
    setSelectedId(vehicleId);
    setFocusNonce((prev) => prev + 1);
    setMobileTab("map");
  }, []);

  const sidebar = (
    <FleetSidebar
      query={query}
      onQueryChange={setQuery}
      pill={pill}
      onPillChange={setPill}
      totalCount={vehicles.length}
      movingCount={movingCount}
      stoppedCount={stoppedCount}
      group={groupFilter}
      groups={groups}
      onGroupChange={setGroupFilter}
      sort={sort}
      onSortChange={setSort}
      vehicles={filtered}
      selectedId={selectedId}
      onSelect={handleSelect}
      loading={loading}
      now={now}
      className="h-full"
    />
  );

  return (
    <RouteGuard permission="tms">
      {/* ── Desktop / laptop: sidebar + peta full-area ─────────────────── */}
      <div className="hidden h-[calc(100dvh-120px)] min-h-[560px] gap-4 lg:flex lg:h-[calc(100dvh-160px)]">
        <div className="w-[340px] shrink-0">{sidebar}</div>

        <div
          ref={mapWrapRef}
          className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border bg-muted shadow-sm"
        >
          <FleetMap
            vehicles={filtered}
            selectedId={selectedId}
            onSelect={handleSelect}
            loading={loading}
            focusNonce={focusNonce}
            fitAllNonce={fitAllNonce}
          />

          {/* Breadcrumb live */}
          <div className="absolute left-4 top-4 z-[1000] flex items-center gap-2 rounded-xl bg-card/95 px-3.5 py-2 text-xs font-bold shadow-lg ring-1 ring-black/5 backdrop-blur">
            <span className="text-muted-foreground">Operasional / Live Tracking</span>
            <span className="flex items-center gap-1.5 text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              LIVE
            </span>
            {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>

          {/* Kontrol peta */}
          <div className="absolute right-4 top-4 z-[1000] flex gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Keluar fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Keluar fullscreen" : "Tampilkan fullscreen"}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-card/95 text-foreground shadow-lg ring-1 ring-black/5 backdrop-blur transition-colors hover:text-primary"
            >
              {isFullscreen ? <Minimize className="h-4.5 w-4.5" /> : <Maximize className="h-4.5 w-4.5" />}
            </button>
            <button
              type="button"
              onClick={() => setFitAllNonce((prev) => prev + 1)}
              title="Tampilkan seluruh armada"
              aria-label="Tampilkan seluruh armada"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-card/95 text-foreground shadow-lg ring-1 ring-black/5 backdrop-blur transition-colors hover:text-primary"
            >
              <LocateFixed className="h-4.5 w-4.5" />
            </button>
          </div>

          {/* Toast error */}
          {error && (
            <div
              role="alert"
              className="absolute left-1/2 top-4 z-[1000] flex w-max max-w-[90%] -translate-x-1/2 items-center gap-2.5 rounded-xl bg-card/95 py-2 pl-3 pr-2 text-xs shadow-lg ring-1 ring-danger/30 backdrop-blur"
            >
              <TriangleAlert className="h-4 w-4 shrink-0 text-danger" />
              <span className="font-medium text-foreground">
                {error}{" "}
                {lastUpdated && (
                  <span className="text-muted-foreground">
                    • data {formatRelativeTime(new Date(lastUpdated).toISOString(), now)}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => fetchFleet(false)}
                disabled={refreshing}
                className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                Coba lagi
              </button>
            </div>
          )}

          {/* Detail panel floating */}
          {selectedVehicle && (
            <div className="absolute bottom-16 right-4 top-[72px] z-[1000] w-[320px] overflow-y-auto rounded-2xl">
              <VehicleDetailPanel
                vehicle={selectedVehicle}
                now={now}
                onFocusMap={handleFocusMap}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}

          {/* Summary cards */}
          <div className="absolute bottom-4 left-4 z-[1000] flex gap-2.5">
            <div className="min-w-[104px] rounded-2xl bg-slate-900/95 px-4 py-3 text-white shadow-xl backdrop-blur">
              <p className="text-2xl font-extrabold tabular-nums">{vehicles.length}</p>
              <p className="mt-0.5 text-[11px] text-slate-300">Total armada</p>
            </div>
            <div className="min-w-[104px] rounded-2xl bg-slate-900/95 px-4 py-3 text-white shadow-xl backdrop-blur">
              <p className="text-2xl font-extrabold tabular-nums text-emerald-400">{movingCount}</p>
              <p className="mt-0.5 text-[11px] text-slate-300">Sedang berjalan</p>
            </div>
            <div className="min-w-[104px] rounded-2xl bg-slate-900/95 px-4 py-3 text-white shadow-xl backdrop-blur">
              <p className="text-2xl font-extrabold tabular-nums">{stoppedCount}</p>
              <p className="mt-0.5 text-[11px] text-slate-300">Berhenti / offline</p>
            </div>
          </div>

          {/* Legenda */}
          <div className="absolute bottom-4 left-1/2 z-[1000] hidden -translate-x-1/2 items-center gap-3 rounded-full bg-card/95 px-4 py-2 text-[11px] font-medium text-muted-foreground shadow-lg ring-1 ring-black/5 backdrop-blur xl:flex">
            {(Object.keys(TMS_STATUS_META) as (keyof typeof TMS_STATUS_META)[]).map((key) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[4px]"
                  style={{ backgroundColor: TMS_STATUS_META[key].dotHex }}
                />
                {TMS_STATUS_META[key].label}
              </span>
            ))}
          </div>

          {/* Badge sumber data */}
          <div className="absolute bottom-4 right-4 z-[1000] rounded-full bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-lg ring-1 ring-black/5 backdrop-blur">
            {lastUpdated ? (
              <>
                Diperbarui{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {formatClockTime(lastUpdated)}
                </span>
                {autoRefresh && secondsToRefresh !== null && (
                  <span className="tabular-nums"> ({secondsToRefresh}d)</span>
                )}
              </>
            ) : (
              "Menghubungkan..."
            )}
          </div>
        </div>
      </div>

      {/* Sidebar footer controls (desktop) */}
      <div className="mt-3 hidden items-center gap-2 lg:flex">
        <Button
          variant="outline"
          size="sm"
          icon={autoRefresh ? Pause : Play}
          onClick={() => {
            setAutoRefresh((prev) => {
              const next = !prev;
              if (next) nextRefreshRef.current = Date.now() + TMS_AUTO_REFRESH_MS;
              return next;
            });
          }}
          title={autoRefresh ? "Nonaktifkan auto-refresh" : "Aktifkan auto-refresh"}
        >
          {autoRefresh ? "Jeda Otomatis" : "Otomatis"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={RefreshCw}
          onClick={() => fetchFleet(false)}
          disabled={loading || refreshing}
          className={cn(refreshing && "[&_svg]:animate-spin")}
        >
          Refresh Sekarang
        </Button>
      </div>

      {/* ── Mobile / tablet ───────────────────────────────────────────── */}
      <div className="lg:hidden">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/50 p-1" role="tablist" aria-label="Tampilan TMS">
          {(["map", "list"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={mobileTab === tab}
              onClick={() => setMobileTab(tab)}
              className={cn(
                "rounded-lg py-2 text-sm font-semibold transition-colors",
                mobileTab === tab ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {tab === "map" ? "Peta" : `Armada (${filtered.length})`}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {mobileTab === "map" ? (
            <div className="h-[62dvh] min-h-[420px] overflow-hidden rounded-2xl border border-border shadow-sm">
              <FleetMap
                vehicles={filtered}
                selectedId={selectedId}
                onSelect={handleSelect}
                loading={loading}
                focusNonce={focusNonce}
                fitAllNonce={fitAllNonce}
              />
            </div>
          ) : (
            <div className="h-[70dvh] min-h-[480px]">{sidebar}</div>
          )}
        </div>
      </div>

      {/* Bottom sheet detail pada mobile */}
      {selectedVehicle && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-3 lg:hidden">
          <div className="mx-auto max-h-[58dvh] max-w-lg overflow-y-auto rounded-2xl">
            <VehicleDetailPanel
              vehicle={selectedVehicle}
              now={now}
              onFocusMap={handleFocusMap}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      )}
    </RouteGuard>
  );
}
