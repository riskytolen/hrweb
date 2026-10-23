-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Finance Forecast (rencana kas mingguan)
-- ───────────────────────────────────────────────────────────────
-- Tabel:
--   finance_forecast_months   — satu lembar per bulan (saldo awal + versi)
--   finance_forecast_incomes  — rencana pemasukan per minggu
--   finance_forecast_expenses — rencana pengeluaran per minggu
--
-- Forecast adalah dokumen RENCANA yang terpisah dari transaksi aktual:
-- tidak menulis ke finance_invoices / finance_invoice_payments /
-- finance_expenses, dan tidak memengaruhi Arus Kas maupun Tutup Buku.
--
-- Pembagian minggu: 1–7, 8–14, 15–21, 22–akhir bulan.
-- Saldo mingguan dihitung aplikasi:
--   saldo akhir = saldo awal + pemasukan − nominal pengeluaran − admin
-- ═══════════════════════════════════════════════════════════════

-- ─── Tabel ───
CREATE TABLE IF NOT EXISTS public.finance_forecast_months (
  id               BIGSERIAL PRIMARY KEY,
  period_start     DATE NOT NULL UNIQUE,
  opening_balance  BIGINT NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  notes            TEXT,
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID
);

CREATE TABLE IF NOT EXISTS public.finance_forecast_incomes (
  id           BIGSERIAL PRIMARY KEY,
  month_id     BIGINT NOT NULL REFERENCES public.finance_forecast_months(id) ON DELETE CASCADE,
  week_no      SMALLINT NOT NULL CHECK (week_no BETWEEN 1 AND 4),
  planned_date DATE NOT NULL,
  description  TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  amount       BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  invoice_id   BIGINT REFERENCES public.finance_invoices(id) ON DELETE SET NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_forecast_expenses (
  id           BIGSERIAL PRIMARY KEY,
  month_id     BIGINT NOT NULL REFERENCES public.finance_forecast_months(id) ON DELETE CASCADE,
  week_no      SMALLINT NOT NULL CHECK (week_no BETWEEN 1 AND 4),
  planned_date DATE NOT NULL,
  description  TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  amount       BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment      BIGINT NOT NULL DEFAULT 0 CHECK (payment >= 0),
  admin        BIGINT NOT NULL DEFAULT 0 CHECK (admin >= 0),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_forecast_expenses_payment_lte_amount CHECK (payment <= amount)
);

-- Satu invoice hanya boleh dirujuk sekali dalam satu bulan forecast.
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_forecast_incomes_invoice
  ON public.finance_forecast_incomes (month_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_forecast_incomes_month
  ON public.finance_forecast_incomes (month_id, week_no, sort_order);
CREATE INDEX IF NOT EXISTS idx_finance_forecast_expenses_month
  ON public.finance_forecast_expenses (month_id, week_no, sort_order);

-- ─── Trigger updated_at ───
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_forecast_months', 'finance_forecast_incomes', 'finance_forecast_expenses'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      t, t
    );
  END LOOP;
END $$;

-- ─── RLS ───
ALTER TABLE public.finance_forecast_months    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_forecast_incomes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_forecast_expenses  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'finance_forecast_months', 'finance_forecast_incomes', 'finance_forecast_expenses'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_select_%s ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY auth_select_%s ON public.%I FOR SELECT TO authenticated USING ('
      ' public.finance_internal_active() AND public.has_app_permission(''finance'', true)'
      ');',
      tbl, tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS auth_insert_%s ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY auth_insert_%s ON public.%I FOR INSERT TO authenticated WITH CHECK ('
      ' EXISTS (SELECT 1 FROM public.user_profiles up JOIN public.roles r ON r.id = up.role_id'
      '  WHERE up.id = auth.uid() AND up.status = ''Aktif'' AND r.status = ''Aktif'''
      '  AND COALESCE(up.account_type, ''internal'') = ''internal'''
      '  AND (r.permissions ? ''all'' OR r.permissions ? ''finance'' OR r.permissions ? ''finance.input''))'
      ');',
      tbl, tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS auth_update_%s ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY auth_update_%s ON public.%I FOR UPDATE TO authenticated USING ('
      ' public.finance_internal_active() AND public.has_app_permission(''finance'')'
      ') WITH CHECK ('
      ' public.finance_internal_active() AND public.has_app_permission(''finance'')'
      ');',
      tbl, tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS auth_delete_%s ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY auth_delete_%s ON public.%I FOR DELETE TO authenticated USING ('
      ' public.finance_internal_active() AND public.has_app_permission(''finance'')'
      ');',
      tbl, tbl
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_forecast_months   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_forecast_incomes  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_forecast_expenses TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.finance_forecast_months_id_seq   TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.finance_forecast_incomes_id_seq  TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.finance_forecast_expenses_id_seq TO authenticated;

-- ─── RPC simpan atomik ───
-- Mengganti seluruh baris bulan dalam satu transaksi + cek versi optimistik
-- agar dua pengguna tidak saling menimpa tanpa sadar.
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
    (month_id, week_no, planned_date, description, amount, payment, admin, sort_order)
  SELECT v_id,
         (elem->>'week_no')::smallint,
         (elem->>'planned_date')::date,
         btrim(elem->>'description'),
         COALESCE((elem->>'amount')::bigint, 0),
         COALESCE((elem->>'payment')::bigint, 0),
         COALESCE((elem->>'admin')::bigint, 0),
         COALESCE((elem->>'sort_order')::integer, ord::integer - 1)
    FROM jsonb_array_elements(COALESCE(p_expenses, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord);

  RETURN jsonb_build_object('month_id', v_id, 'version', v_version);
END;
$$;

REVOKE ALL ON FUNCTION public.save_finance_forecast(date, bigint, integer, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_finance_forecast(date, bigint, integer, text, jsonb, jsonb)
  TO authenticated;
