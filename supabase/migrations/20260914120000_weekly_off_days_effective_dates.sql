-- Migration: weekly off-days menjadi tanggal-efektif + repair regresi Dendi (Kamis -> Sabtu)
--
-- Latar: perubahan jadwal libur mingguan sebelumnya DELETE row lama, sementara
-- auto-generator menilai ulang tanggal historis dengan jadwal TERBARU. Akibatnya
-- 15 Kamis historis Dendi Saputra (ID99334) yang seharusnya Libur berubah menjadi
-- Alpha/Izin otomatis saat riwayat dibuka pada 2026-09-14.
--
-- Isi migration:
-- 1. Tambah effective_from/effective_to di employee_off_days (histori, bukan hapus).
-- 2. Backfill baris aktif ke tanggal pembuatan (dibatasi MIN_DATE 2026-05-08).
-- 3. Ganti UNIQUE (employee_id, day_of_week) menjadi partial unique untuk baris aktif
--    (effective_to IS NULL) agar histori boleh menyimpan hari yang sama 2x.
-- 4. Rekonstruksi histori Dendi: Kamis 2026-05-08..2026-09-13, Sabtu mulai 2026-09-14.
-- 5. Repair 15 record Kamis yang salah (hanya auto, tidak pernah sentuh manual/Hadir).

ALTER TABLE public.employee_off_days
  ADD COLUMN IF NOT EXISTS effective_from DATE NOT NULL DEFAULT DATE '2026-05-08',
  ADD COLUMN IF NOT EXISTS effective_to DATE NULL;

-- Backfill: jadwal aktif dianggap berlaku sejak dibuat (minimal MIN_DATE sistem).
UPDATE public.employee_off_days
SET effective_from = GREATEST(DATE '2026-05-08', created_at::date)
WHERE created_at::date > DATE '2026-05-08'
  AND effective_from = DATE '2026-05-08';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_employee_off_days_effective_range') THEN
    ALTER TABLE public.employee_off_days
      ADD CONSTRAINT chk_employee_off_days_effective_range
      CHECK (effective_to IS NULL OR effective_to >= effective_from);
  END IF;
END $$;

-- Ganti unique penuh dengan partial unique baris aktif agar histori tersimpan.
ALTER TABLE public.employee_off_days
  DROP CONSTRAINT IF EXISTS employee_off_days_employee_id_day_of_week_key;
DROP INDEX IF EXISTS public.employee_off_days_employee_id_day_of_week_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_employee_off_days_active
  ON public.employee_off_days (employee_id, day_of_week)
  WHERE effective_to IS NULL;

-- Histori Dendi: Kamis berlaku 2026-05-08 s/d 2026-09-13 (sebelum pindah ke Sabtu).
INSERT INTO public.employee_off_days (employee_id, day_of_week, effective_from, effective_to)
SELECT 'ID99334', 4, DATE '2026-05-08', DATE '2026-09-13'
WHERE NOT EXISTS (
  SELECT 1 FROM public.employee_off_days
  WHERE employee_id = 'ID99334'
    AND day_of_week = 4
    AND effective_from <= DATE '2026-09-13'
    AND (effective_to IS NULL OR effective_to >= DATE '2026-05-08')
);

-- Sabtu Dendi berlaku mulai tanggal perubahan (2026-09-14), bukan surut ke belakang.
UPDATE public.employee_off_days
SET effective_from = DATE '2026-09-14'
WHERE employee_id = 'ID99334'
  AND day_of_week = 6
  AND effective_to IS NULL
  AND effective_from < DATE '2026-09-14';

-- Repair: Kamis historis yang terlanjur jadi Alpha/Izin/Sakit/Cuti otomatis -> Libur.
-- Aman: hanya pegawai+rentang+hari Kamis + is_manual=false + catatan otomatis.
-- Tidak menyentuh Hadir/Terlambat/Libur/manual (termasuk Hadir 2026-09-10).
UPDATE public.attendance_records
SET status = 'Libur',
    denda = 0,
    durasi_telat = 0,
    catatan = 'Hari libur',
    jam_masuk = '00:00',
    schedule_jam_masuk = '00:00',
    toleransi_menit = 0,
    updated_at = NOW()
WHERE employee_id = 'ID99334'
  AND tanggal BETWEEN DATE '2026-05-08' AND DATE '2026-09-13'
  AND EXTRACT(DOW FROM tanggal) = 4
  AND is_manual = false
  AND (
    (status = 'Alpha' AND catatan LIKE 'Alpha otomatis%')
    OR (status IN ('Izin', 'Sakit', 'Cuti') AND catatan LIKE '%otomatis%')
  );
