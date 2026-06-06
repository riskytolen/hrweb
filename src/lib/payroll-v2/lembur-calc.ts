/**
 * Lembur calculation.
 * Filter overtime_requests dengan status "Disetujui" dalam periode.
 */

import type { LemburDetail, OvertimeRequest, PeriodRange } from "./types";

export function calculateLembur(
  overtime: OvertimeRequest[],
  period: PeriodRange,
): { total: number; detail: LemburDetail[] } {
  const startMs = new Date(period.mulai).getTime();
  const endMs = new Date(period.selesai).getTime();

  const approved = overtime.filter((o) => {
    if (o.status !== "Disetujui") return false;
    const t = new Date(o.tanggalMulai).getTime();
    return t >= startMs && t <= endMs;
  });

  const detail: LemburDetail[] = approved.map((o) => ({
    tanggal: o.tanggalMulai,
    jam: o.totalJam,
    tarif: o.tarifPerJam,
    total: o.totalBayar,
  }));

  detail.sort((a, b) => a.tanggal.localeCompare(b.tanggal));

  const total = detail.reduce((s, d) => s + d.total, 0);
  return { total, detail };
}
