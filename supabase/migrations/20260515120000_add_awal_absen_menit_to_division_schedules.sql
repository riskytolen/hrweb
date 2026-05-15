-- Tambah kolom awal_absen_menit ke division_schedules.
-- Pegawai baru bisa absen mulai (jam_masuk - awal_absen_menit).
-- Default 0 = fitur OFF (backward compatible).
-- Max 720 (12 jam) sebagai sanity bound.

ALTER TABLE public.division_schedules
ADD COLUMN awal_absen_menit INT NOT NULL DEFAULT 0
  CHECK (awal_absen_menit >= 0 AND awal_absen_menit <= 720);

COMMENT ON COLUMN public.division_schedules.awal_absen_menit IS
  'Berapa menit sebelum jam_masuk pegawai sudah boleh absen. 0 = tidak ada batasan.';
