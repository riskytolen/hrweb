-- Remove the temporary Vault setter RPC after the cron secrets have been saved.

drop function if exists public.set_tms_capture_vault_secrets(text, text);

notify pgrst, 'reload schema';
