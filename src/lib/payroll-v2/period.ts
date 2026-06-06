/**
 * Period utilities untuk Payroll v2.
 * Cut-off: tgl 8 bulan sebelumnya s/d tgl 7 bulan ini.
 */

import type { PeriodRange } from "./types";

export function getPeriodRange(periodKey: string): PeriodRange {
  const [year, month] = periodKey.split("-").map(Number);
  const startDate = new Date(year, month - 2, 8);
  const endDate = new Date(year, month - 1, 7);

  const start = formatLocalDate(year, month - 2, 8);
  const end = formatLocalDate(year, month - 1, 7);

  const label = `8 ${startDate.toLocaleDateString("id-ID", { month: "short", year: "numeric" })} – 7 ${endDate.toLocaleDateString("id-ID", { month: "short", year: "numeric" })}`;

  // Total hari kalender (inklusif)
  const totalHariKalender = Math.floor(
    (endDate.getTime() - startDate.getTime()) / 86400000,
  ) + 1;

  return { key: periodKey, mulai: start, selesai: end, label, totalHariKalender };
}

export function getCurrentPeriodKey(): string {
  const now = new Date();
  if (now.getDate() <= 7) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftPeriod(periodKey: string, direction: -1 | 1): string {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, m - 1 + direction, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatPeriodLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

function formatLocalDate(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
