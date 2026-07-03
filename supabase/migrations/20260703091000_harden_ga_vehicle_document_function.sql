-- Trigger-only helper must not be executable through RPC.

REVOKE ALL ON FUNCTION public.set_current_ga_vehicle_document() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_current_ga_vehicle_document() FROM anon;
REVOKE ALL ON FUNCTION public.set_current_ga_vehicle_document() FROM authenticated;
