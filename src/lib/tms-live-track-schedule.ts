/**
 * Jadwal tampil Live Track Task (pure, client-safe).
 *
 * Jadwal bersifat konfigurasi berulang berbasis kontrak: satu jam operasional
 * per kelompok yang diwarisi unit, dengan opsi override per unit. Zona waktu
 * selalu Asia/Jakarta. Jadwal boleh melewati tengah malam: bila jam selesai
 * lebih kecil dari jam mulai, window berakhir keesokan harinya.
 */

export const LIVE_TRACK_TIMEZONE = "Asia/Jakarta";

/** Ubah "HH:MM" atau "HH:MM:SS" menjadi menit sejak tengah malam. */
export function parseClockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

interface WibDateParts {
  year: number;
  month: number;
  day: number;
  minutes: number;
}

function wibParts(atMs: number): WibDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LIVE_TRACK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(atMs));
  const get = (type: string): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  // "24:xx" tengah malam pada beberapa implementasi Intl dinormalkan ke 0.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), minutes: hour * 60 + get("minute") };
}

/** Timestamp UTC (ms) untuk tanggal WIB + menit sejak tengah malam WIB. */
function wibDateTimeMs(year: number, month: number, day: number, minutes: number): number {
  // WIB = UTC+7 tetap (tanpa DST), jadi offset-nya konstan.
  const dayMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return dayMs - 7 * 60 * 60 * 1000 + minutes * 60 * 1000;
}

/**
 * Apakah window sedang aktif pada `nowMs`?
 * - start < end: aktif pada hari yang sama.
 * - start > end: melewati tengah malam.
 * - start === end: ambigu, selalu false.
 */
export function isLiveTrackWindowActive(
  startMinutes: number | null,
  endMinutes: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (startMinutes === null || endMinutes === null) return false;
  if (startMinutes === endMinutes) return false;
  const current = wibParts(nowMs).minutes;
  if (startMinutes < endMinutes) {
    return current >= startMinutes && current < endMinutes;
  }
  return current >= startMinutes || current < endMinutes;
}

export interface LiveTrackWindowBounds {
  windowStartedAt: string;
  visibleUntil: string;
}

/**
 * Batas occurrence window yang sedang berjalan pada `nowMs`.
 * Mengembalikan null bila jam tidak valid/ambigu.
 */
export function currentLiveTrackWindowBounds(
  startMinutes: number | null,
  endMinutes: number | null,
  nowMs: number = Date.now(),
): LiveTrackWindowBounds | null {
  if (startMinutes === null || endMinutes === null) return null;
  if (startMinutes === endMinutes) return null;
  const { year, month, day, minutes } = wibParts(nowMs);
  const startOfToday = wibDateTimeMs(year, month, day, startMinutes);
  if (startMinutes < endMinutes) {
    return {
      windowStartedAt: new Date(startOfToday).toISOString(),
      visibleUntil: new Date(wibDateTimeMs(year, month, day, endMinutes)).toISOString(),
    };
  }
  // Lintas tengah malam.
  if (minutes >= startMinutes) {
    // Window dimulai hari ini, berakhir besok.
    const started = new Date(startOfToday);
    const until = new Date(startOfToday + (24 * 60 - startMinutes + endMinutes) * 60 * 1000);
    return { windowStartedAt: started.toISOString(), visibleUntil: until.toISOString() };
  }
  // Window dimulai kemarin, berakhir hari ini.
  const yParts = wibParts(startOfToday - 24 * 60 * 60 * 1000);
  const startedAt = new Date(wibDateTimeMs(yParts.year, yParts.month, yParts.day, startMinutes));
  const until = new Date(wibDateTimeMs(year, month, day, endMinutes));
  return { windowStartedAt: startedAt.toISOString(), visibleUntil: until.toISOString() };
}

/** Normalisasi nomor polisi untuk pencocokan lintas endpoint. */
export function normalizeLiveTrackPlateKey(plate: string | null | undefined): string {
  if (!plate) return "";
  return plate.toUpperCase().replace(/[\s.\-]/g, "");
}

/** Format "HH:MM" menjadi label Indonesia ("06.00"). */
export function formatLiveTrackClock(value: string | null | undefined): string {
  const minutes = parseClockToMinutes(value);
  if (minutes === null) return "–";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}.${String(rest).padStart(2, "0")}`;
}
