-- Reset input manual Worksheet: kosongkan seluruh kolom manual (nominal ke 0,
-- keterangan dan catatan ke NULL) untuk periode target. Pasangan tombol
-- Salin Input Lalu; mencakup input hasil salinan maupun input langsung.
-- Kolom hasil hitung worksheet, snapshot, total, status, dan arsip tidak disentuh.

CREATE OR REPLACE FUNCTION public.reset_payroll_manual_inputs(
  p_target_period text,
  p_employee_ids text[] DEFAULT NULL
)
RETURNS TABLE (
  reset_count integer,
  already_empty_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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

  RETURN QUERY
  WITH target_rows AS (
    SELECT id
    FROM public.payrolls
    WHERE periode = p_target_period
      AND status = 'Worksheet'
      AND (
        p_employee_ids IS NULL
        OR cardinality(p_employee_ids) = 0
        OR employee_id = ANY(p_employee_ids)
      )
  ),
  reset_rows AS (
    UPDATE public.payrolls p
    SET
      extra_job = 0,
      uang_makan = 0,
      insentif = 0,
      tunjangan_jabatan = 0,
      transport = 0,
      tunjangan_lain = 0,
      tambahan_lain = 0,
      koperasi = 0,
      koperasi_keterangan = NULL,
      pinjaman_perusahaan = 0,
      potongan_lain = 0,
      jht = 0,
      bpjs_kesehatan = 0,
      extra_job_keterangan = NULL,
      insentif_keterangan = NULL,
      pinjaman_perusahaan_keterangan = NULL,
      potongan_lain_keterangan = NULL,
      catatan = NULL,
      updated_at = now(),
      version = p.version + 1
    FROM target_rows t
    WHERE p.id = t.id
      AND p.status = 'Worksheet'
      AND (
        p.extra_job <> 0
        OR p.uang_makan <> 0
        OR p.insentif <> 0
        OR p.tunjangan_jabatan <> 0
        OR p.transport <> 0
        OR p.tunjangan_lain <> 0
        OR p.tambahan_lain <> 0
        OR p.koperasi <> 0
        OR p.pinjaman_perusahaan <> 0
        OR p.potongan_lain <> 0
        OR p.jht <> 0
        OR p.bpjs_kesehatan <> 0
        OR btrim(coalesce(p.extra_job_keterangan, '')) <> ''
        OR btrim(coalesce(p.insentif_keterangan, '')) <> ''
        OR btrim(coalesce(p.koperasi_keterangan, '')) <> ''
        OR btrim(coalesce(p.pinjaman_perusahaan_keterangan, '')) <> ''
        OR btrim(coalesce(p.potongan_lain_keterangan, '')) <> ''
        OR btrim(coalesce(p.catatan, '')) <> ''
      )
    RETURNING p.id
  )
  SELECT
    (SELECT count(*) FROM reset_rows)::integer AS reset_count,
    ((SELECT count(*) FROM target_rows) - (SELECT count(*) FROM reset_rows))::integer AS already_empty_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_payroll_manual_inputs(text, text[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_payroll_manual_inputs(text, text[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
