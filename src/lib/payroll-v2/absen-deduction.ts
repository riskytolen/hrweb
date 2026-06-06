/**
 * Potongan absen (telat + alpha).
 *
 * Tarif (default):
 * - Terlambat: Rp 3.000 per kejadian (flat), atau prorata per 15 menit
 * - Alpha: Rp 50.000 per hari (atau sesuai konstanta perusahaan)
 *
 * V2: Configurable per perusahaan, default values:
 */

import type { AttendanceRecord, PotonganAbsen } from "./types";

export const TARIF_TELAT_PER_15MENIT = 3000;
export const TARIF_ALPHA_PER_HARI = 50_000;

export function calculateAbsenDeduction(
  attendance: AttendanceRecord[],
): { total: number; detail: PotonganAbsen[] } {
  const detail: PotonganAbsen[] = [];

  // Group by tanggal — kalau 1 hari ada multiple telat (impossible tapi safe),
  // atau kalau alpha + telat (impossible), aggregate jadi yang terberat.
  const byDate = new Map<string, AttendanceRecord>();
  for (const a of attendance) {
    if (a.status === "Terlambat" || a.status === "Alpha") {
      const existing = byDate.get(a.tanggal);
      if (!existing) {
        byDate.set(a.tanggal, a);
      } else {
        // Alpha lebih berat dari telat
        if (existing.status === "Terlambat" && a.status === "Alpha") {
          byDate.set(a.tanggal, a);
        }
      }
    }
  }

  for (const [tanggal, record] of byDate) {
    if (record.status === "Alpha") {
      detail.push({
        tanggal,
        status: "Alpha",
        nominal: TARIF_ALPHA_PER_HARI,
      });
    } else if (record.status === "Terlambat") {
      const menit = record.menitTelat ?? 0;
      const unit = Math.max(1, Math.ceil(menit / 15));
      const nominal = unit * TARIF_TELAT_PER_15MENIT;
      detail.push({
        tanggal,
        status: "Terlambat",
        nominal,
        menitTelat: menit,
      });
    }
  }

  // Sort by tanggal ascending
  detail.sort((a, b) => a.tanggal.localeCompare(b.tanggal));

  const total = detail.reduce((s, d) => s + d.nominal, 0);
  return { total, detail };
}
