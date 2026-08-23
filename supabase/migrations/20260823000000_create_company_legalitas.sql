-- Legalitas Perusahaan: archive softcopy perusahaan (sertifikasi, akta, dll).
-- - kategori dinamis
-- - dokumen + versi + multi-file
-- - private bucket, signed URL
-- - RLS: view = read, input = +insert document/version/files, edit = full CRUD
-- - archive (soft delete) via status

-- ──────────────────────────────────────────
-- 1. Categories
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_legal_categories (
  id bigserial PRIMARY KEY,
  nama text NOT NULL,
  deskripsi text,
  status text NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_company_legal_categories_nama UNIQUE (nama)
);

CREATE INDEX IF NOT EXISTS idx_company_legal_categories_status ON public.company_legal_categories(status);
CREATE INDEX IF NOT EXISTS idx_company_legal_categories_sort ON public.company_legal_categories(sort_order);

DROP TRIGGER IF EXISTS company_legal_categories_updated_at ON public.company_legal_categories;
CREATE TRIGGER company_legal_categories_updated_at
  BEFORE UPDATE ON public.company_legal_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────
-- 2. Documents (header)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_legal_documents (
  id bigserial PRIMARY KEY,
  category_id bigint NOT NULL REFERENCES public.company_legal_categories(id) ON DELETE RESTRICT,
  judul text NOT NULL CHECK (char_length(judul) BETWEEN 1 AND 300),
  catatan text,
  status text NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Diarsipkan')),
  current_version_no integer NOT NULL DEFAULT 1 CHECK (current_version_no >= 1),
  file_count integer NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_legal_documents_category ON public.company_legal_documents(category_id);
CREATE INDEX IF NOT EXISTS idx_company_legal_documents_status ON public.company_legal_documents(status);
CREATE INDEX IF NOT EXISTS idx_company_legal_documents_created ON public.company_legal_documents(created_at DESC);

DROP TRIGGER IF EXISTS company_legal_documents_updated_at ON public.company_legal_documents;
CREATE TRIGGER company_legal_documents_updated_at
  BEFORE UPDATE ON public.company_legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────
-- 3. Versions
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_legal_document_versions (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES public.company_legal_documents(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no >= 1),
  catatan text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_legal_document_versions_doc_version UNIQUE (document_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_company_legal_document_versions_document ON public.company_legal_document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_company_legal_document_versions_created ON public.company_legal_document_versions(created_at DESC);

DROP TRIGGER IF EXISTS company_legal_document_versions_updated_at ON public.company_legal_document_versions;
CREATE TRIGGER company_legal_document_versions_updated_at
  BEFORE UPDATE ON public.company_legal_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────
-- 4. Files
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_legal_document_files (
  id bigserial PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES public.company_legal_document_versions(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 300),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp')),
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_legal_document_files_path UNIQUE (file_path)
);

CREATE INDEX IF NOT EXISTS idx_company_legal_document_files_version ON public.company_legal_document_files(version_id);
CREATE INDEX IF NOT EXISTS idx_company_legal_document_files_path ON public.company_legal_document_files(file_path);

-- ──────────────────────────────────────────
-- 5. Seed categories (idempotent)
-- ──────────────────────────────────────────
INSERT INTO public.company_legal_categories (nama, deskripsi, sort_order, status)
VALUES
  ('Sertifikasi', 'Sertifikat perusahaan', 1, 'Aktif'),
  ('Akta', 'Akta pendirian & perubahan', 2, 'Aktif'),
  ('Perizinan', 'Izin usaha, operasional, dll', 3, 'Aktif'),
  ('Perpajakan', 'NPWP, PKP, dan dokumen pajak', 4, 'Aktif'),
  ('Kontrak', 'Kontrak kerja sama & perjanjian', 5, 'Aktif'),
  ('Lainnya', 'Dokumen lain', 99, 'Aktif')
ON CONFLICT (nama) DO NOTHING;

-- ──────────────────────────────────────────
-- 6. RLS
-- ──────────────────────────────────────────
ALTER TABLE public.company_legal_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_legal_document_files ENABLE ROW LEVEL SECURITY;

-- Categories: select = view/input/edit ; write = edit only
DROP POLICY IF EXISTS auth_select_company_legal_categories ON public.company_legal_categories;
DROP POLICY IF EXISTS auth_insert_company_legal_categories ON public.company_legal_categories;
DROP POLICY IF EXISTS auth_update_company_legal_categories ON public.company_legal_categories;
DROP POLICY IF EXISTS auth_delete_company_legal_categories ON public.company_legal_categories;

CREATE POLICY auth_select_company_legal_categories
  ON public.company_legal_categories FOR SELECT TO authenticated
  USING (public.has_app_permission('legalitas', true));

CREATE POLICY auth_insert_company_legal_categories
  ON public.company_legal_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('legalitas'));

CREATE POLICY auth_update_company_legal_categories
  ON public.company_legal_categories FOR UPDATE TO authenticated
  USING (public.has_app_permission('legalitas'))
  WITH CHECK (public.has_app_permission('legalitas'));

CREATE POLICY auth_delete_company_legal_categories
  ON public.company_legal_categories FOR DELETE TO authenticated
  USING (public.has_app_permission('legalitas'));

-- Documents: select = view ; insert = input ; update/delete = edit
DROP POLICY IF EXISTS auth_select_company_legal_documents ON public.company_legal_documents;
DROP POLICY IF EXISTS auth_insert_company_legal_documents ON public.company_legal_documents;
DROP POLICY IF EXISTS auth_update_company_legal_documents ON public.company_legal_documents;
DROP POLICY IF EXISTS auth_delete_company_legal_documents ON public.company_legal_documents;

CREATE POLICY auth_select_company_legal_documents
  ON public.company_legal_documents FOR SELECT TO authenticated
  USING (public.has_app_permission('legalitas', true));

CREATE POLICY auth_insert_company_legal_documents
  ON public.company_legal_documents FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'legalitas' OR r.permissions ? 'legalitas.input')
    )
  );

CREATE POLICY auth_update_company_legal_documents
  ON public.company_legal_documents FOR UPDATE TO authenticated
  USING (public.has_app_permission('legalitas'))
  WITH CHECK (public.has_app_permission('legalitas'));

CREATE POLICY auth_delete_company_legal_documents
  ON public.company_legal_documents FOR DELETE TO authenticated
  USING (public.has_app_permission('legalitas'));

-- Versions
DROP POLICY IF EXISTS auth_select_company_legal_versions ON public.company_legal_document_versions;
DROP POLICY IF EXISTS auth_insert_company_legal_versions ON public.company_legal_document_versions;
DROP POLICY IF EXISTS auth_update_company_legal_versions ON public.company_legal_document_versions;
DROP POLICY IF EXISTS auth_delete_company_legal_versions ON public.company_legal_document_versions;

CREATE POLICY auth_select_company_legal_versions
  ON public.company_legal_document_versions FOR SELECT TO authenticated
  USING (public.has_app_permission('legalitas', true));

CREATE POLICY auth_insert_company_legal_versions
  ON public.company_legal_document_versions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'legalitas' OR r.permissions ? 'legalitas.input')
    )
  );

CREATE POLICY auth_update_company_legal_versions
  ON public.company_legal_document_versions FOR UPDATE TO authenticated
  USING (public.has_app_permission('legalitas'))
  WITH CHECK (public.has_app_permission('legalitas'));

CREATE POLICY auth_delete_company_legal_versions
  ON public.company_legal_document_versions FOR DELETE TO authenticated
  USING (public.has_app_permission('legalitas'));

-- Files
DROP POLICY IF EXISTS auth_select_company_legal_files ON public.company_legal_document_files;
DROP POLICY IF EXISTS auth_insert_company_legal_files ON public.company_legal_document_files;
DROP POLICY IF EXISTS auth_update_company_legal_files ON public.company_legal_document_files;
DROP POLICY IF EXISTS auth_delete_company_legal_files ON public.company_legal_document_files;

CREATE POLICY auth_select_company_legal_files
  ON public.company_legal_document_files FOR SELECT TO authenticated
  USING (public.has_app_permission('legalitas', true));

CREATE POLICY auth_insert_company_legal_files
  ON public.company_legal_document_files FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'legalitas' OR r.permissions ? 'legalitas.input')
    )
  );

CREATE POLICY auth_update_company_legal_files
  ON public.company_legal_document_files FOR UPDATE TO authenticated
  USING (public.has_app_permission('legalitas'))
  WITH CHECK (public.has_app_permission('legalitas'));

CREATE POLICY auth_delete_company_legal_files
  ON public.company_legal_document_files FOR DELETE TO authenticated
  USING (public.has_app_permission('legalitas'));

-- ──────────────────────────────────────────
-- 7. Storage bucket (private)
-- ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-legal-documents',
  'company-legal-documents',
  false,
  10485760,
  ARRAY['application/pdf','image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/jpg','image/png','image/webp'];

DROP POLICY IF EXISTS auth_select_company_legal_docs ON storage.objects;
DROP POLICY IF EXISTS auth_insert_company_legal_docs ON storage.objects;
DROP POLICY IF EXISTS auth_update_company_legal_docs ON storage.objects;
DROP POLICY IF EXISTS auth_delete_company_legal_docs ON storage.objects;

CREATE POLICY auth_select_company_legal_docs
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-legal-documents' AND public.has_app_permission('legalitas', true));

CREATE POLICY auth_insert_company_legal_docs
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-legal-documents'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'legalitas' OR r.permissions ? 'legalitas.input')
    )
  );

CREATE POLICY auth_update_company_legal_docs
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-legal-documents' AND public.has_app_permission('legalitas'))
  WITH CHECK (bucket_id = 'company-legal-documents' AND public.has_app_permission('legalitas'));

CREATE POLICY auth_delete_company_legal_docs
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-legal-documents' AND public.has_app_permission('legalitas'));

-- ──────────────────────────────────────────
-- 8. Helper RPCs (optional atomic helpers)
-- ──────────────────────────────────────────
-- Create document + first version atomically (caller must still upload files and insert file rows)
CREATE OR REPLACE FUNCTION public.create_company_legal_document(
  p_category_id bigint,
  p_judul text,
  p_catatan text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc_id bigint;
  v_version_id bigint;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'legalitas' OR r.permissions ? 'legalitas.input')
    )
  ) THEN
    RAISE EXCEPTION 'Tidak memiliki izin legalitas';
  END IF;

  IF char_length(btrim(p_judul)) = 0 THEN RAISE EXCEPTION 'Judul wajib diisi'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.company_legal_categories WHERE id = p_category_id AND status='Aktif') THEN
    RAISE EXCEPTION 'Kategori tidak valid';
  END IF;

  INSERT INTO public.company_legal_documents (category_id, judul, catatan, created_by, updated_by)
  VALUES (p_category_id, btrim(p_judul), NULLIF(btrim(p_catatan), ''), auth.uid(), auth.uid())
  RETURNING id INTO v_doc_id;

  INSERT INTO public.company_legal_document_versions (document_id, version_no, created_by)
  VALUES (v_doc_id, 1, auth.uid())
  RETURNING id INTO v_version_id;

  RETURN v_doc_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_legal_document(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_company_legal_document(bigint, text, text) TO authenticated;

-- Create new version for existing document
CREATE OR REPLACE FUNCTION public.create_company_legal_document_version(
  p_document_id bigint,
  p_catatan text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_no integer;
  v_version_id bigint;
  v_status text;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'legalitas' OR r.permissions ? 'legalitas.input')
    )
  ) THEN
    RAISE EXCEPTION 'Tidak memiliki izin legalitas';
  END IF;

  SELECT status INTO v_status FROM public.company_legal_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dokumen tidak ditemukan'; END IF;
  IF v_status = 'Diarsipkan' THEN RAISE EXCEPTION 'Dokumen sudah diarsipkan'; END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_no
  FROM public.company_legal_document_versions WHERE document_id = p_document_id;

  INSERT INTO public.company_legal_document_versions (document_id, version_no, catatan, created_by)
  VALUES (p_document_id, v_next_no, NULLIF(btrim(p_catatan), ''), auth.uid())
  RETURNING id INTO v_version_id;

  UPDATE public.company_legal_documents
  SET current_version_no = v_next_no, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_document_id;

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_legal_document_version(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_company_legal_document_version(bigint, text) TO authenticated;

-- ──────────────────────────────────────────
-- 9. Grant legalitas to Admin HR and General Affair
-- ──────────────────────────────────────────
UPDATE public.roles
SET permissions = (
  CASE WHEN NOT (permissions ? 'legalitas') THEN permissions || to_jsonb(ARRAY['legalitas']) ELSE permissions END
),
updated_at = now()
WHERE nama IN ('Admin HR', 'General Affair')
  AND status = 'Aktif';
