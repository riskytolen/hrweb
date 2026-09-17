/**
 * Normalisasi dan pencocokan data suhu kendaraan dari webhook
 * Temperature Data Update (DVC-DU/T1).
 *
 * Payload dokumentasi tidak menyertakan timestamp, sehingga waktu
 * pengukuran memakai `received_at` (waktu server menerima webhook).
 */

export interface TemperatureWebhookEvent {
  licensePlate: string | null;
  imei: string | null;
  driverName: string | null;
  latitude: number | null;
  longitude: number | null;
  temperatureNum: number | null;
  temperature: number | null;
  engineOn: boolean | null;
}

function toTrimmedString(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toFiniteInteger(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed)) return null;
  return parsed;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "ya"].includes(normalized)) return true;
    if (["false", "0", "off", "tidak"].includes(normalized)) return false;
  }
  return null;
}

function pickFirst(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Normalisasi satu payload webhook suhu. Mengembalikan `null` bila payload
 * tidak memuat suhu valid atau identitas kendaraan (plat/imei).
 */
export function normalizeTemperatureWebhook(raw: unknown): TemperatureWebhookEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  const temperature = toFiniteNumber(
    pickFirst(source, ["temperature", "temp", "temperature_value", "temperatureValue", "value"]),
  );
  if (temperature === null) return null;

  const licensePlate = toTrimmedString(
    pickFirst(source, ["license_plate", "licensePlate", "plate", "plate_number", "plateNumber"]),
    40,
  );
  const imei = toTrimmedString(pickFirst(source, ["imei", "IMEI", "device_imei", "deviceImei"]), 60);
  if (!licensePlate && !imei) return null;

  return {
    licensePlate,
    imei,
    driverName: toTrimmedString(pickFirst(source, ["driver", "driver_name", "driverName"]), 120),
    latitude: toFiniteNumber(pickFirst(source, ["latitude", "lat"])),
    longitude: toFiniteNumber(pickFirst(source, ["longitude", "lng", "lon", "long"])),
    temperatureNum: toFiniteInteger(
      pickFirst(source, ["temperature_num", "temperatureNum", "sensor_num", "sensorNum", "sensor"]),
    ),
    temperature,
    engineOn: toBoolean(pickFirst(source, ["engine_on", "engineOn", "engine"])),
  };
}

export interface TemperatureReading {
  temperature: number;
  temperatureNum: number | null;
  /** Waktu pengukuran dalam ISO string (diisi dari `received_at`). */
  recordedAt: string;
}

export interface TemperatureMatchPoint {
  sequence: number | null;
  arrivalActual: string | null;
  departureActual: string | null;
}

export interface PointTemperature {
  sequence: number | null;
  temperature: number;
  temperatureNum: number | null;
  recordedAt: string;
}

/**
 * Cocokkan suhu ke titik rute yang sudah dikunjungi. Untuk tiap titik yang
 * punya waktu tiba/berangkat aktual, pilih event suhu terdekat dalam window
 * toleransi. Titik tanpa waktu aktual (belum dikunjungi) selalu dilewati.
 */
export function matchTemperaturesToPoints(
  points: TemperatureMatchPoint[],
  readings: TemperatureReading[],
  windowMinutes = 30,
): PointTemperature[] {
  const windowMs = Math.max(1, windowMinutes) * 60_000;
  const validReadings = readings.filter((reading) => {
    if (!Number.isFinite(reading.temperature)) return false;
    return !Number.isNaN(Date.parse(reading.recordedAt));
  });
  if (validReadings.length === 0) return [];

  const matched: PointTemperature[] = [];
  for (const point of points) {
    const at = point.arrivalActual ?? point.departureActual;
    if (!at) continue;
    const atMs = Date.parse(at);
    if (Number.isNaN(atMs)) continue;

    let nearest: TemperatureReading | null = null;
    let nearestDiff = Number.POSITIVE_INFINITY;
    for (const reading of validReadings) {
      const diff = Math.abs(Date.parse(reading.recordedAt) - atMs);
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearest = reading;
      }
    }
    if (!nearest || nearestDiff > windowMs) continue;
    matched.push({
      sequence: point.sequence,
      temperature: nearest.temperature,
      temperatureNum: nearest.temperatureNum,
      recordedAt: nearest.recordedAt,
    });
  }
  return matched;
}

/** Format nilai suhu sensor, mis. 4 -> "4°C", 4.5 -> "4.5°C". */
export function formatTemperature(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}°C`;
}

/** Label suhu untuk titik rute, mis. "Sensor 1 · 4.5°C" atau "Suhu 4.5°C". */
export function pointTemperatureLabel(temperatureNum: number | null, temperature: number): string {
  const formatted = formatTemperature(temperature);
  if (temperatureNum === null) return `Suhu ${formatted}`;
  return `Sensor ${temperatureNum} · ${formatted}`;
}
