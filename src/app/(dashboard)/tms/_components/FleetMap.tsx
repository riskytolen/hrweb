"use client";

import { useCallback, useEffect, useRef } from "react";
import type * as LeafletNS from "leaflet";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { TMS_STATUS_META, type TmsVehicleStatus } from "@/lib/tms-status";
import "leaflet/dist/leaflet.css";

interface FleetMapProps {
  vehicles: TmsVehicleStatus[];
  selectedId: number | null;
  onSelect: (vehicleId: number) => void;
  loading: boolean;
  /** Menaikkan nonce akan memusatkan peta ke kendaraan terpilih. */
  focusNonce?: number;
  /** Menaikkan nonce akan menampilkan seluruh armada. */
  fitAllNonce?: number;
}

interface LeafletRefs {
  L: typeof LeafletNS;
  map: LeafletMap;
  layer: LayerGroup;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tiles: any;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const TRUCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`;

function markerHtml(vehicle: TmsVehicleStatus, selected: boolean): string {
  const color = TMS_STATUS_META[vehicle.status].dotHex;
  const size = selected ? 42 : 36;
  const ring = selected
    ? "box-shadow:0 0 0 3px #fff, 0 0 0 6px #1d4ed8, 0 6px 16px rgba(0,0,0,.35);"
    : "box-shadow:0 4px 10px rgba(0,0,0,.35);";
  return (
    `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:12px;background:${color};${ring}">` +
    TRUCK_SVG +
    `</div>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function FleetMap({
  vehicles,
  selectedId,
  onSelect,
  loading,
  focusNonce = 0,
  fitAllNonce = 0,
}: FleetMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletRefs | null>(null);
  const fittedRef = useRef(false);
  const userMovedRef = useRef(false);

  // Data terbaru disimpan di ref agar fungsi gambar tidak perlu berubah identitas.
  const dataRef = useRef<{ vehicles: TmsVehicleStatus[]; selectedId: number | null }>({
    vehicles,
    selectedId,
  });
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const fitAll = useCallback(() => {
    const refs = leafletRef.current;
    if (!refs) return;
    const points = dataRef.current.vehicles
      .filter((v) => v.hasValidLocation && v.latitude !== null && v.longitude !== null)
      .map((v) => [v.latitude as number, v.longitude as number] as [number, number]);
    if (points.length === 0) return;
    userMovedRef.current = false;
    refs.map.fitBounds(points, { padding: [40, 40], maxZoom: 13 });
  }, []);

  const drawMarkers = useCallback(() => {
    const refs = leafletRef.current;
    if (!refs) return;
    const { L, map, layer } = refs;
    const { vehicles: list, selectedId: selected } = dataRef.current;

    layer.clearLayers();
    const bounds: [number, number][] = [];

    for (const vehicle of list) {
      if (!vehicle.hasValidLocation || vehicle.latitude === null || vehicle.longitude === null) continue;
      const lat = vehicle.latitude;
      const lng = vehicle.longitude;
      bounds.push([lat, lng]);
      const isSelected = vehicle.vehicleId === selected;
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          html: markerHtml(vehicle, isSelected),
          className: "tms-marker",
          iconSize: isSelected ? [42, 42] : [36, 36],
          iconAnchor: isSelected ? [21, 21] : [18, 18],
        }),
        title: vehicle.licensePlate,
        zIndexOffset: isSelected ? 1000 : 0,
      });
      marker.on("click", () => onSelectRef.current(vehicle.vehicleId));
      const speed = Math.max(vehicle.speed, vehicle.calculatedSpeed);
      marker.bindTooltip(
        `<strong>${escapeHtml(vehicle.licensePlate)}</strong><br/>${escapeHtml(TMS_STATUS_META[vehicle.status].label)} &bull; ${Math.round(speed)} km/jam`,
        { direction: "top", offset: [0, -16] },
      );
      marker.addTo(layer);
    }

    if (bounds.length > 0 && (!fittedRef.current || !userMovedRef.current)) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      fittedRef.current = true;
    }
  }, []);

  // Init peta + cleanup saat unmount.
  useEffect(() => {
    let disposed = false;

    (async () => {
      const mod = await import("leaflet");
      const L = (mod.default ?? mod) as typeof LeafletNS;
      if (disposed || !containerRef.current || leafletRef.current) return;

      const map = L.map(containerRef.current, {
        center: [-2.5, 118],
        zoom: 5,
        scrollWheelZoom: true,
        zoomControl: false,
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const tiles = L.tileLayer(TILE_URL, {
        maxZoom: 19,
        subdomains: "abc",
        attribution: TILE_ATTRIBUTION,
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      map.on("movestart", () => {
        userMovedRef.current = true;
      });

      leafletRef.current = { L, map, layer, tiles };
      fittedRef.current = false;
      drawMarkers();
    })();

    return () => {
      disposed = true;
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    };
  }, [drawMarkers]);

  // Gambar ulang marker saat data/seleksi berubah tanpa mereset view user.
  useEffect(() => {
    dataRef.current = { vehicles, selectedId };
    drawMarkers();
  }, [vehicles, selectedId, drawMarkers]);

  // Pusatkan peta ke kendaraan terpilih saat diminta (Fokus di Peta).
  useEffect(() => {
    if (focusNonce === 0) return;
    const refs = leafletRef.current;
    if (!refs) return;
    const { vehicles: list, selectedId: selected } = dataRef.current;
    const target = list.find((v) => v.vehicleId === selected);
    if (!target || !target.hasValidLocation || target.latitude === null || target.longitude === null) return;
    userMovedRef.current = true;
    refs.map.flyTo([target.latitude, target.longitude], Math.max(refs.map.getZoom(), 15), {
      duration: 0.6,
    });
  }, [focusNonce]);

  // Tampilkan seluruh armada saat diminta tombol locate.
  useEffect(() => {
    if (fitAllNonce === 0) return;
    fitAll();
  }, [fitAllNonce, fitAll]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="absolute inset-0"
        role="application"
        aria-label="Peta posisi armada"
      />
      {loading && vehicles.length === 0 && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-muted/60 text-sm text-muted-foreground">
          Memuat posisi armada...
        </div>
      )}
    </div>
  );
}
