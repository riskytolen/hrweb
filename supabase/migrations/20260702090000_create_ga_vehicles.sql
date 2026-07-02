-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: GA Vehicles (Data Mobil) for General Affair
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ga_vehicles (
  id          SERIAL PRIMARY KEY,
  unit        TEXT NOT NULL UNIQUE,
  jenis       TEXT NOT NULL,
  divisi      TEXT,
  milik       TEXT,
  no_rangka   TEXT,
  nomer_mesin TEXT,
  volume      TEXT,
  tonase      TEXT,
  suhu        TEXT,
  status      TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger auto-update updated_at
DROP TRIGGER IF EXISTS ga_vehicles_updated_at ON public.ga_vehicles;

CREATE TRIGGER ga_vehicles_updated_at
  BEFORE UPDATE ON public.ga_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.ga_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_ga_vehicles ON public.ga_vehicles;
DROP POLICY IF EXISTS auth_insert_ga_vehicles ON public.ga_vehicles;
DROP POLICY IF EXISTS auth_update_ga_vehicles ON public.ga_vehicles;
DROP POLICY IF EXISTS auth_delete_ga_vehicles ON public.ga_vehicles;

-- SELECT: view, input, edit, atau all
CREATE POLICY auth_select_ga_vehicles
  ON public.ga_vehicles
  FOR SELECT
  TO authenticated
  USING (public.has_app_permission('data-mobil', true));

-- INSERT: input atau edit atau all
CREATE POLICY auth_insert_ga_vehicles
  ON public.ga_vehicles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_app_permission('data-mobil'));

-- UPDATE: edit atau all
CREATE POLICY auth_update_ga_vehicles
  ON public.ga_vehicles
  FOR UPDATE
  TO authenticated
  USING (public.has_app_permission('data-mobil'))
  WITH CHECK (public.has_app_permission('data-mobil'));

-- DELETE: edit atau all
CREATE POLICY auth_delete_ga_vehicles
  ON public.ga_vehicles
  FOR DELETE
  TO authenticated
  USING (public.has_app_permission('data-mobil'));
