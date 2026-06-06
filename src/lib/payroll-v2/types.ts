/**
 * Types & interfaces untuk Payroll v2.
 * Pure data structures, no business logic.
 */

export type PayrollStatus = "DRAFT" | "REVIEWED" | "FINAL";

export type EmploymentStatus = "Aktif" | "Training" | "Tidak Aktif" | "Cuti";

/** Status absensi (huruf besar sesuai DB). */
export type AttendanceStatus =
  | "Hadir"
  | "Terlambat"
  | "Alpha"
  | "Cuti"
  | "Sakit"
  | "Izin"
  | "Libur";

export interface PeriodRange {
  key: string;
  label: string;
  mulai: string;
  selesai: string;
  totalHariKalender: number;
}

export interface EmployeeInput {
  id: string;
  nama: string;
  divisi: string;
  jabatan: string;
  statusKaryawan: EmploymentStatus;
  tanggalMasuk: string;
  tanggalKeluar: string | null;
  gajiPokok: number;
}

export interface AttendanceRecord {
  tanggal: string;
  status: AttendanceStatus;
  /** Durasi telat dalam menit (untuk "Terlambat"). */
  menitTelat?: number;
}

export interface OvertimeRequest {
  id: number;
  tanggalMulai: string;
  tanggalSelesai: string;
  jamMulai: string;
  jamSelesai: string;
  totalJam: number;
  tarifPerJam: number;
  totalBayar: number;
  status: "Diajukan" | "Disetujui" | "Ditolak";
}

export interface PotonganAbsen {
  tanggal: string;
  status: AttendanceStatus;
  nominal: number;
  menitTelat?: number;
}

export interface LemburDetail {
  tanggal: string;
  jam: number;
  tarif: number;
  total: number;
}

export interface PayrollInput {
  employee: EmployeeInput;
  period: PeriodRange;
  attendance: AttendanceRecord[];
  overtime: OvertimeRequest[];
  /** Override per field (misal dari Batch Fill). Optional. */
  overrides?: Partial<PayrollOutput>;
}

export interface PayrollOutput {
  // Pendapatan
  gajiPokok: number;
  gajiPokokProrata: number;
  isProrated: boolean;
  prorataHari: number;
  prorataTotal: number;
  pendapatanTitik: number;
  lembur: number;
  lemburDetail: LemburDetail[];
  totalPendapatan: number;
  // Potongan
  potonganAbsen: number;
  potonganAbsenDetail: PotonganAbsen[];
  totalPotongan: number;
  // Netto
  netto: number;
  // Status
  status: PayrollStatus;
}

export interface PayrollRow {
  id: number;
  employeeId: string;
  employeeName: string;
  divisi: string;
  periode: string;
  gajiPokok: number;
  pendapatanTitik: number;
  lembur: number;
  totalPendapatan: number;
  potonganAbsen: number;
  totalPotongan: number;
  netto: number;
  status: PayrollStatus;
  isProrated: boolean;
  version: number;
  reviewedAt: string | null;
  lockedAt: string | null;
  updatedAt: string;
}

export type BatchField =
  | "gajiPokok"
  | "pendapatanTitik"
  | "lembur"
  | "potonganAbsen"
  | "koperasi"
  | "pinjaman"
  | "potonganLain";

export interface BatchFillRequest {
  field: BatchField;
  value: number;
  mode: "set" | "add" | "subtract";
}

/** Snapshot source data saat hitung worksheet. */
export interface PayrollSnapshot {
  gaji_pokok: number;
  total_titik: number;
  total_lembur: number;
  formula: string;
  computed_at: string;
}
