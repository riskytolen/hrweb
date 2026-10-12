-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Finance closing hardening (follow-up 20261013000000)
-- ───────────────────────────────────────────────────────────────
-- - View finance_month_status memakai permission penanya
--   (security_invoker) sehingga RLS tabel berlaku; menutup temuan
--   security_definer_view.
-- - Kunci search_path pada trigger immutability.
-- - Fungsi trigger-only tidak dapat dipanggil langsung via REST RPC
--   (tetap jalan saat dipicu trigger; preseden harden_gapok).
-- ═══════════════════════════════════════════════════════════════

ALTER VIEW public.finance_month_status SET (security_invoker = true);

CREATE OR REPLACE FUNCTION public.finance_month_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'FINANCE_CLOSE_IMMUTABLE: snapshot closing tidak dapat diubah atau dihapus';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_guard_invoices() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_guard_payments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_guard_expenses() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_guard_adjustments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_guard_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_payment_integrity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_month_events_immutable() FROM PUBLIC, anon, authenticated;
