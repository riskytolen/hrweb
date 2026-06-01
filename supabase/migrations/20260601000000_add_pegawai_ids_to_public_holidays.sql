-- Tambah kolom pegawai_ids untuk hari libur yang berlaku spesifik per pegawai
ALTER TABLE public_holidays 
  ADD COLUMN IF NOT EXISTS pegawai_ids VARCHAR(50)[] DEFAULT NULL;

-- Update CHECK constraint: tambah opsi 'pegawai'
ALTER TABLE public_holidays DROP CONSTRAINT IF EXISTS chk_berlaku;
ALTER TABLE public_holidays ADD CONSTRAINT chk_berlaku 
  CHECK (berlaku_untuk IN ('semua', 'divisi', 'pegawai'));
