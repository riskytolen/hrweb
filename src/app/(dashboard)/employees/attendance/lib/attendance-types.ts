import type { DbAttendanceRecord } from "@/lib/supabase";
import type { PenaltyLite } from "./attendance-helpers";

export type EmployeeLite = {
  id: string;
  nama: string;
  status: string;
  tanggal_bergabung: string | null;
  tanggal_keluar: string | null;
};

export type OffDayEntry = { employee_id: string; day_of_week: number };

export type OverrideEntry = {
  id: number;
  employee_id: string;
  tanggal: string;
  type: "libur" | "masuk";
  catatan: string | null;
};

export type DivisionLite = { id: number; nama: string; color: string };

export type ScheduleLite = {
  division_id: number;
  jam_masuk: string;
  toleransi_menit: number;
  awal_absen_menit: number;
};

export type AttendanceRow = DbAttendanceRecord & {
  employeeNama?: string;
  divisionNama?: string;
  divisionColor?: string;
};

export type PublicHoliday = {
  id: number;
  nama: string;
  tanggal: string;
  tanggal_selesai: string | null;
  kategori: "Nasional" | "Cuti Bersama" | "Spesial";
  catatan: string | null;
  berlaku_untuk: "semua" | "divisi" | "pegawai";
  divisi_ids: number[] | null;
  pegawai_ids: string[] | null;
  created_at: string;
};

export type SummaryRow = {
  employee_id: string;
  nama: string;
  status: string;
  divisionId: number;
  divisionNama: string;
  divisionColor: string;
  hadir: number;
  telat: number;
  izin: number;
  sakit: number;
  alpha: number;
  libur: number;
  cuti: number;
  total: number;
};

export type { PenaltyLite };
