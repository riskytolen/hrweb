export interface VehicleOdometerLogLike {
  vehicle_id: number;
  vehicle_unit: string;
  tanggal: string;
  odometer_awal: number;
  odometer_akhir: number;
  jarak_km: number;
}

export interface VehicleOdometerSummary {
  totalJarak: number;
  totalLog: number;
  avgJarak: number;
  odometerAwal: number | null;
  odometerAkhir: number | null;
  kendaraanCount: number;
}

export interface VehicleDistanceSummary {
  vehicleId: number;
  unit: string;
  totalJarak: number;
  totalLog: number;
}

export function parseOdometerInput(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  let normalized = raw;

  if (lastDot >= 0 && lastComma >= 0) {
    normalized = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = raw.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = raw.split(".");
    normalized = parts.length > 2 || parts[parts.length - 1].length === 3 ? raw.replace(/\./g, "") : raw;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 10) / 10;
}

export function calculateDistance(start: number | null | undefined, end: number | null | undefined): number | null {
  if (start == null || end == null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) * 10) / 10;
}

export function formatKm(value: number | null | undefined, suffix = " km"): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

export function formatDateId(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  return new Date(year, month - 1, day).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function localDateInput(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function monthStartInput(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export function summarizeOdometerLogs(logs: VehicleOdometerLogLike[]): VehicleOdometerSummary {
  const totalJarak = Math.round(logs.reduce((sum, log) => sum + Number(log.jarak_km || 0), 0) * 10) / 10;
  const sortedAsc = [...logs].sort((a, b) => {
    const byDate = a.tanggal.localeCompare(b.tanggal);
    return byDate !== 0 ? byDate : a.vehicle_id - b.vehicle_id;
  });
  const first = sortedAsc[0] ?? null;
  const last = sortedAsc[sortedAsc.length - 1] ?? null;

  return {
    totalJarak,
    totalLog: logs.length,
    avgJarak: logs.length ? Math.round((totalJarak / logs.length) * 10) / 10 : 0,
    odometerAwal: first ? Number(first.odometer_awal) : null,
    odometerAkhir: last ? Number(last.odometer_akhir) : null,
    kendaraanCount: new Set(logs.map((log) => log.vehicle_id)).size,
  };
}

export function summarizeDistanceByVehicle(logs: VehicleOdometerLogLike[]): VehicleDistanceSummary[] {
  const map = new Map<number, VehicleDistanceSummary>();
  logs.forEach((log) => {
    const current = map.get(log.vehicle_id) ?? {
      vehicleId: log.vehicle_id,
      unit: log.vehicle_unit,
      totalJarak: 0,
      totalLog: 0,
    };
    current.totalJarak = Math.round((current.totalJarak + Number(log.jarak_km || 0)) * 10) / 10;
    current.totalLog += 1;
    map.set(log.vehicle_id, current);
  });
  return [...map.values()].sort((a, b) => b.totalJarak - a.totalJarak || a.unit.localeCompare(b.unit, "id"));
}

export function summarizeDistanceByDate(logs: VehicleOdometerLogLike[]): { tanggal: string; totalJarak: number; totalLog: number }[] {
  const map = new Map<string, { tanggal: string; totalJarak: number; totalLog: number }>();
  logs.forEach((log) => {
    const current = map.get(log.tanggal) ?? { tanggal: log.tanggal, totalJarak: 0, totalLog: 0 };
    current.totalJarak = Math.round((current.totalJarak + Number(log.jarak_km || 0)) * 10) / 10;
    current.totalLog += 1;
    map.set(log.tanggal, current);
  });
  return [...map.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}
