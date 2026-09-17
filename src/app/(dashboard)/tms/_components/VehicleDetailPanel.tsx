"use client";

import type { ReactNode } from "react";
import { Crosshair, ExternalLink, Gauge, Power, Satellite, Thermometer, X } from "lucide-react";
import Badge from "@/components/ui/Badge";
import {
  TMS_STATUS_META,
  formatFullTimestamp,
  formatRelativeTime,
  formatSignalLabel,
  formatSpeedShort,
  formatVehicleTemperatures,
  googleMapsUrl,
  type TmsVehicleStatus,
} from "@/lib/tms-status";

interface VehicleDetailPanelProps {
  vehicle: TmsVehicleStatus | null;
  now: number;
  onFocusMap: (vehicleId: number) => void;
  onClose: () => void;
}

interface MetricTileProps {
  icon: ReactNode;
  label: string;
  value: string;
  title?: string;
  valueClassName?: string;
}

function MetricTile({ icon, label, value, title, valueClassName = "text-base leading-snug" }: MetricTileProps) {
  return (
    <div className="flex min-h-[64px] min-w-0 flex-col justify-center rounded-xl border border-white/10 bg-white/10 px-2.5 py-2 text-center">
      <span className="flex items-center justify-center gap-1 text-slate-300">
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-[0.07em]">{label}</span>
      </span>
      <p title={title ?? value} className={`mt-1 font-extrabold break-words ${valueClassName}`}>
        {value}
      </p>
    </div>
  );
}

export default function VehicleDetailPanel({ vehicle, now, onFocusMap, onClose }: VehicleDetailPanelProps) {
  if (!vehicle) return null;

  const meta = TMS_STATUS_META[vehicle.status];
  const mapsUrl = googleMapsUrl(vehicle);
  const shortAddress = vehicle.address || vehicle.city || "Alamat tidak tersedia";
  const speedLabel = formatSpeedShort(vehicle);
  const engineLabel = vehicle.engineOn === null ? "-" : vehicle.engineOn ? "ON" : "OFF";
  const signalLabel = formatSignalLabel(vehicle.signalStrength);
  const temperatureLabel = formatVehicleTemperatures(vehicle.temperatures);
  const engineTone =
    vehicle.engineOn === null ? "text-slate-300" : vehicle.engineOn ? "text-emerald-300" : "text-rose-300";
  const signalTone =
    vehicle.signalStrength === null
      ? "text-slate-300"
      : vehicle.signalStrength >= 4
        ? "text-emerald-300"
        : vehicle.signalStrength >= 2
          ? "text-amber-300"
          : "text-rose-300";
  const temperatureValueClassName =
    temperatureLabel.length > 12
      ? "text-[13px] leading-snug tabular-nums"
      : "text-base leading-snug tabular-nums";

  return (
    <div className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/10">
      {/* Header gelap: data langsung */}
      <div className="bg-slate-900 px-4 pb-3 pt-3 text-white">
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

        <p className="mt-1.5 text-[21px] font-extrabold leading-tight tracking-tight">{vehicle.licensePlate}</p>
        <p className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-slate-300">
          {vehicle.driverName ? `${vehicle.driverName} • ` : ""}
          {shortAddress}
        </p>

        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <MetricTile
            icon={<Gauge className="h-3.5 w-3.5 text-sky-300" aria-hidden="true" />}
            label="Kecepatan"
            value={speedLabel}
            valueClassName="text-[15px] leading-tight tabular-nums"
          />
          <MetricTile
            icon={<Power className={`h-3.5 w-3.5 ${engineTone}`} aria-hidden="true" />}
            label="Mesin"
            value={engineLabel}
            valueClassName={`whitespace-nowrap text-[15px] leading-tight ${engineTone}`}
          />
          <MetricTile
            icon={<Satellite className={`h-3.5 w-3.5 ${signalTone}`} aria-hidden="true" />}
            label="Sinyal GPS"
            value={signalLabel}
            valueClassName={`whitespace-nowrap text-[15px] leading-tight ${signalTone}`}
          />
          <MetricTile
            icon={<Thermometer className="h-3.5 w-3.5 text-sky-300" aria-hidden="true" />}
            label="Suhu"
            value={temperatureLabel}
            valueClassName={temperatureValueClassName}
          />
        </div>
      </div>

      {/* Badan terang: status + timeline */}
      <div className="bg-card px-4 pb-3 pt-3 text-foreground">
        <p className="text-[10px] font-bold tracking-[0.16em] text-muted-foreground">STATUS KENDARAAN</p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-base font-extrabold tracking-tight">{meta.label}</p>
          <Badge variant={meta.badge}>{formatRelativeTime(vehicle.lastReceive, now)}</Badge>
        </div>

        <div className="mt-2.5 space-y-2.5">
          <div className="flex gap-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-foreground" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold">Posisi terakhir</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {shortAddress}
              </p>
              {vehicle.latitude !== null && vehicle.longitude !== null && (
                <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {vehicle.latitude.toFixed(6)}, {vehicle.longitude.toFixed(6)}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex min-w-0 gap-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold">Update</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug tabular-nums text-muted-foreground">
                  {formatFullTimestamp(vehicle.lastReceive)}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 gap-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold">Bergerak</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug tabular-nums text-muted-foreground">
                  {formatFullTimestamp(vehicle.lastMotion)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => onFocusMap(vehicle.vehicleId)}
            disabled={!vehicle.hasValidLocation}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold whitespace-nowrap text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Crosshair className="h-4 w-4 shrink-0" />
            Fokus di Peta
          </button>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-xs font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
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
