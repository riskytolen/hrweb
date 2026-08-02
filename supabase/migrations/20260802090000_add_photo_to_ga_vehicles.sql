-- Add unit photos for General Affair Data Mobil.

ALTER TABLE public.ga_vehicles
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS photo_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ga-vehicle-photos',
  'ga-vehicle-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[];

DROP POLICY IF EXISTS public_select_ga_vehicle_photos ON storage.objects;
DROP POLICY IF EXISTS auth_insert_ga_vehicle_photos ON storage.objects;
DROP POLICY IF EXISTS auth_update_ga_vehicle_photos ON storage.objects;
DROP POLICY IF EXISTS auth_delete_ga_vehicle_photos ON storage.objects;

CREATE POLICY public_select_ga_vehicle_photos
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'ga-vehicle-photos');

CREATE POLICY auth_insert_ga_vehicle_photos
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ga-vehicle-photos'
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

CREATE POLICY auth_update_ga_vehicle_photos
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'ga-vehicle-photos' AND public.has_app_permission('data-mobil'))
  WITH CHECK (bucket_id = 'ga-vehicle-photos' AND public.has_app_permission('data-mobil'));

CREATE POLICY auth_delete_ga_vehicle_photos
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'ga-vehicle-photos' AND public.has_app_permission('data-mobil'));
