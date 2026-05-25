-- ============================================================
-- delivery_points pakai zone_id penuh (drop division_id).
-- Tabel saat ini kosong (0 baris), aman.
-- ============================================================

-- 1) Sanity check.
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.delivery_points;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'delivery_points tidak kosong (% baris). Migrasi dibatalkan untuk hindari kehilangan data.', cnt;
  END IF;
END$$;

-- 2) Drop index lama yang merujuk division_id.
DROP INDEX IF EXISTS public.idx_delivery_points_division;

-- 3) Drop FK + kolom division_id.
ALTER TABLE public.delivery_points DROP CONSTRAINT IF EXISTS delivery_points_division_id_fkey;
ALTER TABLE public.delivery_points DROP COLUMN IF EXISTS division_id;

-- 4) zone_id wajib (tabel kosong, aman).
ALTER TABLE public.delivery_points ALTER COLUMN zone_id SET NOT NULL;
