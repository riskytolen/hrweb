import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Database Types ───

/** Inclusive date range for a historical non-active period (used by `pegawai.non_active_periods`). */
export interface NonActivePeriod {
  from: string;
  to: string;
}

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
  awal_absen_menit: number;
  /** Biaya lembur per jam (Rp). 0 = divisi tidak menerapkan lembur. */
  overtime_rate_per_hour: number;
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
  foto_skck: string | null;
  no_rekening: string | null;
  bank: string | null;
  nama_rekening: string | null;
  kartu_keluarga: string | null;
  tanggal_mulai_pkwt: string | null;
  tanggal_berakhir_pkwt: string | null;
  /** Tanggal terakhir efektif kerja saat status diubah ke "Tidak Aktif". NULL jika masih aktif. */
  tanggal_keluar: string | null;
  /**
   * Historical non-active periods (inclusive date ranges) from past termination/rehire cycles.
   * The CURRENT non-active period (if any) is tracked by `tanggal_keluar` and NOT mirrored here.
   * Format: `[{ from: "YYYY-MM-DD", to: "YYYY-MM-DD" }, ...]`
   */
  non_active_periods: NonActivePeriod[];
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
  extra_job_keterangan: string | null;
  uang_makan: number;
  insentif: number;
  insentif_keterangan: string | null;
  tunjangan_jabatan: number;
  transport: number;
  tunjangan_lain: number;
  tambahan_lain: number;
  /** Total biaya lembur dari overtime_requests Disetujui dalam periode. Auto-fill saat generate. */
  lembur: number;
  total_pendapatan: number;
  // Potongan
  koperasi: number;
  pinjaman_perusahaan: number;
  pinjaman_perusahaan_keterangan: string | null;
  potongan_absen: number;
  potongan_lain: number;
  potongan_lain_keterangan: string | null;
  jht: number;
  bpjs_kesehatan: number;
  total_potongan: number;
  // Netto
  netto: number;
  status: "Worksheet" | "Draft" | "Final";
  catatan: string | null;
  created_at: string;
  updated_at: string;
  /** Kapan worksheet terakhir di-recompute. NULL untuk slip Draft/Final. */
  last_recomputed_at: string | null;
  /** Snapshot auto-computed nilai gapok saat worksheet di-compute. Untuk audit. */
  source_gaji_pokok: number | null;
  source_titik: number | null;
  source_lembur: number | null;
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

/**
 * Nama titik pengantaran (delivery_zones).
 *
 * Terpisah penuh dari `divisions`. Divisi dipakai untuk konteks absen,
 * sedangkan delivery_zones hanya dipakai di Rekap Titik & Harga Titik
 * (lalu mengalir ke modul Penggajian).
 */
export interface DbDeliveryZone {
  id: number;
  nama: string;
  deskripsi: string | null;
  color: string;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbPointRate {
  id: number;
  zone_id: number;
  role: "Driver" | "Helper";
  rate_per_point: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
  // joined
  delivery_zones?: DbDeliveryZone;
}

export interface DbDeliveryPoint {
  id: number;
  employee_id: string | null;
  employee_nama: string | null;
  zone_id: number;
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
  delivery_zones?: DbDeliveryZone;
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
  ktp_url: string | null;
  pas_foto_url: string | null;
  sim_url: string | null;
  status: "Lamaran Masuk" | "Terpilih" | "Training" | "Diterima" | "Ditolak";
  catatan: string | null;
  tanggal_training_mulai: string | null;
  tanggal_training_selesai: string | null;
  /** Tanggal lahir pelamar (form landing public). NULL untuk entry manual lama. */
  tanggal_lahir: string | null;
  /** Lama bekerja di perusahaan sebelumnya (text bebas, mis. "2 tahun"). */
  lama_kerja_terakhir: string | null;
  daerah_kerja_terakhir: string | null;
  /** "Berkeluarga" | "Belum Berkeluarga" — diisi via form landing. */
  status_pernikahan_pelamar: string | null;
  bisa_nyupir: boolean | null;
  bersedia_shift: boolean | null;
  bersedia_jabodetabek: boolean | null;
  /** Asal entri: "manual" (admin input) atau "landing" (form publik). */
  sumber_lamaran: "manual" | "landing";
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
  /** Realisasi jam pulang. NULL jika belum check-out atau divisi tidak menerapkan jam pulang. */
  jam_pulang: string | null;
  /** Snapshot jadwal jam pulang divisi saat check-in. NULL jika divisi tidak punya jam pulang. */
  schedule_jam_pulang: string | null;
  /** Tepat: pulang >= jadwal; Cepat: pulang sebelum jadwal; Lupa Pulang: belum absen pulang sampai akhir hari. */
  status_pulang: "Tepat" | "Cepat" | "Lupa Pulang" | null;
  /** Total durasi lembur (menit) yang sudah disetujui untuk hari ini. */
  durasi_lembur_menit: number;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
  divisions?: DbDivision;
  attendance_locations?: DbAttendanceLocation;
}

export interface DbOvertimeRequest {
  id: number;
  employee_id: string;
  tanggal: string;
  jam_mulai: string;
  jam_selesai: string;
  alasan: string | null;
  status: "Menunggu" | "Disetujui" | "Ditolak";
  catatan_approval: string | null;
  approved_at: string | null;
  /** FK ke auth.users untuk lookup. NULL kalau user dihapus. */
  approved_by_user_id: string | null;
  /** Snapshot nama approver saat approve. */
  approved_by_nama: string | null;
  /** Snapshot rate dari division_schedules saat approve. 0 sebelum approve. */
  rate_per_jam: number;
  /** Auto-computed dari jam_selesai - jam_mulai dalam menit. */
  durasi_menit: number;
  /** Auto-computed: durasi_jam * rate_per_jam. */
  total_lembur: number;
  created_at: string;
  updated_at: string;
  // joined
  pegawai?: DbPegawai;
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
  /** FK ke auth.users untuk lookup. NULL kalau user dihapus. */
  approved_by_user_id: string | null;
  /** Snapshot nama approver saat approve. */
  approved_by_nama: string | null;
  /** Sumber pengajuan: pegawai (mobile self-service) atau admin (manual input dari web). */
  created_by: "pegawai" | "admin";
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
  platform: string | null;
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
  kategori: "PKWT" | "SP" | "PERNYATAAN";
  nomor_kontrak: string | null;
  kontrak_ke: number | null;
  tingkat_sp: "SP-1" | "SP-2" | "SP-3" | null;
  pelanggaran: string | null;
  tanggal_terbit: string;
  tanggal_berakhir: string | null;
  catatan: string | null;
  lampiran_url: string | null;
  status: "Aktif" | "Segera Berakhir" | "Berakhir";
  status_approval: "Menunggu" | "Disetujui" | "Ditolak";
  catatan_approval: string | null;
  /** Legacy: nama approver dalam bentuk text bebas. Pakai approved_by_nama untuk yang baru. */
  approved_by: string | null;
  approved_at: string | null;
  /** FK ke auth.users untuk lookup. NULL kalau user dihapus. */
  approved_by_user_id: string | null;
  /** Snapshot nama approver saat approve (struktur baru, lebih akurat). */
  approved_by_nama: string | null;
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

export interface DbAuditLog {
  id: number;
  user_id: string | null;
  user_email: string | null;
  user_nama: string | null;
  user_role: string | null;
  /** create | update | delete | approve | reject | generate | manual_input | status_change */
  action: string;
  /** Nama tabel target: pegawai, leave_requests, overtime_requests, attendance_records, dll. */
  entity_type: string;
  entity_id: string | null;
  /** Human-readable label untuk display (mis. nama pegawai, periode payroll). */
  entity_label: string | null;
  /** Snapshot row sebelum perubahan (NULL untuk create). */
  old_data: Record<string, unknown> | null;
  /** Snapshot row sesudah perubahan (NULL untuk delete). */
  new_data: Record<string, unknown> | null;
  /** Konteks bisnis tambahan: catatan approval, alasan, periode, dll. */
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─── Petty Cash System ───

export interface DbPettyCashSettings {
  id: number;
  initial_balance: number;
  low_balance_threshold: number;
  custodian_id: string | null;
  catatan: string | null;
  updated_at: string;
  updated_by: string | null;
  // joined
  custodian?: DbPegawai;
}

export interface DbPettyCashCategory {
  id: number;
  nama: string;
  icon: string | null;
  color: string;
  type: "income" | "expense" | "both";
  urutan: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
}

export interface DbPettyCashBagian {
  id: number;
  nama: string;
  urutan: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
}

export interface DbPettyCashUnit {
  id: number;
  nama: string;
  urutan: number;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
}

export interface DbPettyCashTransaction {
  id: number;
  tanggal: string;
  category_id: number;
  bagian_id: number;
  unit: string | null;
  keterangan: string;
  cash_in: number;
  cash_out: number;
  receipt_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joined
  category?: DbPettyCashCategory;
  bagian?: DbPettyCashBagian;
}

// ─── GA Vehicles (Data Mobil) ───

export interface DbGaVehicleVendor {
  id: number;
  nama: string;
  deskripsi: string | null;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbGaVehicleDivision {
  id: number;
  nama: string;
  deskripsi: string | null;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbGaVehicle {
  id: number;
  unit: string;
  jenis: string;
  divisi: string | null;
  vendor: string | null;
  vendor_id: number | null;
  vehicle_division_id: number | null;
  lokasi_administrasi: string | null;
  no_rangka: string | null;
  nomer_mesin: string | null;
  volume: string | null;
  tonase: string | null;
  suhu: string | null;
  kir_required: boolean;
  stnk_required: boolean;
  pajak_required: boolean;
  status: "Aktif" | "Tidak Aktif";
  created_at: string;
  updated_at: string;
}

export interface DbGaVehicleDocumentSetting {
  id: number;
  kir_reminder_days: number;
  stnk_reminder_days: number;
  pajak_reminder_days: number;
  kir_required_default: boolean;
  stnk_required_default: boolean;
  pajak_required_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbGaVehicleDocumentFile {
  id: number;
  document_id: number;
  file_url: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  sort_order: number;
  created_at: string;
}

export interface DbGaVehicleDocument {
  id: number;
  vehicle_id: number;
  document_type: "KIR" | "STNK";
  document_number: string | null;
  issued_date: string | null;
  expired_date: string | null;
  pajak_expired_date: string | null;
  notes: string | null;
  is_current: boolean;
  created_at: string;
  updated_at: string;
  // joined
  files?: DbGaVehicleDocumentFile[];
}
