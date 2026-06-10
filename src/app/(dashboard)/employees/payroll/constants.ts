import type { DbPayroll } from "@/lib/supabase";

export type PayrollRow = DbPayroll & { pegawaiNama?: string; pegawaiJabatan?: string };

export type AbsenBreakdownItem = { tanggal: string; status: string; denda: number; durasi_telat: number | null };
export type LemburBreakdownItem = { tanggal: string; jam_mulai: string; jam_selesai: string; durasi_menit: number; rate_per_jam: number; total_lembur: number; alasan: string | null };

export const PENDAPATAN_FIELDS: { key: string; label: string; readonly?: boolean }[] = [
  { key: "gaji_pokok", label: "Gaji Pokok", readonly: true },
  { key: "pendapatan_titik", label: "Pendapatan Titik", readonly: true },
  { key: "lembur", label: "Lembur", readonly: true },
  { key: "extra_job", label: "Extra Job" },
  { key: "uang_makan", label: "Uang Makan" },
  { key: "insentif", label: "Insentif" },
  { key: "tunjangan_jabatan", label: "Tunjangan Jabatan" },
  { key: "transport", label: "Transport" },
  { key: "tunjangan_lain", label: "Tunjangan Lain" },
  { key: "tambahan_lain", label: "Tambahan Lain" },
];

export const POTONGAN_FIELDS: { key: string; label: string; readonly?: boolean }[] = [
  { key: "koperasi", label: "Koperasi" },
  { key: "pinjaman_perusahaan", label: "Pinjaman Perusahaan" },
  { key: "potongan_absen", label: "Potongan Absen", readonly: true },
  { key: "potongan_lain", label: "Potongan Lain" },
  { key: "jht", label: "JHT" },
  { key: "bpjs_kesehatan", label: "BPJS Kesehatan" },
];

export const inputClass =
  "w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50 text-foreground";

export function parseCurrencyInput(val: string): number {
  return parseInt(val.replace(/\D/g, "")) || 0;
}

export function formatInputCurrency(val: number): string {
  if (val === 0) return "";
  return new Intl.NumberFormat("id-ID").format(val);
}
