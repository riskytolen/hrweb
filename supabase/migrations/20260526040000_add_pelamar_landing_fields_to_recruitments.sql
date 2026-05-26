-- Tambah kolom untuk landing page form lamaran publik (hr_landing).
-- Semua nullable supaya kompatibel dengan data lama yang masuk via menu HR.

ALTER TABLE public.recruitments
  ADD COLUMN IF NOT EXISTS tanggal_lahir date,
  ADD COLUMN IF NOT EXISTS lama_kerja_terakhir varchar(100),
  ADD COLUMN IF NOT EXISTS daerah_kerja_terakhir varchar(255),
  ADD COLUMN IF NOT EXISTS status_pernikahan_pelamar varchar(20),
  ADD COLUMN IF NOT EXISTS bisa_nyupir boolean,
  ADD COLUMN IF NOT EXISTS bersedia_shift boolean,
  ADD COLUMN IF NOT EXISTS bersedia_jabodetabek boolean,
  ADD COLUMN IF NOT EXISTS sumber_lamaran varchar(20) DEFAULT 'manual';

COMMENT ON COLUMN public.recruitments.sumber_lamaran IS 'Asal entri: ''manual'' (admin input) atau ''landing'' (pelamar via form publik).';

-- Constraint untuk status pernikahan
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruitments_pernikahan_pelamar_check'
  ) THEN
    ALTER TABLE public.recruitments
      ADD CONSTRAINT recruitments_pernikahan_pelamar_check
      CHECK (status_pernikahan_pelamar IS NULL OR status_pernikahan_pelamar IN ('Berkeluarga','Belum Berkeluarga'));
  END IF;
END$$;

-- Constraint untuk sumber_lamaran
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruitments_sumber_lamaran_check'
  ) THEN
    ALTER TABLE public.recruitments
      ADD CONSTRAINT recruitments_sumber_lamaran_check
      CHECK (sumber_lamaran IN ('manual','landing'));
  END IF;
END$$;
