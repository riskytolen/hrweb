"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Expand,
  Loader2,
  MapPin,
  Route as RouteIcon,
  TriangleAlert,
  Truck,
  User,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  normalizeFleetTaskInstantDetail,
  normalizeFleetTaskTrack,
  normalizeTripDetailTrail,
  type FleetTaskInstantDetail as FleetTaskInstantDetailData,
  type FleetTaskInstantItem,
  type FleetTaskTimelinePoint,
  type LatLng,
} from "@/lib/fleet-task-track";
import {
  formatFullTimestamp,
  formatRelativeTime,
  normalizeMcEasyVehicleStatus,
  type TmsVehicleStatus,
} from "@/lib/tms-status";
import {
  formatCapturedPointTemperature,
  indexPointTemperaturesBySequence,
  normalizePointTemperatureList,
  resolveRoutePointSequence,
  type TmsRoutePointTemperature,
} from "@/lib/tms-point-temperature";
import { useAuth } from "@/components/AuthProvider";
import { canViewTmsEpod } from "@/lib/permissions";
import {
  EPOD_ASSIGNMENT_STATUS_LABEL,
  EPOD_RESULT_LABEL,
  normalizeEpodStop,
  normalizeEpodSubmission,
  type EpodAssignmentStatus,
  type EpodStop,
  type EpodStopType,
  type EpodSubmission,
} from "@/lib/tms-epod";
import TaskRouteMap from "./TaskRouteMap";
import TaskStatusBadge from "./TaskStatusBadge";
import EpodEvidenceGallery from "./EpodEvidenceGallery";

interface TaskDetailApiResponse {
  data?: unknown;
  error?: string;
}

interface PointTemperatureApiResponse {
  data?: unknown;
  error?: string;
}

interface TripTrailAttempt {
  source: "trips" | "track";
  identifier: string;
  startDate: string | null;
  endDate: string | null;
  status: number | null;
  count: number;
  label?: string | null;
}

interface TripTrailWindow {
  start: number;
  end: number;
  label: string;
}

/** WIB = UTC+7. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Batas hari kalender WIB untuk sebuah timestamp, dikembalikan dalam ms UTC. */
function jakartaDayBounds(timestampMs: number): { startUtcMs: number; endUtcMs: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(timestampMs));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const year = Number(get("year"));
    const month = Number(get("month"));
    const day = Number(get("day"));
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      const startUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - WIB_OFFSET_MS;
      return { startUtcMs, endUtcMs: startUtcMs + DAY_MS - 1 };
    }
  } catch {
    // Fallthrough ke fallback lokal di bawah.
  }
  const fallback = new Date(timestampMs);
  fallback.setHours(0, 0, 0, 0);
  return { startUtcMs: fallback.getTime(), endUtcMs: fallback.getTime() + DAY_MS - 1 };
}

/**
 * Susun window query dari sempit ke lebar: window task, hari WIB tanggal
 * mulai, rentang hari WIB mulai-selesai, lalu rentang itu ±1 hari.
 */
function buildTripTrailWindows(startMs: number, endMs: number): TripTrailWindow[] {
  const startDay = jakartaDayBounds(startMs);
  const endDay = jakartaDayBounds(endMs);
  const spanStart = Math.min(startDay.startUtcMs, endDay.startUtcMs);
  const spanEnd = Math.max(startDay.endUtcMs, endDay.endUtcMs);
  const windows: TripTrailWindow[] = [
    { start: startMs - 60_000, end: endMs + 60_000, label: "task" },
    { start: startDay.startUtcMs, end: startDay.endUtcMs, label: "hari-mulai" },
  ];
  if (spanEnd > startDay.endUtcMs || spanStart < startDay.startUtcMs) {
    windows.push({ start: spanStart, end: spanEnd, label: "rentang-hari" });
  }
  windows.push({ start: spanStart - DAY_MS, end: spanEnd + DAY_MS, label: "h-1-h+1" });
  return windows;
}

interface TripTrailDebug {
  attempts: TripTrailAttempt[];
  selected: string | null;
}

const VISITED_STATUSES = new Set([
  "VISITED",
  "ARRIVED",
  "DONE",
  "COMPLETED",
  "FINISHED",
  "ENDED",
  "DEPARTED",
  "SKIPPED",
]);

function isVisited(raw: string | null): boolean {
  if (!raw) return false;
  return VISITED_STATUSES.has(raw.toUpperCase());
}

/**
 * Titik dianggap sudah dikunjungi bila status menandai visited ATAU sudah ada
 * waktu tiba/berangkat aktual. Ini penting karena sebagian respons hanya
 * mengisi `arrivalActual` tanpa memperbarui `visitStatusRaw`.
 */
function isPointVisited(point: FleetTaskTimelinePoint): boolean {
  return isVisited(point.visitStatusRaw) || !!point.arrivalActual || !!point.departureActual;
}

/** Nama status yang tidak ditampilkan di daftar rute (mis. "Terlambat", "Potensi Terlambat"). */
function isHiddenVisitStatus(raw: string): boolean {
  const upper = raw.toUpperCase();
  return upper.includes("TERLAMBAT") || upper.includes("LATE");
}

function visitStatusLabel(point: FleetTaskTimelinePoint, state: "done" | "current" | "pending"): string {
  const raw = point.visitStatusName?.trim();
  if (raw && !isHiddenVisitStatus(raw)) return raw;
  if (state === "done") return "Dikunjungi";
  if (state === "pending") return "Belum dikunjungi";
  return "Sedang dikunjungi";
}

/**
 * Selaraskan status titik rute dengan progres task. Endpoint Show sering
 * tidak mengirim `timeline_route`, sehingga timeline fallback dari Index bisa
 * tertinggal. Bila task sudah berjalan/selesai, titik yang sudah terlewati
 * (berdasarkan `currentPoint`) ditandai selesai agar tidak "stuck" di titik 1.
 */
function withTaskProgress(
  timeline: FleetTaskTimelinePoint[],
  currentPoint: number | null,
  statusRaw: string | null,
): FleetTaskTimelinePoint[] {
  const ended = statusRaw === "ENDED";
  const doneCount = ended ? timeline.length : Math.max(0, currentPoint ?? 0);
  return timeline.map((point, index) => {
    if (isPointVisited(point)) return point;
    const reached = index < doneCount || (point.sequence !== null && point.sequence <= doneCount);
    return reached ? { ...point, visitStatusRaw: "VISITED" } : point;
  });
}

/** Jam lokal (mis. "13:42") dari timestamp ISO. */
function formatClock(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function pointTime(point: FleetTaskTimelinePoint): {
  at: string | null;
  label: string;
  kind: "actual" | "target";
} {
  if (point.arrivalActual) return { at: point.arrivalActual, label: "Tiba", kind: "actual" };
  if (point.departureActual) return { at: point.departureActual, label: "Berangkat", kind: "actual" };
  if (point.arrivalTarget) return { at: point.arrivalTarget, label: "Target tiba", kind: "target" };
  if (point.departureTarget) return { at: point.departureTarget, label: "Target berangkat", kind: "target" };
  return { at: null, label: "", kind: "target" };
}

function isLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.latitude === "number" && typeof point.longitude === "number";
}

interface EpodPointState {
  stopId: string;
  stopType: EpodStopType;
  submission: EpodSubmission | null;
}

interface EpodTaskSummaryData {
  assignment: {
    status: EpodAssignmentStatus;
    loadingStatus: "PENDING_LOADING" | "LOADING_COMPLETED";
    deliveryDoneCount: number;
    deliveryTotalCount: number;
  };
  stops: EpodStop[];
  currentByStop: Record<string, EpodSubmission>;
}

/** Normalisasi ringkasan e-POD dari endpoint `by-task` (client-safe). */
function normalizeEpodTaskSummary(value: unknown): EpodTaskSummaryData | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const assignmentRaw = source.assignment;
  if (!assignmentRaw || typeof assignmentRaw !== "object") return null;
  const assignment = assignmentRaw as Record<string, unknown>;

  const stops = Array.isArray(source.stops)
    ? source.stops.map(normalizeEpodStop).filter((stop): stop is EpodStop => stop !== null)
    : [];

  const currentByStop: Record<string, EpodSubmission> = {};
  const rawCurrent = source.currentByStop;
  if (rawCurrent && typeof rawCurrent === "object") {
    for (const [key, entry] of Object.entries(rawCurrent as Record<string, unknown>)) {
      const submission = normalizeEpodSubmission(entry);
      if (submission) currentByStop[key] = submission;
    }
  }

  const status = String(assignment.status ?? "OPEN") as EpodAssignmentStatus;

  return {
    assignment: {
      status,
      loadingStatus: assignment.loadingStatus === "LOADING_COMPLETED" ? "LOADING_COMPLETED" : "PENDING_LOADING",
      deliveryDoneCount: Number(assignment.deliveryDoneCount ?? 0) || 0,
      deliveryTotalCount: Number(assignment.deliveryTotalCount ?? 0) || 0,
    },
    stops,
    currentByStop,
  };
}

/** Label ringkas e-POD untuk satu titik. */
function epodPointLabel(state: EpodPointState): { text: string; tone: string } {
  if (state.stopType === "LOADING") {
    return state.submission
      ? { text: "Loading selesai", tone: "bg-emerald-500/10 text-emerald-600" }
      : { text: "Loading belum", tone: "bg-slate-500/10 text-slate-600" };
  }
  if (state.submission?.result) {
    const tone =
      state.submission.result === "DELIVERED"
        ? "bg-emerald-500/10 text-emerald-600"
        : state.submission.result === "PARTIAL"
          ? "bg-amber-500/10 text-amber-600"
          : "bg-rose-500/10 text-rose-600";
    return { text: EPOD_RESULT_LABEL[state.submission.result], tone };
  }
  return { text: "Belum ada e-POD", tone: "bg-muted text-muted-foreground" };
}

function extractTripTrail(payloadData: unknown): LatLng[] {
  if (payloadData && typeof payloadData === "object" && !Array.isArray(payloadData)) {
    const trail = (payloadData as { trail?: unknown }).trail;
    if (Array.isArray(trail)) return trail.filter(isLatLng);
  }
  return normalizeTripDetailTrail(payloadData);
}

/**
 * Daftar rute perjalanan (titik kunjungan) dari `timeline_route`.
 * Titik pertama yang belum dikunjungi ditandai sebagai posisi saat ini.
 */
function RoutePointList({
  points,
  pointTemperatures,
  epodBySequence,
}: {
  points: FleetTaskTimelinePoint[];
  pointTemperatures: Map<number, TmsRoutePointTemperature>;
  epodBySequence: Map<number, EpodPointState>;
}) {
  // Titik e-POD yang sedang dibuka detail buktinya.
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);

  if (points.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Daftar rute belum tersedia untuk task ini.
      </p>
    );
  }

  const firstPending = points.findIndex((p) => !isPointVisited(p));

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Rute Perjalanan ({points.length} titik)
      </p>
      <ol>
        {points.map((point, index) => {
          const visited = isPointVisited(point);
          const current = !visited && index === firstPending;
          const time = pointTime(point);
          const sequence = resolveRoutePointSequence(point, index);
          const temperatureLabel = visited
            ? formatCapturedPointTemperature(pointTemperatures.get(sequence))
            : null;
          const epodState = epodBySequence.get(sequence) ?? null;
          const state = visited ? "done" : current ? "current" : "pending";
          const nextVisited = index + 1 < points.length && isPointVisited(points[index + 1]);
          return (
            <li key={`${point.sequence ?? index}-${point.name ?? index}`} className="relative flex gap-3 pb-4 last:pb-0">
              <span className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold",
                    state === "done" && "bg-[#16a34a] text-white",
                    state === "current" && "bg-[#0284c7] text-white",
                    state === "pending" && "bg-[#e2e8f0] text-[#64748b] ring-1 ring-[#cbd5e1]",
                  )}
                >
                  {point.sequence ?? index + 1}
                </span>
                {index < points.length - 1 && (
                  <span
                    className={cn(
                      "w-0.5 flex-1 rounded-full",
                      visited && nextVisited ? "bg-[#16a34a]" : "bg-[#e2e8f0]",
                    )}
                  />
                )}
              </span>
              <div
                className={cn(
                  "min-w-0 flex-1 pb-0.5",
                  state === "pending" && "opacity-70",
                )}
              >
                <p
                  className={cn(
                    "truncate text-sm font-semibold",
                    state === "done" && "text-[#15803d]",
                    state === "current" && "text-[#0284c7]",
                    state === "pending" && "text-muted-foreground",
                  )}
                  title={point.name ?? undefined}
                >
                  {point.name ?? `Titik ${point.sequence ?? index + 1}`}
                </p>
                {point.address && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={point.address}>
                    {point.address}
                  </p>
                )}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums text-muted-foreground">
                  <span
                    className={cn(
                      "font-semibold",
                      state === "done" && "text-[#16a34a]",
                      state === "current" && "text-[#0284c7]",
                      state === "pending" && "text-[#94a3b8]",
                    )}
                  >
                    {visitStatusLabel(point, state)}
                  </span>
                  {time.at && (
                    <span title={formatFullTimestamp(time.at)}>
                      {time.label} {formatClock(time.at)}
                      {time.kind === "actual" && ` · ${formatRelativeTime(time.at)}`}
                    </span>
                  )}
                  {temperatureLabel && (
                    <span title="Suhu kendaraan saat berada pada titik ini">{temperatureLabel}</span>
                  )}
                  {epodState && (() => {
                    const label = epodPointLabel(epodState);
                    if (!epodState.submission) {
                      return (
                        <span
                          className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", label.tone)}
                          title="Status e-POD titik ini"
                        >
                          {label.text}
                        </span>
                      );
                    }
                    const expanded = expandedStopId === epodState.stopId;
                    return (
                      <button
                        type="button"
                        onClick={() => setExpandedStopId(expanded ? null : epodState.stopId)}
                        aria-expanded={expanded}
                        title={expanded ? "Tutup detail e-POD" : "Lihat detail e-POD"}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
                          label.tone,
                        )}
                      >
                        {label.text}
                        <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
                      </button>
                    );
                  })()}
                </p>
                {epodState && epodState.submission && expandedStopId === epodState.stopId && (
                  <div className="mt-2">
                    <EpodEvidenceGallery stopId={epodState.stopId} refreshKey={0} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface TaskInstantSidePanelProps {
  item: FleetTaskInstantItem | null;
  onBack: () => void;
}

/** Interval polling posisi kendaraan realtime (ms). */
const VEHICLE_POLL_MS = 30_000;

/** Interval refresh detail task terpilih agar progres tidak basi (ms). */
const DETAIL_POLL_MS = 30_000;

export default function TaskInstantSidePanel({ item, onBack }: TaskInstantSidePanelProps) {
  const [detail, setDetail] = useState<FleetTaskInstantDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [vehicleStatus, setVehicleStatus] = useState<TmsVehicleStatus | null>(null);
  const [pointTemperatures, setPointTemperatures] = useState<TmsRoutePointTemperature[]>([]);
  const { profile } = useAuth();
  const canViewEpod = canViewTmsEpod(profile?.roles?.permissions ?? [], profile?.account_type ?? "internal");
  // Ringkasan e-POD disimpan bersama taskId agar badge task lama tidak
  // sempat tampil saat task berganti.
  const [epodData, setEpodData] = useState<{ taskId: string; summary: EpodTaskSummaryData | null } | null>(null);
  // Jejak historis dari track endpoint (bila actual_trip tidak tersedia).
  const [historyTrail, setHistoryTrail] = useState<LatLng[]>([]);
  // Jejak yang terakumulasi dari polling realtime selama halaman dibuka.
  const [liveTrail, setLiveTrail] = useState<LatLng[]>([]);
  const [tripTrailDebug, setTripTrailDebug] = useState<TripTrailDebug>({
    attempts: [],
    selected: null,
  });

  useEffect(() => {
    // Reset tampilan saat task yang dipilih berganti, lalu muat detail baru.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    setError(null);
    setMapOpen(false);
    setVehicleStatus(null);
    setPointTemperatures([]);
    setHistoryTrail([]);
    setLiveTrail([]);
    setTripTrailDebug({ attempts: [], selected: null });
    if (!item) return;
    const taskId = item.id;
    const listTimeline = item.timeline;
    let disposed = false;
    const controller = new AbortController();
    async function load(isInitial: boolean) {
      if (isInitial) setLoading(true);
      try {
        const response = await fetch(`/api/tms/fleet-task-instant/${encodeURIComponent(taskId)}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = (await response.json()) as TaskDetailApiResponse;
        if (!response.ok) throw new Error(payload.error ?? "Gagal memuat detail task.");
        const normalized = normalizeFleetTaskInstantDetail(payload.data);
        if (!normalized) throw new Error("Detail task tidak dikenali. Coba lagi.");
        if (disposed) return;
        // Endpoint Show tidak mengirim timeline_route, jadi pakai titik
        // rute dari data Index bila detail tidak memilikinya.
        setDetail({
          ...normalized,
          timeline: normalized.timeline.length > 0 ? normalized.timeline : listTimeline,
        });
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (disposed) return;
        // Jangan hapus data lama saat refresh berkala gagal.
        if (isInitial) {
          setDetail(null);
          setError(err instanceof Error && err.message ? err.message : "Gagal memuat detail task.");
        }
      } finally {
        if (isInitial && !disposed) setLoading(false);
      }
    }
    void load(true);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void load(false);
    }, DETAIL_POLL_MS);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [item]);

  useEffect(() => {
    const taskId = item?.id;
    if (typeof taskId !== "string" || !taskId) return;
    const activeTaskId: string = taskId;
    let disposed = false;
    const controller = new AbortController();

    async function loadPointTemperatures() {
      try {
        const response = await fetch(
          `/api/tms/fleet-task-instant/${encodeURIComponent(activeTaskId)}/point-temperatures`,
          { headers: { Accept: "application/json" }, signal: controller.signal },
        );
        const payload = (await response.json()) as PointTemperatureApiResponse;
        if (!response.ok || disposed) return;
        setPointTemperatures(normalizePointTemperatureList(payload.data));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!disposed) setPointTemperatures([]);
      }
    }

    void loadPointTemperatures();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadPointTemperatures();
    }, DETAIL_POLL_MS);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [item?.id]);

  // Ringkasan e-POD per titik (badge loading/pengantaran) tiap 30 detik.
  useEffect(() => {
    const taskId = item?.id;
    if (typeof taskId !== "string" || !taskId || !canViewEpod) return;
    const activeTaskId: string = taskId;
    let disposed = false;
    const controller = new AbortController();

    async function loadEpod() {
      try {
        const response = await fetch(
          `/api/tms/epod/by-task/${encodeURIComponent(activeTaskId)}`,
          { headers: { Accept: "application/json" }, signal: controller.signal },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { data?: unknown };
        if (disposed) return;
        setEpodData({ taskId: activeTaskId, summary: normalizeEpodTaskSummary(payload.data) });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!disposed) setEpodData({ taskId: activeTaskId, summary: null });
      }
    }

    void loadEpod();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadEpod();
    }, DETAIL_POLL_MS);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [item?.id, canViewEpod]);

  const shown = detail ?? item;

  // Timeline efektif: fallback dari Index + selaras dengan progres task
  // (endpoint Show sering tidak mengirim timeline_route terbaru).
  const effectiveTimeline = useMemo(() => {
    const base = detail?.timeline ?? item?.timeline ?? [];
    return withTaskProgress(base, shown?.currentPoint ?? null, shown?.statusRaw ?? null);
  }, [detail, item, shown?.currentPoint, shown?.statusRaw]);

  const pointTemperatureBySequence = useMemo(
    () => indexPointTemperaturesBySequence(pointTemperatures),
    [pointTemperatures],
  );

  const epodSummary = epodData && epodData.taskId === item?.id ? epodData.summary : null;

  const epodBySequence = useMemo(() => {
    const map = new Map<number, EpodPointState>();
    if (!epodSummary) return map;
    for (const stop of epodSummary.stops) {
      map.set(stop.sequence, {
        stopId: stop.id,
        stopType: stop.stopType,
        submission: epodSummary.currentByStop[stop.id] ?? null,
      });
    }
    return map;
  }, [epodSummary]);

  /** True bila semua titik rute sudah dikunjungi. */
  const allRoutePointsVisited =
    effectiveTimeline.length > 0 && effectiveTimeline.every((point) => isPointVisited(point));

  /**
   * Waktu selesai kunjungan terakhir (ms). Dipakai sebagai batas akhir
   * riwayat trip agar garis berhenti setelah semua titik dikunjungi.
   */
  const routeCompletedAtMs = useMemo(() => {
    let latest: number | null = null;
    for (const point of effectiveTimeline) {
      for (const at of [point.arrivalActual, point.departureActual]) {
        if (!at) continue;
        const parsed = Date.parse(at);
        if (Number.isNaN(parsed)) continue;
        if (latest === null || parsed > latest) latest = parsed;
      }
    }
    return latest;
  }, [effectiveTimeline]);

  // Polling posisi kendaraan realtime tiap 30 detik selama task dipilih.
  useEffect(() => {
    const vehicleId = item?.vehicleId ?? null;
    if (vehicleId === null) return;
    let disposed = false;
    const controller = new AbortController();

    async function loadVehicle() {
      try {
        const response = await fetch(
          `/api/tms/vehicle-statuses/${encodeURIComponent(String(vehicleId))}?withAddress=true`,
          { headers: { Accept: "application/json" }, signal: controller.signal },
        );
        const payload = (await response.json()) as { data?: unknown };
        if (!response.ok) return;
        const normalized = normalizeMcEasyVehicleStatus(
          (payload.data ?? {}) as Record<string, unknown>,
        );
        if (disposed) return;
        setVehicleStatus(normalized);
        // Simpan posisi baru sebagai jejak lintasan realtime.
        if (
          normalized &&
          normalized.hasValidLocation &&
          normalized.latitude !== null &&
          normalized.longitude !== null
        ) {
          const point: LatLng = {
            latitude: normalized.latitude,
            longitude: normalized.longitude,
          };
          // Setelah semua titik selesai dikunjungi, garis jejak tidak
          // ditambah lagi; marker kendaraan tetap diperbarui.
          if (!allRoutePointsVisited) {
            setLiveTrail((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.latitude === point.latitude && last.longitude === point.longitude) {
                return prev;
              }
              return [...prev, point];
            });
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Diamkan kegagalan polling; peta tetap menampilkan data rute.
      }
    }

    void loadVehicle();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadVehicle();
    }, VEHICLE_POLL_MS);

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [item, allRoutePointsVisited]);

  // Jejak historis: sumber utama Detail Trip History (/trips/:id/detail).
  // Coba license plate dulu (paling andal lintas endpoint), lalu vehicleId,
  // dengan rentang waktu task dan fallback rentang harian. Bila tetap kosong,
  // fallback ke track endpoint.
  useEffect(() => {
    if (!item) return;
    const identifiers = [item.licensePlate, item.vehicleId !== null ? String(item.vehicleId) : null].filter(
      (value): value is string => !!value,
    );
    if (identifiers.length === 0) return;
    const startRaw = item.actualStartedOn ?? item.expectedStartedOn ?? item.createdOn;
    if (!startRaw) return;
    const startMs = Date.parse(startRaw);
    if (Number.isNaN(startMs)) return;
    const endMsRaw = item.actualArrivalOn ? Date.parse(item.actualArrivalOn) : NaN;
    // Bila semua titik sudah dikunjungi, hentikan riwayat trip pada waktu
    // kunjungan terakhir agar garis tidak lanjut setelah toko terakhir.
    // Tanpa waktu cutoff yang akurat, pakai waktu sekarang seperti semula.
    const endMs =
      !Number.isNaN(endMsRaw)
        ? endMsRaw
        : allRoutePointsVisited && routeCompletedAtMs !== null
          ? routeCompletedAtMs
          : Date.now();

    // Window dari sempit ke lebar (WIB-aware) agar trip yang tercatat di luar
    // jam task tetap tertangkap.
    const windows = buildTripTrailWindows(startMs, endMs);

    let disposed = false;
    const controller = new AbortController();

    async function loadFallbackTrack() {
      const trackId = item?.trackId;
      if (!trackId) return;
      try {
        const response = await fetch(
          `/api/tms/fleet-task-instant/track/${encodeURIComponent(trackId)}`,
          { headers: { Accept: "application/json" }, signal: controller.signal },
        );
        const payload = (await response.json()) as { data?: unknown };
        if (!response.ok) return;
        const normalized = normalizeFleetTaskTrack(payload.data, trackId);
        if (disposed) return;
        setTripTrailDebug((prev) => ({
          attempts: [
            ...prev.attempts,
            {
              source: "track",
              identifier: trackId,
              startDate: null,
              endDate: null,
              status: response.status,
              count: normalized.points.length,
            },
          ],
          selected: normalized.points.length > 1 ? `track:${trackId}` : prev.selected,
        }));
        setHistoryTrail(
          normalized.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }

    async function tryFetchTrail(
      window: TripTrailWindow,
      identifier: string,
      speedLimit?: number,
    ): Promise<LatLng[]> {
      const startDate = new Date(window.start).toISOString();
      const endDate = new Date(window.end).toISOString();
      const params = new URLSearchParams({ startDate, endDate });
      if (speedLimit !== undefined) params.set("speedLimit", String(speedLimit));
      const url = `/api/tms/trips/${encodeURIComponent(identifier)}/detail?${params.toString()}`;
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as { data?: unknown; meta?: { total?: unknown } };
      const trail = response.ok ? extractTripTrail(payload.data) : [];
      const count = typeof payload.meta?.total === "number" ? payload.meta.total : trail.length;
      if (disposed) return [];
      setTripTrailDebug((prev) => ({
        attempts: [
          ...prev.attempts,
          {
            source: "trips",
            identifier,
            startDate,
            endDate,
            status: response.status,
            count,
            label: `${window.label}, ${speedLimit === undefined ? "no-speedLimit" : `speedLimit=${speedLimit}`}`,
          },
        ],
        selected: trail.length > 1 ? `trips:${identifier}` : prev.selected,
      }));
      if (!response.ok) return [];
      if (process.env.NODE_ENV !== "production") {
        console.debug("[tms-trip-trail]", {
          identifier,
          label: window.label,
          speedLimit,
          startDate,
          endDate,
          count: trail.length,
        });
      }
      return trail;
    }

    async function loadHistory() {
      try {
        for (const identifier of identifiers) {
          for (const window of windows) {
            for (const speedLimit of [undefined, 120] as const) {
              const trail = await tryFetchTrail(window, identifier, speedLimit);
              if (disposed) return;
              if (trail.length > 1) {
                setHistoryTrail(trail);
                return;
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
      await loadFallbackTrack();
    }

    void loadHistory();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [item, allRoutePointsVisited, routeCompletedAtMs]);

  // Progress: pakai current/total bila ada, fallback ke timeline visited.
  let doneCount = 0;
  let totalCount = 0;
  if (shown && (shown.totalPoint ?? 0) > 0) {
    doneCount = shown.statusRaw === "ENDED" ? (shown.totalPoint ?? 0) : (shown.currentPoint ?? 0);
    totalCount = shown.totalPoint ?? 0;
  } else if (effectiveTimeline.length > 0) {
    totalCount = effectiveTimeline.length;
    doneCount = effectiveTimeline.filter((p) => isPointVisited(p)).length;
  }
  const percent = totalCount > 0 ? Math.min(100, Math.round((doneCount / totalCount) * 100)) : 0;

  // Koordinat titik rute — dipakai sebagai sumber peta bila polyline
  // planned_trip/actual_trip tidak tersedia (umum pada task terjadwal).
  const timelineCoords: LatLng[] = [];
  for (const point of effectiveTimeline) {
    if (point.latitude !== null && point.longitude !== null) {
      timelineCoords.push({ latitude: point.latitude, longitude: point.longitude });
    }
  }
  const hasPolylines = !!detail && (detail.plannedRoutes.length > 0 || detail.actualRoutes.length > 0);
  // Hanya gambar polyline asli dari API. Titik kunjungan tidak dihubungkan
  // dengan garis agar peta menampilkan lokasi tanpa rute semu.
  const mapPlanned = detail?.plannedRoutes ?? [];
  const mapActual = detail?.actualRoutes ?? [];
  const hasPlannedRoute = mapPlanned.length > 0;
  const hasActualRoute = mapActual.length > 0;

  // Jejak lintasan: gabungkan jejak historis (track endpoint) dengan jejak
  // realtime hasil polling, lalu buang titik berurutan yang duplikat.
  const trail = useMemo(() => {
    const combined = historyTrail.length > 0 ? [...historyTrail, ...liveTrail] : liveTrail;
    const result: LatLng[] = [];
    for (const point of combined) {
      const last = result[result.length - 1];
      if (last && last.latitude === point.latitude && last.longitude === point.longitude) continue;
      result.push(point);
    }
    return result;
  }, [historyTrail, liveTrail]);
  const hasTrail = trail.length > 1;

  const hasMapData = hasPolylines || timelineCoords.length > 0 || trail.length > 0;

  const routeNames = effectiveTimeline.length > 0
    ? effectiveTimeline
        .map((p) => p.name)
        .filter((n): n is string => !!n)
    : [];
  const routeSummary =
    routeNames.length >= 2
      ? `${routeNames[0]} → ${routeNames[routeNames.length - 1]}`
      : (shown?.currentPointName ?? null);

  return (
    <div className="space-y-4">
      {/* Live Fleet Overview */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3">
          <h3 className="text-sm font-bold text-foreground">Live Fleet Overview</h3>
          {hasMapData && detail && (
            <button
              type="button"
              onClick={() => setMapOpen(true)}
              className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
            >
              <Expand className="h-3.5 w-3.5" />
              View Full Map
            </button>
          )}
        </div>
        <div className="px-4 pb-4">
          {!item ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-4 text-center">
              <MapPin className="h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Pilih task pada tabel untuk melihat rute di peta.
              </p>
            </div>
          ) : loading && !detail ? (
            <div className="h-56 animate-pulse rounded-xl bg-muted" />
          ) : hasMapData ? (
            <div className="relative z-0 h-56 overflow-hidden rounded-xl ring-1 ring-border">
              <TaskRouteMap
                key={`mini-${detail?.id ?? item?.id ?? "task"}`}
                planned={mapPlanned}
                actual={mapActual}
                trail={trail}
                timeline={effectiveTimeline}
                vehicle={vehicleStatus}
                scrollWheel={false}
              />
            </div>
          ) : (
            <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-4 text-center">
              <RouteIcon className="h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {error ?? "Data rute tidak tersedia untuk task ini."}
              </p>
            </div>
          )}
          {(hasPlannedRoute || hasActualRoute || hasTrail) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-muted-foreground">
              {hasPlannedRoute && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-[#0284c7]" />
                  Rencana
                </span>
              )}
              {hasActualRoute && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1 w-5 rounded bg-[#16a34a]" />
                  Realisasi
                </span>
              )}
              {hasTrail && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1 w-5 rounded bg-[#2563eb]" />
                  Jejak Mobil
                </span>
              )}
              {effectiveTimeline.length > 0 && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#16a34a]" />
                    Dikunjungi
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0284c7]" />
                    Sedang
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#94a3b8]" />
                    Belum
                  </span>
                </>
              )}
            </div>
          )}
          {!loading && detail && !hasTrail && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Jejak lintasan trip belum tersedia dari layanan tracking.
            </p>
          )}
          {!loading && !hasTrail && tripTrailDebug.attempts.length > 0 && (
            <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
              <p className="font-bold text-foreground">Diagnostik jejak trip</p>
              <div className="mt-1 space-y-1">
                {tripTrailDebug.attempts.map((attempt, index) => (
                  <p key={`${attempt.source}-${attempt.identifier}-${index}`} className="break-words tabular-nums">
                    {attempt.source}
                    {attempt.label ? ` (${attempt.label})` : ""} / {attempt.identifier} / HTTP {attempt.status ?? "-"} /{" "}
                    {attempt.count} titik
                    {attempt.startDate && attempt.endDate
                      ? ` / ${attempt.startDate} sampai ${attempt.endDate}`
                      : ""}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-foreground">Task Details</h3>
          {item && (
            <button
              type="button"
              onClick={onBack}
              className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Tutup
            </button>
          )}
        </div>

        {!shown ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Belum ada task dipilih.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-extrabold text-foreground">
                {shown.number ?? shown.id.slice(0, 8)}
              </span>
              <TaskStatusBadge
                color={shown.statusColor}
                label={shown.statusName ?? "–"}
                className="ml-auto"
              />
            </div>
            {routeSummary && (
              <p className="truncate text-xs text-muted-foreground" title={routeSummary}>
                {routeSummary}
              </p>
            )}
            <div className="space-y-2 rounded-xl bg-muted/50 p-3">
              <p className="flex items-center gap-2 text-sm">
                <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-bold tabular-nums text-foreground">
                  {shown.licensePlate ?? "–"}
                </span>
              </p>
              <p className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium text-foreground">
                  {shown.driverName ?? "–"}
                </span>
              </p>
            </div>

            {loading && !detail ? (
              <div className="h-32 animate-pulse rounded-xl bg-muted" />
            ) : (
              <>
                {epodSummary && (
                  <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-semibold",
                        epodSummary.assignment.loadingStatus === "LOADING_COMPLETED"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-slate-500/10 text-slate-600",
                      )}
                    >
                      Loading {epodSummary.assignment.loadingStatus === "LOADING_COMPLETED" ? "selesai" : "belum"}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-semibold tabular-nums">
                      e-POD {epodSummary.assignment.deliveryDoneCount}/{epodSummary.assignment.deliveryTotalCount}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
                      {EPOD_ASSIGNMENT_STATUS_LABEL[epodSummary.assignment.status]}
                    </span>
                  </p>
                )}
                <RoutePointList
                  key={item?.id ?? "none"}
                  points={effectiveTimeline}
                  pointTemperatures={pointTemperatureBySequence}
                  epodBySequence={epodBySequence}
                />
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 text-xs text-danger">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>{error}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Instant Point Progress */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-bold text-foreground">Instant Point Progress</h3>
          <span className="ml-auto text-lg font-extrabold tabular-nums text-foreground">
            {totalCount > 0 ? `${percent}%` : "–"}
          </span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[#16a34a] transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {totalCount > 0
            ? `${doneCount} of ${totalCount} instant points completed`
            : "Data titik belum tersedia."}
        </p>
      </div>

      {/* Full map overlay */}
      {mapOpen && detail && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h3 className="text-sm font-bold text-foreground">
                Rute {detail.number ?? detail.id.slice(0, 8)}
              </h3>
              <Button size="sm" variant="outline" className="ml-auto" icon={X} onClick={() => setMapOpen(false)}>
                Tutup
              </Button>
            </div>
            <div className="relative z-0 h-[70vh]">
              <TaskRouteMap
                key={`full-${detail.id}`}
                planned={mapPlanned}
                actual={mapActual}
                trail={trail}
                timeline={effectiveTimeline}
                vehicle={vehicleStatus}
              />
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Memuat detail task…
        </div>
      )}
    </div>
  );
}
