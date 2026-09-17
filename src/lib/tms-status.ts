/**
 * TMS fleet status helpers (pure, client-safe).
 *
 * Memusatkan normalisasi respons McEasy Vehicle Status List, klasifikasi
 * status operasional, ringkasan armada, filter, dan format tampilan.
 * Modul ini tidak boleh mengimpor secret atau modul server-only.
 */

export type TmsOperationalStatus = "moving" | "idle" | "parked" | "offline";

export type TmsBadgeVariant = "success" | "warning" | "info" | "danger";

export interface TmsVehicleStatus {
  vehicleId: number;
  licensePlate: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  speed: number;
  calculatedSpeed: number;
  direction: number | null;
  engineOn: boolean | null;
  motionStatus: string | null;
  calculatedMotionStatus: string | null;
  lastPacket: string | null;
  lastReceive: string | null;
  lastMotion: string | null;
  address: string;
  province: string;
  city: string;
  district: string;
  vehicleGroups: string[];
  driverName: string | null;
  temperatures: (number | null)[];
  signalStrength: number | null;
  status: TmsOperationalStatus;
  hasValidLocation: boolean;
}

export interface TmsFleetSummary {
  total: number;
  moving: number;
  idle: number;
  parked: number;
  offline: number;
  withLocation: number;
}

export interface TmsFleetFilter {
  query: string;
  status: "all" | TmsOperationalStatus;
  group: string;
}

export type TmsSortKey = "status" | "plate" | "speed" | "updated";

/** Batas data dianggap offline bila lastReceive lebih lama dari ini. */
export const TMS_OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

/** Interval auto-refresh default dashboard TMS. */
export const TMS_AUTO_REFRESH_MS = 60 * 1000;

const STATUS_ORDER: Record<TmsOperationalStatus, number> = {
  moving: 0,
  idle: 1,
  parked: 2,
  offline: 3,
};

export const TMS_STATUS_META: Record<
  TmsOperationalStatus,
  { label: string; badge: TmsBadgeVariant; dotHex: string; description: string }
> = {
  moving: {
    label: "Bergerak",
    badge: "success",
    dotHex: "#16a34a",
    description: "Kendaraan sedang berjalan",
  },
  idle: {
    label: "Idle",
    badge: "warning",
    dotHex: "#d97706",
    description: "Mesin hidup tetapi tidak bergerak",
  },
  parked: {
    label: "Parkir",
    badge: "info",
    dotHex: "#0284c7",
    description: "Mesin mati dan data masih aktual",
  },
  offline: {
    label: "Offline",
    badge: "danger",
    dotHex: "#dc2626",
    description: "Data terakhir melewati batas waktu",
  },
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toTrimmedString(item))
    .filter((item) => item.length > 0);
}

function toTemperatureArray(value: unknown): (number | null)[] {
  if (!Array.isArray(value)) {
    const single = toNullableNumber(value);
    return single === null ? [] : [single];
  }
  return value.map((item) => toNullableNumber(item));
}

function isValidCoordinate(latitude: number | null, longitude: number | null): boolean {
  if (latitude === null || longitude === null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude === 0 && longitude === 0) return false;
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function classifyVehicleStatus(input: {
  speed?: number | null;
  calculatedSpeed?: number | null;
  engineOn?: boolean | null;
  motionStatus?: string | null;
  calculatedMotionStatus?: string | null;
  lastReceive?: string | null;
  now?: number;
  offlineThresholdMs?: number;
}): TmsOperationalStatus {
  const now = input.now ?? Date.now();
  const threshold = input.offlineThresholdMs ?? TMS_OFFLINE_THRESHOLD_MS;
  const lastReceiveTime = input.lastReceive ? Date.parse(input.lastReceive) : NaN;
  const calculatedMotion = (input.calculatedMotionStatus ?? "").trim().toUpperCase();

  // Sinyal offline eksplisit dari McEasy (calculatedMotionStatus "O").
  if (calculatedMotion === "O" || calculatedMotion === "OFFLINE") return "offline";

  if (!input.lastReceive || Number.isNaN(lastReceiveTime) || now - lastReceiveTime > threshold) {
    return "offline";
  }

  const speed = Math.max(toFiniteNumber(input.speed), toFiniteNumber(input.calculatedSpeed));
  const motion = (input.motionStatus ?? "").trim().toUpperCase();
  if (
    speed > 0 ||
    motion === "M" ||
    motion === "MOVING" ||
    motion === "RUNNING" ||
    calculatedMotion === "M"
  ) {
    return "moving";
  }

  if (input.engineOn === true) return "idle";
  return "parked";
}

/**
 * Normalisasi satu item mentah McEasy menjadi TmsVehicleStatus.
 * Mengembalikan null bila identifier utama tidak valid.
 */
export function normalizeMcEasyVehicleStatus(
  raw: Record<string, unknown>,
  now: number = Date.now(),
): TmsVehicleStatus | null {
  if (!raw || typeof raw !== "object") return null;

  const vehicleId = toFiniteNumber(raw.vehicleId ?? raw.id, NaN);
  const licensePlate = toTrimmedString(raw.licensePlate ?? raw.license_plate).toUpperCase();
  if (!Number.isFinite(vehicleId) || licensePlate.length === 0) return null;

  const latitude = toNullableNumber(raw.latitude);
  const longitude = toNullableNumber(raw.longitude);
  const speed = toFiniteNumber(raw.speed);
  const calculatedSpeed = toFiniteNumber(raw.calculatedSpeed ?? raw.calculated_speed);
  const engineOn = toNullableBoolean(raw.engineOn ?? raw.engine_on);
  const motionStatus = toTrimmedString(raw.motionStatus ?? raw.motion_status) || null;
  const calculatedMotionStatus =
    toTrimmedString(raw.calculatedMotionStatus ?? raw.calculated_motion_status) || null;

  const addressDetail =
    raw.addressDetail && typeof raw.addressDetail === "object"
      ? (raw.addressDetail as Record<string, unknown>)
      : null;

  const driver =
    raw.driver1 && typeof raw.driver1 === "object"
      ? (raw.driver1 as Record<string, unknown>)
      : null;

  const lastReceive = toTrimmedString(raw.lastReceive ?? raw.last_receive) || null;

  const status = classifyVehicleStatus({
    speed,
    calculatedSpeed,
    engineOn,
    motionStatus,
    calculatedMotionStatus,
    lastReceive,
    now,
  });

  return {
    vehicleId,
    licensePlate,
    latitude,
    longitude,
    altitude: toNullableNumber(raw.altitude),
    speed,
    calculatedSpeed,
    direction: toNullableNumber(raw.direction),
    engineOn,
    motionStatus,
    calculatedMotionStatus,
    lastPacket: toTrimmedString(raw.lastPacket ?? raw.last_packet) || null,
    lastReceive,
    lastMotion: toTrimmedString(raw.lastMotion ?? raw.last_motion) || null,
    address: toTrimmedString(raw.address),
    province: addressDetail ? toTrimmedString(addressDetail.province) : "",
    city: addressDetail ? toTrimmedString(addressDetail.city) : "",
    district: addressDetail ? toTrimmedString(addressDetail.district) : "",
    vehicleGroups: toStringArray(raw.vehicleGroups ?? raw.vehicle_groups),
    driverName: driver ? toTrimmedString(driver.fullname ?? driver.full_name) || null : null,
    temperatures: toTemperatureArray(raw.temperature ?? raw.temp),
    signalStrength: toNullableNumber(raw.signalStrength ?? raw.signal_strength),
    status,
    hasValidLocation: status !== "offline" && isValidCoordinate(latitude, longitude),
  };
}

export function normalizeMcEasyVehicleStatusList(
  raw: unknown,
  now: number = Date.now(),
): TmsVehicleStatus[] {
  const list = Array.isArray(raw) ? raw : [];
  const result: TmsVehicleStatus[] = [];
  for (const item of list) {
    if (item && typeof item === "object") {
      const normalized = normalizeMcEasyVehicleStatus(item as Record<string, unknown>, now);
      if (normalized) result.push(normalized);
    }
  }
  return result;
}

export function summarizeFleet(vehicles: TmsVehicleStatus[]): TmsFleetSummary {
  const summary: TmsFleetSummary = {
    total: vehicles.length,
    moving: 0,
    idle: 0,
    parked: 0,
    offline: 0,
    withLocation: 0,
  };
  for (const vehicle of vehicles) {
    summary[vehicle.status] += 1;
    if (vehicle.hasValidLocation) summary.withLocation += 1;
  }
  return summary;
}

export function collectVehicleGroups(vehicles: TmsVehicleStatus[]): string[] {
  const groups = new Set<string>();
  for (const vehicle of vehicles) {
    for (const group of vehicle.vehicleGroups) groups.add(group);
  }
  return [...groups].sort((a, b) => a.localeCompare(b, "id"));
}

export function filterFleet(vehicles: TmsVehicleStatus[], filter: TmsFleetFilter): TmsVehicleStatus[] {
  const query = filter.query.trim().toLowerCase();
  return vehicles.filter((vehicle) => {
    if (filter.status !== "all" && vehicle.status !== filter.status) return false;
    if (filter.group !== "all" && !vehicle.vehicleGroups.includes(filter.group)) return false;
    if (!query) return true;
    const haystack = [
      vehicle.licensePlate,
      vehicle.driverName ?? "",
      vehicle.address,
      vehicle.city,
      vehicle.vehicleGroups.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return query.split(/\s+/).every((token) => haystack.includes(token));
  });
}

function lastReceiveTime(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortFleet(vehicles: TmsVehicleStatus[], sort: TmsSortKey): TmsVehicleStatus[] {
  const sorted = [...vehicles];
  switch (sort) {
    case "plate":
      sorted.sort((a, b) => a.licensePlate.localeCompare(b.licensePlate, "id"));
      break;
    case "speed":
      sorted.sort((a, b) => Math.max(b.speed, b.calculatedSpeed) - Math.max(a.speed, a.calculatedSpeed));
      break;
    case "updated":
      sorted.sort((a, b) => lastReceiveTime(b.lastReceive) - lastReceiveTime(a.lastReceive));
      break;
    case "status":
    default:
      sorted.sort((a, b) => {
        const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (byStatus !== 0) return byStatus;
        return lastReceiveTime(b.lastReceive) - lastReceiveTime(a.lastReceive);
      });
      break;
  }
  return sorted;
}

export function formatSpeedKmh(vehicle: Pick<TmsVehicleStatus, "speed" | "calculatedSpeed">): string {
  const speed = Math.max(toFiniteNumber(vehicle.speed), toFiniteNumber(vehicle.calculatedSpeed));
  return `${new Intl.NumberFormat("id-ID").format(Math.round(speed))} km/jam`;
}

export function formatSpeedShort(vehicle: Pick<TmsVehicleStatus, "speed" | "calculatedSpeed">): string {
  const speed = Math.max(toFiniteNumber(vehicle.speed), toFiniteNumber(vehicle.calculatedSpeed));
  return `${new Intl.NumberFormat("id-ID").format(Math.round(speed))} km/h`;
}

export function formatSignalLabel(strength: number | null): string {
  if (strength === null || !Number.isFinite(strength)) return "-";
  if (strength >= 4) return "Kuat";
  if (strength >= 2) return "Sedang";
  return "Lemah";
}

export function formatTemperature(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const rounded = Math.round(value * 10) / 10;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(rounded)}°C`;
}

export function formatVehicleTemperatures(temperatures: (number | null)[]): string {
  const valid = temperatures
    .map((temperature, index) => ({ temperature, index }))
    .filter((entry): entry is { temperature: number; index: number } =>
      typeof entry.temperature === "number" && Number.isFinite(entry.temperature),
    );
  if (valid.length === 0) return "-";
  if (valid.length === 1) return formatTemperature(valid[0].temperature);
  return valid.map((entry) => `S${entry.index + 1} ${formatTemperature(entry.temperature)}`).join(" • ");
}

export function formatRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "Tidak diketahui";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "Tidak diketahui";
  const diffSeconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (diffSeconds < 60) return `${diffSeconds} dtk lalu`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} mnt lalu`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} hari lalu`;
}

export function formatFullTimestamp(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatClockTime(timestamp: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

export function googleMapsUrl(vehicle: Pick<TmsVehicleStatus, "latitude" | "longitude">): string | null {
  if (!isValidCoordinate(vehicle.latitude, vehicle.longitude)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${vehicle.latitude},${vehicle.longitude}`;
}
