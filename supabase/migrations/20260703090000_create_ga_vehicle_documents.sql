-- Vehicle documents (KIR/STNK) with multi-file media and reminder settings.

ALTER TABLE public.ga_vehicles
  ADD COLUMN IF NOT EXISTS kir_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stnk_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pajak_required boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.ga_vehicle_document_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  kir_reminder_days integer NOT NULL DEFAULT 30 CHECK (kir_reminder_days BETWEEN 1 AND 365),
  stnk_reminder_days integer NOT NULL DEFAULT 30 CHECK (stnk_reminder_days BETWEEN 1 AND 365),
  pajak_reminder_days integer NOT NULL DEFAULT 30 CHECK (pajak_reminder_days BETWEEN 1 AND 365),
  kir_required_default boolean NOT NULL DEFAULT true,
  stnk_required_default boolean NOT NULL DEFAULT true,
  pajak_required_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ga_vehicle_document_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS ga_vehicle_document_settings_updated_at ON public.ga_vehicle_document_settings;
CREATE TRIGGER ga_vehicle_document_settings_updated_at
  BEFORE UPDATE ON public.ga_vehicle_document_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.ga_vehicle_documents (
  id bigserial PRIMARY KEY,
  vehicle_id integer NOT NULL REFERENCES public.ga_vehicles(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('KIR', 'STNK')),
  document_number text,
  issued_date date,
  expired_date date,
  pajak_expired_date date,
  notes text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_vehicle_documents_pajak_only_stnk CHECK (document_type = 'STNK' OR pajak_expired_date IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_ga_vehicle_documents_vehicle_id ON public.ga_vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ga_vehicle_documents_type ON public.ga_vehicle_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_ga_vehicle_documents_expired_date ON public.ga_vehicle_documents(expired_date);
CREATE INDEX IF NOT EXISTS idx_ga_vehicle_documents_pajak_expired_date ON public.ga_vehicle_documents(pajak_expired_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_vehicle_documents_current ON public.ga_vehicle_documents(vehicle_id, document_type) WHERE is_current;

CREATE OR REPLACE FUNCTION public.set_current_ga_vehicle_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE public.ga_vehicle_documents
    SET is_current = false, updated_at = now()
    WHERE vehicle_id = NEW.vehicle_id
      AND document_type = NEW.document_type
      AND id <> COALESCE(NEW.id, -1);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_current_ga_vehicle_document ON public.ga_vehicle_documents;
CREATE TRIGGER set_current_ga_vehicle_document
  BEFORE INSERT OR UPDATE OF vehicle_id, document_type, is_current ON public.ga_vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_current_ga_vehicle_document();

DROP TRIGGER IF EXISTS ga_vehicle_documents_updated_at ON public.ga_vehicle_documents;
CREATE TRIGGER ga_vehicle_documents_updated_at
  BEFORE UPDATE ON public.ga_vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.ga_vehicle_document_files (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES public.ga_vehicle_documents(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes integer,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ga_vehicle_document_files_document_id ON public.ga_vehicle_document_files(document_id);

ALTER TABLE public.ga_vehicle_document_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_vehicle_document_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_ga_vehicle_document_settings ON public.ga_vehicle_document_settings;
DROP POLICY IF EXISTS auth_update_ga_vehicle_document_settings ON public.ga_vehicle_document_settings;
DROP POLICY IF EXISTS auth_select_ga_vehicle_documents ON public.ga_vehicle_documents;
DROP POLICY IF EXISTS auth_insert_ga_vehicle_documents ON public.ga_vehicle_documents;
DROP POLICY IF EXISTS auth_update_ga_vehicle_documents ON public.ga_vehicle_documents;
DROP POLICY IF EXISTS auth_delete_ga_vehicle_documents ON public.ga_vehicle_documents;
DROP POLICY IF EXISTS auth_select_ga_vehicle_document_files ON public.ga_vehicle_document_files;
DROP POLICY IF EXISTS auth_insert_ga_vehicle_document_files ON public.ga_vehicle_document_files;
DROP POLICY IF EXISTS auth_update_ga_vehicle_document_files ON public.ga_vehicle_document_files;
DROP POLICY IF EXISTS auth_delete_ga_vehicle_document_files ON public.ga_vehicle_document_files;

CREATE POLICY auth_select_ga_vehicle_document_settings
  ON public.ga_vehicle_document_settings
  FOR SELECT
  TO authenticated
  USING (public.has_app_permission('data-mobil', true) OR public.has_app_permission('settings', true));

CREATE POLICY auth_update_ga_vehicle_document_settings
  ON public.ga_vehicle_document_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_app_permission('settings'))
  WITH CHECK (public.has_app_permission('settings'));

CREATE POLICY auth_select_ga_vehicle_documents
  ON public.ga_vehicle_documents
  FOR SELECT
  TO authenticated
  USING (public.has_app_permission('data-mobil', true));

CREATE POLICY auth_insert_ga_vehicle_documents
  ON public.ga_vehicle_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.status = 'Aktif'
        AND r.status = 'Aktif'
        AND (
          r.permissions ? 'all'
          OR r.permissions ? 'data-mobil'
          OR r.permissions ? 'data-mobil.input'
        )
    )
  );

CREATE POLICY auth_update_ga_vehicle_documents
  ON public.ga_vehicle_documents
  FOR UPDATE
  TO authenticated
  USING (public.has_app_permission('data-mobil'))
  WITH CHECK (public.has_app_permission('data-mobil'));

CREATE POLICY auth_delete_ga_vehicle_documents
  ON public.ga_vehicle_documents
  FOR DELETE
  TO authenticated
  USING (public.has_app_permission('data-mobil'));

CREATE POLICY auth_select_ga_vehicle_document_files
  ON public.ga_vehicle_document_files
  FOR SELECT
  TO authenticated
  USING (public.has_app_permission('data-mobil', true));

CREATE POLICY auth_insert_ga_vehicle_document_files
  ON public.ga_vehicle_document_files
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.status = 'Aktif'
        AND r.status = 'Aktif'
        AND (
          r.permissions ? 'all'
          OR r.permissions ? 'data-mobil'
          OR r.permissions ? 'data-mobil.input'
        )
    )
  );

CREATE POLICY auth_update_ga_vehicle_document_files
  ON public.ga_vehicle_document_files
  FOR UPDATE
  TO authenticated
  USING (public.has_app_permission('data-mobil'))
  WITH CHECK (public.has_app_permission('data-mobil'));

CREATE POLICY auth_delete_ga_vehicle_document_files
  ON public.ga_vehicle_document_files
  FOR DELETE
  TO authenticated
  USING (public.has_app_permission('data-mobil'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ga-vehicle-docs', 'ga-vehicle-docs', true, 5242880, NULL)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = NULL;

DROP POLICY IF EXISTS public_select_ga_vehicle_docs ON storage.objects;
DROP POLICY IF EXISTS auth_insert_ga_vehicle_docs ON storage.objects;
DROP POLICY IF EXISTS auth_update_ga_vehicle_docs ON storage.objects;
DROP POLICY IF EXISTS auth_delete_ga_vehicle_docs ON storage.objects;

CREATE POLICY public_select_ga_vehicle_docs
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'ga-vehicle-docs');

CREATE POLICY auth_insert_ga_vehicle_docs
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ga-vehicle-docs'
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.status = 'Aktif'
        AND r.status = 'Aktif'
        AND (
          r.permissions ? 'all'
          OR r.permissions ? 'data-mobil'
          OR r.permissions ? 'data-mobil.input'
        )
    )
  );

CREATE POLICY auth_update_ga_vehicle_docs
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'ga-vehicle-docs' AND public.has_app_permission('data-mobil'))
  WITH CHECK (bucket_id = 'ga-vehicle-docs' AND public.has_app_permission('data-mobil'));

CREATE POLICY auth_delete_ga_vehicle_docs
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'ga-vehicle-docs' AND public.has_app_permission('data-mobil'));
