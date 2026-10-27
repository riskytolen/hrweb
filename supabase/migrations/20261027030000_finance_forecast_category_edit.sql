-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: edit nama kategori pengeluaran Forecast
-- ───────────────────────────────────────────────────────────────
-- Rename pada master kategori sekaligus memperbarui nama kategori
-- di seluruh baris pengeluaran Forecast yang memakainya. Dengan
-- begitu rekap dan ekspor tetap mengelompok pada kategori yang sama.
-- Kategori fallback PENGELUARAN LAINNYA dilindungi dari rename.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rename_finance_forecast_category(
  p_id   bigint,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row             public.finance_forecast_categories%ROWTYPE;
  v_old_name        text;
  v_name            text;
  v_updated_expenses integer := 0;
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
    RAISE EXCEPTION 'Akun ini tidak punya akses mengubah kategori Forecast.';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Kategori yang akan diubah tidak valid.';
  END IF;

  SELECT * INTO v_row
  FROM public.finance_forecast_categories
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kategori tidak ditemukan.';
  END IF;

  v_old_name := v_row.name;

  IF upper(btrim(v_old_name)) = 'PENGELUARAN LAINNYA' THEN
    RAISE EXCEPTION 'PENGELUARAN LAINNYA adalah kategori sistem dan tidak dapat diubah namanya.';
  END IF;

  v_name := upper(regexp_replace(btrim(COALESCE(p_name, '')), '[[:space:]]+', ' ', 'g'));

  IF v_name = '' OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'Nama kategori harus 1–60 karakter.';
  END IF;

  IF v_name = v_old_name THEN
    RETURN jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'previous_name', v_old_name,
      'sort_order', v_row.sort_order,
      'updated_expenses', 0
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.finance_forecast_categories
    WHERE upper(name) = v_name
      AND id <> p_id
  ) THEN
    RAISE EXCEPTION 'Nama kategori % sudah digunakan.', v_name;
  END IF;

  UPDATE public.finance_forecast_categories
  SET name = v_name
  WHERE id = p_id
  RETURNING * INTO v_row;

  UPDATE public.finance_forecast_expenses
  SET category = v_name
  WHERE upper(btrim(category)) = v_old_name;

  GET DIAGNOSTICS v_updated_expenses = ROW_COUNT;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'previous_name', v_old_name,
    'sort_order', v_row.sort_order,
    'updated_expenses', v_updated_expenses
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rename_finance_forecast_category(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_finance_forecast_category(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
