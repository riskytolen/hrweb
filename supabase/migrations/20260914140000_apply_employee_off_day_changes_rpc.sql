-- Atomic weekly off-day change with an explicit effective date.
-- Keeps historical rows by closing ranges instead of deleting past validity.

CREATE OR REPLACE FUNCTION public.apply_employee_off_day_changes(
  p_effective_date date,
  p_added jsonb DEFAULT '[]'::jsonb,
  p_removed jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  v_employee_id varchar;
  v_day_of_week int;
  v_prev_date date := p_effective_date - 1;
  v_closed int := 0;
  v_deleted int := 0;
  v_inserted int := 0;
  v_touched int;
BEGIN
  IF NOT public.is_internal_account() THEN
    RAISE EXCEPTION 'Tidak berwenang mengubah jadwal libur.' USING ERRCODE = '42501';
  END IF;

  IF p_effective_date IS NULL OR p_effective_date < DATE '2026-05-08' THEN
    RAISE EXCEPTION 'Tanggal efektif minimal 2026-05-08.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(COALESCE(p_added, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_removed, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Payload jadwal tidak valid.' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_removed, '[]'::jsonb)) LOOP
    v_employee_id := item->>'employee_id';
    v_day_of_week := (item->>'day_of_week')::int;

    IF v_employee_id IS NULL OR v_day_of_week IS NULL OR v_day_of_week < 0 OR v_day_of_week > 6 THEN
      RAISE EXCEPTION 'Payload penghapusan jadwal tidak valid.' USING ERRCODE = '22023';
    END IF;

    -- Future/current rows that start at/after the effective date are fully replaced.
    DELETE FROM public.employee_off_days
    WHERE employee_id = v_employee_id
      AND day_of_week = v_day_of_week
      AND effective_from >= p_effective_date;
    GET DIAGNOSTICS v_touched = ROW_COUNT;
    v_deleted := v_deleted + v_touched;

    -- Rows that started before the date keep their history and stop the day before.
    UPDATE public.employee_off_days
    SET effective_to = v_prev_date
    WHERE employee_id = v_employee_id
      AND day_of_week = v_day_of_week
      AND effective_from < p_effective_date
      AND (effective_to IS NULL OR effective_to >= p_effective_date);
    GET DIAGNOSTICS v_touched = ROW_COUNT;
    v_closed := v_closed + v_touched;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_added, '[]'::jsonb)) LOOP
    v_employee_id := item->>'employee_id';
    v_day_of_week := (item->>'day_of_week')::int;

    IF v_employee_id IS NULL OR v_day_of_week IS NULL OR v_day_of_week < 0 OR v_day_of_week > 6 THEN
      RAISE EXCEPTION 'Payload penambahan jadwal tidak valid.' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.employee_off_days
    WHERE employee_id = v_employee_id
      AND day_of_week = v_day_of_week
      AND effective_from >= p_effective_date;
    GET DIAGNOSTICS v_touched = ROW_COUNT;
    v_deleted := v_deleted + v_touched;

    UPDATE public.employee_off_days
    SET effective_to = v_prev_date
    WHERE employee_id = v_employee_id
      AND day_of_week = v_day_of_week
      AND effective_from < p_effective_date
      AND (effective_to IS NULL OR effective_to >= p_effective_date);
    GET DIAGNOSTICS v_touched = ROW_COUNT;
    v_closed := v_closed + v_touched;

    INSERT INTO public.employee_off_days (employee_id, day_of_week, effective_from, effective_to)
    VALUES (v_employee_id, v_day_of_week, p_effective_date, NULL)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_touched = ROW_COUNT;
    v_inserted := v_inserted + v_touched;
  END LOOP;

  RETURN jsonb_build_object(
    'closed', v_closed,
    'deleted', v_deleted,
    'inserted', v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_employee_off_day_changes(date, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_employee_off_day_changes(date, jsonb, jsonb) TO authenticated;
