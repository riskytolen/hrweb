-- Migration: Add public_holidays table for national/company-wide holidays
-- Enables admin to set holidays that apply to ALL employees at once

CREATE TABLE IF NOT EXISTS public_holidays (
  id SERIAL PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  tanggal DATE NOT NULL,
  tanggal_selesai DATE,
  kategori VARCHAR(30) NOT NULL DEFAULT 'Nasional',
  catatan TEXT,
  berlaku_untuk VARCHAR(20) NOT NULL DEFAULT 'semua',
  divisi_ids INTEGER[] DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_kategori CHECK (kategori IN ('Nasional', 'Cuti Bersama', 'Spesial')),
  CONSTRAINT chk_berlaku CHECK (berlaku_untuk IN ('semua', 'divisi')),
  CONSTRAINT chk_tanggal CHECK (tanggal_selesai IS NULL OR tanggal_selesai >= tanggal)
);

-- Index for fast date-range lookups (used by autoGenerateLibur)
CREATE INDEX IF NOT EXISTS idx_public_holidays_tanggal ON public_holidays (tanggal);
CREATE INDEX IF NOT EXISTS idx_public_holidays_range ON public_holidays (tanggal, tanggal_selesai);

-- Row Level Security
ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can read
CREATE POLICY "public_holidays: authenticated can read"
  ON public_holidays FOR SELECT
  TO authenticated
  USING (true);

-- Policy: authenticated users can insert/update/delete
CREATE POLICY "public_holidays: authenticated can insert"
  ON public_holidays FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "public_holidays: authenticated can update"
  ON public_holidays FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "public_holidays: authenticated can delete"
  ON public_holidays FOR DELETE
  TO authenticated
  USING (true);
