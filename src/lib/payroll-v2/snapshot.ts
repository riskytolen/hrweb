/**
 * Build snapshot data untuk audit & freeze.
 * Snapshot di-freeze saat hitung worksheet — biar kalau gaji pokok naik bulan depan,
 * slip bulan ini tidak ikut berubah.
 */

import type { PayrollOutput } from "./types";
import type { PayrollSnapshot } from "@/lib/supabase";

export function buildSnapshot(
  output: Pick<PayrollOutput, "gajiPokokProrata" | "pendapatanTitik" | "lembur">,
  formula: string,
): PayrollSnapshot {
  return {
    gaji_pokok: output.gajiPokokProrata,
    total_titik: output.pendapatanTitik,
    total_lembur: output.lembur,
    formula,
    computed_at: new Date().toISOString(),
  };
}
