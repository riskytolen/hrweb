-- Temporary RPC used once to copy the production cron secret from the local
-- environment into Supabase Vault without exposing it in migration text.
-- The following migration drops this helper after use.

create or replace function public.set_tms_capture_vault_secrets(
  p_base_url text,
  p_capture_secret text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if nullif(btrim(p_base_url), '') is null then
    raise exception 'base url is required';
  end if;
  if nullif(btrim(p_capture_secret), '') is null then
    raise exception 'capture secret is required';
  end if;

  delete from vault.secrets
  where name in ('tms_capture_base_url', 'tms_point_capture_secret');

  perform vault.create_secret(
    btrim(p_base_url),
    'tms_capture_base_url',
    'Production HR web base URL for TMS point temperature capture'
  );

  perform vault.create_secret(
    btrim(p_capture_secret),
    'tms_point_capture_secret',
    'Bearer secret for TMS point temperature capture cron'
  );
end;
$$;

revoke all on function public.set_tms_capture_vault_secrets(text, text) from public, anon, authenticated;
grant execute on function public.set_tms_capture_vault_secrets(text, text) to service_role;

notify pgrst, 'reload schema';
