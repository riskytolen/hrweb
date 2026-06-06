-- Tambah kolom dokumen pelamar (KTP, Pas Foto, SIM) di recruitments.
-- Storage bucket recruitment-docs sudah support image/* dan application/pdf
-- (sudah diupdate di luar migration ini), jadi tidak perlu diubah lagi.

ALTER TABLE public.recruitments
  ADD COLUMN IF NOT EXISTS ktp_url text,
  ADD COLUMN IF NOT EXISTS pas_foto_url text,
  ADD COLUMN IF NOT EXISTS sim_url text;
