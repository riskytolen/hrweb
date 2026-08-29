-- 1. Add password_changed_at to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

-- 2. RPC: server-only function to record password change atomically with audit
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

-- Revoke direct execute from client roles; only service-role/admin should call this
REVOKE EXECUTE ON FUNCTION public.mark_password_changed(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_password_changed(uuid) FROM authenticated;

-- 3. Clean up legacy RLS policies that were not dropped by prior migrations
DROP POLICY IF EXISTS "Roles viewable by authenticated" ON public.roles;
DROP POLICY IF EXISTS "Roles manageable by superadmin" ON public.roles;
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Superadmin manages all profiles" ON public.user_profiles;
