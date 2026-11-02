-- Keep privileged implementation outside the exposed API schema.
-- Timestamp aligned with remote migration history.
CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA finance_private TO authenticated;
ALTER FUNCTION public.save_finance_invoice_delivery(bigint,integer,integer,boolean,uuid,jsonb)
 SET SCHEMA finance_private;
CREATE FUNCTION public.save_finance_invoice_delivery(
 p_invoice_id bigint, p_expected_version integer, p_expected_attempt integer,
 p_new_attempt boolean, p_request_id uuid, p_data jsonb
) RETURNS public.finance_invoice_deliveries
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT finance_private.save_finance_invoice_delivery(
   p_invoice_id,p_expected_version,p_expected_attempt,p_new_attempt,p_request_id,p_data
 );
$$;
REVOKE ALL ON FUNCTION public.save_finance_invoice_delivery(bigint,integer,integer,boolean,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_finance_invoice_delivery(bigint,integer,integer,boolean,uuid,jsonb) TO authenticated;
