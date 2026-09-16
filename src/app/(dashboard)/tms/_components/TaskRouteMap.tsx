"use client";

import { useCallback, useEffect, useRef } from "react";
import type * as LeafletNS from "leaflet";
import type { FleetTaskTimelinePoint, LatLng } from "@/lib/fleet-task-track";
import { TMS_STATUS_META, formatSpeedShort, type TmsVehicleStatus } from "@/lib/tms-status";
import "leaflet/dist/leaflet.css";

const TRACK_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TRACK_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`;

/** Status titik yang dianggap sudah dikunjungi (sinkron dengan side panel). */
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

function isVisitedStatus(raw: string | null): boolean {
  if (!raw) return false;
  return VISITED_STATUSES.has(raw.toUpperCase());
}

interface TaskRouteMapProps {
  planned: LatLng[][];
  actual: LatLng[][];
  /** Jejak lintasan mobil (historis + realtime). */
  trail?: LatLng[];
  timeline: FleetTaskTimelinePoint[];
  /** Posisi kendaraan realtime untuk task terpilih. */
  vehicle?: TmsVehicleStatus | null;
  /** Matikan zoom via scroll agar nyaman dipakai sebagai mini-map. */
  scrollWheel?: boolean;
}

interface LeafletRefs {
  L: typeof LeafletNS;
  map: LeafletNS.Map;
  layer: LeafletNS.LayerGroup;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function vehicleMarkerHtml(vehicle: TmsVehicleStatus): string {
  const color = TMS_STATUS_META[vehicle.status].dotHex;
  const rotation = vehicle.direction ?? 0;
  return (
    `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);transform:rotate(${rotation}deg)">` +
    CAR_SVG +
    `</div>`
  );
}

/**
 * Peta rute Fleet Task Instant: rencana (biru putus-putus) vs
 * realisasi (hijau solid) + marker titik bernomor + icon kendaraan
 * realtime. Instance peta dipertahankan agar posisi kendaraan bisa
 * bergerak tanpa mereset zoom/pan pengguna.
 */
export default function TaskRouteMap({
  planned,
  actual,
  trail = [],
  timeline,
  vehicle = null,
  scrollWheel = true,
}: TaskRouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletRefs | null>(null);
  const fittedRef = useRef(false);
  const dataRef = useRef({ planned, actual, trail, timeline, vehicle });

  const draw = useCallback(() => {
    const refs = leafletRef.current;
    if (!refs) return;
    const { L, map, layer } = refs;
    const current = dataRef.current;

    layer.clearLayers();
    const bounds: [number, number][] = [];

    const drawRoutes = (routes: LatLng[][], color: string, dash?: string) => {
      for (const route of routes) {
        const latLngs = route.map((p) => [p.latitude, p.longitude] as [number, number]);
        for (const latLng of latLngs) bounds.push(latLng);
        L.polyline(latLngs, { color, weight: 4, opacity: 0.9, dashArray: dash }).addTo(layer);
      }
    };
    // Rencana digambar putus-putus biru, realisasi garis solid hijau.
    drawRoutes(current.planned, "#0284c7", "8 6");
    drawRoutes(current.actual, "#16a34a");

    // Jejak lintasan mobil: casing putih tipis + garis orange tebal agar
    // menonjol di atas basemap dan garis rute lain.
    if (current.trail.length > 1) {
      const latLngs = current.trail.map((p) => [p.latitude, p.longitude] as [number, number]);
      for (const latLng of latLngs) bounds.push(latLng);
      L.polyline(latLngs, { color: "#ffffff", weight: 8, opacity: 0.85 }).addTo(layer);
      L.polyline(latLngs, { color: "#f97316", weight: 5, opacity: 1 }).addTo(layer);
    }

    // Titik pertama yang belum dikunjungi dianggap posisi saat ini.
    const firstPending = current.timeline.findIndex((p) => !isVisitedStatus(p.visitStatusRaw));

    current.timeline.forEach((point, index) => {
      if (point.latitude === null || point.longitude === null) return;
      bounds.push([point.latitude, point.longitude]);
      const visited = isVisitedStatus(point.visitStatusRaw);
      const isCurrent = !visited && index === firstPending;
      // Hijau = sudah dikunjungi, biru = posisi saat ini, abu-abu = belum.
      const color = visited ? "#16a34a" : isCurrent ? "#0284c7" : "#94a3b8";
      const icon = L.divIcon({
        className: "task-timeline-marker",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;background:${color};color:#fff;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${point.sequence ?? index + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([point.latitude, point.longitude], { icon })
        .bindTooltip(point.name ?? point.address ?? `Titik ${point.sequence ?? index + 1}`, {
          permanent: true,
          direction: "right",
          offset: [14, 0],
          opacity: 1,
          className: "task-timeline-label",
        })
        .addTo(layer);
    });

    // Icon kendaraan realtime di atas semua layer.
    const v = current.vehicle;
    if (v && v.hasValidLocation && v.latitude !== null && v.longitude !== null) {
      bounds.push([v.latitude, v.longitude]);
      const marker = L.marker([v.latitude, v.longitude], {
        icon: L.divIcon({
          className: "task-vehicle-marker",
          html: vehicleMarkerHtml(v),
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        title: v.licensePlate,
        zIndexOffset: 1000,
      });
      marker.bindTooltip(
        `<strong>${escapeHtml(v.licensePlate)}</strong><br/>${escapeHtml(TMS_STATUS_META[v.status].label)} &bull; ${escapeHtml(formatSpeedShort(v))}`,
        { direction: "top", offset: [0, -18] },
      );
      marker.addTo(layer);
    }

    if (bounds.length > 0 && !fittedRef.current) {
      map.fitBounds(L.latLngBounds(bounds).pad(0.15));
      fittedRef.current = true;
    }
  }, []);

  // Init peta sekali; layer digambar ulang terpisah agar tidak reset view.
  useEffect(() => {
    let disposed = false;
    (async () => {
      if (!containerRef.current || leafletRef.current) return;
      const mod = await import("leaflet");
      const L = mod.default ?? mod;
      if (disposed || !containerRef.current || leafletRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: scrollWheel }).setView(
        [-2.5, 118],
        5,
      );
      L.tileLayer(TRACK_TILE_URL, {
        maxZoom: 19,
        subdomains: "abc",
        attribution: TRACK_TILE_ATTRIBUTION,
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      leafletRef.current = { L, map, layer };
      fittedRef.current = false;
      draw();
      window.setTimeout(() => {
        if (!disposed) map.invalidateSize();
      }, 150);
    })();
    return () => {
      disposed = true;
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    };
  }, [draw, scrollWheel]);

  // Redraw layer saat data rute, jejak, atau posisi kendaraan berubah.
  useEffect(() => {
    const prev = dataRef.current;
    const routeChanged =
      prev.planned !== planned || prev.actual !== actual || prev.timeline !== timeline;
    // Jejak historis datang async: refit sekali saat pertama kali muncul agar
    // lintasan langsung terlihat. Polling live berikutnya tidak refit.
    const trailAppeared = prev.trail.length <= 1 && trail.length > 1;
    if (routeChanged || trailAppeared) {
      fittedRef.current = false;
    }
    dataRef.current = { planned, actual, trail, timeline, vehicle };
    draw();
  }, [planned, actual, trail, timeline, vehicle, draw]);

  return <div ref={containerRef} className="h-full w-full" />;
}
