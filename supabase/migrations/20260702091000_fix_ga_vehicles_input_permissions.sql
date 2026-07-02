-- Align Data Mobil RLS with application permission levels:
-- view = read, input = read + insert, edit/full = full CRUD.

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
        OR (
          allow_view
          AND (
            r.permissions ? (required_permission || '.view')
            OR r.permissions ? (required_permission || '.input')
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_app_permission(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_app_permission(text, boolean) TO authenticated;

DROP POLICY IF EXISTS auth_select_ga_vehicles ON public.ga_vehicles;
DROP POLICY IF EXISTS auth_insert_ga_vehicles ON public.ga_vehicles;
DROP POLICY IF EXISTS auth_update_ga_vehicles ON public.ga_vehicles;
DROP POLICY IF EXISTS auth_delete_ga_vehicles ON public.ga_vehicles;

CREATE POLICY auth_select_ga_vehicles
  ON public.ga_vehicles
  FOR SELECT
  TO authenticated
  USING (public.has_app_permission('data-mobil', true));

CREATE POLICY auth_insert_ga_vehicles
  ON public.ga_vehicles
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

CREATE POLICY auth_update_ga_vehicles
  ON public.ga_vehicles
  FOR UPDATE
  TO authenticated
  USING (public.has_app_permission('data-mobil'))
  WITH CHECK (public.has_app_permission('data-mobil'));

CREATE POLICY auth_delete_ga_vehicles
  ON public.ga_vehicles
  FOR DELETE
  TO authenticated
  USING (public.has_app_permission('data-mobil'));
