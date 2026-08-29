-- Configurable payroll incentive for Rekap Titik rows marked as Backup Libur.
-- The amount is calculated once per employee/date/role, not multiplied by jumlah_titik.

CREATE TABLE IF NOT EXISTS public.backup_libur_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  delivery_status_id integer NOT NULL REFERENCES public.delivery_statuses(id) ON DELETE RESTRICT,
  driver_amount integer NOT NULL DEFAULT 65000 CHECK (driver_amount >= 0),
  helper_amount integer NOT NULL DEFAULT 45000 CHECK (helper_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS backup_libur_settings_updated_at ON public.backup_libur_settings;
CREATE TRIGGER backup_libur_settings_updated_at
  BEFORE UPDATE ON public.backup_libur_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

WITH existing_status AS (
  SELECT id
  FROM public.delivery_statuses
  WHERE upper(btrim(kode)) = 'BKP-LB'
     OR lower(btrim(nama)) = 'backup libur'
  ORDER BY (upper(btrim(kode)) = 'BKP-LB') DESC, id
  LIMIT 1
), inserted_status AS (
  INSERT INTO public.delivery_statuses (nama, kode, color, status)
  SELECT 'Backup Libur', 'BKP-LB', '#f97316', 'Aktif'
  WHERE NOT EXISTS (SELECT 1 FROM existing_status)
  RETURNING id
), selected_status AS (
  SELECT id FROM existing_status
  UNION ALL
  SELECT id FROM inserted_status
  LIMIT 1
)
INSERT INTO public.backup_libur_settings (id, delivery_status_id, driver_amount, helper_amount)
SELECT 1, id, 65000, 45000
FROM selected_status
ON CONFLICT (id) DO UPDATE
SET delivery_status_id = EXCLUDED.delivery_status_id,
    updated_at = now();

ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS tambahan_backup_libur integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backup_libur_driver_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backup_libur_helper_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backup_libur_driver_rate integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backup_libur_helper_rate integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_tambahan_backup_libur_nonnegative') THEN
    ALTER TABLE public.payrolls
      ADD CONSTRAINT payrolls_tambahan_backup_libur_nonnegative CHECK (tambahan_backup_libur >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_backup_libur_driver_days_nonnegative') THEN
    ALTER TABLE public.payrolls
      ADD CONSTRAINT payrolls_backup_libur_driver_days_nonnegative CHECK (backup_libur_driver_days >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_backup_libur_helper_days_nonnegative') THEN
    ALTER TABLE public.payrolls
      ADD CONSTRAINT payrolls_backup_libur_helper_days_nonnegative CHECK (backup_libur_helper_days >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_backup_libur_driver_rate_nonnegative') THEN
    ALTER TABLE public.payrolls
      ADD CONSTRAINT payrolls_backup_libur_driver_rate_nonnegative CHECK (backup_libur_driver_rate >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_backup_libur_helper_rate_nonnegative') THEN
    ALTER TABLE public.payrolls
      ADD CONSTRAINT payrolls_backup_libur_helper_rate_nonnegative CHECK (backup_libur_helper_rate >= 0);
  END IF;
END $$;

-- Rebuild generated income columns so the dedicated Backup Libur component is included.
ALTER TABLE public.payrolls DROP COLUMN IF EXISTS total_pendapatan;
ALTER TABLE public.payrolls DROP COLUMN IF EXISTS netto;

ALTER TABLE public.payrolls
  ADD COLUMN total_pendapatan integer GENERATED ALWAYS AS (
    gaji_pokok + pendapatan_titik + tambahan_backup_libur + extra_job + uang_makan + insentif + tunjangan_jabatan + transport + tunjangan_lain + tambahan_lain + lembur
  ) STORED,
  ADD COLUMN netto integer GENERATED ALWAYS AS (
    (gaji_pokok + pendapatan_titik + tambahan_backup_libur + extra_job + uang_makan + insentif + tunjangan_jabatan + transport + tunjangan_lain + tambahan_lain + lembur)
    - (koperasi + pinjaman_perusahaan + potongan_absen + potongan_lain + jht + bpjs_kesehatan)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_delivery_points_backup_libur_calc
  ON public.delivery_points (status_id, tanggal, employee_id, role)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_backup_libur_settings_delivery_status_id
  ON public.backup_libur_settings (delivery_status_id);

ALTER TABLE public.backup_libur_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_backup_libur_settings ON public.backup_libur_settings;
DROP POLICY IF EXISTS auth_update_backup_libur_settings ON public.backup_libur_settings;

CREATE POLICY auth_select_backup_libur_settings
  ON public.backup_libur_settings
  FOR SELECT
  TO authenticated
  USING (public.has_app_permission('settings', true) OR public.has_app_permission('payroll', true));

CREATE POLICY auth_update_backup_libur_settings
  ON public.backup_libur_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_app_permission('settings'))
  WITH CHECK (public.has_app_permission('settings'));

GRANT SELECT, UPDATE ON public.backup_libur_settings TO authenticated;
GRANT ALL ON public.backup_libur_settings TO service_role;

-- Existing Final payroll is an immutable archive. Backfill only open Worksheet rows.
WITH settings AS (
  SELECT delivery_status_id, driver_amount, helper_amount
  FROM public.backup_libur_settings
  WHERE id = 1
)
UPDATE public.payrolls py
SET
  backup_libur_driver_days = 0,
  backup_libur_helper_days = 0,
  backup_libur_driver_rate = s.driver_amount,
  backup_libur_helper_rate = s.helper_amount,
  tambahan_backup_libur = 0
FROM settings s
WHERE py.status = 'Worksheet';

WITH settings AS (
  SELECT delivery_status_id, driver_amount, helper_amount
  FROM public.backup_libur_settings
  WHERE id = 1
), counts AS (
  SELECT
    py.id AS payroll_id,
    count(DISTINCT dp.tanggal) FILTER (WHERE dp.role = 'Driver')::integer AS driver_days,
    count(DISTINCT dp.tanggal) FILTER (WHERE dp.role = 'Helper')::integer AS helper_days
  FROM public.payrolls py
  CROSS JOIN settings s
  JOIN public.delivery_points dp
    ON dp.employee_id = py.employee_id
   AND dp.tanggal BETWEEN py.periode_mulai AND py.periode_selesai
   AND dp.status_id = s.delivery_status_id
   AND dp.role IN ('Driver', 'Helper')
  WHERE py.status = 'Worksheet'
  GROUP BY py.id
)
UPDATE public.payrolls py
SET
  backup_libur_driver_days = c.driver_days,
  backup_libur_helper_days = c.helper_days,
  backup_libur_driver_rate = s.driver_amount,
  backup_libur_helper_rate = s.helper_amount,
  tambahan_backup_libur = (c.driver_days * s.driver_amount) + (c.helper_days * s.helper_amount)
FROM settings s
JOIN counts c ON true
WHERE py.status = 'Worksheet'
  AND c.payroll_id = py.id;

NOTIFY pgrst, 'reload schema';
