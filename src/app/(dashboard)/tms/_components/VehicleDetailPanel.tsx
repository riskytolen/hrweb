"use client";

import { Crosshair, ExternalLink, X } from "lucide-react";
import Badge from "@/components/ui/Badge";
import {
  TMS_STATUS_META,
  formatFullTimestamp,
  formatRelativeTime,
  formatSignalLabel,
  formatSpeedShort,
  googleMapsUrl,
  type TmsVehicleStatus,
} from "@/lib/tms-status";

interface VehicleDetailPanelProps {
  vehicle: TmsVehicleStatus | null;
  now: number;
  onFocusMap: (vehicleId: number) => void;
  onClose: () => void;
}

export default function VehicleDetailPanel({ vehicle, now, onFocusMap, onClose }: VehicleDetailPanelProps) {
  if (!vehicle) return null;

  const meta = TMS_STATUS_META[vehicle.status];
  const mapsUrl = googleMapsUrl(vehicle);
  const shortAddress = vehicle.address || vehicle.city || "Alamat tidak tersedia";

  return (
    <div className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/10">
      {/* Header gelap: data langsung */}
      <div className="bg-slate-900 p-4 text-white">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold tracking-[0.16em] text-slate-300">DATA LIVE TRACKING</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup detail kendaraan"
            className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-[22px] font-extrabold leading-tight tracking-tight">{vehicle.licensePlate}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-300">
          {vehicle.driverName ? `${vehicle.driverName} • ` : ""}
          {shortAddress}
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/10 px-2 py-2.5 text-center">
            <p className="truncate text-sm font-extrabold tabular-nums">{formatSpeedShort(vehicle)}</p>
            <p className="mt-0.5 text-[10px] text-slate-300">Kecepatan</p>
          </div>
          <div className="rounded-xl bg-white/10 px-2 py-2.5 text-center">
            <p className="text-sm font-extrabold">
              {vehicle.engineOn === null ? "-" : vehicle.engineOn ? "ON" : "OFF"}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-300">Mesin</p>
          </div>
          <div className="rounded-xl bg-white/10 px-2 py-2.5 text-center">
            <p className="truncate text-sm font-extrabold">{formatSignalLabel(vehicle.signalStrength)}</p>
            <p className="mt-0.5 text-[10px] text-slate-300">Sinyal GPS</p>
          </div>
        </div>
      </div>

      {/* Badan terang: status + timeline */}
      <div className="bg-card p-4 text-foreground">
        <p className="text-[11px] font-bold tracking-[0.16em] text-muted-foreground">STATUS KENDARAAN</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-lg font-extrabold tracking-tight">{meta.label}</p>
          <Badge variant={meta.badge}>{formatRelativeTime(vehicle.lastReceive, now)}</Badge>
        </div>

        <div className="mt-3 space-y-3.5">
          <div className="flex gap-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-bold">Posisi terakhir</p>
              <p className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {shortAddress}
              </p>
              {vehicle.latitude !== null && vehicle.longitude !== null && (
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {vehicle.latitude.toFixed(6)}, {vehicle.longitude.toFixed(6)}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger" />
            <div className="min-w-0">
              <p className="text-xs font-bold">Pembaruan perangkat</p>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {formatFullTimestamp(vehicle.lastReceive)}
              </p>
            </div>
          </div>
          <div className="flex gap-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success" />
            <div className="min-w-0">
              <p className="text-xs font-bold">Terakhir bergerak</p>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {formatFullTimestamp(vehicle.lastMotion)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onFocusMap(vehicle.vehicleId)}
            disabled={!vehicle.hasValidLocation}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold whitespace-nowrap text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Crosshair className="h-4 w-4 shrink-0" />
            Fokus di Peta
          </button>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3.5 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ExternalLink className="h-4 w-4" />
              Maps
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
