import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Database Types ───

export interface DbDivision {
  id: number;
  nama: string;
  deskripsi: string | null;
  color: string;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbAttendanceLocation {
  id: number;
  nama: string;
  latitude: number;
  longitude: number;
  radius: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbDivisionLocationAssignment {
  id: number;
  division_id: number;
  location_id: number;
  created_at: string;
  // joined
  divisions?: DbDivision;
  attendance_locations?: DbAttendanceLocation;
}

export interface DbDivisionSchedule {
  id: number;
  division_id: number;
  jam_masuk: string;
  jam_pulang: string | null;
  toleransi_menit: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
  // joined
  divisions?: DbDivision;
}

export interface DbBank {
  id: number;
  nama: string;
  kode: string | null;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbLevel {
  id: number;
  nama: string;
  urutan: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbJabatan {
  id: number;
  nama: string;
  deskripsi: string | null;
  level_id: number | null;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
  // joined
  levels?: DbLevel;
}

export interface DbPegawai {
  id: string;
  nama: string;
  jenis_kelamin: "Laki-laki" | "Perempuan" | null;
  agama: "Islam" | "Kristen" | "Katolik" | "Hindu" | "Buddha" | "Konghucu" | null;
  status: "Aktif" | "Tidak Aktif" | "Cuti" | "Training";
  no_ktp: string | null;
  tempat_lahir: string | null;
  tanggal_lahir: string | null;
  alamat_ktp: string | null;
  alamat_domisili: string | null;
  no_telp: string;
  tanggal_bergabung: string | null;
  jabatan_id: number | null;
  status_pernikahan: "Belum Menikah" | "Menikah" | "Cerai" | null;
  nama_pasangan: string | null;
  jumlah_anak: number;
  foto_ktp: string | null;
  foto_diri: string | null;
  no_bpjs_kesehatan: string | null;
  no_bpjs_ketenagakerjaan: string | null;
  foto_sim: string | null;
  no_rekening: string | null;
  bank: string | null;
  nama_rekening: string | null;
  kartu_keluarga: string | null;
  tanggal_mulai_pkwt: string | null;
  tanggal_berakhir_pkwt: string | null;
  recruitment_id: number | null;
  created_at: string;
  updated_at: string;
  // joined
  jabatan?: DbJabatan;
}

export interface DbDeliveryStatus {
  id: number;
  nama: string;
  kode: string;
  color: string;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbPointRate {
  id: number;
  division_id: number;
  role: "Driver" | "Helper";
  rate_per_point: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
  // joined
  divisions?: DbDivision;
}

export interface DbDeliveryPoint {
  id: number;
  employee_id: string | null;
  employee_nama: string | null;
  division_id: number;
  role: "Driver" | "Helper";
  tanggal: string;
  jumlah_titik: number;
  rate_per_point: number;
  total: number;
  catatan: string | null;
  status_id: number | null;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
  divisions?: DbDivision;
  delivery_statuses?: DbDeliveryStatus;
}

export interface DbRecruitment {
  id: number;
  nama: string;
  no_hp: string;
  email: string | null;
  posisi_dilamar: string;
  pendidikan_terakhir: string;
  pengalaman_kerja: string | null;
  alamat: string | null;
  sim: string | null;
  cv_url: string | null;
  status: "Lamaran Masuk" | "Terpilih" | "Training" | "Diterima" | "Ditolak";
  catatan: string | null;
  tanggal_training_mulai: string | null;
  tanggal_training_selesai: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAttendancePenaltyRate {
  id: number;
  division_id: number;
  denda_per_menit: number;
  batas_menit: number;
  denda_maksimum: number;
  denda_alpha: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
  // joined
  divisions?: DbDivision;
}

export interface DbAttendanceRecord {
  id: number;
  employee_id: string;
  division_id: number;
  tanggal: string;
  jam_masuk: string;
  schedule_jam_masuk: string;
  toleransi_menit: number;
  status: "Hadir" | "Terlambat" | "Izin" | "Sakit" | "Alpha";
  durasi_telat: number;
  denda: number;
  location_id: number | null;
  catatan: string | null;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
  divisions?: DbDivision;
  attendance_locations?: DbAttendanceLocation;
}

export interface DbEmployeeDevice {
  id: number;
  employee_id: string;
  device_id: string;
  status: "Aktif" | "Tidak Aktif";
  registered_at: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
}

export interface DbEmployeeFaceProfile {
  id: number;
  employee_id: string;
  face_data_ref: string | null;
  status: "Aktif" | "Tidak Aktif";
  enrolled_at: string;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
}
