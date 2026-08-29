-- Remove Supabase default table privileges that bypass row policies (notably
-- TRUNCATE). Re-grant only the operations used by the application.

REVOKE ALL ON public.gapok_increment_events FROM anon, authenticated;
GRANT SELECT ON public.gapok_increment_events TO authenticated;
REVOKE ALL ON SEQUENCE public.gapok_increment_events_id_seq FROM anon, authenticated;

REVOKE ALL ON public.gapok_settings FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.gapok_settings TO authenticated;

-- Keep existing row-level employee operations, but API roles must never be
-- able to bypass RLS by truncating the employee master table.
REVOKE TRUNCATE ON public.pegawai FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
