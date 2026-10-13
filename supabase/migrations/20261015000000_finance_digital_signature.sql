-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: TTD digital Finance — bucket privat + kolom path
-- ───────────────────────────────────────────────────────────────
-- - Bucket privat `finance-signatures` khusus PNG transparan 2 MB.
--   Privat mengikuti keputusan keamanan: TTD tidak boleh punya URL
--   publik permanen seperti logo di bucket `finance-assets`.
-- - Database hanya menyimpan `signer_signature_path`; signed URL dibuat
--   sesaat (preview pengaturan & render PDF), tidak disimpan.
-- - SELECT: akun internal aktif dengan akses lihat Finance.
-- - INSERT/UPDATE/DELETE: hanya izin edit Finance.
-- ═══════════════════════════════════════════════════════════════

-- Bucket privat harus ada sebelum policy dipakai.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-signatures',
  'finance-signatures',
  false,
  2097152,
  ARRAY['image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/png'];

DROP POLICY IF EXISTS auth_select_finance_signatures ON storage.objects;
DROP POLICY IF EXISTS auth_insert_finance_signatures ON storage.objects;
DROP POLICY IF EXISTS auth_update_finance_signatures ON storage.objects;
DROP POLICY IF EXISTS auth_delete_finance_signatures ON storage.objects;

CREATE POLICY auth_select_finance_signatures
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'finance-signatures'
    AND public.has_app_permission('finance', true)
  );

CREATE POLICY auth_insert_finance_signatures
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'finance-signatures'
    AND public.has_app_permission('finance')
  );

CREATE POLICY auth_update_finance_signatures
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'finance-signatures'
    AND public.has_app_permission('finance')
  )
  WITH CHECK (
    bucket_id = 'finance-signatures'
    AND public.has_app_permission('finance')
  );

CREATE POLICY auth_delete_finance_signatures
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'finance-signatures'
    AND public.has_app_permission('finance')
  );

-- Path file TTD pada baris singleton pengaturan (id = 1).
ALTER TABLE public.finance_company_settings
  ADD COLUMN IF NOT EXISTS signer_signature_path TEXT;
