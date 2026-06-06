/**
 * Pure calculator functions untuk Payroll v2.
 * Testable, no side effects, no Supabase calls.
 */

import { calculateAbsenDeduction } from "./absen-deduction";
import { calculateLembur } from "./lembur-calc";
import { calculateProratedGapok } from "./proration";
import type { PayrollInput, PayrollOutput } from "./types";

/**
 * Hitung payroll lengkap untuk 1 pegawai dalam 1 periode.
 *
 * Returns null jika pegawai harus di-skip (Tidak Aktif + 0 catatan absen).
 */
export function calculatePayroll(input: PayrollInput): PayrollOutput | null {
  const { employee, period, attendance, overtime, overrides } = input;

  // 1. Gapok (dengan prorata)
  const prorata = calculateProratedGapok(employee, period, attendance);
  if (!prorata) return null;

  // 2. Pendapatan titik (dari rekap delivery)
  // V1: caller inject via overrides atau default 0
  const pendapatanTitik = overrides?.pendapatanTitik ?? 0;

  // 3. Lembur (dari overtime_requests Disetujui)
  const lembur = calculateLembur(overtime, period);

  // 4. Potongan absen
  const potongan = calculateAbsenDeduction(attendance);

  // 5. Aggregate
  const totalPendapatan = prorata.gapokFinal + pendapatanTitik + lembur.total;
  const totalPotongan = potongan.total;
  const netto = totalPendapatan - totalPotongan;

  // 6. Override (dari Batch Fill)
  const out: PayrollOutput = {
    gajiPokok: employee.gajiPokok,
    gajiPokokProrata: prorata.gapokFinal,
    isProrated: prorata.isProrated,
    prorataHari: prorata.hariEfektif,
    prorataTotal: prorata.hariKalender,
    pendapatanTitik,
    lembur: lembur.total,
    lemburDetail: lembur.detail,
    totalPendapatan,
    potonganAbsen: potongan.total,
    potonganAbsenDetail: potongan.detail,
    totalPotongan,
    netto,
    status: "DRAFT",
  };

  return { ...out, ...overrides };
}

/**
 * Hitung total kumulatif untuk rekap laporan.
 */
export function aggregatePayrolls(rows: PayrollOutput[]) {
  return rows.reduce(
    (acc, r) => ({
      totalGapok: acc.totalGapok + r.gajiPokokProrata,
      totalTitik: acc.totalTitik + r.pendapatanTitik,
      totalLembur: acc.totalLembur + r.lembur,
      totalPendapatan: acc.totalPendapatan + r.totalPendapatan,
      totalPotonganAbsen: acc.totalPotonganAbsen + r.potonganAbsen,
      totalPotongan: acc.totalPotongan + r.totalPotongan,
      totalNetto: acc.totalNetto + r.netto,
    }),
    {
      totalGapok: 0,
      totalTitik: 0,
      totalLembur: 0,
      totalPendapatan: 0,
      totalPotonganAbsen: 0,
      totalPotongan: 0,
      totalNetto: 0,
    },
  );
}
