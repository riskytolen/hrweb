-- Payroll prorata + integrity hardening (idempotent, safe for drifted prod schema).
-- Kontrak:
-- - tanggal_keluar = hari pertama TIDAK aktif (tidak dihitung).
-- - Prorata: round(monthly / 30 * min(active_days, 30)); aktif penuh => monthly penuh.
-- - Final adalah arsip imutabel: tidak boleh update nominal/hapus langsung.

-- ─── 1. Metadata prorata di payrolls ───
ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS gapok_bulanan integer,
  ADD COLUMN IF NOT EXISTS gapok_hari_aktif integer,
  ADD COLUMN IF NOT EXISTS gapok_total_hari integer,
  ADD COLUMN IF NOT EXISTS gapok_pembagi integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS gapok_is_prorata boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gapok_rincian text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_gapok_pembagi_check') THEN
    ALTER TABLE public.payrolls ADD CONSTRAINT payrolls_gapok_pembagi_check CHECK (gapok_pembagi = 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_gapok_hari_nonnegative') THEN
    ALTER TABLE public.payrolls ADD CONSTRAINT payrolls_gapok_hari_nonnegative CHECK (
      (gapok_hari_aktif IS NULL OR gapok_hari_aktif >= 0) AND
      (gapok_total_hari IS NULL OR gapok_total_hari >= 0) AND
      (gapok_bulanan IS NULL OR gapok_bulanan >= 0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_status_check') THEN
    ALTER TABLE public.payrolls ADD CONSTRAINT payrolls_status_check CHECK (status IN ('Worksheet','Draft','Final'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payrolls_employee_periode_unique') THEN
    -- Cegah duplikat pegawai per periode; pakai UNIQUE agar race insert gagal aman.
    -- Jika data lama sudah terlanjur ganda, jangan gagalkan migration: beri warning agar dibersihkan manual.
    IF EXISTS (
      SELECT employee_id, periode FROM public.payrolls
      GROUP BY employee_id, periode HAVING count(*) > 1
    ) THEN
      RAISE WARNING 'payrolls memiliki duplikat (employee_id, periode); constraint unik dilewati sampai dibersihkan manual.';
    ELSE
      ALTER TABLE public.payrolls ADD CONSTRAINT payrolls_employee_periode_unique UNIQUE (employee_id, periode);
    END IF;
  END IF;
END $$;

-- Backfill metadata untuk row lama yang belum punya (tanpa mengubah nominal):
-- gapok_bulanan = source_gaji_pokok ?? gaji_pokok; hari/rincian dibiarkan NULL agar
-- jelas bahwa row historis belum dihitung dengan kontrak prorata baru.
UPDATE public.payrolls
SET gapok_bulanan = COALESCE(source_gaji_pokok, gaji_pokok)
WHERE gapok_bulanan IS NULL;

-- ─── 2. Histori gapok per tanggal efektif ───
CREATE TABLE IF NOT EXISTS public.employee_gapok_history (
  id bigserial PRIMARY KEY,
  employee_id varchar(20) NOT NULL REFERENCES public.pegawai(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount >= 0),
  effective_date date NOT NULL,
  source varchar(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','cron','system','seed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_gapok_history_employee_effective
  ON public.employee_gapok_history (employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_gapok_history_effective
  ON public.employee_gapok_history (effective_date);

ALTER TABLE public.employee_gapok_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_gapok_history ON public.employee_gapok_history;
CREATE POLICY auth_select_gapok_history
  ON public.employee_gapok_history FOR SELECT TO authenticated
  USING (public.has_app_permission('payroll', true) OR public.has_app_permission('settings', true));

-- History hanya ditulis lewat RPC/trigger terkontrol, bukan direct client write.
REVOKE INSERT, UPDATE, DELETE ON public.employee_gapok_history FROM authenticated;
GRANT SELECT ON public.employee_gapok_history TO authenticated;
GRANT ALL ON public.employee_gapok_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.employee_gapok_history_id_seq TO service_role;

-- Seed awal dari master saat ini (sekali saja, idempotent via NOT EXISTS).
INSERT INTO public.employee_gapok_history (employee_id, amount, effective_date, source, notes)
SELECT p.id, COALESCE(p.gaji_pokok, 0), CURRENT_DATE, 'seed', 'Seed awal histori gapok'
FROM public.pegawai p
WHERE NOT EXISTS (
  SELECT 1 FROM public.employee_gapok_history h WHERE h.employee_id = p.id
);

-- Seed dari event kenaikan yang sudah Applied (agar histori bisa diaudit mundur).
INSERT INTO public.employee_gapok_history (employee_id, amount, effective_date, source, notes, created_at)
SELECT e.employee_id, e.after_gapok, e.due_date, 'cron', 'Backfill dari gapok_increment_events Applied', COALESCE(e.applied_at, now())
FROM public.gapok_increment_events e
WHERE e.status = 'Applied'
  AND e.after_gapok IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.employee_gapok_history h
    WHERE h.employee_id = e.employee_id
      AND h.effective_date = e.due_date
      AND h.amount = e.after_gapok
  );

-- ─── 3. set_employee_gapok wajib tanggal efektif + catat histori atomik ───
CREATE OR REPLACE FUNCTION public.set_employee_gapok(
  p_employee_id varchar,
  p_amount integer,
  p_effective_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(old_gapok integer, new_gapok integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old integer;
  v_new integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_app_permission('payroll') THEN
    RAISE EXCEPTION 'Insufficient payroll permission' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Gapok cannot be negative';
  END IF;
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'Effective date is required';
  END IF;
  -- Batasi tanggal efektif tidak terlalu jauh ke masa depan (typo guard).
  IF p_effective_date > CURRENT_DATE + INTERVAL '60 days' THEN
    RAISE EXCEPTION 'Effective date too far in the future';
  END IF;

  SELECT gaji_pokok INTO v_old
  FROM public.pegawai
  WHERE id = p_employee_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  UPDATE public.pegawai
  SET gaji_pokok = p_amount,
      updated_at = now()
  WHERE id = p_employee_id
  RETURNING gaji_pokok INTO v_new;

  INSERT INTO public.employee_gapok_history (employee_id, amount, effective_date, source, created_by, notes)
  VALUES (p_employee_id, v_new, p_effective_date, 'manual', auth.uid(), 'Perubahan manual via payroll');

  RETURN QUERY SELECT COALESCE(v_old, 0), v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_gapok(varchar, integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_gapok(varchar, integer, date) TO authenticated, service_role;
-- Kompatibilitas: signature lama 2-arg tetap ada? Postgres membedakan overload;
-- pertahankan wrapper 2-arg yang memanggil versi 3-arg dengan CURRENT_DATE.
CREATE OR REPLACE FUNCTION public.set_employee_gapok(
  p_employee_id varchar,
  p_amount integer
)
RETURNS TABLE(old_gapok integer, new_gapok integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.set_employee_gapok(p_employee_id, p_amount, CURRENT_DATE);
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_gapok(varchar, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_gapok(varchar, integer) TO authenticated, service_role;

-- Catat kenaikan otomatis ke histori yang sama.
CREATE OR REPLACE FUNCTION public.log_gapok_increment_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'Applied' AND (OLD.status IS DISTINCT FROM 'Applied') AND NEW.after_gapok IS NOT NULL THEN
    INSERT INTO public.employee_gapok_history (employee_id, amount, effective_date, source, created_by, notes, created_at)
    VALUES (NEW.employee_id, NEW.after_gapok, NEW.due_date, 'cron', NEW.applied_by, 'Kenaikan otomatis gapok', COALESCE(NEW.applied_at, now()))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_gapok_increment_history ON public.gapok_increment_events;
CREATE TRIGGER trg_log_gapok_increment_history
  AFTER UPDATE OF status ON public.gapok_increment_events
  FOR EACH ROW EXECUTE FUNCTION public.log_gapok_increment_history();

REVOKE ALL ON FUNCTION public.log_gapok_increment_history() FROM PUBLIC, anon, authenticated;

-- ─── 4. Proteksi Final: arsip imutabel ───
CREATE OR REPLACE FUNCTION public.protect_final_payroll()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_superadmin boolean := false;
BEGIN
  -- Cek superadmin via level role >= 100 atau permission 'all'.
  IF auth.uid() IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid()
        AND up.status = 'Aktif'
        AND r.status = 'Aktif'
        AND (r.level >= 100 OR r.permissions ? 'all')
    ) INTO v_is_superadmin;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Final' THEN
      RAISE EXCEPTION 'Slip Final tidak boleh dihapus langsung; kembalikan ke Draft oleh Super Admin terlebih dahulu.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: Final -> Final (edit nominal terkunci) selalu ditolak.
  IF OLD.status = 'Final' AND NEW.status = 'Final' THEN
    RAISE EXCEPTION 'Slip Final terkunci; kembalikan ke Draft oleh Super Admin untuk mengubah.' USING ERRCODE = '42501';
  END IF;

  -- UPDATE: Final -> selain Draft ditolak.
  IF OLD.status = 'Final' AND NEW.status <> 'Draft' THEN
    RAISE EXCEPTION 'Transisi status Final tidak valid.' USING ERRCODE = '42501';
  END IF;

  -- UPDATE: Final -> Draft hanya Super Admin.
  IF OLD.status = 'Final' AND NEW.status = 'Draft' THEN
    IF NOT v_is_superadmin THEN
      RAISE EXCEPTION 'Hanya Super Admin yang dapat mengembalikan Final ke Draft.' USING ERRCODE = '42501';
    END IF;
    -- Bersihkan snapshot Final (trigger snapshot juga melakukannya; ini safety).
    NEW.final_employee_nama := NULL;
    NEW.final_employee_jabatan := NULL;
    NEW.final_employee_bank := NULL;
    NEW.final_employee_no_rekening := NULL;
    NEW.final_employee_nama_rekening := NULL;
    NEW.final_snapshot_at := NULL;
    NEW.locked_at := NULL;
    NEW.locked_by := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: ke Final harus dari Draft (tidak boleh loncat dari Worksheet).
  IF NEW.status = 'Final' AND OLD.status <> 'Final' AND OLD.status <> 'Draft' THEN
    RAISE EXCEPTION 'Slip hanya dapat difinalkan dari status Draft.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_final_payroll ON public.payrolls;
CREATE TRIGGER trg_protect_final_payroll
  BEFORE UPDATE OR DELETE ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION public.protect_final_payroll();

REVOKE ALL ON FUNCTION public.protect_final_payroll() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
