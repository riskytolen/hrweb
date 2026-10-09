-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Finance invoice cost components + PPh + tax scheme
-- ───────────────────────────────────────────────────────────────
-- Menambah komponen biaya Toll, Parkir, Biaya Lain, serta PPh 2%
-- dengan dua skema perhitungan pajak:
--   'trip_only'      — PPN & PPh dihitung dari Biaya Perjalanan saja
--   'all_components' — PPN & PPh dihitung dari total semua komponen
--
-- Rumus yang dikunci:
--   total_biaya (subtotal) = trip + toll + parkir + lain
--   dasar_pajak            = trip_only ? trip : total_biaya
--   ppn_amount             = round(dasar_pajak * ppn_percent / 100)
--   pph_amount             = round(dasar_pajak * pph_percent / 100)
--   total_amount           = total_biaya + ppn_amount - pph_amount
--
-- Backfill data lama (semuanya tanpa PPN saat migrasi ditulis):
--   trip_amount = subtotal, komponen lain 0, pph 0 → total tidak berubah.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS trip_amount     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toll_amount     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parking_amount  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_amount    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_scheme      TEXT   NOT NULL DEFAULT 'trip_only',
  ADD COLUMN IF NOT EXISTS tax_base_amount BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pph_percent     NUMERIC(5, 2) NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pph_amount      BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_invoices_tax_scheme_check'
  ) THEN
    ALTER TABLE public.finance_invoices
      ADD CONSTRAINT finance_invoices_tax_scheme_check
      CHECK (tax_scheme IN ('trip_only', 'all_components'));
  END IF;
END $$;

-- Backfill: invoice lama → seluruh nilai lama ada di Biaya Perjalanan,
-- skema trip_only, PPh 0 sehingga total_amount tidak berubah.
UPDATE public.finance_invoices
SET trip_amount     = COALESCE(subtotal, 0),
    toll_amount     = 0,
    parking_amount  = 0,
    other_amount    = 0,
    tax_scheme      = 'trip_only',
    tax_base_amount = COALESCE(subtotal, 0),
    pph_percent     = 0,
    pph_amount      = 0
WHERE trip_amount = 0
  AND toll_amount = 0
  AND parking_amount = 0
  AND other_amount = 0
  AND tax_base_amount = 0
  AND pph_amount = 0;

-- Trigger: hitung ulang subtotal/ppn/pph/total dari satu rumus di DB
-- agar konsisten dengan helper frontend (src/lib/finance.ts).
CREATE OR REPLACE FUNCTION public.finance_invoice_recalc_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_base BIGINT;
  v_tax  BIGINT;
BEGIN
  NEW.trip_amount    := GREATEST(COALESCE(NEW.trip_amount, 0), 0);
  NEW.toll_amount    := GREATEST(COALESCE(NEW.toll_amount, 0), 0);
  NEW.parking_amount := GREATEST(COALESCE(NEW.parking_amount, 0), 0);
  NEW.other_amount   := GREATEST(COALESCE(NEW.other_amount, 0), 0);
  IF NEW.tax_scheme IS NULL OR NEW.tax_scheme NOT IN ('trip_only', 'all_components') THEN
    NEW.tax_scheme := 'trip_only';
  END IF;
  NEW.ppn_percent := COALESCE(NEW.ppn_percent, 0);
  NEW.pph_percent := COALESCE(NEW.pph_percent, 0);

  v_base := NEW.trip_amount + NEW.toll_amount + NEW.parking_amount + NEW.other_amount;
  v_tax  := CASE WHEN NEW.tax_scheme = 'all_components' THEN v_base ELSE NEW.trip_amount END;

  NEW.subtotal        := v_base;
  NEW.tax_base_amount := v_tax;
  NEW.ppn_amount      := CASE WHEN v_tax > 0 AND NEW.ppn_percent > 0
                              THEN ROUND(v_tax * NEW.ppn_percent / 100) ELSE 0 END;
  NEW.pph_amount      := CASE WHEN v_tax > 0 AND NEW.pph_percent > 0
                              THEN ROUND(v_tax * NEW.pph_percent / 100) ELSE 0 END;
  NEW.total_amount    := v_base + NEW.ppn_amount - NEW.pph_amount;
  NEW.updated_at      := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_invoices_recalc_totals ON public.finance_invoices;
CREATE TRIGGER finance_invoices_recalc_totals
  BEFORE INSERT OR UPDATE OF trip_amount, toll_amount, parking_amount, other_amount,
    tax_scheme, ppn_percent, pph_percent, subtotal, ppn_amount, pph_amount, total_amount
  ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.finance_invoice_recalc_totals();

-- Normalisasi ulang baris lama lewat trigger agar ppn_amount/total
-- benar-benar konsisten dengan rumus (no-op untuk data tanpa pajak).
UPDATE public.finance_invoices
SET subtotal = COALESCE(subtotal, 0)
WHERE true;
