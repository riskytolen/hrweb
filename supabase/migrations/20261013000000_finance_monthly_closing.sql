-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Finance monthly closing (tutup buku)
-- ───────────────────────────────────────────────────────────────
-- Aturan yang dikunci:
-- - Pendapatan Laba Rugi = finance_invoices.total_amount berdasar invoice_date.
-- - Semua pengeluaran langsung mengurangi kas pada expense_date
--   (termasuk metode Kredit / Kartu Kredit).
-- - Laba On Hand = pembayaran berdasar payment_date − pengeluaran periode.
-- - Saldo awal bulan = max(0, saldo akhir bulan sebelumnya).
--   Defisit tidak dibawa; dicatat sebagai reset pembukaan di snapshot.
-- - Piutang akhir = invoice s.d. akhir periode − pembayaran s.d. akhir
--   periode, dihitung per invoice dan tidak negatif per baris.
-- - Closing berurutan dari books_start_month, hanya setelah bulan berakhir
--   (zona Asia/Jakarta), dan reopen hanya bulan closed paling akhir
--   oleh Super Admin (permission `all`) dengan alasan wajib.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Settings: bulan awal pembukuan + timezone ───
ALTER TABLE public.finance_company_settings
  ADD COLUMN IF NOT EXISTS books_start_month DATE,
  ADD COLUMN IF NOT EXISTS finance_timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta';

UPDATE public.finance_company_settings
SET books_start_month = COALESCE(books_start_month, DATE '2026-09-01'),
    finance_timezone = COALESCE(NULLIF(finance_timezone, ''), 'Asia/Jakarta')
WHERE id = 1;

-- Pastikan seed awal juga membawa books_start_month bila row belum ada.
INSERT INTO public.finance_company_settings (id, company_name, ppn_default, initial_cash_balance, books_start_month, finance_timezone)
VALUES (1, 'Jamslogistic', 0, 0, DATE '2026-09-01', 'Asia/Jakarta')
ON CONFLICT (id) DO UPDATE SET
  books_start_month = COALESCE(public.finance_company_settings.books_start_month, DATE '2026-09-01'),
  finance_timezone = COALESCE(NULLIF(public.finance_company_settings.finance_timezone, ''), 'Asia/Jakarta');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_settings_books_start_first_day') THEN
    ALTER TABLE public.finance_company_settings
      ADD CONSTRAINT finance_settings_books_start_first_day
      CHECK (books_start_month IS NULL OR books_start_month = date_trunc('month', books_start_month)::date);
  END IF;
END $$;

-- ─── 2. Tabel event closing (append-only) ───
CREATE TABLE IF NOT EXISTS public.finance_month_events (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  event_seq             INTEGER NOT NULL CHECK (event_seq > 0),
  event_type            TEXT NOT NULL CHECK (event_type IN ('close', 'reopen')),
  calculation_version   TEXT NOT NULL DEFAULT 'finance-close-v1',

  opening_prev_balance  BIGINT,
  deficit_reset         BIGINT,
  opening_cash_balance  BIGINT,
  cash_in               BIGINT,
  cash_out_expenses     BIGINT,
  adjustment_in         BIGINT,
  adjustment_out        BIGINT,
  ending_cash_balance   BIGINT,

  revenue_total         BIGINT,
  revenue_subtotal      BIGINT,
  ppn_amount            BIGINT,
  pph_amount            BIGINT,
  expense_total         BIGINT,
  net_profit            BIGINT,
  cash_on_hand_profit   BIGINT,

  opening_receivable    BIGINT,
  new_invoices_total    BIGINT,
  period_payments_total BIGINT,
  closing_receivable    BIGINT,

  invoice_count         INTEGER,
  payment_count         INTEGER,
  expense_count         INTEGER,
  adjustment_count      INTEGER,

  snapshot_data         JSONB,
  source_hash           TEXT,

  actor_user_id         UUID,
  actor_email           TEXT,
  actor_name            TEXT,
  reason                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT finance_month_period_first_day CHECK (period_start = date_trunc('month', period_start)::date),
  CONSTRAINT finance_month_period_end CHECK (period_end = (period_start + INTERVAL '1 month - 1 day')::date),
  CONSTRAINT finance_month_close_totals_required CHECK (
    event_type = 'reopen' OR (
      opening_cash_balance IS NOT NULL AND cash_in IS NOT NULL AND cash_out_expenses IS NOT NULL AND
      adjustment_in IS NOT NULL AND adjustment_out IS NOT NULL AND ending_cash_balance IS NOT NULL AND
      revenue_total IS NOT NULL AND expense_total IS NOT NULL AND net_profit IS NOT NULL AND
      cash_on_hand_profit IS NOT NULL AND opening_receivable IS NOT NULL AND
      new_invoices_total IS NOT NULL AND period_payments_total IS NOT NULL AND
      closing_receivable IS NOT NULL AND snapshot_data IS NOT NULL
    )
  ),
  CONSTRAINT finance_month_reopen_reason_required CHECK (
    event_type = 'close' OR (reason IS NOT NULL AND btrim(reason) <> '')
  ),
  CONSTRAINT finance_month_reopen_snapshot_null CHECK (
    event_type = 'close' OR (
      opening_cash_balance IS NULL AND cash_in IS NULL AND ending_cash_balance IS NULL AND
      revenue_total IS NULL AND snapshot_data IS NULL
    )
  ),
  CONSTRAINT finance_month_cash_balance_equation CHECK (
    event_type = 'reopen' OR
    ending_cash_balance = opening_cash_balance + cash_in + adjustment_in - cash_out_expenses - adjustment_out
  ),
  UNIQUE (period_start, event_seq)
);

CREATE INDEX IF NOT EXISTS idx_finance_month_events_period ON public.finance_month_events (period_start, event_seq DESC);
CREATE INDEX IF NOT EXISTS idx_finance_month_events_type ON public.finance_month_events (event_type);

-- ─── 3. RLS tabel closing ───
ALTER TABLE public.finance_month_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_finance_month_events ON public.finance_month_events;
CREATE POLICY auth_select_finance_month_events ON public.finance_month_events
  FOR SELECT TO authenticated USING (public.has_app_permission('finance', true));

-- Tidak ada policy INSERT/UPDATE/DELETE untuk authenticated: tulis hanya via RPC.
DROP POLICY IF EXISTS auth_insert_finance_month_events ON public.finance_month_events;
DROP POLICY IF EXISTS auth_update_finance_month_events ON public.finance_month_events;
DROP POLICY IF EXISTS auth_delete_finance_month_events ON public.finance_month_events;

-- Immutability: tolak UPDATE/DELETE langsung dalam bentuk apa pun.
CREATE OR REPLACE FUNCTION public.finance_month_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'FINANCE_CLOSE_IMMUTABLE: snapshot closing tidak dapat diubah atau dihapus';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS finance_month_events_no_update ON public.finance_month_events;
CREATE TRIGGER finance_month_events_no_update
  BEFORE UPDATE OR DELETE ON public.finance_month_events
  FOR EACH ROW EXECUTE FUNCTION public.finance_month_events_immutable();

-- ─── 4. Helper otorisasi internal ───
CREATE OR REPLACE FUNCTION public.finance_internal_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id = up.role_id
    WHERE up.id = auth.uid()
      AND up.status = 'Aktif'
      AND r.status = 'Aktif'
      AND COALESCE(up.account_type, 'internal') = 'internal'
  );
$$;

REVOKE ALL ON FUNCTION public.finance_internal_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_internal_active() TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_can_close()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finance_internal_active() AND public.has_app_permission('finance');
$$;

REVOKE ALL ON FUNCTION public.finance_can_close() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_can_close() TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_can_reopen()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id = up.role_id
    WHERE up.id = auth.uid()
      AND up.status = 'Aktif'
      AND r.status = 'Aktif'
      AND COALESCE(up.account_type, 'internal') = 'internal'
      AND r.permissions ? 'all'
  );
$$;

REVOKE ALL ON FUNCTION public.finance_can_reopen() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_can_reopen() TO authenticated;

-- ─── 5. Status periode: latest event per bulan ───
CREATE OR REPLACE VIEW public.finance_month_status AS
SELECT DISTINCT ON (e.period_start)
  e.period_start,
  e.period_end,
  e.id AS latest_event_id,
  e.event_seq AS latest_seq,
  e.event_type AS state,
  e.calculation_version,
  e.opening_cash_balance,
  e.cash_in,
  e.cash_out_expenses,
  e.adjustment_in,
  e.adjustment_out,
  e.ending_cash_balance,
  e.revenue_total,
  e.expense_total,
  e.net_profit,
  e.cash_on_hand_profit,
  e.opening_receivable,
  e.closing_receivable,
  e.invoice_count,
  e.payment_count,
  e.expense_count,
  e.adjustment_count,
  e.source_hash,
  e.actor_user_id,
  e.actor_email,
  e.actor_name,
  e.reason,
  e.created_at
FROM public.finance_month_events e
ORDER BY e.period_start, e.event_seq DESC;

-- ─── 6. Cutoff bulan closed (kontinu dari books_start) ───
CREATE OR REPLACE FUNCTION public.finance_closed_through()
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_books date;
  v_start date;
  v_state text;
  v_last_closed date := NULL;
BEGIN
  SELECT COALESCE(books_start_month, DATE '2026-09-01')
    INTO v_books
  FROM public.finance_company_settings WHERE id = 1;

  IF v_books IS NULL THEN
    RETURN NULL;
  END IF;

  v_start := v_books;
  LOOP
    SELECT s.state INTO v_state
    FROM public.finance_month_status s
    WHERE s.period_start = v_start;

    IF v_state IS NULL THEN
      EXIT;
    END IF;
    IF v_state <> 'close' THEN
      EXIT;
    END IF;
    v_last_closed := (v_start + INTERVAL '1 month - 1 day')::date;
    v_start := (v_start + INTERVAL '1 month')::date;
    -- Batas aman 240 bulan (20 tahun) agar loop tidak liar.
    IF v_start > v_books + INTERVAL '240 months' THEN
      EXIT;
    END IF;
  END LOOP;

  RETURN v_last_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_closed_through() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_closed_through() TO authenticated;

-- ─── 7. Guard periode closed untuk transaksi ───
CREATE OR REPLACE FUNCTION public.finance_assert_date_open(p_date date)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_books date;
  v_closed date;
BEGIN
  IF p_date IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(books_start_month, DATE '2026-09-01')
    INTO v_books
  FROM public.finance_company_settings WHERE id = 1;

  IF v_books IS NOT NULL AND p_date < v_books THEN
    RAISE EXCEPTION 'FINANCE_BEFORE_BOOKS_START:%', p_date
      USING ERRCODE = 'P0001';
  END IF;

  v_closed := public.finance_closed_through();
  IF v_closed IS NOT NULL AND p_date <= v_closed THEN
    RAISE EXCEPTION 'FINANCE_PERIOD_CLOSED:%', p_date
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_assert_date_open(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_assert_date_open(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_guard_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('finance_month_close'));
  IF TG_OP = 'INSERT' THEN
    PERFORM public.finance_assert_date_open(NEW.invoice_date);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.finance_assert_date_open(OLD.invoice_date);
    PERFORM public.finance_assert_date_open(NEW.invoice_date);
    RETURN NEW;
  ELSE
    PERFORM public.finance_assert_date_open(OLD.invoice_date);
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_guard_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('finance_month_close'));
  IF TG_OP = 'INSERT' THEN
    PERFORM public.finance_assert_date_open(NEW.payment_date);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.finance_assert_date_open(OLD.payment_date);
    PERFORM public.finance_assert_date_open(NEW.payment_date);
    RETURN NEW;
  ELSE
    PERFORM public.finance_assert_date_open(OLD.payment_date);
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_guard_expenses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('finance_month_close'));
  IF TG_OP = 'INSERT' THEN
    PERFORM public.finance_assert_date_open(NEW.expense_date);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.finance_assert_date_open(OLD.expense_date);
    PERFORM public.finance_assert_date_open(NEW.expense_date);
    RETURN NEW;
  ELSE
    PERFORM public.finance_assert_date_open(OLD.expense_date);
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_guard_adjustments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('finance_month_close'));
  IF TG_OP = 'INSERT' THEN
    PERFORM public.finance_assert_date_open(NEW.adjustment_date);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.finance_assert_date_open(OLD.adjustment_date);
    PERFORM public.finance_assert_date_open(NEW.adjustment_date);
    RETURN NEW;
  ELSE
    PERFORM public.finance_assert_date_open(OLD.adjustment_date);
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS finance_guard_invoices ON public.finance_invoices;
CREATE TRIGGER finance_guard_invoices
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.finance_guard_invoices();

DROP TRIGGER IF EXISTS finance_guard_payments ON public.finance_invoice_payments;
CREATE TRIGGER finance_guard_payments
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.finance_guard_payments();

DROP TRIGGER IF EXISTS finance_guard_expenses ON public.finance_expenses;
CREATE TRIGGER finance_guard_expenses
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_expenses
  FOR EACH ROW EXECUTE FUNCTION public.finance_guard_expenses();

DROP TRIGGER IF EXISTS finance_guard_adjustments ON public.finance_cash_adjustments;
CREATE TRIGGER finance_guard_adjustments
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_cash_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.finance_guard_adjustments();

-- ─── 8. Integritas pembayaran ───
CREATE OR REPLACE FUNCTION public.finance_payment_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_inv_date DATE;
  v_paid BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_AMOUNT: nominal pembayaran harus lebih dari nol'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT i.total_amount, i.invoice_date INTO v_total, v_inv_date
  FROM public.finance_invoices i
  WHERE i.id = NEW.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_INVOICE_NOT_FOUND:%', NEW.invoice_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.payment_date < v_inv_date THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_BEFORE_INVOICE:% pembayaran sebelum invoice %', NEW.payment_date, v_inv_date
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
  FROM public.finance_invoice_payments p
  WHERE p.invoice_id = NEW.invoice_id
    AND (TG_OP <> 'UPDATE' OR p.id <> NEW.id);

  IF v_paid + NEW.amount > COALESCE(v_total, 0) THEN
    RAISE EXCEPTION 'FINANCE_PAYMENT_OVERPAID: pembayaran melebihi sisa tagihan (terbayar % dari total %)', v_paid, v_total
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_payments_integrity ON public.finance_invoice_payments;
CREATE TRIGGER finance_payments_integrity
  BEFORE INSERT OR UPDATE ON public.finance_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.finance_payment_integrity();

-- ─── 9. Bekukan saldo awal & bulan awal setelah closing pertama ───
CREATE OR REPLACE FUNCTION public.finance_guard_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.finance_month_events) THEN
    IF NEW.initial_cash_balance IS DISTINCT FROM OLD.initial_cash_balance THEN
      RAISE EXCEPTION 'FINANCE_SETTINGS_LOCKED: saldo awal tidak dapat diubah setelah closing pertama'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.books_start_month IS DISTINCT FROM OLD.books_start_month THEN
      RAISE EXCEPTION 'FINANCE_SETTINGS_LOCKED: bulan awal pembukuan tidak dapat diubah setelah closing pertama'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Normalisasi books_start ke awal bulan bila diisi sebelum closing pertama.
  IF NEW.books_start_month IS NOT NULL THEN
    NEW.books_start_month := date_trunc('month', NEW.books_start_month)::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_guard_settings ON public.finance_company_settings;
CREATE TRIGGER finance_guard_settings
  BEFORE UPDATE ON public.finance_company_settings
  FOR EACH ROW EXECUTE FUNCTION public.finance_guard_settings();

-- ─── 10. RPC close_finance_month ───
CREATE OR REPLACE FUNCTION public.close_finance_month(p_period_start date)
RETURNS public.finance_month_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_books date;
  v_tz text;
  v_today date;
  v_settings public.finance_company_settings%ROWTYPE;
  v_expected date;
  v_latest_start date;
  v_latest_state text;
  v_seq integer;
  v_opening_prev BIGINT;
  v_deficit BIGINT;
  v_opening BIGINT;
  v_revenue BIGINT; v_subtotal BIGINT; v_ppn BIGINT; v_pph BIGINT;
  v_expenses BIGINT; v_cash_in BIGINT; v_adj_in BIGINT; v_adj_out BIGINT;
  v_ending BIGINT; v_net BIGINT; v_onhand BIGINT;
  v_open_ar BIGINT; v_new_inv BIGINT; v_period_pay BIGINT; v_close_ar BIGINT;
  v_inv_count integer; v_pay_count integer; v_exp_count integer; v_adj_count integer;
  v_snapshot jsonb;
  v_hash text;
  v_actor uuid;
  v_email text; v_nama text;
  v_existing public.finance_month_events%ROWTYPE;
BEGIN
  IF NOT public.finance_can_close() THEN
    RAISE EXCEPTION 'FINANCE_FORBIDDEN: butuh hak Finance penuh untuk tutup buku'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finance_month_close'));

  IF p_period_start IS NULL OR p_period_start <> date_trunc('month', p_period_start)::date THEN
    RAISE EXCEPTION 'FINANCE_PERIOD_INVALID: period_start harus tanggal 1 awal bulan'
      USING ERRCODE = 'P0001';
  END IF;
  v_start := p_period_start;
  v_end := (v_start + INTERVAL '1 month - 1 day')::date;

  SELECT * INTO v_settings FROM public.finance_company_settings WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCE_SETTINGS_MISSING: pengaturan finance belum ada'
      USING ERRCODE = 'P0001';
  END IF;
  v_books := COALESCE(v_settings.books_start_month, DATE '2026-09-01');
  v_tz := COALESCE(NULLIF(v_settings.finance_timezone, ''), 'Asia/Jakarta');
  BEGIN
    v_today := (now() AT TIME ZONE v_tz)::date;
  EXCEPTION WHEN OTHERS THEN
    v_today := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  END;

  IF v_today <= v_end THEN
    RAISE EXCEPTION 'FINANCE_PERIOD_NOT_ENDED: periode % belum berakhir', v_start
      USING ERRCODE = 'P0001';
  END IF;

  IF v_start < v_books THEN
    RAISE EXCEPTION 'FINANCE_BEFORE_BOOKS_START:%', v_start
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent: bila bulan ini sudah closed, kembalikan snapshot aktif.
  SELECT * INTO v_existing FROM public.finance_month_events
  WHERE period_start = v_start
  ORDER BY event_seq DESC LIMIT 1;
  IF FOUND AND v_existing.event_type = 'close' THEN
    -- Pastikan tidak ada bulan sesudahnya yang sudah closed (konsistensi).
    RETURN v_existing;
  END IF;
  IF FOUND AND v_existing.event_type = 'reopen' THEN
    -- Reclose bulan yang sedang reopened: lanjutkan di bawah dengan seq baru.
    NULL;
  END IF;

  -- Tentukan bulan yang seharusnya ditutup berikutnya.
  SELECT s.period_start, s.state INTO v_latest_start, v_latest_state
  FROM (
    SELECT period_start, state FROM public.finance_month_status ORDER BY period_start DESC LIMIT 1
  ) s;

  IF v_latest_start IS NULL THEN
    v_expected := v_books;
  ELSIF v_latest_state = 'reopen' THEN
    -- Hanya boleh reclose bulan reopened tersebut.
    IF v_start <> v_latest_start THEN
      RAISE EXCEPTION 'FINANCE_SEQUENCE: bulan % masih dibuka kembali; tutup ulang bulan tersebut dulu', v_latest_start
        USING ERRCODE = 'P0001';
    END IF;
    v_expected := v_latest_start;
  ELSE
    v_expected := (v_latest_start + INTERVAL '1 month')::date;
  END IF;

  IF v_start <> v_expected THEN
    RAISE EXCEPTION 'FINANCE_SEQUENCE: bulan berikutnya yang harus ditutup adalah %, bukan %', v_expected, v_start
      USING ERRCODE = 'P0001';
  END IF;

  -- Saldo pembuka: bulan pertama memakai initial, berikutnya max(0, saldo akhir sebelumnya).
  IF v_start = v_books THEN
    v_opening_prev := NULL;
    v_deficit := 0;
    v_opening := COALESCE(v_settings.initial_cash_balance, 0);
  ELSE
    SELECT ending_cash_balance INTO v_opening_prev
    FROM public.finance_month_status WHERE period_start = (v_start - INTERVAL '1 month')::date;
    IF v_opening_prev IS NULL THEN
      RAISE EXCEPTION 'FINANCE_SEQUENCE: saldo bulan sebelumnya belum tersedia'
        USING ERRCODE = 'P0001';
    END IF;
    v_deficit := CASE WHEN v_opening_prev < 0 THEN -v_opening_prev ELSE 0 END;
    v_opening := CASE WHEN v_opening_prev < 0 THEN 0 ELSE v_opening_prev END;
  END IF;

  -- Agregat Laba Rugi & kas periode (langsung di DB agar lengkap).
  SELECT COALESCE(SUM(total_amount),0), COALESCE(SUM(subtotal),0),
         COALESCE(SUM(ppn_amount),0), COALESCE(SUM(pph_amount),0), COUNT(*)
    INTO v_revenue, v_subtotal, v_ppn, v_pph, v_inv_count
  FROM public.finance_invoices WHERE invoice_date BETWEEN v_start AND v_end;

  SELECT COALESCE(SUM(amount),0), COUNT(*)
    INTO v_expenses, v_exp_count
  FROM public.finance_expenses WHERE expense_date BETWEEN v_start AND v_end;

  SELECT COALESCE(SUM(amount),0), COUNT(*)
    INTO v_cash_in, v_pay_count
  FROM public.finance_invoice_payments WHERE payment_date BETWEEN v_start AND v_end;

  SELECT COALESCE(SUM(CASE WHEN type='Masuk' THEN amount ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN type='Keluar' THEN amount ELSE 0 END),0),
         COUNT(*)
    INTO v_adj_in, v_adj_out, v_adj_count
  FROM public.finance_cash_adjustments WHERE adjustment_date BETWEEN v_start AND v_end;

  v_net := v_revenue - v_expenses;
  v_onhand := v_cash_in - v_expenses;
  v_ending := v_opening + v_cash_in + v_adj_in - v_expenses - v_adj_out;

  -- Piutang per invoice agar tidak negatif per baris.
  WITH inv_through AS (
    SELECT id, total_amount FROM public.finance_invoices WHERE invoice_date <= v_end
  ), paid_open AS (
    SELECT invoice_id, SUM(amount) AS paid FROM public.finance_invoice_payments
    WHERE payment_date < v_start GROUP BY invoice_id
  ), paid_close AS (
    SELECT invoice_id, SUM(amount) AS paid FROM public.finance_invoice_payments
    WHERE payment_date <= v_end GROUP BY invoice_id
  )
  SELECT
    COALESCE(SUM(GREATEST(i.total_amount - COALESCE(o.paid,0), 0)) FILTER (WHERE i.id IN (SELECT id FROM public.finance_invoices WHERE invoice_date < v_start)), 0),
    COALESCE(SUM(GREATEST(i.total_amount - COALESCE(c.paid,0), 0)), 0)
  INTO v_open_ar, v_close_ar
  FROM inv_through i
  LEFT JOIN paid_open o ON o.invoice_id = i.id
  LEFT JOIN paid_close c ON c.invoice_id = i.id;

  v_new_inv := v_revenue;
  v_period_pay := v_cash_in;

  -- Snapshot detail (terurut stabil untuk hash konsisten).
  SELECT jsonb_build_object(
    'period_start', v_start::text,
    'period_end', v_end::text,
    'calculation_version', 'finance-close-v1',
    'company', jsonb_build_object(
      'company_name', v_settings.company_name, 'address', v_settings.address,
      'npwp', v_settings.npwp, 'phone', v_settings.phone, 'email', v_settings.email,
      'logo_url', v_settings.logo_url, 'initial_cash_balance', v_settings.initial_cash_balance,
      'books_start_month', v_books::text, 'timezone', v_tz
    ),
    'totals', jsonb_build_object(
      'opening_prev_balance', v_opening_prev, 'deficit_reset', v_deficit, 'opening_cash_balance', v_opening,
      'cash_in', v_cash_in, 'cash_out_expenses', v_expenses,
      'adjustment_in', v_adj_in, 'adjustment_out', v_adj_out, 'ending_cash_balance', v_ending,
      'revenue_total', v_revenue, 'revenue_subtotal', v_subtotal, 'ppn_amount', v_ppn, 'pph_amount', v_pph,
      'expense_total', v_expenses, 'net_profit', v_net, 'cash_on_hand_profit', v_onhand,
      'opening_receivable', v_open_ar, 'new_invoices_total', v_new_inv,
      'period_payments_total', v_period_pay, 'closing_receivable', v_close_ar
    ),
    'counts', jsonb_build_object(
      'invoices', v_inv_count, 'payments', v_pay_count,
      'expenses', v_exp_count, 'adjustments', v_adj_count
    ),
    'invoices', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.id) FROM (
        SELECT i.id, i.invoice_no, i.invoice_date, i.due_date, i.client_id,
               c.contact_name AS client_contact, c.company_name AS client_company,
               i.description, i.subtotal, i.trip_amount, i.toll_amount, i.parking_amount,
               i.other_amount, i.tax_scheme, i.tax_base_amount, i.ppn_percent, i.ppn_amount,
               i.pph_percent, i.pph_amount, i.total_amount, i.notes,
               COALESCE((SELECT SUM(p.amount) FROM public.finance_invoice_payments p WHERE p.invoice_id = i.id AND p.payment_date <= v_end), 0) AS paid_through_end,
               GREATEST(i.total_amount - COALESCE((SELECT SUM(p.amount) FROM public.finance_invoice_payments p WHERE p.invoice_id = i.id AND p.payment_date <= v_end), 0), 0) AS remaining_as_of_end
        FROM public.finance_invoices i
        LEFT JOIN public.finance_clients c ON c.id = i.client_id
        WHERE i.invoice_date BETWEEN v_start AND v_end
      ) t
    ), '[]'::jsonb),
    'period_payments', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.id) FROM (
        SELECT p.id, p.invoice_id, p.payment_date, p.amount, p.method, p.notes,
               i.invoice_no, i.invoice_date
        FROM public.finance_invoice_payments p
        JOIN public.finance_invoices i ON i.id = p.invoice_id
        WHERE p.payment_date BETWEEN v_start AND v_end
      ) t
    ), '[]'::jsonb),
    'expenses', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.id) FROM (
        SELECT e.id, e.expense_date, e.category_id, cat.name AS category_name, cat.color AS category_color,
               e.description, e.vendor, e.method, e.amount, e.notes
        FROM public.finance_expenses e
        LEFT JOIN public.finance_expense_categories cat ON cat.id = e.category_id
        WHERE e.expense_date BETWEEN v_start AND v_end
      ) t
    ), '[]'::jsonb),
    'adjustments', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.id) FROM (
        SELECT a.id, a.adjustment_date, a.type, a.amount, a.description, a.notes
        FROM public.finance_cash_adjustments a
        WHERE a.adjustment_date BETWEEN v_start AND v_end
      ) t
    ), '[]'::jsonb),
    'receivables_as_of_end', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.id) FROM (
        SELECT i.id, i.invoice_no, i.invoice_date, i.due_date,
               c.contact_name AS client_contact, c.company_name AS client_company,
               i.total_amount AS total,
               COALESCE(pp.paid, 0) AS paid,
               GREATEST(i.total_amount - COALESCE(pp.paid, 0), 0) AS remaining,
               CASE
                 WHEN GREATEST(i.total_amount - COALESCE(pp.paid, 0), 0) <= 0 THEN 'Lunas'
                 WHEN COALESCE(pp.paid, 0) > 0 THEN 'Sebagian'
                 ELSE 'Belum Lunas'
               END AS status_as_of_end
        FROM public.finance_invoices i
        LEFT JOIN public.finance_clients c ON c.id = i.client_id
        LEFT JOIN (
          SELECT invoice_id, SUM(amount) AS paid
          FROM public.finance_invoice_payments WHERE payment_date <= v_end GROUP BY invoice_id
        ) pp ON pp.invoice_id = i.id
        WHERE i.invoice_date <= v_end
          AND (i.total_amount - COALESCE(pp.paid, 0)) > 0
      ) t
    ), '[]'::jsonb)
  ) INTO v_snapshot;

  v_hash := md5(v_snapshot::text);

  v_actor := auth.uid();
  SELECT up.email, up.nama INTO v_email, v_nama
  FROM public.user_profiles up WHERE up.id = v_actor;

  SELECT COALESCE(MAX(event_seq), 0) + 1 INTO v_seq
  FROM public.finance_month_events WHERE period_start = v_start;

  INSERT INTO public.finance_month_events (
    period_start, period_end, event_seq, event_type, calculation_version,
    opening_prev_balance, deficit_reset, opening_cash_balance,
    cash_in, cash_out_expenses, adjustment_in, adjustment_out, ending_cash_balance,
    revenue_total, revenue_subtotal, ppn_amount, pph_amount,
    expense_total, net_profit, cash_on_hand_profit,
    opening_receivable, new_invoices_total, period_payments_total, closing_receivable,
    invoice_count, payment_count, expense_count, adjustment_count,
    snapshot_data, source_hash, actor_user_id, actor_email, actor_name, reason
  ) VALUES (
    v_start, v_end, v_seq, 'close', 'finance-close-v1',
    v_opening_prev, v_deficit, v_opening,
    v_cash_in, v_expenses, v_adj_in, v_adj_out, v_ending,
    v_revenue, v_subtotal, v_ppn, v_pph,
    v_expenses, v_net, v_onhand,
    v_open_ar, v_new_inv, v_period_pay, v_close_ar,
    v_inv_count, v_pay_count, v_exp_count, v_adj_count,
    v_snapshot, v_hash, v_actor, v_email, v_nama, NULL
  )
  RETURNING * INTO v_existing;

  RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.close_finance_month(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_finance_month(date) TO authenticated;

-- ─── 11. RPC reopen_finance_month ───
CREATE OR REPLACE FUNCTION public.reopen_finance_month(p_period_start date, p_reason text)
RETURNS public.finance_month_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_latest_closed date;
  v_current public.finance_month_events%ROWTYPE;
  v_seq integer;
  v_actor uuid;
  v_email text; v_nama text;
  v_row public.finance_month_events%ROWTYPE;
BEGIN
  IF NOT public.finance_can_reopen() THEN
    RAISE EXCEPTION 'FINANCE_FORBIDDEN: reopen hanya untuk Super Admin'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finance_month_close'));

  IF p_period_start IS NULL OR p_period_start <> date_trunc('month', p_period_start)::date THEN
    RAISE EXCEPTION 'FINANCE_PERIOD_INVALID: period_start harus tanggal 1 awal bulan'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'FINANCE_REASON_REQUIRED: alasan reopen wajib diisi'
      USING ERRCODE = 'P0001';
  END IF;
  v_start := p_period_start;
  v_end := (v_start + INTERVAL '1 month - 1 day')::date;

  SELECT * INTO v_current FROM public.finance_month_events
  WHERE period_start = v_start ORDER BY event_seq DESC LIMIT 1;

  IF NOT FOUND OR v_current.event_type <> 'close' THEN
    RAISE EXCEPTION 'FINANCE_NOT_CLOSED: bulan % tidak dalam status closed', v_start
      USING ERRCODE = 'P0001';
  END IF;

  SELECT s.period_start INTO v_latest_closed FROM public.finance_month_status s
  WHERE s.state = 'close' ORDER BY s.period_start DESC LIMIT 1;

  IF v_latest_closed IS NULL OR v_latest_closed <> v_start THEN
    RAISE EXCEPTION 'FINANCE_REOPEN_LATEST_ONLY: hanya bulan closed paling akhir (%) yang boleh dibuka', COALESCE(v_latest_closed::text, '-')
      USING ERRCODE = 'P0001';
  END IF;

  v_actor := auth.uid();
  SELECT up.email, up.nama INTO v_email, v_nama
  FROM public.user_profiles up WHERE up.id = v_actor;

  SELECT COALESCE(MAX(event_seq), 0) + 1 INTO v_seq
  FROM public.finance_month_events WHERE period_start = v_start;

  INSERT INTO public.finance_month_events (
    period_start, period_end, event_seq, event_type, calculation_version,
    actor_user_id, actor_email, actor_name, reason
  ) VALUES (
    v_start, v_end, v_seq, 'reopen', 'finance-close-v1',
    v_actor, v_email, v_nama, btrim(p_reason)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_finance_month(date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_finance_month(date, text) TO authenticated;

-- ─── 12. Perbaiki RLS finance.input (UI mengizinkan tambah, DB menolak) ───
-- SELECT tetap memakai has_app_permission('finance', true) = finance/input/view.
-- INSERT: finance penuh + finance.input + all, khusus akun internal aktif.
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'finance_company_settings', 'finance_clients', 'finance_invoices',
    'finance_invoice_payments', 'finance_expense_categories',
    'finance_expenses', 'finance_cash_adjustments'
  ]
  LOOP
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
  END LOOP;
END $$;

-- UPDATE/DELETE + SELECT diperketat ke akun internal aktif (menutup celah external).
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'finance_company_settings', 'finance_clients', 'finance_invoices',
    'finance_invoice_payments', 'finance_expense_categories',
    'finance_expenses', 'finance_cash_adjustments'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_select_%s ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY auth_select_%s ON public.%I FOR SELECT TO authenticated USING ('
      ' public.finance_internal_active() AND public.has_app_permission(''finance'', true)'
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

-- ─── 13. Grants baca untuk UI ───
GRANT SELECT ON public.finance_month_events TO authenticated;
GRANT SELECT ON public.finance_month_status TO authenticated;
