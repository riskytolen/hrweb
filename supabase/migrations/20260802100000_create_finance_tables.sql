-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Finance module (standalone)
-- ───────────────────────────────────────────────────────────────
-- Tabel: company_settings, clients, invoices, invoice_payments,
--        expense_categories, expenses, cash_adjustments
-- Semua nominal disimpan sebagai BIGINT rupiah (integer) supaya
-- aman dari pembulatan floating point.
-- ═══════════════════════════════════════════════════════════════

-- ─── Finance Company Settings ───
CREATE TABLE IF NOT EXISTS public.finance_company_settings (
  id                  SMALLINT PRIMARY KEY CHECK (id = 1),
  company_name        TEXT NOT NULL DEFAULT 'Perusahaan Saya',
  address             TEXT,
  npwp                TEXT,
  phone               TEXT,
  email               TEXT,
  ppn_default         NUMERIC(5, 2) NOT NULL DEFAULT 0,
  initial_cash_balance BIGINT NOT NULL DEFAULT 0,
  logo_url            TEXT,
  logo_path           TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          TEXT
);

-- ─── Finance Clients ───
CREATE TABLE IF NOT EXISTS public.finance_clients (
  id           BIGSERIAL PRIMARY KEY,
  contact_name TEXT NOT NULL,
  company_name TEXT,
  email        TEXT,
  phone        TEXT,
  address      TEXT,
  status       TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Finance Invoices ───
CREATE TABLE IF NOT EXISTS public.finance_invoices (
  id           BIGSERIAL PRIMARY KEY,
  invoice_no   TEXT NOT NULL UNIQUE,
  invoice_date DATE NOT NULL,
  due_date     DATE,
  client_id    BIGINT REFERENCES public.finance_clients(id) ON DELETE SET NULL,
  description  TEXT,
  subtotal     BIGINT NOT NULL DEFAULT 0,
  ppn_percent  NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ppn_amount   BIGINT NOT NULL DEFAULT 0,
  total_amount BIGINT NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Finance Invoice Payments ───
CREATE TABLE IF NOT EXISTS public.finance_invoice_payments (
  id           BIGSERIAL PRIMARY KEY,
  invoice_id   BIGINT NOT NULL REFERENCES public.finance_invoices(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount       BIGINT NOT NULL CHECK (amount >= 0),
  method       TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Finance Expense Categories ───
CREATE TABLE IF NOT EXISTS public.finance_expense_categories (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Finance Expenses ───
CREATE TABLE IF NOT EXISTS public.finance_expenses (
  id           BIGSERIAL PRIMARY KEY,
  expense_date DATE NOT NULL,
  category_id  BIGINT REFERENCES public.finance_expense_categories(id) ON DELETE SET NULL,
  description  TEXT NOT NULL,
  vendor       TEXT,
  method       TEXT,
  amount       BIGINT NOT NULL CHECK (amount >= 0),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Finance Cash Adjustments ───
CREATE TABLE IF NOT EXISTS public.finance_cash_adjustments (
  id              BIGSERIAL PRIMARY KEY,
  adjustment_date DATE NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('Masuk', 'Keluar')),
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  description     TEXT NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Triggers auto-update updated_at ───
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_company_settings', 'finance_clients', 'finance_invoices',
                          'finance_invoice_payments', 'finance_expense_categories',
                          'finance_expenses', 'finance_cash_adjustments']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON public.%I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      t, t
    );
  END LOOP;
END $$;

-- ─── Indexes ───
CREATE INDEX IF NOT EXISTS idx_finance_invoices_invoice_date ON public.finance_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_client_id     ON public.finance_invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_invoice_id    ON public.finance_invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_payment_date  ON public.finance_invoice_payments (payment_date);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_expense_date  ON public.finance_expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_category_id   ON public.finance_expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_finance_adjustments_date       ON public.finance_cash_adjustments (adjustment_date);

-- ─── RLS ───
ALTER TABLE public.finance_company_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_invoice_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expense_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_cash_adjustments    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
  pol TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['finance_company_settings', 'finance_clients', 'finance_invoices',
                             'finance_invoice_payments', 'finance_expense_categories',
                             'finance_expenses', 'finance_cash_adjustments']
  LOOP
    FOREACH pol IN ARRAY ARRAY['select', 'insert', 'update', 'delete']
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS auth_%s_%s ON public.%I;', pol, tbl, tbl);
    END LOOP;
  END LOOP;
END $$;

CREATE POLICY auth_select_finance_company_settings ON public.finance_company_settings
  FOR SELECT TO authenticated USING (public.has_app_permission('finance', true));
CREATE POLICY auth_insert_finance_company_settings ON public.finance_company_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_update_finance_company_settings ON public.finance_company_settings
  FOR UPDATE TO authenticated USING (public.has_app_permission('finance')) WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_delete_finance_company_settings ON public.finance_company_settings
  FOR DELETE TO authenticated USING (public.has_app_permission('finance'));

CREATE POLICY auth_select_finance_clients ON public.finance_clients
  FOR SELECT TO authenticated USING (public.has_app_permission('finance', true));
CREATE POLICY auth_insert_finance_clients ON public.finance_clients
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_update_finance_clients ON public.finance_clients
  FOR UPDATE TO authenticated USING (public.has_app_permission('finance')) WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_delete_finance_clients ON public.finance_clients
  FOR DELETE TO authenticated USING (public.has_app_permission('finance'));

CREATE POLICY auth_select_finance_invoices ON public.finance_invoices
  FOR SELECT TO authenticated USING (public.has_app_permission('finance', true));
CREATE POLICY auth_insert_finance_invoices ON public.finance_invoices
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_update_finance_invoices ON public.finance_invoices
  FOR UPDATE TO authenticated USING (public.has_app_permission('finance')) WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_delete_finance_invoices ON public.finance_invoices
  FOR DELETE TO authenticated USING (public.has_app_permission('finance'));

CREATE POLICY auth_select_finance_invoice_payments ON public.finance_invoice_payments
  FOR SELECT TO authenticated USING (public.has_app_permission('finance', true));
CREATE POLICY auth_insert_finance_invoice_payments ON public.finance_invoice_payments
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_update_finance_invoice_payments ON public.finance_invoice_payments
  FOR UPDATE TO authenticated USING (public.has_app_permission('finance')) WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_delete_finance_invoice_payments ON public.finance_invoice_payments
  FOR DELETE TO authenticated USING (public.has_app_permission('finance'));

CREATE POLICY auth_select_finance_expense_categories ON public.finance_expense_categories
  FOR SELECT TO authenticated USING (public.has_app_permission('finance', true));
CREATE POLICY auth_insert_finance_expense_categories ON public.finance_expense_categories
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_update_finance_expense_categories ON public.finance_expense_categories
  FOR UPDATE TO authenticated USING (public.has_app_permission('finance')) WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_delete_finance_expense_categories ON public.finance_expense_categories
  FOR DELETE TO authenticated USING (public.has_app_permission('finance'));

CREATE POLICY auth_select_finance_expenses ON public.finance_expenses
  FOR SELECT TO authenticated USING (public.has_app_permission('finance', true));
CREATE POLICY auth_insert_finance_expenses ON public.finance_expenses
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_update_finance_expenses ON public.finance_expenses
  FOR UPDATE TO authenticated USING (public.has_app_permission('finance')) WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_delete_finance_expenses ON public.finance_expenses
  FOR DELETE TO authenticated USING (public.has_app_permission('finance'));

CREATE POLICY auth_select_finance_cash_adjustments ON public.finance_cash_adjustments
  FOR SELECT TO authenticated USING (public.has_app_permission('finance', true));
CREATE POLICY auth_insert_finance_cash_adjustments ON public.finance_cash_adjustments
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_update_finance_cash_adjustments ON public.finance_cash_adjustments
  FOR UPDATE TO authenticated USING (public.has_app_permission('finance')) WITH CHECK (public.has_app_permission('finance'));
CREATE POLICY auth_delete_finance_cash_adjustments ON public.finance_cash_adjustments
  FOR DELETE TO authenticated USING (public.has_app_permission('finance'));

-- ─── Seed ───
INSERT INTO public.finance_company_settings (id, company_name, ppn_default, initial_cash_balance)
VALUES (1, 'Jamslogistic', 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.finance_expense_categories (name, color, sort_order) VALUES
  ('Sewa Mobil',          '#3b82f6', 1),
  ('Driver',              '#8b5cf6', 2),
  ('Helper',              '#a855f7', 3),
  ('BBM',                 '#f59e0b', 4),
  ('Tol',                 '#10b981', 5),
  ('Parkir',              '#06b6d4', 6),
  ('Maintenance',         '#ef4444', 7),
  ('Servis Kendaraan',    '#ec4899', 8),
  ('Pajak Kendaraan',     '#f97316', 9),
  ('Operasional Kantor',  '#6366f1', 10),
  ('Gaji',                '#14b8a6', 11),
  ('Internet',            '#84cc16', 12),
  ('Listrik',             '#eab308', 13),
  ('Air',                 '#0ea5e9', 14),
  ('Marketing',           '#d946ef', 15),
  ('Lain-lain',           '#64748b', 99)
ON CONFLICT (name) DO NOTHING;
