-- Hapus nilai satu kolom manual Worksheet untuk semua baris periode target.
-- Nominal manual kembali ke 0, keterangan manual menjadi NULL.
-- Hanya 17 kolom manual spreadsheet yang diterima (whitelist ketat);
-- kolom hasil hitung, total, status, dan arsip selalu ditolak.

CREATE OR REPLACE FUNCTION public.reset_payroll_manual_input_column(
  p_target_period text,
  p_column_key text
)
RETURNS TABLE (
  reset_count integer,
  already_empty_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_assign text;
  v_cond text;
BEGIN
  -- 1. Izin server-side: payroll penuh atau payroll.input (bukan view-only).
  IF NOT public.has_payroll_input_permission() THEN
    RAISE EXCEPTION 'insufficient_payroll_permission' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Format periode YYYY-MM.
  IF p_target_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid_period_format' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Tolak duplikat defensif agar hitungan per pegawai deterministik.
  IF EXISTS (
    SELECT 1 FROM public.payrolls
    WHERE periode = p_target_period
    GROUP BY employee_id, periode
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_payroll_rows' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Whitelist ketat 17 kolom manual spreadsheet.
  IF p_column_key IN (
    'extra_job', 'uang_makan', 'insentif', 'tunjangan_jabatan',
    'transport', 'tunjangan_lain', 'tambahan_lain', 'koperasi',
    'pinjaman_perusahaan', 'potongan_lain', 'jht', 'bpjs_kesehatan'
  ) THEN
    v_assign := '0';
    v_cond := format('p.%I <> 0', p_column_key);
  ELSIF p_column_key IN (
    'extra_job_keterangan', 'insentif_keterangan', 'koperasi_keterangan',
    'pinjaman_perusahaan_keterangan', 'potongan_lain_keterangan'
  ) THEN
    v_assign := 'NULL';
    v_cond := format('btrim(coalesce(p.%I, '''')) <> ''''', p_column_key);
  ELSE
    RAISE EXCEPTION 'invalid_column_key' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY EXECUTE format('
    WITH target_rows AS (
      SELECT id
      FROM public.payrolls
      WHERE periode = $1
        AND status = ''Worksheet''
    ),
    reset_rows AS (
      UPDATE public.payrolls p
      SET %I = %s,
          updated_at = now(),
          version = p.version + 1
      FROM target_rows t
      WHERE p.id = t.id
        AND p.status = ''Worksheet''
        AND (%s)
      RETURNING p.id
    )
    SELECT
      (SELECT count(*) FROM reset_rows)::integer AS reset_count,
      ((SELECT count(*) FROM target_rows) - (SELECT count(*) FROM reset_rows))::integer AS already_empty_count',
    p_column_key, v_assign, v_cond)
  USING p_target_period;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_payroll_manual_input_column(text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_payroll_manual_input_column(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
