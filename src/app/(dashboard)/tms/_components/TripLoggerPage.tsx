"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
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

/* ─── Tipe data ─── */

type TempStatus = "NORMAL" | "WASPADA" | "TINGGI";

interface TripLog {
  id: string;
  unit: string;
  unitType: string;
  store: string;
  city: string;
  driver: string;
  enteredAt: string;
  exitedAt: string | null;
  temperatureC: number;
}

/* ─── Data dummy (sementara, menunggu integrasi GPS/suhu) ─── */

const DUMMY_LOGS: TripLog[] = [
  { id: "TL-001", unit: "B 9123 UZX", unitType: "Box Freezer", store: "Toko Berkah Jaya", city: "Bekasi", driver: "Sutrisno", enteredAt: "2026-09-22T06:12:00", exitedAt: "2026-09-22T06:58:00", temperatureC: -18.4 },
  { id: "TL-002", unit: "B 8741 FKS", unitType: "Box Freezer", store: "Toko Sumber Rejeki", city: "Depok", driver: "Hendra Gunawan", enteredAt: "2026-09-22T07:05:00", exitedAt: "2026-09-22T07:41:00", temperatureC: -16.1 },
  { id: "TL-003", unit: "B 9052 ABC", unitType: "Wingbox", store: "Toko Makmur Abadi", city: "Bogor", driver: "Dedi Kurniawan", enteredAt: "2026-09-22T07:48:00", exitedAt: "2026-09-22T09:02:00", temperatureC: -9.6 },
  { id: "TL-004", unit: "B 9123 UZX", unitType: "Box Freezer", store: "Toko Sinar Pagi", city: "Bekasi", driver: "Sutrisno", enteredAt: "2026-09-22T08:20:00", exitedAt: "2026-09-22T08:55:00", temperatureC: -17.8 },
  { id: "TL-005", unit: "B 7330 QWE", unitType: "Box Chiller", store: "Toko Anugerah", city: "Jakarta Timur", driver: "Agus Santoso", enteredAt: "2026-09-22T09:10:00", exitedAt: "2026-09-22T09:47:00", temperatureC: 3.2 },
  { id: "TL-006", unit: "B 8741 FKS", unitType: "Box Freezer", store: "Toko Lancar Jaya", city: "Depok", driver: "Hendra Gunawan", enteredAt: "2026-09-22T10:02:00", exitedAt: null, temperatureC: -4.2 },
  { id: "TL-007", unit: "B 6554 ZXC", unitType: "Wingbox", store: "Toko Mitra Sejahtera", city: "Tangerang", driver: "Rudi Hartono", enteredAt: "2026-09-22T10:26:00", exitedAt: "2026-09-22T11:31:00", temperatureC: -19.0 },
  { id: "TL-008", unit: "B 7330 QWE", unitType: "Box Chiller", store: "Toko Barokah", city: "Jakarta Timur", driver: "Agus Santoso", enteredAt: "2026-09-22T11:05:00", exitedAt: "2026-09-22T11:38:00", temperatureC: 4.1 },
  { id: "TL-009", unit: "B 9052 ABC", unitType: "Wingbox", store: "Toko Cahaya Baru", city: "Bogor", driver: "Dedi Kurniawan", enteredAt: "2026-09-22T12:14:00", exitedAt: "2026-09-22T12:59:00", temperatureC: -11.3 },
  { id: "TL-010", unit: "B 6554 ZXC", unitType: "Wingbox", store: "Toko Harapan Kita", city: "Tangerang", driver: "Rudi Hartono", enteredAt: "2026-09-22T13:22:00", exitedAt: null, temperatureC: -15.7 },
];

type TempFilter = "ALL" | TempStatus;

const TEMP_FILTERS: { key: TempFilter; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "NORMAL", label: "Normal" },
  { key: "WASPADA", label: "Waspada" },
  { key: "TINGGI", label: "Tinggi" },
];

/* ─── Helper ─── */

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

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(parsed));
}

function getDurationMinutes(log: TripLog): number | null {
  if (!log.exitedAt) return null;
  const diff = Date.parse(log.exitedAt) - Date.parse(log.enteredAt);
  if (Number.isNaN(diff) || diff < 0) return null;
  return Math.round(diff / 60000);
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "Berlangsung";
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} mnt`;
}

function formatTemp(tempC: number): string {
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

function TempBadge({ tempC }: { tempC: number }) {
  const status = getTempStatus(tempC);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={status === "NORMAL" ? "success" : status === "WASPADA" ? "warning" : "danger"}>
        <Thermometer className="h-3 w-3" />
        {formatTemp(tempC)}
      </Badge>
    </span>
  );
}

/* ─── Halaman ─── */

export default function TripLoggerPage() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [tempFilter, setTempFilter] = useState<TempFilter>("ALL");

  const filtered = useMemo(() => {
    const keyword = appliedSearch.trim().toLowerCase();
    return DUMMY_LOGS.filter((log) => {
      if (tempFilter !== "ALL" && getTempStatus(log.temperatureC) !== tempFilter) return false;
      if (!keyword) return true;
      return [log.unit, log.store, log.city, log.driver]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [appliedSearch, tempFilter]);

  const stats = useMemo(() => {
    const done = DUMMY_LOGS.filter((log) => log.exitedAt);
    const durations = done
      .map((log) => getDurationMinutes(log))
      .filter((d): d is number => d !== null);
    const avgDuration = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    const avgTemp = DUMMY_LOGS.length
      ? DUMMY_LOGS.reduce((a, b) => a + b.temperatureC, 0) / DUMMY_LOGS.length
      : 0;
    const alerts = DUMMY_LOGS.filter((log) => getTempStatus(log.temperatureC) !== "NORMAL").length;
    return {
      total: DUMMY_LOGS.length,
      avgDuration,
      avgTemp,
      alerts,
      onSite: DUMMY_LOGS.length - done.length,
    };
  }, []);

  const handleSearch = () => setAppliedSearch(search.trim());

  return (
    <RouteGuard permission="tms">
      <div className="space-y-5">
        <PageHeader
          title="Logger Trips"
          description="Catatan waktu kunjungan unit ke toko beserta suhu kargo saat bongkar"
          icon={Clock3}
          actions={<Badge variant="muted">Data Dummy</Badge>}
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard icon={Store} tileClass="bg-sky-500" label="Total kunjungan" value={String(stats.total)} sub={`${stats.onSite} unit masih di lokasi`} />
          <KpiCard icon={Clock3} tileClass="bg-violet-500" label="Rata-rata durasi di toko" value={formatDuration(stats.avgDuration)} sub="per kunjungan selesai" />
          <KpiCard icon={Thermometer} tileClass="bg-cyan-600" label="Suhu rata-rata" value={formatTemp(stats.avgTemp)} sub="seluruh kunjungan" />
          <KpiCard icon={AlertTriangle} tileClass={stats.alerts > 0 ? "bg-rose-500" : "bg-emerald-500"} label="Peringatan suhu" value={String(stats.alerts)} sub="waspada & tinggi" />
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-xs"
                  placeholder="Cari unit, toko, kota, atau driver"
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
          </div>

          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
            {TEMP_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setTempFilter(filter.key)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  tempFilter === filter.key ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Tidak ada catatan perjalanan yang cocok dengan pencarian.
            </p>
          ) : (
            <>
              {/* Tabel desktop */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">Unit</th>
                      <th className="px-4 py-3 font-semibold">Nama Toko</th>
                      <th className="px-4 py-3 font-semibold">Driver</th>
                      <th className="px-4 py-3 font-semibold">Masuk Toko</th>
                      <th className="px-4 py-3 font-semibold">Keluar Toko</th>
                      <th className="px-4 py-3 font-semibold">Durasi di Toko</th>
                      <th className="px-4 py-3 font-semibold">Suhu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((log) => {
                      const minutes = getDurationMinutes(log);
                      const inProgress = log.exitedAt === null;
                      return (
                        <tr key={log.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-bold tabular-nums text-foreground">{log.unit}</p>
                            <p className="text-[11px] text-muted-foreground">{log.unitType}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-semibold text-foreground">{log.store}</p>
                            <p className="text-[11px] text-muted-foreground">{log.city}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-foreground">{log.driver}</td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-semibold tabular-nums text-foreground">{formatTime(log.enteredAt)}</p>
                            <p className="text-[11px] text-muted-foreground">{formatDate(log.enteredAt)}</p>
                          </td>
                          <td className="px-4 py-3">
                            {inProgress ? (
                              <Badge variant="info">Di lokasi</Badge>
                            ) : (
                              <>
                                <p className="text-xs font-semibold tabular-nums text-foreground">{formatTime(log.exitedAt)}</p>
                                <p className="text-[11px] text-muted-foreground">{log.exitedAt ? formatDate(log.exitedAt) : "–"}</p>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {inProgress ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                                Berlangsung
                              </span>
                            ) : (
                              <span className="text-xs font-semibold tabular-nums text-foreground">{formatDuration(minutes)}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <TempBadge tempC={log.temperatureC} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Kartu mobile */}
              <div className="space-y-2.5 p-4 lg:hidden">
                {filtered.map((log) => {
                  const minutes = getDurationMinutes(log);
                  const inProgress = log.exitedAt === null;
                  return (
                    <article key={log.id} className="rounded-xl border border-border bg-background p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{log.store}</p>
                          <p className="text-[11px] text-muted-foreground">{log.city}</p>
                        </div>
                        <TempBadge tempC={log.temperatureC} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Truck className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-mono font-semibold tabular-nums text-foreground">{log.unit}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-foreground">{log.driver}</span>
                        </div>
                        <div className="col-span-2 flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-2">
                          <span className="tabular-nums text-foreground">
                            Masuk <strong>{formatTime(log.enteredAt)}</strong>
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="tabular-nums text-foreground">
                            {inProgress ? <strong className="text-sky-600">Di lokasi</strong> : <>Keluar <strong>{formatTime(log.exitedAt)}</strong></>}
                          </span>
                        </div>
                        <div className="col-span-2 flex items-center justify-between">
                          <span className="text-muted-foreground">Durasi di toko</span>
                          <span className="font-semibold tabular-nums text-foreground">{formatDuration(minutes)}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Status suhu: Normal (≤ −12°C) · Waspada (−12°C s.d. −5°C) · Tinggi (&gt; −5°C). Data di atas masih contoh dan akan diganti hasil logger perangkat.
        </p>
      </div>
    </RouteGuard>
  );
}
