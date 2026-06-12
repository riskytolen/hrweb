-- Harden recruitment data and document access.
-- Keep bucket public for existing public URLs, but restrict listing/mutation by RLS
-- and align upload rules with the current apps: JPG/PNG, max 2MB.

CREATE OR REPLACE FUNCTION public.has_app_permission(
  required_permission text,
  allow_view boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id = up.role_id
    WHERE up.id = auth.uid()
      AND up.status = 'Aktif'
      AND r.status = 'Aktif'
      AND (
        r.permissions ? 'all'
        OR r.permissions ? required_permission
        OR (allow_view AND (r.permissions ? (required_permission || '.view')))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_app_permission(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_app_permission(text, boolean) TO authenticated;

UPDATE storage.buckets
SET
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png']::text[]
WHERE id = 'recruitment-docs';

ALTER TABLE public.recruitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_recruitments ON public.recruitments;
DROP POLICY IF EXISTS auth_select_recruitments ON public.recruitments;
DROP POLICY IF EXISTS auth_insert_recruitments ON public.recruitments;
DROP POLICY IF EXISTS auth_update_recruitments ON public.recruitments;
DROP POLICY IF EXISTS auth_delete_recruitments ON public.recruitments;

CREATE POLICY auth_select_recruitments
ON public.recruitments
FOR SELECT
TO authenticated
USING (public.has_app_permission('recruitment', true));

CREATE POLICY auth_insert_recruitments
ON public.recruitments
FOR INSERT
TO authenticated
WITH CHECK (public.has_app_permission('recruitment'));

CREATE POLICY auth_update_recruitments
ON public.recruitments
FOR UPDATE
TO authenticated
USING (public.has_app_permission('recruitment'))
WITH CHECK (public.has_app_permission('recruitment'));

CREATE POLICY auth_delete_recruitments
ON public.recruitments
FOR DELETE
TO authenticated
USING (public.has_app_permission('recruitment'));

DROP POLICY IF EXISTS auth_select_recruitment_docs ON storage.objects;
DROP POLICY IF EXISTS auth_insert_recruitment_docs ON storage.objects;
DROP POLICY IF EXISTS auth_update_recruitment_docs ON storage.objects;
DROP POLICY IF EXISTS auth_delete_recruitment_docs ON storage.objects;

CREATE POLICY auth_select_recruitment_docs
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'recruitment-docs'
  AND public.has_app_permission('recruitment', true)
);

CREATE POLICY auth_insert_recruitment_docs
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'recruitment-docs'
  AND public.has_app_permission('recruitment')
);

CREATE POLICY auth_update_recruitment_docs
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'recruitment-docs'
  AND public.has_app_permission('recruitment')
)
WITH CHECK (
  bucket_id = 'recruitment-docs'
  AND public.has_app_permission('recruitment')
);

CREATE POLICY auth_delete_recruitment_docs
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'recruitment-docs'
  AND public.has_app_permission('recruitment')
);
