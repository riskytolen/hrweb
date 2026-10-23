-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: kategori pengeluaran Forecast Finance
-- ───────────────────────────────────────────────────────────────
-- Setiap baris pengeluaran forecast punya kategori rekap bulanan.
-- Kategori dipilih eksplisit per baris di UI; RPC menyimpan nilainya
-- dan memakai "PENGELUARAN LAINNYA" bila payload lama tidak mengirim
-- kategori (kompatibel dengan data/klien sebelum migrasi ini).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.finance_forecast_expenses
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'PENGELUARAN LAINNYA';

COMMENT ON COLUMN public.finance_forecast_expenses.category IS
  'Kategori rekap pengeluaran forecast, mis. GAJI KARYAWAN / BBM & E-MONEY / ANGSURAN.';

-- RPC yang sama, kini membaca dan menyimpan kategori per baris.
CREATE OR REPLACE FUNCTION public.save_finance_forecast(
  p_period_start    date,
  p_opening_balance bigint,
  p_version         integer,
  p_notes           text,
  p_incomes         jsonb,
  p_expenses        jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start   date := date_trunc('month', p_period_start)::date;
  v_end     date := (date_trunc('month', p_period_start) + interval '1 month')::date;
  v_row     public.finance_forecast_months%ROWTYPE;
  v_id      bigint;
  v_version integer;
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
    RAISE EXCEPTION 'Akun ini tidak punya akses menyimpan Forecast Finance.';
  END IF;

  IF date_trunc('month', p_period_start)::date <> p_period_start THEN
    RAISE EXCEPTION 'Periode forecast harus tanggal 1 bulan.';
  END IF;
  IF COALESCE(p_opening_balance, 0) < 0 THEN
    RAISE EXCEPTION 'Saldo awal tidak boleh negatif.';
  END IF;
  IF jsonb_typeof(COALESCE(p_incomes, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_expenses, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Payload forecast tidak valid.';
  END IF;

  -- Validasi isi payload sebelum menyentuh tabel.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_incomes, '[]'::jsonb)) AS t(elem)
    WHERE btrim(COALESCE(elem->>'description', '')) = ''
       OR COALESCE((elem->>'amount')::bigint, 0) < 0
       OR COALESCE((elem->>'week_no')::integer, 0) NOT BETWEEN 1 AND 4
       OR (elem->>'planned_date')::date < v_start
       OR (elem->>'planned_date')::date >= v_end
  ) THEN
    RAISE EXCEPTION 'Data pemasukan forecast tidak valid (tanggal/minggu/nominal/keterangan).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_expenses, '[]'::jsonb)) AS t(elem)
    WHERE btrim(COALESCE(elem->>'description', '')) = ''
       OR COALESCE((elem->>'amount')::bigint, 0) < 0
       OR COALESCE((elem->>'payment')::bigint, 0) < 0
       OR COALESCE((elem->>'admin')::bigint, 0) < 0
       OR COALESCE((elem->>'payment')::bigint, 0) > COALESCE((elem->>'amount')::bigint, 0)
       OR COALESCE((elem->>'week_no')::integer, 0) NOT BETWEEN 1 AND 4
       OR (elem->>'planned_date')::date < v_start
       OR (elem->>'planned_date')::date >= v_end
  ) THEN
    RAISE EXCEPTION 'Data pengeluaran forecast tidak valid (tanggal/minggu/nominal/pembayaran/admin).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_incomes, '[]'::jsonb)) AS t(elem)
    WHERE NULLIF(elem->>'invoice_id', '') IS NOT NULL
    GROUP BY (elem->>'invoice_id')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invoice yang sama tidak boleh dipakai dua kali dalam satu bulan.';
  END IF;

  SELECT * INTO v_row
    FROM public.finance_forecast_months
   WHERE period_start = v_start
   FOR UPDATE;

  IF FOUND THEN
    IF p_version IS DISTINCT FROM v_row.version THEN
      RAISE EXCEPTION 'Forecast bulan ini sudah diperbarui pengguna lain. Muat ulang data lalu ulangi.';
    END IF;
    v_id := v_row.id;
    v_version := v_row.version + 1;
    UPDATE public.finance_forecast_months
       SET opening_balance = COALESCE(p_opening_balance, 0),
           notes = p_notes,
           version = v_version,
           updated_at = now(),
           updated_by = auth.uid()
     WHERE id = v_id;
    DELETE FROM public.finance_forecast_incomes WHERE month_id = v_id;
    DELETE FROM public.finance_forecast_expenses WHERE month_id = v_id;
  ELSE
    IF COALESCE(p_version, 0) <> 0 THEN
      RAISE EXCEPTION 'Forecast bulan ini belum ada. Muat ulang halaman.';
    END IF;
    INSERT INTO public.finance_forecast_months
      (period_start, opening_balance, notes, version, updated_by)
    VALUES (v_start, COALESCE(p_opening_balance, 0), p_notes, 1, auth.uid())
    RETURNING id, version INTO v_id, v_version;
  END IF;

  INSERT INTO public.finance_forecast_incomes
    (month_id, week_no, planned_date, description, amount, invoice_id, sort_order)
  SELECT v_id,
         (elem->>'week_no')::smallint,
         (elem->>'planned_date')::date,
         btrim(elem->>'description'),
         COALESCE((elem->>'amount')::bigint, 0),
         NULLIF(elem->>'invoice_id', '')::bigint,
         COALESCE((elem->>'sort_order')::integer, ord::integer - 1)
    FROM jsonb_array_elements(COALESCE(p_incomes, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord);

  INSERT INTO public.finance_forecast_expenses
    (month_id, week_no, planned_date, description, amount, payment, admin, category, sort_order)
  SELECT v_id,
         (elem->>'week_no')::smallint,
         (elem->>'planned_date')::date,
         btrim(elem->>'description'),
         COALESCE((elem->>'amount')::bigint, 0),
         COALESCE((elem->>'payment')::bigint, 0),
         COALESCE((elem->>'admin')::bigint, 0),
         COALESCE(NULLIF(btrim(elem->>'category'), ''), 'PENGELUARAN LAINNYA'),
         COALESCE((elem->>'sort_order')::integer, ord::integer - 1)
    FROM jsonb_array_elements(COALESCE(p_expenses, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord);

  RETURN jsonb_build_object('month_id', v_id, 'version', v_version);
END;
$$;

REVOKE ALL ON FUNCTION public.save_finance_forecast(date, bigint, integer, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_finance_forecast(date, bigint, integer, text, jsonb, jsonb)
  TO authenticated;
