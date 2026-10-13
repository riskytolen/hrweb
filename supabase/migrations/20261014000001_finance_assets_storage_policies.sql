-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Storage bucket finance-assets — logo perusahaan Finance
-- ───────────────────────────────────────────────────────────────
-- Bucket finance-assets sudah ada (publik) tetapi belum punya policy
-- RLS di storage.objects sehingga upload logo dari browser selalu
-- gagal dengan "new row violates row-level security policy".
--
-- Aturan:
-- - File dibatasi 2 MB dan hanya JPG/PNG/WebP (selaras validasi UI).
-- - Logo hanya boleh di folder logo/.
-- - SELECT: akun internal aktif dengan akses lihat Finance.
-- - INSERT/UPDATE/DELETE: hanya izin edit Finance (finance / finance.input).
--   Catatan: halaman Pengaturan hanya mengizinkan level "edit" menyimpan,
--   policy memakai has_app_permission('finance') agar konsisten dengan
--   policy tabel finance_company_settings.
-- ═══════════════════════════════════════════════════════════════

-- Bucket harus ada sebelum policy dipakai.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-assets',
  'finance-assets',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS auth_select_finance_assets ON storage.objects;
DROP POLICY IF EXISTS auth_insert_finance_assets ON storage.objects;
DROP POLICY IF EXISTS auth_update_finance_assets ON storage.objects;
DROP POLICY IF EXISTS auth_delete_finance_assets ON storage.objects;

CREATE POLICY auth_select_finance_assets
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'finance-assets'
    AND (storage.foldername(name))[1] = 'logo'
    AND public.has_app_permission('finance', true)
  );

CREATE POLICY auth_insert_finance_assets
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'finance-assets'
    AND (storage.foldername(name))[1] = 'logo'
    AND public.has_app_permission('finance')
  );

CREATE POLICY auth_update_finance_assets
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'finance-assets'
    AND (storage.foldername(name))[1] = 'logo'
    AND public.has_app_permission('finance')
  )
  WITH CHECK (
    bucket_id = 'finance-assets'
    AND (storage.foldername(name))[1] = 'logo'
    AND public.has_app_permission('finance')
  );

CREATE POLICY auth_delete_finance_assets
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'finance-assets'
    AND (storage.foldername(name))[1] = 'logo'
    AND public.has_app_permission('finance')
  );
