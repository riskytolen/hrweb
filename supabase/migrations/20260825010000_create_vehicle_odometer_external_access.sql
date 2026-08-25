-- Vehicle odometer module + external account isolation.
-- Existing accounts are kept as internal to preserve current web/mobile behavior.

-- 1. Account type for external isolation.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_type text;

UPDATE public.user_profiles
SET account_type = 'internal'
WHERE account_type IS NULL;

ALTER TABLE public.user_profiles
  ALTER COLUMN account_type SET DEFAULT 'internal',
  ALTER COLUMN account_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_user_profiles_account_type'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT chk_user_profiles_account_type
      CHECK (account_type IN ('internal', 'external'));
  END IF;
END $$;

-- 2. Authorization helpers used by RLS and RPCs.
CREATE OR REPLACE FUNCTION public.is_internal_account()
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
      AND up.account_type = 'internal'
      AND r.status = 'Aktif'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_super_admin()
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
      AND up.account_type = 'internal'
      AND r.status = 'Aktif'
      AND (r.level >= 100 OR coalesce(r.permissions, '[]'::jsonb) ? 'all')
  );
$$;

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
        coalesce(r.permissions, '[]'::jsonb) ? 'all'
        OR coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer'
        OR (
          p_action IN ('view', 'read')
          AND (
            coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.view'
            OR coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.input'
          )
        )
        OR (
          p_action IN ('create', 'input')
          AND coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.input'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.touch_user_last_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.user_profiles
  SET last_login = now()
  WHERE id = auth.uid()
    AND status = 'Aktif';
END;
$$;

REVOKE ALL ON FUNCTION public.is_internal_account() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_vehicle_odometer_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_user_last_login() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_internal_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_vehicle_odometer_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_user_last_login() TO authenticated;

-- 3. Keep existing internal roles compatible and seed an external read-only role.
UPDATE public.roles
SET permissions = coalesce(permissions, '[]'::jsonb) || '["dashboard.view"]'::jsonb
WHERE NOT coalesce(permissions, '[]'::jsonb) ? 'all'
  AND NOT coalesce(permissions, '[]'::jsonb) ? 'dashboard'
  AND NOT coalesce(permissions, '[]'::jsonb) ? 'dashboard.view'
  AND NOT coalesce(permissions, '[]'::jsonb) ? 'dashboard.input';

UPDATE public.roles
SET permissions = coalesce(permissions, '[]'::jsonb) || '["vehicle-odometer"]'::jsonb
WHERE nama IN ('Admin HR', 'General Affair')
  AND NOT coalesce(permissions, '[]'::jsonb) ? 'all'
  AND NOT coalesce(permissions, '[]'::jsonb) ? 'vehicle-odometer'
  AND NOT coalesce(permissions, '[]'::jsonb) ? 'vehicle-odometer.view'
  AND NOT coalesce(permissions, '[]'::jsonb) ? 'vehicle-odometer.input';

INSERT INTO public.roles (nama, deskripsi, level, permissions, status)
VALUES (
  'Eksternal Kendaraan',
  'Akses eksternal read-only untuk dashboard dan laporan operasional kendaraan',
  0,
  '["vehicle-odometer.view"]'::jsonb,
  'Aktif'
)
ON CONFLICT (nama) DO UPDATE
SET deskripsi = EXCLUDED.deskripsi,
    level = EXCLUDED.level,
    permissions = EXCLUDED.permissions,
    status = EXCLUDED.status;

-- 4. Harden roles/profile policies while preserving internal account behavior.
DROP POLICY IF EXISTS "Anyone can read roles" ON public.roles;
DROP POLICY IF EXISTS "Superadmin can insert roles" ON public.roles;
DROP POLICY IF EXISTS "Superadmin can update roles" ON public.roles;
DROP POLICY IF EXISTS "Superadmin can delete roles" ON public.roles;
DROP POLICY IF EXISTS auth_select_roles_limited ON public.roles;
DROP POLICY IF EXISTS superadmin_insert_roles ON public.roles;
DROP POLICY IF EXISTS superadmin_update_roles ON public.roles;
DROP POLICY IF EXISTS superadmin_delete_roles ON public.roles;

CREATE POLICY auth_select_roles_limited
  ON public.roles FOR SELECT TO authenticated
  USING (
    public.is_internal_account()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role_id = roles.id
        AND up.status = 'Aktif'
    )
  );

CREATE POLICY superadmin_insert_roles
  ON public.roles FOR INSERT TO authenticated
  WITH CHECK (public.is_active_super_admin());

CREATE POLICY superadmin_update_roles
  ON public.roles FOR UPDATE TO authenticated
  USING (public.is_active_super_admin())
  WITH CHECK (public.is_active_super_admin());

CREATE POLICY superadmin_delete_roles
  ON public.roles FOR DELETE TO authenticated
  USING (public.is_active_super_admin());

DROP POLICY IF EXISTS "Anyone can read profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Superadmin can insert profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Superadmin can update all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Superadmin can delete profiles" ON public.user_profiles;
DROP POLICY IF EXISTS auth_select_user_profiles_limited ON public.user_profiles;
DROP POLICY IF EXISTS superadmin_insert_user_profiles ON public.user_profiles;
DROP POLICY IF EXISTS superadmin_update_user_profiles ON public.user_profiles;
DROP POLICY IF EXISTS superadmin_delete_user_profiles ON public.user_profiles;

CREATE POLICY auth_select_user_profiles_limited
  ON public.user_profiles FOR SELECT TO authenticated
  USING (public.is_internal_account() OR id = auth.uid());

CREATE POLICY superadmin_insert_user_profiles
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_active_super_admin());

CREATE POLICY superadmin_update_user_profiles
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (public.is_active_super_admin())
  WITH CHECK (public.is_active_super_admin());

CREATE POLICY superadmin_delete_user_profiles
  ON public.user_profiles FOR DELETE TO authenticated
  USING (public.is_active_super_admin());

-- 5. Existing broad authenticated policies remain broad only for internal accounts.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename NOT IN ('roles', 'user_profiles')
      AND 'authenticated' = ANY (roles)
      AND (
        coalesce(qual, '') IN ('true', '(true)')
        OR coalesce(with_check, '') IN ('true', '(true)')
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);

    IF p.cmd = 'SELECT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_internal_account())', p.policyname, p.tablename);
    ELSIF p.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_internal_account())', p.policyname, p.tablename);
    ELSIF p.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_internal_account()) WITH CHECK (public.is_internal_account())', p.policyname, p.tablename);
    ELSIF p.cmd = 'DELETE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_internal_account())', p.policyname, p.tablename);
    ELSIF p.cmd = 'ALL' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_internal_account()) WITH CHECK (public.is_internal_account())', p.policyname, p.tablename);
    END IF;
  END LOOP;
END $$;

-- 6. Odometer logs.
CREATE TABLE IF NOT EXISTS public.vehicle_odometer_logs (
  id bigserial PRIMARY KEY,
  vehicle_id integer NOT NULL REFERENCES public.ga_vehicles(id) ON DELETE RESTRICT,
  tanggal date NOT NULL,
  odometer_awal numeric(12,1) NOT NULL,
  odometer_akhir numeric(12,1) NOT NULL,
  jarak_km numeric(12,1) GENERATED ALWAYS AS (odometer_akhir - odometer_awal) STORED,
  catatan text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_vehicle_odometer_non_negative CHECK (odometer_awal >= 0 AND odometer_akhir >= 0),
  CONSTRAINT chk_vehicle_odometer_order CHECK (odometer_akhir >= odometer_awal),
  CONSTRAINT chk_vehicle_odometer_date CHECK (tanggal <= CURRENT_DATE + INTERVAL '1 day')
);

CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_logs_vehicle_date
  ON public.vehicle_odometer_logs(vehicle_id, tanggal DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_logs_tanggal
  ON public.vehicle_odometer_logs(tanggal DESC);

DROP TRIGGER IF EXISTS vehicle_odometer_logs_updated_at ON public.vehicle_odometer_logs;
CREATE TRIGGER vehicle_odometer_logs_updated_at
  BEFORE UPDATE ON public.vehicle_odometer_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.vehicle_odometer_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_vehicle_odometer_logs ON public.vehicle_odometer_logs;
CREATE POLICY auth_select_vehicle_odometer_logs
  ON public.vehicle_odometer_logs FOR SELECT TO authenticated
  USING (public.has_vehicle_odometer_access('view'));

-- 7. Internal audit helper used from privileged odometer RPCs.
CREATE OR REPLACE FUNCTION public.audit_vehicle_odometer_action(
  p_action text,
  p_log_id bigint,
  p_vehicle_unit text,
  p_old_data jsonb,
  p_new_data jsonb,
  p_metadata jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor record;
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RETURN;
  END IF;

  SELECT up.email, up.nama, r.nama AS role_name
  INTO v_actor
  FROM public.user_profiles up
  LEFT JOIN public.roles r ON r.id = up.role_id
  WHERE up.id = auth.uid();

  INSERT INTO public.audit_logs (
    user_id, user_email, user_nama, user_role,
    action, entity_type, entity_id, entity_label,
    old_data, new_data, metadata
  ) VALUES (
    auth.uid(),
    coalesce(v_actor.email, auth.jwt() ->> 'email'),
    v_actor.nama,
    v_actor.role_name,
    p_action,
    'vehicle_odometer_logs',
    p_log_id::text,
    p_vehicle_unit,
    p_old_data,
    p_new_data,
    p_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.audit_vehicle_odometer_action(text, bigint, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- 8. Safe read RPCs: expose only vehicle labels and odometer report rows.
CREATE OR REPLACE FUNCTION public.list_vehicle_odometer_vehicles()
RETURNS TABLE (
  id integer,
  unit text,
  jenis text,
  status text,
  last_log_id bigint,
  last_log_date date,
  last_odometer numeric,
  total_jarak numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_vehicle_odometer_access('view') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    v.id,
    v.unit,
    v.jenis,
    v.status,
    latest.id AS last_log_id,
    latest.tanggal AS last_log_date,
    latest.odometer_akhir AS last_odometer,
    coalesce(t.total_jarak, 0)::numeric AS total_jarak
  FROM public.ga_vehicles v
  LEFT JOIN LATERAL (
    SELECT l.id, l.tanggal, l.odometer_akhir
    FROM public.vehicle_odometer_logs l
    WHERE l.vehicle_id = v.id
    ORDER BY l.tanggal DESC, l.id DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT sum(l.jarak_km) AS total_jarak
    FROM public.vehicle_odometer_logs l
    WHERE l.vehicle_id = v.id
  ) t ON true
  WHERE v.status = 'Aktif'
  ORDER BY v.unit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_vehicle_odometer_logs(
  p_vehicle_id integer DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  vehicle_id integer,
  vehicle_unit text,
  vehicle_jenis text,
  vehicle_status text,
  tanggal date,
  odometer_awal numeric,
  odometer_akhir numeric,
  jarak_km numeric,
  catatan text,
  created_by uuid,
  created_by_nama text,
  created_at timestamptz,
  updated_at timestamptz,
  is_latest boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_vehicle_odometer_access('view') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.vehicle_id,
    v.unit AS vehicle_unit,
    v.jenis AS vehicle_jenis,
    v.status AS vehicle_status,
    l.tanggal,
    l.odometer_awal,
    l.odometer_akhir,
    l.jarak_km,
    l.catatan,
    l.created_by,
    up.nama AS created_by_nama,
    l.created_at,
    l.updated_at,
    NOT EXISTS (
      SELECT 1
      FROM public.vehicle_odometer_logs nx
      WHERE nx.vehicle_id = l.vehicle_id
        AND (nx.tanggal, nx.id) > (l.tanggal, l.id)
    ) AS is_latest
  FROM public.vehicle_odometer_logs l
  JOIN public.ga_vehicles v ON v.id = l.vehicle_id
  LEFT JOIN public.user_profiles up ON up.id = l.created_by
  WHERE (p_vehicle_id IS NULL OR l.vehicle_id = p_vehicle_id)
    AND (p_start_date IS NULL OR l.tanggal >= p_start_date)
    AND (p_end_date IS NULL OR l.tanggal <= p_end_date)
  ORDER BY l.tanggal DESC, l.id DESC;
END;
$$;

-- 9. Write RPCs: full vehicle-odometer permission only.
CREATE OR REPLACE FUNCTION public.create_vehicle_odometer_log(
  p_vehicle_id integer,
  p_tanggal date,
  p_odometer_awal numeric,
  p_odometer_akhir numeric,
  p_catatan text DEFAULT NULL
)
RETURNS public.vehicle_odometer_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_vehicle public.ga_vehicles%ROWTYPE;
  v_last public.vehicle_odometer_logs%ROWTYPE;
  v_start numeric(12,1);
  v_inserted public.vehicle_odometer_logs%ROWTYPE;
BEGIN
  IF NOT public.has_vehicle_odometer_access('manage') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.ga_vehicles
  WHERE id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kendaraan tidak ditemukan.';
  END IF;

  IF v_vehicle.status <> 'Aktif' THEN
    RAISE EXCEPTION 'Kendaraan tidak aktif tidak bisa dipilih untuk input baru.';
  END IF;

  SELECT * INTO v_last
  FROM public.vehicle_odometer_logs
  WHERE vehicle_id = p_vehicle_id
  ORDER BY tanggal DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_start := v_last.odometer_akhir;
    IF p_odometer_awal IS NOT NULL AND round(p_odometer_awal::numeric, 1) <> v_start THEN
      RAISE EXCEPTION 'Odometer awal harus mengikuti odometer akhir terakhir (%).', v_start;
    END IF;
    IF p_tanggal < v_last.tanggal THEN
      RAISE EXCEPTION 'Tanggal input tidak boleh lebih lama dari log terakhir (%).', v_last.tanggal;
    END IF;
  ELSE
    IF p_odometer_awal IS NULL THEN
      RAISE EXCEPTION 'Odometer awal pertama wajib diisi.';
    END IF;
    v_start := round(p_odometer_awal::numeric, 1);
  END IF;

  IF p_odometer_akhir IS NULL THEN
    RAISE EXCEPTION 'Odometer akhir wajib diisi.';
  END IF;

  INSERT INTO public.vehicle_odometer_logs (
    vehicle_id, tanggal, odometer_awal, odometer_akhir, catatan, created_by, updated_by
  ) VALUES (
    p_vehicle_id,
    p_tanggal,
    v_start,
    round(p_odometer_akhir::numeric, 1),
    nullif(btrim(p_catatan), ''),
    auth.uid(),
    auth.uid()
  )
  RETURNING * INTO v_inserted;

  PERFORM public.audit_vehicle_odometer_action(
    'create',
    v_inserted.id,
    v_vehicle.unit,
    NULL,
    to_jsonb(v_inserted),
    jsonb_build_object('vehicle_id', p_vehicle_id, 'jarak_km', v_inserted.jarak_km)
  );

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_vehicle_odometer_log(
  p_log_id bigint,
  p_tanggal date,
  p_odometer_akhir numeric,
  p_catatan text DEFAULT NULL
)
RETURNS public.vehicle_odometer_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target public.vehicle_odometer_logs%ROWTYPE;
  v_latest public.vehicle_odometer_logs%ROWTYPE;
  v_previous public.vehicle_odometer_logs%ROWTYPE;
  v_vehicle public.ga_vehicles%ROWTYPE;
  v_updated public.vehicle_odometer_logs%ROWTYPE;
BEGIN
  IF NOT public.has_vehicle_odometer_access('manage') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_target
  FROM public.vehicle_odometer_logs
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Log odometer tidak ditemukan.';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.ga_vehicles
  WHERE id = v_target.vehicle_id
  FOR UPDATE;

  SELECT * INTO v_latest
  FROM public.vehicle_odometer_logs
  WHERE vehicle_id = v_target.vehicle_id
  ORDER BY tanggal DESC, id DESC
  LIMIT 1;

  IF v_latest.id <> v_target.id THEN
    RAISE EXCEPTION 'Hanya log terbaru kendaraan yang boleh dikoreksi.';
  END IF;

  SELECT * INTO v_previous
  FROM public.vehicle_odometer_logs
  WHERE vehicle_id = v_target.vehicle_id
    AND id <> v_target.id
  ORDER BY tanggal DESC, id DESC
  LIMIT 1;

  IF FOUND AND p_tanggal < v_previous.tanggal THEN
    RAISE EXCEPTION 'Tanggal koreksi tidak boleh lebih lama dari log sebelumnya (%).', v_previous.tanggal;
  END IF;

  IF p_odometer_akhir IS NULL THEN
    RAISE EXCEPTION 'Odometer akhir wajib diisi.';
  END IF;

  UPDATE public.vehicle_odometer_logs
  SET tanggal = p_tanggal,
      odometer_akhir = round(p_odometer_akhir::numeric, 1),
      catatan = nullif(btrim(p_catatan), ''),
      updated_by = auth.uid()
  WHERE id = p_log_id
  RETURNING * INTO v_updated;

  PERFORM public.audit_vehicle_odometer_action(
    'update',
    v_updated.id,
    v_vehicle.unit,
    to_jsonb(v_target),
    to_jsonb(v_updated),
    jsonb_build_object('vehicle_id', v_target.vehicle_id, 'jarak_km', v_updated.jarak_km)
  );

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_vehicle_odometer_log(p_log_id bigint)
RETURNS public.vehicle_odometer_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target public.vehicle_odometer_logs%ROWTYPE;
  v_latest public.vehicle_odometer_logs%ROWTYPE;
  v_vehicle public.ga_vehicles%ROWTYPE;
BEGIN
  IF NOT public.has_vehicle_odometer_access('manage') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_target
  FROM public.vehicle_odometer_logs
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Log odometer tidak ditemukan.';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.ga_vehicles
  WHERE id = v_target.vehicle_id
  FOR UPDATE;

  SELECT * INTO v_latest
  FROM public.vehicle_odometer_logs
  WHERE vehicle_id = v_target.vehicle_id
  ORDER BY tanggal DESC, id DESC
  LIMIT 1;

  IF v_latest.id <> v_target.id THEN
    RAISE EXCEPTION 'Hanya log terbaru kendaraan yang boleh dihapus.';
  END IF;

  DELETE FROM public.vehicle_odometer_logs
  WHERE id = p_log_id;

  PERFORM public.audit_vehicle_odometer_action(
    'delete',
    v_target.id,
    v_vehicle.unit,
    to_jsonb(v_target),
    NULL,
    jsonb_build_object('vehicle_id', v_target.vehicle_id, 'jarak_km', v_target.jarak_km)
  );

  RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.list_vehicle_odometer_vehicles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_vehicle_odometer_logs(integer, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_vehicle_odometer_log(integer, date, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_vehicle_odometer_log(bigint, date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_vehicle_odometer_log(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vehicle_odometer_vehicles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_odometer_logs(integer, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_vehicle_odometer_log(integer, date, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vehicle_odometer_log(bigint, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_vehicle_odometer_log(bigint) TO authenticated;
