-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Master data for GA Vehicle vendor & division
-- ═══════════════════════════════════════════════════════════════

-- 1. Vendor master table
CREATE TABLE IF NOT EXISTS public.ga_vehicle_vendors (
  id          SERIAL PRIMARY KEY,
  nama        TEXT NOT NULL UNIQUE,
  deskripsi   TEXT,
  status      TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ga_vehicle_vendors_updated_at ON public.ga_vehicle_vendors;
CREATE TRIGGER ga_vehicle_vendors_updated_at
  BEFORE UPDATE ON public.ga_vehicle_vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.ga_vehicle_vendors ENABLE ROW LEVEL SECURITY;

-- 2. Division master table (vehicle-specific, separate from HR divisions)
CREATE TABLE IF NOT EXISTS public.ga_vehicle_divisions (
  id          SERIAL PRIMARY KEY,
  nama        TEXT NOT NULL UNIQUE,
  deskripsi   TEXT,
  status      TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ga_vehicle_divisions_updated_at ON public.ga_vehicle_divisions;
CREATE TRIGGER ga_vehicle_divisions_updated_at
  BEFORE UPDATE ON public.ga_vehicle_divisions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.ga_vehicle_divisions ENABLE ROW LEVEL SECURITY;

-- 3. Seed from existing ga_vehicles data
INSERT INTO public.ga_vehicle_vendors (nama)
  SELECT DISTINCT TRIM(vendor) FROM public.ga_vehicles
  WHERE vendor IS NOT NULL AND TRIM(vendor) != ''
  ON CONFLICT (nama) DO NOTHING;

INSERT INTO public.ga_vehicle_divisions (nama)
  SELECT DISTINCT TRIM(divisi) FROM public.ga_vehicles
  WHERE divisi IS NOT NULL AND TRIM(divisi) != ''
  ON CONFLICT (nama) DO NOTHING;

-- 4. Add FK columns to ga_vehicles
ALTER TABLE public.ga_vehicles
  ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES public.ga_vehicle_vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_division_id INTEGER REFERENCES public.ga_vehicle_divisions(id) ON DELETE SET NULL;

-- 5. Backfill IDs from existing text values
UPDATE public.ga_vehicles v
  SET vendor_id = vv.id
  FROM public.ga_vehicle_vendors vv
  WHERE v.vendor IS NOT NULL AND TRIM(v.vendor) != '' AND TRIM(v.vendor) = vv.nama;

UPDATE public.ga_vehicles v
  SET vehicle_division_id = vd.id
  FROM public.ga_vehicle_divisions vd
  WHERE v.divisi IS NOT NULL AND TRIM(v.divisi) != '' AND TRIM(v.divisi) = vd.nama;

-- 6. RLS policies (same pattern as ga_vehicles – data-mobil permission)
DROP POLICY IF EXISTS auth_select_ga_vehicle_vendors ON public.ga_vehicle_vendors;
DROP POLICY IF EXISTS auth_insert_ga_vehicle_vendors ON public.ga_vehicle_vendors;
DROP POLICY IF EXISTS auth_update_ga_vehicle_vendors ON public.ga_vehicle_vendors;
DROP POLICY IF EXISTS auth_delete_ga_vehicle_vendors ON public.ga_vehicle_vendors;

CREATE POLICY auth_select_ga_vehicle_vendors
  ON public.ga_vehicle_vendors FOR SELECT TO authenticated
  USING (public.has_app_permission('data-mobil', true));

CREATE POLICY auth_insert_ga_vehicle_vendors
  ON public.ga_vehicle_vendors FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status = 'Aktif' AND r.status = 'Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'data-mobil' OR r.permissions ? 'data-mobil.input')
    )
  );

CREATE POLICY auth_update_ga_vehicle_vendors
  ON public.ga_vehicle_vendors FOR UPDATE TO authenticated
  USING (public.has_app_permission('data-mobil'))
  WITH CHECK (public.has_app_permission('data-mobil'));

CREATE POLICY auth_delete_ga_vehicle_vendors
  ON public.ga_vehicle_vendors FOR DELETE TO authenticated
  USING (public.has_app_permission('data-mobil'));

DROP POLICY IF EXISTS auth_select_ga_vehicle_divisions ON public.ga_vehicle_divisions;
DROP POLICY IF EXISTS auth_insert_ga_vehicle_divisions ON public.ga_vehicle_divisions;
DROP POLICY IF EXISTS auth_update_ga_vehicle_divisions ON public.ga_vehicle_divisions;
DROP POLICY IF EXISTS auth_delete_ga_vehicle_divisions ON public.ga_vehicle_divisions;

CREATE POLICY auth_select_ga_vehicle_divisions
  ON public.ga_vehicle_divisions FOR SELECT TO authenticated
  USING (public.has_app_permission('data-mobil', true));

CREATE POLICY auth_insert_ga_vehicle_divisions
  ON public.ga_vehicle_divisions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status = 'Aktif' AND r.status = 'Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'data-mobil' OR r.permissions ? 'data-mobil.input')
    )
  );

CREATE POLICY auth_update_ga_vehicle_divisions
  ON public.ga_vehicle_divisions FOR UPDATE TO authenticated
  USING (public.has_app_permission('data-mobil'))
  WITH CHECK (public.has_app_permission('data-mobil'));

CREATE POLICY auth_delete_ga_vehicle_divisions
  ON public.ga_vehicle_divisions FOR DELETE TO authenticated
  USING (public.has_app_permission('data-mobil'));
