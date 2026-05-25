-- ============================================================
-- Seed delivery_zones dari nama divisi yang dipakai di point_rates,
-- lalu pindahkan point_rates dari division_id ke zone_id (hard-cut).
-- ============================================================

-- 1) Seed zona dari divisi unik yang punya point_rates.
--    Color & status diwarisi dari divisi sumber, deskripsi default.
INSERT INTO public.delivery_zones (nama, deskripsi, color, status)
SELECT DISTINCT d.nama,
       NULL::text,
       COALESCE(d.color, '#3b82f6'),
       'Aktif'
FROM public.point_rates pr
JOIN public.divisions d ON d.id = pr.division_id
ON CONFLICT (nama) DO NOTHING;

-- 2) Map division_id -> zone_id berdasarkan nama divisi (case-sensitive, persis).
UPDATE public.point_rates pr
SET zone_id = z.id
FROM public.divisions d, public.delivery_zones z
WHERE pr.division_id = d.id
  AND z.nama = d.nama
  AND pr.zone_id IS NULL;

-- 3) Pastikan tidak ada baris yang gagal mapping.
DO $$
DECLARE
  unmapped int;
BEGIN
  SELECT COUNT(*) INTO unmapped FROM public.point_rates WHERE zone_id IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'Masih ada % baris point_rates dengan zone_id NULL. Migrasi dibatalkan.', unmapped;
  END IF;
END$$;

-- 4) Constraint switch:
--    - Drop UNIQUE (division_id, role) lama.
--    - Drop FK division_id.
--    - Drop kolom division_id.
--    - Set zone_id NOT NULL.
--    - Tambah UNIQUE (zone_id, role).
ALTER TABLE public.point_rates DROP CONSTRAINT IF EXISTS point_rates_division_role_unique;
ALTER TABLE public.point_rates DROP CONSTRAINT IF EXISTS point_rates_division_id_fkey;
ALTER TABLE public.point_rates DROP COLUMN IF EXISTS division_id;

ALTER TABLE public.point_rates ALTER COLUMN zone_id SET NOT NULL;
ALTER TABLE public.point_rates
  ADD CONSTRAINT point_rates_zone_role_unique UNIQUE (zone_id, role);
