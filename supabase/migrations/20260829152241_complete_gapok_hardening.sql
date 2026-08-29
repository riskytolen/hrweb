-- Complete the hardening after validating production permissions and edge
-- cases: unrestricted milestone age, recruitment mapping access, and Applied
-- history retention when employee records are removed.

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

  v_next_no := GREATEST(1, v_last_applied + 1);
  v_next_due := (
    v_emp.tanggal_bergabung::date
    + (v_next_no * v_setting.interval_months) * interval '1 month'
  )::date;

  WHILE v_next_due <= v_cutoff LOOP
    v_next_no := v_next_no + 1;
    v_next_due := (
      v_emp.tanggal_bergabung::date
      + (v_next_no * v_setting.interval_months) * interval '1 month'
    )::date;
  END LOOP;

  DELETE FROM public.gapok_increment_events
  WHERE employee_id = v_emp.id
    AND status = 'Scheduled';

  INSERT INTO public.gapok_increment_events (
    employee_id, jabatan_id, milestone_no, due_date, status, amount, source, notes
  )
  VALUES (
    v_emp.id, v_emp.jabatan_id, v_next_no, v_next_due,
    'Scheduled', v_setting.increment_amount, 'system', NULL
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

REVOKE ALL ON FUNCTION public.reconcile_gapok_schedule_for_employee(varchar, date)
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS auth_select_gapok_settings ON public.gapok_settings;
CREATE POLICY auth_select_gapok_settings
  ON public.gapok_settings
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_permission('settings', true)
    OR public.has_app_permission('payroll', true)
    OR public.has_app_permission('recruitment', true)
  );

CREATE OR REPLACE FUNCTION public.protect_applied_gapok_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.gapok_increment_events
    WHERE employee_id = OLD.id
      AND status = 'Applied'
  ) THEN
    RAISE EXCEPTION 'Employee with applied gapok history cannot be deleted; set the employee inactive instead.'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_applied_gapok_history ON public.pegawai;
CREATE TRIGGER trg_protect_applied_gapok_history
BEFORE DELETE ON public.pegawai
FOR EACH ROW
EXECUTE FUNCTION public.protect_applied_gapok_history();

REVOKE ALL ON FUNCTION public.protect_applied_gapok_history()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
