-- 1. Create encrypted credential storage for account passwords
CREATE TABLE IF NOT EXISTS public.account_password_secrets (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  password_encrypted bytea NOT NULL,
  password_iv bytea NOT NULL,
  password_tag bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- One active credential per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_password_secrets_user_active
  ON public.account_password_secrets(user_id)
  WHERE is_active;

COMMENT ON TABLE public.account_password_secrets IS
  'Reversible account credentials. Accessed only by service-role.';
COMMENT ON COLUMN public.account_password_secrets.password_encrypted IS
  'AES-256-GCM ciphertext (without IV/tag).';
COMMENT ON COLUMN public.account_password_secrets.password_iv IS
  'AES-256-GCM initialization vector.';
COMMENT ON COLUMN public.account_password_secrets.password_tag IS
  'AES-256-GCM authentication tag.';
COMMENT ON COLUMN public.account_password_secrets.key_version IS
  'Encryption key version for rotation support.';

-- 2. RLS: enable but no permissive policies; service-role only via admin client
ALTER TABLE public.account_password_secrets ENABLE ROW LEVEL SECURITY;

-- 3. Revoke client access entirely
REVOKE ALL ON public.account_password_secrets FROM anon;
REVOKE ALL ON public.account_password_secrets FROM authenticated;

-- 4. Grant only service_role (used by admin client)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_password_secrets TO service_role;

-- 5. Harden audit_logs insert policy to reject plaintext password metadata
DROP POLICY IF EXISTS auth_insert_audit_logs ON public.audit_logs;

CREATE POLICY auth_insert_audit_logs ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    is_internal_account()
    AND NOT (
      metadata ? 'operation'
      AND (metadata->>'operation')::text IN (
        'password_reveal',
        'credential_view'
      )
    )
  );

-- 6. Expose reveal via RPC (server-only, returns plaintext to caller)
CREATE OR REPLACE FUNCTION public.reveal_account_password(target_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_row public.account_password_secrets%ROWTYPE;
BEGIN
  SELECT * INTO secret_row
  FROM public.account_password_secrets
  WHERE user_id = target_user_id AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credential not found for user %', target_user_id;
  END IF;

  RETURN encode(secret_row.password_encrypted, 'hex')
    || ':' || encode(secret_row.password_iv, 'hex')
    || ':' || encode(secret_row.password_tag, 'hex')
    || ':' || secret_row.key_version::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reveal_account_password(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reveal_account_password(uuid) FROM authenticated;
