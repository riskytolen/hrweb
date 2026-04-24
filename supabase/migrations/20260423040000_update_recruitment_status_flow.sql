ALTER TABLE public.recruitments DROP CONSTRAINT IF EXISTS recruitments_status_check;
ALTER TABLE public.recruitments ADD CONSTRAINT recruitments_status_check CHECK (
  status::text = ANY (ARRAY['Lamaran Masuk', 'Terpilih', 'Training', 'Diterima', 'Ditolak']::text[])
);
ALTER TABLE public.recruitments ALTER COLUMN status SET DEFAULT 'Lamaran Masuk'::varchar;
ALTER TABLE public.recruitments ADD COLUMN IF NOT EXISTS tanggal_training_mulai date;
ALTER TABLE public.recruitments ADD COLUMN IF NOT EXISTS tanggal_training_selesai date;
