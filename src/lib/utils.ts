import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("id-ID").format(num);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(date));
}

export function formatShortDate(date: Date | string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Title Case - huruf pertama setiap kata kapital, sisanya kecil.
 * "risky yanto" -> "Risky Yanto"
 * "RISKY YANTO" -> "Risky Yanto"
 */
export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s|[-'/])\S/g, (char) => char.toUpperCase());
}

/**
 * Upper Case seluruh teks.
 * Untuk field seperti No. KTP, BPJS, No. Rekening.
 */
export function toUpperTrim(str: string): string {
  return str.toUpperCase().trim();
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    active: "bg-success-light text-success",
    inactive: "bg-muted text-muted-foreground",
    pending: "bg-warning-light text-warning",
    approved: "bg-success-light text-success",
    rejected: "bg-danger-light text-danger",
    paid: "bg-success-light text-success",
    unpaid: "bg-danger-light text-danger",
    overdue: "bg-danger-light text-danger",
    draft: "bg-muted text-muted-foreground",
  };
  return colors[status.toLowerCase()] || "bg-muted text-muted-foreground";
}

// Palet warna divisi yang kontras dan mudah dibedakan
const DIVISION_COLORS = [
  "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
  "#e11d48", "#84cc16", "#a855f7", "#0ea5e9", "#d946ef",
  "#22c55e", "#eab308", "#64748b", "#f43f5e", "#2dd4bf",
];

/**
 * Generate warna unik untuk divisi baru berdasarkan warna yang sudah dipakai.
 */
export function generateDivisionColor(existingColors: string[]): string {
  const used = new Set(existingColors.map((c) => c.toLowerCase()));
  const available = DIVISION_COLORS.find((c) => !used.has(c));
  if (available) return available;
  // Fallback: random hue
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 50%)`;
}
