-- Gapok default & periodic increment system (Driver 2.0jt / Helper 1.0jt, +250rb per 30 months)
-- Settings, schedule/history, triggers, and daily cron. Future schedules only; existing gapok unchanged at rollout.

-- ─── 1. Settings (singleton id=1) ───
CREATE TABLE IF NOT EXISTS public.gapok_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  driver_jabatan_id integer REFERENCES public.jabatan(id) ON DELETE RESTRICT,
  helper_jabatan_id integer REFERENCES public.jabatan(id) ON DELETE RESTRICT,
  driver_default_amount integer NOT NULL DEFAULT 2000000 CHECK (driver_default_amount >= 0),
  helper_default_amount integer NOT NULL DEFAULT 1000000 CHECK (helper_default_amount >= 0),
  increment_amount integer NOT NULL DEFAULT 250000 CHECK (increment_amount >= 0),
  interval_months integer NOT NULL DEFAULT 30 CHECK (interval_months BETWEEN 1 AND 120),
  notification_days integer NOT NULL DEFAULT 90 CHECK (notification_days BETWEEN 1 AND 365),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS gapok_settings_updated_at ON public.gapok_settings;
CREATE TRIGGER gapok_settings_updated_at
  BEFORE UPDATE ON public.gapok_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── 2. Increment schedule + history ───
CREATE TABLE IF NOT EXISTS public.gapok_increment_events (
  id bigserial PRIMARY KEY,
  employee_id varchar(20) NOT NULL REFERENCES public.pegawai(id) ON DELETE CASCADE,
  jabatan_id integer REFERENCES public.jabatan(id) ON DELETE SET NULL,
  milestone_no integer NOT NULL CHECK (milestone_no > 0),
  due_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Applied','Skipped','Cancelled')),
  amount integer NOT NULL DEFAULT 250000 CHECK (amount >= 0),
  before_gapok integer,
  after_gapok integer,
  applied_at timestamptz,
  applied_by uuid,
  source varchar(20) NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','cron','manual','system')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, milestone_no)
);

DROP TRIGGER IF EXISTS gapok_increment_events_updated_at ON public.gapok_increment_events;
CREATE TRIGGER gapok_increment_events_updated_at
  BEFORE UPDATE ON public.gapok_increment_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_gapok_events_employee ON public.gapok_increment_events (employee_id);
CREATE INDEX IF NOT EXISTS idx_gapok_events_due_date ON public.gapok_increment_events (due_date);
CREATE INDEX IF NOT EXISTS idx_gapok_events_status ON public.gapok_increment_events (status);
CREATE INDEX IF NOT EXISTS idx_gapok_events_status_due ON public.gapok_increment_events (status, due_date);
CREATE INDEX IF NOT EXISTS idx_gapok_events_employee_status ON public.gapok_increment_events (employee_id, status);

-- ─── 3. RLS ───
ALTER TABLE public.gapok_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gapok_increment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_gapok_settings ON public.gapok_settings;
DROP POLICY IF EXISTS auth_update_gapok_settings ON public.gapok_settings;
CREATE POLICY auth_select_gapok_settings
  ON public.gapok_settings FOR SELECT TO authenticated
  USING (public.has_app_permission('settings', true) OR public.has_app_permission('payroll', true));
CREATE POLICY auth_update_gapok_settings
  ON public.gapok_settings FOR UPDATE TO authenticated
  USING (public.has_app_permission('settings'))
  WITH CHECK (public.has_app_permission('settings'));

DROP POLICY IF EXISTS auth_select_gapok_events ON public.gapok_increment_events;
DROP POLICY IF EXISTS auth_insert_gapok_events ON public.gapok_increment_events;
DROP POLICY IF EXISTS auth_update_gapok_events ON public.gapok_increment_events;
DROP POLICY IF EXISTS auth_delete_gapok_events ON public.gapok_increment_events;
CREATE POLICY auth_select_gapok_events
  ON public.gapok_increment_events FOR SELECT TO authenticated
  USING (public.has_app_permission('payroll', true) OR public.has_app_permission('settings', true));
CREATE POLICY auth_insert_gapok_events
  ON public.gapok_increment_events FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('payroll') OR public.has_app_permission('settings'));
CREATE POLICY auth_update_gapok_events
  ON public.gapok_increment_events FOR UPDATE TO authenticated
  USING (public.has_app_permission('payroll') OR public.has_app_permission('settings'))
  WITH CHECK (public.has_app_permission('payroll') OR public.has_app_permission('settings'));
CREATE POLICY auth_delete_gapok_events
  ON public.gapok_increment_events FOR DELETE TO authenticated
  USING (public.has_app_permission('payroll') OR public.has_app_permission('settings'));

GRANT SELECT, UPDATE ON public.gapok_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gapok_increment_events TO authenticated;
GRANT ALL ON public.gapok_settings TO service_role;
GRANT ALL ON public.gapok_increment_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gapok_increment_events_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.gapok_increment_events_id_seq TO service_role;

-- ─── 4. Default gapok trigger (pegawai Aktif + Driver/Helper + gapok 0) ───
CREATE OR REPLACE FUNCTION public.set_default_gapok_on_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_driver_jabatan integer;
  v_helper_jabatan integer;
  v_driver_default integer;
  v_helper_default integer;
BEGIN
  SELECT driver_jabatan_id, helper_jabatan_id, driver_default_amount, helper_default_amount
    INTO v_driver_jabatan, v_helper_jabatan, v_driver_default, v_helper_default
  FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN
    -- fallback hard defaults when settings row not yet seeded (e.g. during bootstrap)
    v_driver_jabatan := 16;
    v_helper_jabatan := 14;
    v_driver_default := 2000000;
    v_helper_default := 1000000;
  END IF;

  IF NEW.status = 'Aktif'
     AND NEW.jabatan_id IS NOT NULL
     AND COALESCE(NEW.gaji_pokok, 0) = 0
     AND NEW.jabatan_id IN (v_driver_jabatan, v_helper_jabatan) THEN
    IF NEW.jabatan_id = v_driver_jabatan THEN
      NEW.gaji_pokok := v_driver_default;
    ELSIF NEW.jabatan_id = v_helper_jabatan THEN
      NEW.gaji_pokok := v_helper_default;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pegawai_gapok_default ON public.pegawai;
CREATE TRIGGER trg_pegawai_gapok_default
  BEFORE INSERT OR UPDATE OF status, jabatan_id, gaji_pokok ON public.pegawai
  FOR EACH ROW EXECUTE FUNCTION public.set_default_gapok_on_activation();

-- ─── 5. Helpers for schedule reconciliation ───
CREATE OR REPLACE FUNCTION public.reconcile_gapok_schedule_for_employee(p_employee_id varchar)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_setting RECORD;
  v_emp RECORD;
  v_due date;
  v_milestone integer := 0;
  v_latest_due date := NULL;
  v_latest_milestone integer := 0;
  v_next_due date := NULL;
  v_next_milestone integer := 0;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id, tanggal_bergabung, jabatan_id, status INTO v_emp FROM public.pegawai WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_emp.status <> 'Aktif' THEN RETURN; END IF;
  IF v_emp.jabatan_id IS NULL OR v_emp.jabatan_id NOT IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id) THEN RETURN; END IF;
  IF v_emp.tanggal_bergabung IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.gapok_increment_events WHERE employee_id = v_emp.id AND status = 'Scheduled') THEN
    RETURN;
  END IF;

  -- Find the most recent overdue milestone <= effective_from and the next future > effective_from
  FOR i IN 1..40 LOOP
    v_due := (v_emp.tanggal_bergabung::date + (i * v_setting.interval_months) * interval '1 month')::date;
    IF v_due <= v_setting.effective_from THEN
      v_latest_due := v_due;
      v_latest_milestone := i;
    ELSE
      v_next_due := v_due;
      v_next_milestone := i;
      EXIT;
    END IF;
  END LOOP;

  IF v_latest_due IS NOT NULL THEN
    INSERT INTO public.gapok_increment_events (employee_id, jabatan_id, milestone_no, due_date, status, amount, source)
    VALUES (v_emp.id, v_emp.jabatan_id, v_latest_milestone, v_latest_due, 'Scheduled', v_setting.increment_amount, 'seed')
    ON CONFLICT (employee_id, milestone_no) DO NOTHING;
  ELSIF v_next_due IS NOT NULL THEN
    INSERT INTO public.gapok_increment_events (employee_id, jabatan_id, milestone_no, due_date, status, amount, source)
    VALUES (v_emp.id, v_emp.jabatan_id, v_next_milestone, v_next_due, 'Scheduled', v_setting.increment_amount, 'seed')
    ON CONFLICT (employee_id, milestone_no) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_gapok_schedules()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_setting RECORD;
  r RECORD;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN; END IF;
  FOR r IN SELECT id FROM public.pegawai WHERE status='Aktif' AND jabatan_id IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id) AND tanggal_bergabung IS NOT NULL LOOP
    PERFORM public.reconcile_gapok_schedule_for_employee(r.id);
  END LOOP;
END;
$$;

-- ─── 6. Settings change handler (reschedule future Scheduled events) ───
CREATE OR REPLACE FUNCTION public.handle_gapok_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.interval_months <> OLD.interval_months OR NEW.increment_amount <> OLD.increment_amount OR NEW.driver_jabatan_id IS DISTINCT FROM OLD.driver_jabatan_id OR NEW.helper_jabatan_id IS DISTINCT FROM OLD.helper_jabatan_id THEN
    -- Reschedule due_date & amount for still-Scheduled events
    UPDATE public.gapok_increment_events e
      SET due_date = (p.tanggal_bergabung::date + (e.milestone_no * NEW.interval_months) * interval '1 month')::date,
          amount = NEW.increment_amount,
          updated_at = now()
      FROM public.pegawai p
      WHERE e.employee_id = p.id
        AND e.status = 'Scheduled'
        AND p.tanggal_bergabung IS NOT NULL;

    -- Cancel schedules whose jabatan is no longer eligible
    UPDATE public.gapok_increment_events e
      SET status = 'Cancelled', updated_at = now(), notes = COALESCE(notes,'') || ' Cancelled: jabatan no longer eligible after settings change.'
      FROM public.pegawai p
      WHERE e.employee_id = p.id
        AND e.status = 'Scheduled'
        AND (p.jabatan_id IS NULL OR p.jabatan_id NOT IN (NEW.driver_jabatan_id, NEW.helper_jabatan_id));

    -- Create schedules for newly eligible active employees who lack one
    PERFORM public.reconcile_gapok_schedules();
  END IF;

  IF NEW.notification_days IS DISTINCT FROM OLD.notification_days THEN
    -- notification window only affects UI, no DB reschedule needed
    NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gapok_settings_change ON public.gapok_settings;
CREATE TRIGGER trg_gapok_settings_change
  AFTER UPDATE ON public.gapok_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_gapok_settings_change();

-- ─── 7. Pegawai schedule handler (Aktif/Tidak Aktif, jabatan switch) ───
CREATE OR REPLACE FUNCTION public.handle_pegawai_gapok_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_setting RECORD;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Becoming non-aktif => cancel scheduled
  IF NEW.status <> 'Aktif' AND OLD.status = 'Aktif' THEN
    UPDATE public.gapok_increment_events
      SET status='Cancelled', updated_at=now(), notes=COALESCE(notes,'') || ' Cancelled: status=' || NEW.status
      WHERE employee_id = NEW.id AND status='Scheduled';
    RETURN NEW;
  END IF;

  -- Becoming Aktif or jabatan changed to eligible
  IF (OLD.status <> 'Aktif' AND NEW.status = 'Aktif') OR (OLD.jabatan_id IS DISTINCT FROM NEW.jabatan_id) THEN
    IF NEW.status = 'Aktif' AND NEW.jabatan_id IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id) AND NEW.tanggal_bergabung IS NOT NULL THEN
      -- if no scheduled exists, create one
      IF NOT EXISTS (SELECT 1 FROM public.gapok_increment_events WHERE employee_id = NEW.id AND status='Scheduled') THEN
        PERFORM public.reconcile_gapok_schedule_for_employee(NEW.id);
      END IF;
    ELSE
      -- no longer eligible
      UPDATE public.gapok_increment_events
        SET status='Cancelled', updated_at=now(), notes=COALESCE(notes,'') || ' Cancelled: not eligible jabatan/status'
        WHERE employee_id = NEW.id AND status='Scheduled';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pegawai_gapok_schedule ON public.pegawai;
CREATE TRIGGER trg_pegawai_gapok_schedule
  AFTER UPDATE OF status, jabatan_id ON public.pegawai
  FOR EACH ROW EXECUTE FUNCTION public.handle_pegawai_gapok_schedule();

-- ─── 8. Daily processor (idempotent, locks pegawai row) ───
CREATE OR REPLACE FUNCTION public.process_due_gapok_increments(p_limit integer DEFAULT 100, p_source varchar DEFAULT 'cron', p_actor uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_setting RECORD;
  v_event RECORD;
  v_updated integer := 0;
  v_before integer;
  v_after integer;
  v_next_due date;
  v_next_no integer;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_event IN
    SELECT e.id, e.employee_id, e.milestone_no, e.due_date, e.amount, e.jabatan_id
    FROM public.gapok_increment_events e
    JOIN public.pegawai p ON p.id = e.employee_id
    WHERE e.status = 'Scheduled'
      AND e.due_date <= CURRENT_DATE
      AND p.status = 'Aktif'
      AND p.jabatan_id IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id)
    ORDER BY e.due_date, e.employee_id
    LIMIT p_limit
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    -- Lock pegawai row
    SELECT gaji_pokok INTO v_before FROM public.pegawai WHERE id = v_event.employee_id FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE public.gapok_increment_events SET status='Skipped', notes=COALESCE(notes,'') || ' Skipped: pegawai missing', updated_at=now() WHERE id=v_event.id;
      CONTINUE;
    END IF;
    v_before := COALESCE(v_before, 0);
    v_after := v_before + v_event.amount;

    UPDATE public.pegawai SET gaji_pokok = v_after, updated_at = now() WHERE id = v_event.employee_id;

    UPDATE public.gapok_increment_events
      SET status='Applied', before_gapok=v_before, after_gapok=v_after, applied_at=now(), applied_by=p_actor, source=p_source, updated_at=now()
      WHERE id=v_event.id;

    -- Create next schedule
    v_next_no := v_event.milestone_no + 1;
    -- fetch tanggal_bergabung for next due calc
    SELECT (tanggal_bergabung::date + (v_next_no * v_setting.interval_months) * interval '1 month')::date INTO v_next_due FROM public.pegawai WHERE id=v_event.employee_id;
    IF v_next_due IS NOT NULL THEN
      INSERT INTO public.gapok_increment_events (employee_id, jabatan_id, milestone_no, due_date, status, amount, source)
      VALUES (v_event.employee_id, v_event.jabatan_id, v_next_no, v_next_due, 'Scheduled', v_setting.increment_amount, p_source)
      ON CONFLICT (employee_id, milestone_no) DO NOTHING;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  -- Cleanup overdue scheduled where pegawai no longer eligible (e.g. status changed between select and loop)
  UPDATE public.gapok_increment_events e
    SET status='Cancelled', notes=COALESCE(notes,'') || ' Cancelled: not Aktif/eligible at run', updated_at=now()
    FROM public.pegawai p
    WHERE e.employee_id = p.id
      AND e.status='Scheduled'
      AND e.due_date <= CURRENT_DATE
      AND (p.status <> 'Aktif' OR p.jabatan_id NOT IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id));

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.process_due_gapok_increments(integer, varchar, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_due_gapok_increments(integer, varchar, uuid) TO authenticated, service_role;

-- ─── 9. Seed settings singleton ───
WITH j_driver AS (SELECT id FROM public.jabatan WHERE lower(btrim(nama))='driver' LIMIT 1),
     j_helper AS (SELECT id FROM public.jabatan WHERE lower(btrim(nama))='helper' LIMIT 1)
INSERT INTO public.gapok_settings (id, driver_jabatan_id, helper_jabatan_id, driver_default_amount, helper_default_amount, increment_amount, interval_months, notification_days, effective_from)
SELECT 1, (SELECT id FROM j_driver), (SELECT id FROM j_helper), 2000000, 1000000, 250000, 30, 90, CURRENT_DATE
ON CONFLICT (id) DO UPDATE SET
  driver_jabatan_id = COALESCE(EXCLUDED.driver_jabatan_id, public.gapok_settings.driver_jabatan_id),
  helper_jabatan_id = COALESCE(EXCLUDED.helper_jabatan_id, public.gapok_settings.helper_jabatan_id),
  driver_default_amount = EXCLUDED.driver_default_amount,
  helper_default_amount = EXCLUDED.helper_default_amount,
  increment_amount = EXCLUDED.increment_amount,
  interval_months = EXCLUDED.interval_months,
  notification_days = EXCLUDED.notification_days,
  effective_from = LEAST(public.gapok_settings.effective_from, EXCLUDED.effective_from),
  updated_at = now();

-- ─── 10. Seed schedules for existing active Driver/Helper (future-or-latest-overdue, one per employee) ───
SELECT public.reconcile_gapok_schedules();

-- ─── 11. Cron (00:10 WIB = 17:10 UTC) ───
DO $$ BEGIN PERFORM cron.unschedule('gapok-daily-increment'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('gapok-daily-increment', '10 17 * * *', $$SELECT public.process_due_gapok_increments(100, 'cron', NULL);$$);

NOTIFY pgrst, 'reload schema';
