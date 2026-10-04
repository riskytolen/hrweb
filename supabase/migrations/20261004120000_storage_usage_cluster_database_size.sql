-- Storage usage: hitung database size sebagai total seluruh database dalam cluster
-- (mengikuti query resmi Supabase: SUM(pg_database_size) dari pg_database),
-- bukan hanya current_database(). Jangan ubah migration hardening sebelumnya;
-- migration ini hanya mengganti cara hitung db_size_bytes.

CREATE OR REPLACE FUNCTION public.get_storage_usage_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  db_size_bytes bigint;
  storage_total_bytes bigint;
  storage_data json;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id = up.role_id
    WHERE up.id = auth.uid()
      AND up.status = 'Aktif'
      AND up.account_type = 'internal'
      AND r.status = 'Aktif'
      AND ((r.level >= 100) OR (r.permissions ? 'all'))
  ) THEN
    RAISE EXCEPTION 'Super Admin access required.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(pg_database_size(datname)), 0)::bigint
  INTO db_size_bytes
  FROM pg_database;

  SELECT COALESCE(SUM(COALESCE((o.metadata->>'size')::bigint, 0)), 0)
  INTO storage_total_bytes
  FROM storage.objects o;

  SELECT COALESCE(json_agg(
    json_build_object(
      'bucket_id', bucket_id,
      'file_count', file_count,
      'total_size_bytes', total_size_bytes
    ) ORDER BY total_size_bytes DESC, bucket_id ASC
  ), '[]'::json)
  INTO storage_data
  FROM (
    SELECT
      b.id AS bucket_id,
      COUNT(o.id)::bigint AS file_count,
      COALESCE(SUM(COALESCE((o.metadata->>'size')::bigint, 0)), 0)::bigint AS total_size_bytes
    FROM storage.buckets b
    LEFT JOIN storage.objects o ON o.bucket_id = b.id
    GROUP BY b.id
  ) bucket_stats;

  RETURN json_build_object(
    'database_size_bytes', db_size_bytes,
    'database_size_pretty', pg_size_pretty(db_size_bytes),
    'storage_total_bytes', storage_total_bytes,
    'storage_total_pretty', pg_size_pretty(storage_total_bytes),
    'buckets', storage_data
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_storage_usage_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storage_usage_stats() TO authenticated;
