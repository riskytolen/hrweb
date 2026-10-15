-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Pilihan TTD per invoice Finance
-- ───────────────────────────────────────────────────────────────
-- - Kolom use_system_signature menentukan apakah PDF invoice memakai
--   gambar TTD dari Pengaturan Finance (true) atau dikosongkan agar bisa
--   ditandatangani manual (false).
-- - Default true agar invoice lama berperilaku sama seperti sebelumnya.
-- - Tidak ada perubahan RLS: policy tabel finance_invoices sudah mencakup
--   seluruh kolom dan tetap berlaku.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS use_system_signature boolean NOT NULL DEFAULT true;
