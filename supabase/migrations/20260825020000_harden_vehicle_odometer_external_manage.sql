-- Keep external vehicle accounts read-only even if a broader role is assigned by mistake.

CREATE OR REPLACE FUNCTION public.has_vehicle_odometer_access(p_action text DEFAULT 'view')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id = up.role_id
    WHERE up.id = auth.uid()
      AND up.status = 'Aktif'
      AND r.status = 'Aktif'
      AND (
        (
          p_action IN ('view', 'read')
          AND (
            coalesce(r.permissions, '[]'::jsonb) ? 'all'
            OR coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer'
            OR coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.view'
            OR coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.input'
            OR coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.manage'
          )
        )
        OR (
          up.account_type = 'internal'
          AND p_action IN ('manage', 'create', 'input', 'update', 'delete')
          AND (
            coalesce(r.permissions, '[]'::jsonb) ? 'all'
            OR coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer'
            OR coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.manage'
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_vehicle_odometer_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_vehicle_odometer_access(text) TO authenticated;
