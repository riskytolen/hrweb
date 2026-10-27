-- Perbaikan normalisasi spasi nama kategori Forecast.
-- Versi sebelumnya memakai escape regex yang salah; gunakan POSIX space class.

CREATE OR REPLACE FUNCTION public.add_finance_forecast_category(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_row  public.finance_forecast_categories%ROWTYPE;
BEGIN
  IF NOT (
    public.finance_internal_active()
    AND (
      public.has_app_permission('finance')
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        JOIN public.roles r ON r.id = up.role_id
        WHERE up.id = auth.uid()
          AND up.status = 'Aktif'
          AND r.status = 'Aktif'
          AND r.permissions ? 'finance.input'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Akun ini tidak punya akses menambah kategori Forecast.';
  END IF;

  v_name := upper(regexp_replace(btrim(COALESCE(p_name, '')), '[[:space:]]+', ' ', 'g'));
  IF v_name = '' OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'Nama kategori harus 1–60 karakter.';
  END IF;

  SELECT * INTO v_row
  FROM public.finance_forecast_categories
  WHERE name = v_name;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'sort_order', v_row.sort_order,
      'created', false
    );
  END IF;

  INSERT INTO public.finance_forecast_categories (name, sort_order, created_by)
  VALUES (
    v_name,
    COALESCE((SELECT MAX(sort_order) FROM public.finance_forecast_categories), 0) + 10,
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'sort_order', v_row.sort_order,
    'created', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.add_finance_forecast_category(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_finance_forecast_category(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
