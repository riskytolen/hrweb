-- Harden gapok increments after rollout review.
-- Existing salaries stay unchanged. All open schedules are rebuilt to the
-- first milestone strictly after the rollout/current eligibility cutoff.

DO $$
BEGIN
  PERFORM cron.unschedule('gapok-daily-increment');
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%could not find valid entry%' THEN
      RAISE;
    END IF;
END $$;

-- Settings must always point to two different jabatan rows.
ALTER TABLE public.gapok_settings
  ALTER COLUMN driver_jabatan_id SET NOT NULL,
  ALTER COLUMN helper_jabatan_id SET NOT NULL;

ALTER TABLE public.gapok_settings
  DROP CONSTRAINT IF EXISTS gapok_settings_distinct_jabatan;
ALTER TABLE public.gapok_settings
  ADD CONSTRAINT gapok_settings_distinct_jabatan
  CHECK (driver_jabatan_id <> helper_jabatan_id);

CREATE INDEX IF NOT EXISTS idx_gapok_settings_driver_jabatan
  ON public.gapok_settings (driver_jabatan_id);
CREATE INDEX IF NOT EXISTS idx_gapok_settings_helper_jabatan
  ON public.gapok_settings (helper_jabatan_id);
CREATE INDEX IF NOT EXISTS idx_gapok_events_jabatan
  ON public.gapok_increment_events (jabatan_id);
DROP INDEX IF EXISTS public.idx_gapok_events_employee;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gapok_events_one_scheduled_per_employee
  ON public.gapok_increment_events (employee_id)
  WHERE status = 'Scheduled';

-- Scheduled rows are operational state, not immutable history. Rebuild them
-- using the corrected future-only policy; Applied rows are never touched.
DELETE FROM public.gapok_increment_events WHERE status = 'Scheduled';

-- The settings row is mandatory. Fail closed instead of using environment IDs.
CREATE OR REPLACE FUNCTION public.set_default_gapok_on_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_setting public.gapok_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Aktif'
     AND COALESCE(NEW.gaji_pokok, 0) = 0
     AND NEW.jabatan_id IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id) THEN
    NEW.gaji_pokok := CASE
      WHEN NEW.jabatan_id = v_setting.driver_jabatan_id THEN v_setting.driver_default_amount
      ELSE v_setting.helper_default_amount
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Rebuild one employee's next milestone. p_cutoff prevents retroactive raises
-- for rollout, imported historical staff, and reactivation after termination.
CREATE OR REPLACE FUNCTION public.reconcile_gapok_schedule_for_employee(
  p_employee_id varchar,
  p_cutoff date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_setting public.gapok_settings%ROWTYPE;
  v_emp record;
  v_cutoff date;
  v_last_applied integer;
  v_next_no integer;
  v_next_due date;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id, tanggal_bergabung, jabatan_id, status, created_at
    INTO v_emp
  FROM public.pegawai
  WHERE id = p_employee_id;

  IF NOT FOUND
     OR v_emp.status <> 'Aktif'
     OR v_emp.tanggal_bergabung IS NULL
     OR v_emp.jabatan_id NOT IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id) THEN
    RETURN;
  END IF;

  v_cutoff := GREATEST(
    v_setting.effective_from,
    (v_emp.created_at AT TIME ZONE 'Asia/Jakarta')::date,
    COALESCE(p_cutoff, v_setting.effective_from)
  );

  SELECT COALESCE(max(milestone_no), 0)
    INTO v_last_applied
  FROM public.gapok_increment_events
  WHERE employee_id = v_emp.id
    AND status = 'Applied';

  SELECT n,
         (v_emp.tanggal_bergabung::date + (n * v_setting.interval_months) * interval '1 month')::date
    INTO v_next_no, v_next_due
  FROM generate_series(GREATEST(1, v_last_applied + 1), 100) AS n
  WHERE (v_emp.tanggal_bergabung::date + (n * v_setting.interval_months) * interval '1 month')::date > v_cutoff
  ORDER BY n
  LIMIT 1;

  IF v_next_no IS NULL THEN RETURN; END IF;

  DELETE FROM public.gapok_increment_events
  WHERE employee_id = v_emp.id
    AND status = 'Scheduled';

  INSERT INTO public.gapok_increment_events (
    employee_id, jabatan_id, milestone_no, due_date, status, amount, source, notes
  )
  VALUES (
    v_emp.id, v_emp.jabatan_id, v_next_no, v_next_due, 'Scheduled',
    v_setting.increment_amount, 'system', NULL
  )
  ON CONFLICT (employee_id, milestone_no) DO UPDATE
    SET jabatan_id = EXCLUDED.jabatan_id,
        due_date = EXCLUDED.due_date,
        status = 'Scheduled',
        amount = EXCLUDED.amount,
        source = 'system',
        notes = NULL,
        updated_at = now()
    WHERE public.gapok_increment_events.status IN ('Cancelled', 'Skipped');
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_gapok_schedules()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_setting public.gapok_settings%ROWTYPE;
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  r record;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN; END IF;

  FOR r IN
    SELECT id
    FROM public.pegawai
    WHERE status = 'Aktif'
      AND jabatan_id IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id)
      AND tanggal_bergabung IS NOT NULL
  LOOP
    PERFORM public.reconcile_gapok_schedule_for_employee(r.id, v_today);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_gapok_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.increment_amount IS DISTINCT FROM OLD.increment_amount THEN
    UPDATE public.gapok_increment_events
    SET amount = NEW.increment_amount,
        updated_at = now()
    WHERE status = 'Scheduled';
  END IF;

  IF NEW.interval_months IS DISTINCT FROM OLD.interval_months
     OR NEW.driver_jabatan_id IS DISTINCT FROM OLD.driver_jabatan_id
     OR NEW.helper_jabatan_id IS DISTINCT FROM OLD.helper_jabatan_id
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
    UPDATE public.gapok_increment_events e
    SET status = 'Cancelled',
        notes = 'Cancelled: no longer eligible after settings change.',
        updated_at = now()
    FROM public.pegawai p
    WHERE e.employee_id = p.id
      AND e.status = 'Scheduled'
      AND p.jabatan_id NOT IN (NEW.driver_jabatan_id, NEW.helper_jabatan_id);

    PERFORM public.reconcile_gapok_schedules();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_pegawai_gapok_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_setting public.gapok_settings%ROWTYPE;
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Cuti is temporary and preserves its existing schedule. Termination or a
  -- non-eligible jabatan cancels the open schedule.
  IF NEW.status IN ('Tidak Aktif', 'Training')
     OR NEW.jabatan_id NOT IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id) THEN
    UPDATE public.gapok_increment_events
    SET status = 'Cancelled',
        notes = 'Cancelled: employee is inactive or no longer eligible.',
        updated_at = now()
    WHERE employee_id = NEW.id
      AND status = 'Scheduled';
    RETURN NEW;
  END IF;

  IF NEW.status = 'Aktif'
     AND NEW.jabatan_id IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id)
     AND NEW.tanggal_bergabung IS NOT NULL
     AND (
       OLD.status IS DISTINCT FROM NEW.status
       OR OLD.jabatan_id IS DISTINCT FROM NEW.jabatan_id
       OR OLD.tanggal_bergabung IS DISTINCT FROM NEW.tanggal_bergabung
     ) THEN
    PERFORM public.reconcile_gapok_schedule_for_employee(NEW.id, v_today);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pegawai_gapok_schedule ON public.pegawai;
CREATE TRIGGER trg_pegawai_gapok_schedule
  AFTER UPDATE OF status, jabatan_id, tanggal_bergabung ON public.pegawai
  FOR EACH ROW EXECUTE FUNCTION public.handle_pegawai_gapok_schedule();

CREATE OR REPLACE FUNCTION public.handle_pegawai_gapok_schedule_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'Aktif' AND NEW.tanggal_bergabung IS NOT NULL THEN
    PERFORM public.reconcile_gapok_schedule_for_employee(
      NEW.id,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date
    );
  END IF;
  RETURN NEW;
END;
$$;

-- The first rollout created a one-argument overload. All callers above now use
-- the corrected two-argument function, so remove the unsafe legacy overload.
DROP FUNCTION IF EXISTS public.reconcile_gapok_schedule_for_employee(varchar);

-- Remove the unsafe caller-controlled worker signature.
DROP FUNCTION IF EXISTS public.process_due_gapok_increments(integer, varchar, uuid);

CREATE OR REPLACE FUNCTION public.process_due_gapok_increments_worker(
  p_limit integer DEFAULT 500,
  p_source varchar DEFAULT 'cron',
  p_actor uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_setting public.gapok_settings%ROWTYPE;
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  v_candidate record;
  v_event public.gapok_increment_events%ROWTYPE;
  v_emp record;
  v_before integer;
  v_after integer;
  v_next_no integer;
  v_next_due date;
  v_updated integer := 0;
BEGIN
  p_limit := GREATEST(1, LEAST(COALESCE(p_limit, 500), 500));
  IF p_source NOT IN ('cron', 'manual', 'system') THEN
    RAISE EXCEPTION 'Invalid gapok processing source';
  END IF;

  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_candidate IN
    SELECT e.id, e.employee_id
    FROM public.gapok_increment_events e
    WHERE e.status = 'Scheduled'
      AND e.due_date <= v_today
    ORDER BY e.due_date, e.employee_id
    LIMIT p_limit
  LOOP
    -- Keep the same lock order as employee lifecycle updates: employee first,
    -- then its schedule row.
    SELECT id, status, jabatan_id, tanggal_bergabung, gaji_pokok
      INTO v_emp
    FROM public.pegawai
    WHERE id = v_candidate.employee_id
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT * INTO v_event
    FROM public.gapok_increment_events
    WHERE id = v_candidate.id
      AND status = 'Scheduled'
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_event.due_date > v_today
       OR v_emp.status <> 'Aktif'
       OR v_emp.tanggal_bergabung IS NULL
       OR v_emp.jabatan_id NOT IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id) THEN
      CONTINUE;
    END IF;

    v_before := COALESCE(v_emp.gaji_pokok, 0);
    UPDATE public.pegawai
    SET gaji_pokok = v_before + v_setting.increment_amount,
        updated_at = now()
    WHERE id = v_emp.id
    RETURNING gaji_pokok INTO v_after;

    UPDATE public.gapok_increment_events
    SET status = 'Applied',
        jabatan_id = v_emp.jabatan_id,
        amount = v_setting.increment_amount,
        before_gapok = v_before,
        after_gapok = v_after,
        applied_at = now(),
        applied_by = p_actor,
        source = p_source,
        updated_at = now()
    WHERE id = v_event.id;

    v_next_no := v_event.milestone_no + 1;
    v_next_due := (
      v_emp.tanggal_bergabung::date
      + (v_next_no * v_setting.interval_months) * interval '1 month'
    )::date;

    INSERT INTO public.gapok_increment_events (
      employee_id, jabatan_id, milestone_no, due_date, status, amount, source
    )
    VALUES (
      v_emp.id, v_emp.jabatan_id, v_next_no, v_next_due, 'Scheduled',
      v_setting.increment_amount, p_source
    )
    ON CONFLICT (employee_id, milestone_no) DO UPDATE
      SET jabatan_id = EXCLUDED.jabatan_id,
          due_date = EXCLUDED.due_date,
          status = 'Scheduled',
          amount = EXCLUDED.amount,
          source = EXCLUDED.source,
          notes = NULL,
          updated_at = now()
      WHERE public.gapok_increment_events.status IN ('Cancelled', 'Skipped');

    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

-- Permission-checked manual wrapper. The caller cannot forge actor or source.
CREATE OR REPLACE FUNCTION public.process_due_gapok_increments(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_app_permission('payroll') THEN
    RAISE EXCEPTION 'Insufficient payroll permission' USING ERRCODE = '42501';
  END IF;
  RETURN public.process_due_gapok_increments_worker(p_limit, 'manual', auth.uid());
END;
$$;

-- All manual master-gapok changes use this RPC so the stored value is returned
-- after database triggers and payroll permission is enforced server-side.
CREATE OR REPLACE FUNCTION public.set_employee_gapok(
  p_employee_id varchar,
  p_amount integer
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
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Gapok cannot be negative';
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

  RETURN QUERY SELECT COALESCE(v_old, 0), v_new;
END;
$$;

-- Event history is client read-only. Only controlled functions and triggers
-- can mutate it.
DROP POLICY IF EXISTS auth_insert_gapok_events ON public.gapok_increment_events;
DROP POLICY IF EXISTS auth_update_gapok_events ON public.gapok_increment_events;
DROP POLICY IF EXISTS auth_delete_gapok_events ON public.gapok_increment_events;
REVOKE INSERT, UPDATE, DELETE ON public.gapok_increment_events FROM authenticated;
REVOKE USAGE, SELECT ON SEQUENCE public.gapok_increment_events_id_seq FROM authenticated;

-- Prevent direct browser writes to gaji_pokok while preserving existing
-- employee forms/imports for all non-salary columns.
REVOKE INSERT, UPDATE ON public.pegawai FROM authenticated;
GRANT INSERT (
  id, nama, jenis_kelamin, agama, status, no_ktp, tempat_lahir,
  tanggal_lahir, alamat_ktp, alamat_domisili, no_telp, tanggal_bergabung,
  jabatan_id, status_pernikahan, nama_pasangan, jumlah_anak, foto_ktp,
  foto_diri, no_bpjs_kesehatan, no_bpjs_ketenagakerjaan, foto_sim,
  no_rekening, bank, nama_rekening, kartu_keluarga, tanggal_mulai_pkwt,
  tanggal_berakhir_pkwt, recruitment_id, foto_skck, tanggal_keluar,
  non_active_periods
) ON public.pegawai TO authenticated;
GRANT UPDATE (
  nama, jenis_kelamin, agama, status, no_ktp, tempat_lahir,
  tanggal_lahir, alamat_ktp, alamat_domisili, no_telp, tanggal_bergabung,
  jabatan_id, status_pernikahan, nama_pasangan, jumlah_anak, foto_ktp,
  foto_diri, no_bpjs_kesehatan, no_bpjs_ketenagakerjaan, foto_sim,
  no_rekening, bank, nama_rekening, kartu_keluarga, tanggal_mulai_pkwt,
  tanggal_berakhir_pkwt, recruitment_id, foto_skck, tanggal_keluar,
  non_active_periods
) ON public.pegawai TO authenticated;

-- Trigger/internal helpers must never be exposed as RPCs.
REVOKE ALL ON FUNCTION public.set_default_gapok_on_activation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_gapok_schedule_for_employee(varchar, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_gapok_schedules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_gapok_settings_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_pegawai_gapok_schedule() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_pegawai_gapok_schedule_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_due_gapok_increments_worker(integer, varchar, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_gapok_increments_worker(integer, varchar, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.process_due_gapok_increments(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_due_gapok_increments(integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_employee_gapok(varchar, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_gapok(varchar, integer) TO authenticated, service_role;

-- Rebuild the 51 current employee schedules after all corrected functions are
-- in place. This does not update pegawai.gaji_pokok.
SELECT public.reconcile_gapok_schedules();

-- 00:10 WIB. The worker itself uses an explicit Asia/Jakarta business date.
SELECT cron.schedule(
  'gapok-daily-increment',
  '10 17 * * *',
  $$SELECT public.process_due_gapok_increments_worker(500, 'cron', NULL);$$
);

NOTIFY pgrst, 'reload schema';
