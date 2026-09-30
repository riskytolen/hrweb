"use client";

import { CalendarDays, CircleAlert, Route as RouteIcon, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeSlaCompliance,
  formatSlaCompliance,
  formatSlaDelta,
  slaKindLabel,
  slaStatusLabel,
  type SlaKind,
  type SlaStatus,
} from "@/lib/tms-sla";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

/* ─── Tipe data (cermin response /api/tms/logger-trips/by-profile) ─── */

export interface ProfileStopView {
  id: string;
  routeOrder: number;
  storeName: string;
  targetTime: string;
  dayOffset: number;
  kind: string;
}

export interface ProfileVisitView {
  id: string;
  routeSequence: number;
  store: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  slaKind: string | null;
  slaTargetAt: string | null;
  slaStatus: string | null;
  slaDeltaSeconds: number | null;
  temperatureC: number | null;
}

export interface ProfileRunView {
  taskId: string;
  taskNumber: string | null;
  taskStatus: string | null;
  serviceDate: string;
  unit: string | null;
  driver: string | null;
  summary: {
    totalStops: number;
    visitedStops: number;
    onTime: number;
    late: number;
    pending: number;
    unset: number;
    compliance: number | null;
  };
  stopVisits: Record<string, ProfileVisitView | null>;
  extras: ProfileVisitView[];
}

export interface ProfileInfoView {
  id: string;
  code: string;
  name: string;
  groupName: string | null;
  status: string;
}

export interface ProfileMetaView {
  totalRuns: number;
  truncated: boolean;
  dateFrom: string;
  dateTo: string;
  lastSyncedAt: string | null;
}

/* ─── Helper ─── */

function formatClock(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date(parsed));
}

function formatSchedule(time: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!match) return time;
  return `${match[1].padStart(2, "0")}.${match[2]}`;
}

function formatServiceDate(value: string): string {
  const parsed = Date.parse(`${value}T00:00:00+07:00`);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(parsed));
}

function formatDateTimeShort(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function asSlaStatus(value: string | null): SlaStatus | null {
  return value === "ON_TIME" || value === "LATE" || value === "PENDING" || value === "UNSET" ? value : null;
}

function asSlaKind(value: string | null): SlaKind | null {
  return value === "DEPARTURE" || value === "ARRIVAL" ? value : null;
}

function statusDot(status: SlaStatus | null): string {
  if (status === "ON_TIME") return "bg-emerald-500";
  if (status === "LATE") return "bg-rose-500";
  if (status === "PENDING") return "bg-amber-400";
  return "bg-slate-300";
}

function VisitSlaBadge({ visit }: { visit: ProfileVisitView }) {
  const status = asSlaStatus(visit.slaStatus);
  const kind = asSlaKind(visit.slaKind);
  if (!status) return <span className="text-xs text-muted-foreground">–</span>;
  const variant =
    status === "ON_TIME" ? "success" : status === "LATE" ? "danger" : status === "PENDING" ? "warning" : "muted";
  return <Badge variant={variant}>{slaStatusLabel(status, kind)}</Badge>;
}

/* ─── Timeline satu perjalanan ─── */

function RunTimeline({ run, stops }: { run: ProfileRunView; stops: ProfileStopView[] }) {
  return (
    <ol>
      {stops.map((stop, index) => {
        const visit = run.stopVisits[stop.id] ?? null;
        const status = asSlaStatus(visit?.slaStatus ?? null);
        const kind = asSlaKind(visit?.slaKind ?? null) ?? (stop.kind === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL");
        const arrived = !!visit?.enteredAt || !!visit?.exitedAt;
        return (
          <li key={stop.id} className="relative flex gap-3 pb-5 last:pb-0">
            <span className="flex flex-col items-center">
              <span className={cn("mt-1 h-3 w-3 shrink-0 rounded-full ring-4 ring-background", statusDot(status))} />
              {index < stops.length - 1 && <span className="w-0.5 flex-1 rounded-full bg-border" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground tabular-nums">
                {stop.routeOrder} · {slaKindLabel(kind)}
              </p>
              <p className="truncate text-sm font-bold text-foreground" title={stop.storeName}>
                {stop.storeName}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
                <span>
                  Target <strong className="text-foreground">{formatSchedule(stop.targetTime)}</strong>
                </span>
                {visit ? (
                  <>
                    <span>
                      Masuk <strong className="text-foreground">{formatClock(visit.enteredAt)}</strong>
                    </span>
                    <span>
                      {visit.exitedAt ? (
                        <>Keluar <strong className="text-foreground">{formatClock(visit.exitedAt)}</strong></>
                      ) : arrived ? (
                        <strong className="font-semibold text-sky-600">Di lokasi</strong>
                      ) : (
                        <strong className="font-semibold text-amber-600">Belum dikunjungi</strong>
                      )}
                    </span>
                  </>
                ) : (
                  <strong className="font-semibold text-amber-600">Belum dikunjungi</strong>
                )}
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-2">
                {visit ? (
                  <>
                    <VisitSlaBadge visit={visit} />
                    {visit.slaDeltaSeconds !== null && visit.slaDeltaSeconds !== undefined && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {formatSlaDelta(visit.slaDeltaSeconds)}
                      </span>
                    )}
                    {visit.temperatureC !== null && visit.temperatureC !== undefined && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {visit.temperatureC.toFixed(1).replace(".", ",")}°C
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Menunggu kunjungan</span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ─── Kartu satu perjalanan (FO) ─── */

function RunCard({ run, stops }: { run: ProfileRunView; stops: ProfileStopView[] }) {
  const summary = run.summary;
  return (
    <article className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-foreground">
            {run.taskNumber ?? run.taskId.slice(0, 8)}
            <span className="ml-2 text-xs font-medium text-muted-foreground">{formatServiceDate(run.serviceDate)}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-mono font-semibold tabular-nums text-foreground">
              <Truck className="h-3 w-3" />
              {run.unit ?? "–"}
            </span>
            <span className="truncate">{run.driver ?? "–"}</span>
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full bg-muted px-2.5 py-1 font-semibold tabular-nums text-muted-foreground">
            {summary.visitedStops}/{summary.totalStops} titik
          </span>
          {summary.late > 0 && (
            <span className="rounded-full bg-rose-500/10 px-2.5 py-1 font-bold tabular-nums text-rose-600">
              {summary.late} terlambat
            </span>
          )}
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-bold tabular-nums text-emerald-600">
            Kepatuhan {formatSlaCompliance(computeSlaCompliance(summary.onTime, summary.late))}
          </span>
        </div>
      </div>
      <div className="px-4 py-4">
        <RunTimeline run={run} stops={stops} />
        {run.extras.length > 0 && (
          <div className="mt-3 rounded-xl bg-muted/60 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-muted-foreground">
              Titik di luar rute {stops.length > 0 ? "" : "SLA "}({run.extras.length})
            </p>
            <ul className="mt-1 space-y-1">
              {run.extras.map((extra) => (
                <li key={extra.id} className="flex flex-wrap items-center gap-x-3 text-[11px] tabular-nums">
                  <span className="font-semibold text-foreground">{extra.store ?? `Titik ${extra.routeSequence}`}</span>
                  <span className="text-muted-foreground">
                    {formatClock(extra.enteredAt)} → {extra.exitedAt ? formatClock(extra.exitedAt) : "di lokasi"}
                  </span>
                  <VisitSlaBadge visit={extra} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

/* ─── View utama mode profil ─── */

export default function TripLoggerProfileView({
  profile,
  stops,
  runs,
  meta,
  loading,
  error,
  onRetry,
}: {
  profile: ProfileInfoView | null;
  stops: ProfileStopView[];
  runs: ProfileRunView[];
  meta: ProfileMetaView | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const totals = runs.reduce(
    (acc, run) => ({
      onTime: acc.onTime + run.summary.onTime,
      late: acc.late + run.summary.late,
      pending: acc.pending + run.summary.pending,
    }),
    { onTime: 0, late: 0, pending: 0 },
  );

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Memuat logger profil">
        <div className="h-16 animate-pulse rounded-2xl bg-muted" />
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-64 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-4 py-10 text-center" role="alert">
        <CircleAlert className="h-6 w-6 text-danger" />
        <p className="text-sm text-danger">{error}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Coba lagi
        </Button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center">
        <RouteIcon className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Belum ada profil SLA</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Profil rute SLA belum tersedia untuk client ini. Hubungi administrator bila rute seharusnya sudah tersedia.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Ringkasan profil */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-2xl border border-border bg-card px-4 py-3 text-xs shadow-sm">
        <span className="font-extrabold text-foreground">
          {profile.code}
          <span className="ml-2 font-medium text-muted-foreground">
            {profile.groupName ?? ""} · {stops.length} titik
          </span>
        </span>
        <span className="tabular-nums text-muted-foreground">
          Perjalanan <strong className="text-foreground">{meta?.totalRuns ?? runs.length}</strong>
        </span>
        <span className="tabular-nums text-muted-foreground">
          Tepat Waktu <strong className="text-emerald-600">{totals.onTime}</strong>
        </span>
        <span className="tabular-nums text-muted-foreground">
          Terlambat <strong className="text-danger">{totals.late}</strong>
        </span>
        <span className="tabular-nums text-muted-foreground">
          Menunggu <strong className="text-amber-600">{totals.pending}</strong>
        </span>
        <span className="ml-auto flex items-center gap-1.5 tabular-nums text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          Sinkron {formatDateTimeShort(meta?.lastSyncedAt ?? null)}
        </span>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <p className="border-b border-border px-4 py-3 text-xs font-semibold text-muted-foreground">
            Rute resmi {profile.code} · belum ada perjalanan pada rentang ini
          </p>
          <div className="px-4 py-4">
            <ol>
              {stops.map((stop, index) => (
                <li key={stop.id} className="relative flex gap-3 pb-4 last:pb-0">
                  <span className="flex flex-col items-center">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-slate-300 ring-4 ring-background" />
                    {index < stops.length - 1 && <span className="w-0.5 flex-1 rounded-full bg-border" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground tabular-nums">
                      {stop.routeOrder} · {slaKindLabel(stop.kind === "DEPARTURE" ? "DEPARTURE" : "ARRIVAL")}
                    </p>
                    <p className="truncate text-sm font-bold text-foreground" title={stop.storeName}>
                      {stop.storeName}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      Target <strong className="text-foreground">{formatSchedule(stop.targetTime)}</strong>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        runs.map((run) => <RunCard key={`${run.serviceDate}-${run.taskId}`} run={run} stops={stops} />)
      )}

      {meta?.truncated && (
        <p className="text-center text-[11px] text-muted-foreground">
          Menampilkan {runs.length} dari {meta.totalRuns} perjalanan — persempit rentang tanggal untuk melihat sisanya.
        </p>
      )}
    </div>
  );
}
