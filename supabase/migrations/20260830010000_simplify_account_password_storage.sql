-- 1. Keep password timestamp available even if the earlier migration was not applied.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_password_changed(target_user_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts timestamptz := now();
BEGIN
  UPDATE public.user_profiles
  SET password_changed_at = now_ts
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found: %', target_user_id;
  END IF;

  RETURN now_ts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_password_changed(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_password_changed(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_password_changed(uuid) FROM authenticated;

-- 2. Remove the previous encrypted-storage experiment if it exists.
DROP FUNCTION IF EXISTS public.reveal_account_password(uuid);
DROP TABLE IF EXISTS public.account_password_secrets;

-- 3. Simple Super Admin-only password copy store, accessed only through server routes.
CREATE TABLE IF NOT EXISTS public.account_password_copies (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.account_password_copies IS
  'Plaintext account password copies for Super Admin reveal. Accessed only by server service-role routes.';
COMMENT ON COLUMN public.account_password_copies.password IS
  'Plaintext password copy by product requirement. Never expose this table to anon/authenticated roles.';

ALTER TABLE public.account_password_copies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.account_password_copies FROM PUBLIC;
REVOKE ALL ON public.account_password_copies FROM anon;
REVOKE ALL ON public.account_password_copies FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_password_copies TO service_role;

-- 4. Keep audit insert policy usable with null metadata while rejecting client-spoofed credential events.
DROP POLICY IF EXISTS auth_insert_audit_logs ON public.audit_logs;

CREATE POLICY auth_insert_audit_logs ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    is_internal_account()
    AND COALESCE(
      (metadata->>'operation') NOT IN ('password_reveal', 'credential_view'),
      true
    )
  );

-- 5. Clean up legacy RLS policies that were not dropped by prior migrations.
DROP POLICY IF EXISTS "Roles viewable by authenticated" ON public.roles;
DROP POLICY IF EXISTS "Roles manageable by superadmin" ON public.roles;
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Superadmin manages all profiles" ON public.user_profiles;
