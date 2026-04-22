-- Ubah division_locations: hapus kolom nama, tambah UNIQUE pada division_id
-- Satu divisi = satu titik absen
ALTER TABLE public.division_locations DROP COLUMN IF EXISTS nama;
ALTER TABLE public.division_locations ADD CONSTRAINT division_locations_division_id_unique UNIQUE (division_id);
