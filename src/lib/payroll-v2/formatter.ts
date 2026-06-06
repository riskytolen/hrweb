/**
 * Formatter utilities untuk Payroll v2.
 * Format Rupiah, tanggal, periode, dll.
 */

const RP = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat("id-ID");

const DATE = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATETIME = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatRupiah(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "Rp 0";
  return RP.format(Math.round(n));
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "0";
  return NUM.format(Math.round(n));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return DATE.format(new Date(iso));
  } catch {
    return "—";
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return DATETIME.format(new Date(iso));
  } catch {
    return "—";
  }
}

export function formatHari(n: number): string {
  return `${n} hari`;
}

export function formatJam(n: number): string {
  return `${formatNumber(n)} jam`;
}
