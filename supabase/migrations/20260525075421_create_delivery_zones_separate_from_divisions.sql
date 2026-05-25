-- 1. Tabel baru delivery_zones (nama titik untuk rekap titik & harga)
CREATE TABLE IF NOT EXISTS delivery_zones (
  id serial PRIMARY KEY,
  nama varchar(100) UNIQUE NOT NULL,
  deskripsi text,
  color varchar(20) DEFAULT '#3b82f6',
  status varchar(20) NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif','Tidak Aktif')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE delivery_zones IS 'Nama titik pengantaran untuk rekap titik & harga per titik. Terpisah dari divisions (yang dipakai untuk absen).';

-- 2. Trigger updated_at
CREATE OR REPLACE FUNCTION set_updated_at_delivery_zones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_zones_updated_at ON delivery_zones;
CREATE TRIGGER delivery_zones_updated_at
BEFORE UPDATE ON delivery_zones
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_delivery_zones();

-- 3. RLS policies
ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_delivery_zones ON delivery_zones;
DROP POLICY IF EXISTS auth_insert_delivery_zones ON delivery_zones;
DROP POLICY IF EXISTS auth_update_delivery_zones ON delivery_zones;
DROP POLICY IF EXISTS auth_delete_delivery_zones ON delivery_zones;

CREATE POLICY auth_select_delivery_zones ON delivery_zones FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_delivery_zones ON delivery_zones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_delivery_zones ON delivery_zones FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_delivery_zones ON delivery_zones FOR DELETE TO authenticated USING (true);

-- 4. Tambah kolom zone_id di point_rates & delivery_points
ALTER TABLE point_rates ADD COLUMN IF NOT EXISTS zone_id integer REFERENCES delivery_zones(id) ON DELETE RESTRICT;
ALTER TABLE delivery_points ADD COLUMN IF NOT EXISTS zone_id integer REFERENCES delivery_zones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS point_rates_zone_idx ON point_rates(zone_id);
CREATE INDEX IF NOT EXISTS delivery_points_zone_idx ON delivery_points(zone_id);
