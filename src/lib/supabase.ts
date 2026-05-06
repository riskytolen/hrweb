import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
  gaji_pokok: number;
  recruitment_id: number | null;
  created_at: string;
  updated_at: string;
  // joined
  jabatan?: DbJabatan;
}

export interface DbPayroll {
  id: number;
  employee_id: string;
  periode: string;
  periode_mulai: string;
  periode_selesai: string;
  // Pendapatan
  gaji_pokok: number;
  pendapatan_titik: number;
  extra_job: number;
  uang_makan: number;
  insentif: number;
  tunjangan_jabatan: number;
  transport: number;
  tunjangan_lain: number;
  tambahan_lain: number;
  total_pendapatan: number;
  // Potongan
  koperasi: number;
  pinjaman_perusahaan: number;
  potongan_absen: number;
  potongan_lain: number;
  jht: number;
  bpjs_kesehatan: number;
  total_potongan: number;
  // Netto
  netto: number;
  status: "Draft" | "Final";
  catatan: string | null;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
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
  status: "Hadir" | "Terlambat" | "Izin" | "Sakit" | "Alpha" | "Libur" | "Cuti";
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

export interface DbLeaveRequest {
  id: number;
  employee_id: string;
  jenis: "Izin" | "Sakit" | "Cuti";
  tanggal_mulai: string;
  tanggal_selesai: string;
  alasan: string | null;
  lampiran_url: string | null;
  status: "Menunggu" | "Disetujui" | "Ditolak";
  catatan_approval: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
}

export interface DbEmployeeOffDay {
  id: number;
  employee_id: string;
  day_of_week: number;
  created_at: string;
  // joined
  pegawai?: DbPegawai;
}

export interface DbEmployeeLeaveOverride {
  id: number;
  employee_id: string;
  tanggal: string;
  type: "libur" | "masuk";
  catatan: string | null;
  created_at: string;
}

export interface DbEmployeeDevice {
  id: number;
  employee_id: string;
  device_id: string;
  device_name: string | null;
  status: "Aktif" | "Tidak Aktif";
  registered_at: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  device_platform: string | null;
  // joined
  pegawai?: DbPegawai;
}

export interface DbEmployeeFaceProfile {
  id: number;
  employee_id: string;
  face_data_ref: string | null; // JSON array of 128 floats (face descriptor)
  status: "Aktif" | "Tidak Aktif";
  enrolled_at: string;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
}

// ─── Auth & Roles ───

export interface DbRole {
  id: number;
  nama: string;
  deskripsi: string | null;
  level: number;
  permissions: string[];
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbUserProfile {
  id: string;
  email: string;
  nama: string;
  role_id: number | null;
  employee_id: string | null;
  avatar_url: string | null;
  status: "Aktif" | "Tidak Aktif";
  last_login: string | null;
  created_at: string;
  updated_at: string;
  // joined
  roles?: DbRole;
}

export interface DbLegalDocument {
  id: number;
  employee_id: string;
  kategori: "PKWT" | "SP";
  nomor_kontrak: string | null;
  kontrak_ke: number | null;
  tingkat_sp: "SP-1" | "SP-2" | "SP-3" | null;
  pelanggaran: string | null;
  tanggal_terbit: string;
  tanggal_berakhir: string | null;
  catatan: string | null;
  lampiran_url: string | null;
  status: "Aktif" | "Segera Berakhir" | "Berakhir";
  created_at: string;
  updated_at: string;
}

export interface DbLegalSetting {
  id: number;
  kode: string;
  label: string;
  masa_berlaku_bulan: number;
  keterangan: string | null;
  updated_at: string;
}
