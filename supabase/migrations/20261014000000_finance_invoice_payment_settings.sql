-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Finance invoice fisik — info rekening & penandatangan
-- ───────────────────────────────────────────────────────────────
-- Menambah kolom nullable di finance_company_settings untuk kop
-- invoice fisik (satu rekening utama + identitas penandatangan).
-- Semua kolom nullable agar baris settings lama tetap valid.
-- Tidak ada perubahan RLS: kebijakan existing pada tabel ini tetap berlaku.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.finance_company_settings
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS signer_city TEXT,
  ADD COLUMN IF NOT EXISTS signer_name TEXT,
  ADD COLUMN IF NOT EXISTS signer_title TEXT;
