REVOKE ALL ON FUNCTION public.copy_payroll_manual_inputs_from_previous(text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_payroll_manual_inputs_from_previous(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
