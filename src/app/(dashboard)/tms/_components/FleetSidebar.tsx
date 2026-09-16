"use client";

import { Search, Truck, X } from "lucide-react";
import Select from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import {
  formatRelativeTime,
  formatSpeedShort,
  type TmsSortKey,
  type TmsVehicleStatus,
} from "@/lib/tms-status";

export type FleetPill = "all" | "moving" | "stopped";

interface FleetSidebarProps {
  query: string;
  onQueryChange: (value: string) => void;
  pill: FleetPill;
  onPillChange: (value: FleetPill) => void;
  totalCount: number;
  movingCount: number;
  stoppedCount: number;
  group: string;
  groups: string[];
  onGroupChange: (value: string) => void;
  sort: TmsSortKey;
  onSortChange: (value: TmsSortKey) => void;
  vehicles: TmsVehicleStatus[];
  selectedId: number | null;
  onSelect: (vehicleId: number) => void;
  loading: boolean;
  now: number;
  className?: string;
}

const SORT_OPTIONS = [
  { value: "status", label: "Urut: Status" },
  { value: "plate", label: "Urut: Plat" },
  { value: "speed", label: "Urut: Kecepatan" },
  { value: "updated", label: "Urut: Terbaru" },
];

export default function FleetSidebar({
  query,
  onQueryChange,
  pill,
  onPillChange,
  totalCount,
  movingCount,
  stoppedCount,
  group,
  groups,
  onGroupChange,
  sort,
  onSortChange,
  vehicles,
  selectedId,
  onSelect,
  loading,
  now,
  className,
}: FleetSidebarProps) {
  const pills: { key: FleetPill; label: string; count: number }[] = [
    { key: "all", label: "Semua", count: totalCount },
    { key: "moving", label: "Berjalan", count: movingCount },
    { key: "stopped", label: "Berhenti", count: stoppedCount },
  ];

  return (
    <div className={cn("flex min-h-0 flex-col rounded-2xl border border-border bg-card shadow-sm", className)}>
      <div className="p-4 pb-3">
        <p className="text-[11px] font-bold tracking-[0.18em] text-danger">CLIENT PORTAL</p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">Live Tracking</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {totalCount} armada Jamslogistic &bull; live
        </p>

        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Cari plat nomor atau driver"
            aria-label="Cari armada"
            className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Hapus pencarian"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>

        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter status armada">
          {pills.map((item) => {
            const active = pill === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onPillChange(item.key)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-[0.97]",
                  active
                    ? "bg-foreground text-background shadow-sm"
                    : "border border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {item.label}
                <span className={cn("tabular-nums", active ? "opacity-70" : "opacity-60")}>
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <Select
            value={sort}
            onChange={(value) => onSortChange(value as TmsSortKey)}
            options={SORT_OPTIONS}
            compact
            className="min-w-0 flex-1"
            aria-label="Urutkan armada"
          />
          {groups.length > 1 && (
            <Select
              value={group}
              onChange={onGroupChange}
              options={[{ value: "all", label: "Semua Grup" }, ...groups.map((g) => ({ value: g, label: g }))]}
              compact
              className="min-w-0 flex-1"
              aria-label="Filter grup kendaraan"
            />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label="Daftar armada">
        {loading && vehicles.length === 0 ? (
          <div className="space-y-2.5 p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/60 p-3.5">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-semibold text-foreground">Tidak ada armada yang cocok</p>
            <p className="mt-1 text-xs text-muted-foreground">Ubah kata pencarian atau filter status.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {vehicles.map((vehicle) => {
              const selected = vehicle.vehicleId === selectedId;
              const moving = vehicle.status === "moving";
              return (
                <button
                  key={vehicle.vehicleId}
                  type="button"
                  onClick={() => onSelect(vehicle.vehicleId)}
                  aria-pressed={selected}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all active:scale-[0.99]",
                    selected
                      ? "border-danger/50 bg-danger/[0.06] shadow-sm"
                      : "border-border/70 bg-background hover:border-foreground/25 hover:shadow-sm",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      moving ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Truck className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold tracking-tight text-foreground">
                      {vehicle.licensePlate}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {vehicle.driverName ?? "Belum ditentukan"}
                      {vehicle.address ? ` • ${vehicle.address}` : ""}
                    </span>
                    <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                      {formatSpeedShort(vehicle)} &bull; {formatRelativeTime(vehicle.lastReceive, now)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
