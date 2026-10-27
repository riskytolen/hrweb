-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: master kategori pengeluaran Forecast
-- ───────────────────────────────────────────────────────────────
-- Kategori kini tersimpan di database dan bisa ditambah pengguna.
-- Kategori baru berlaku lintas bulan, langsung muncul di dropdown
-- pengeluaran, rekap bulanan, dan ekspor PDF/XLSX.
-- Nama kategori disimpan uppercase dan dinormalisasi di RPC.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.finance_forecast_categories (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  CONSTRAINT finance_forecast_categories_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 60)
);

ALTER TABLE public.finance_forecast_categories ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.finance_forecast_categories TO authenticated;

DROP POLICY IF EXISTS auth_select_finance_forecast_categories ON public.finance_forecast_categories;
CREATE POLICY auth_select_finance_forecast_categories
  ON public.finance_forecast_categories
  FOR SELECT
  TO authenticated
  USING (public.has_app_permission('finance', true));

INSERT INTO public.finance_forecast_categories (name, sort_order)
SELECT category, ord * 10
FROM unnest(ARRAY[
  'BBM & E-MONEY',
  'MAINTENANCE & PURCHASE',
  'BPJS KESEHATAN',
  'PPN KELUARAN',
  'BPJS KETENAGAKERJAAN',
  'GAJI KARYAWAN',
  'MC EASY TMS',
  'MC EASY APLIKASI',
  'MC EASY LAINNYA',
  'SEWA MOBIL',
  'PENGELUARAN LAINNYA',
  'BOP KIKI',
  'TABUNGAN PERUSAHAAN',
  'ANGSURAN'
]::text[]) WITH ORDINALITY AS t(category, ord)
ON CONFLICT (name) DO NOTHING;

-- Pertahankan kategori kustom yang mungkin sudah ada pada baris lama.
INSERT INTO public.finance_forecast_categories (name, sort_order)
SELECT category, 1000 + row_number() OVER (ORDER BY category)
FROM (
  SELECT DISTINCT upper(btrim(category)) AS category
  FROM public.finance_forecast_expenses
  WHERE btrim(COALESCE(category, '')) <> ''
) existing
ON CONFLICT (name) DO NOTHING;

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
