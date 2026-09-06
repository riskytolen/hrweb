-- Salin input manual + catatan dari slip Final periode sebelumnya.
-- Kontrak:
-- - Menyalin 12 kolom nominal manual + 5 kolom keterangan + catatan,
--   hanya ke sel target yang masih kosong.
-- - "Kosong" untuk nominal = 0; untuk teks = NULL/kosong/whitespace.
-- - Kolom hasil hitung worksheet, snapshot, total, status, dan arsip Final tidak disentuh.
-- - Sumber harus seluruhnya Final; target hanya Worksheet.
-- - Periode sumber harus tepat satu bulan sebelum periode target.

-- ─── Helper izin: payroll penuh atau payroll.input, user & role aktif ───
CREATE OR REPLACE FUNCTION public.has_payroll_input_permission()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.roles r ON r.id = up.role_id
    WHERE up.id = auth.uid()
      AND up.status = 'Aktif'
      AND r.status = 'Aktif'
      AND (
        r.permissions ? 'all'
        OR r.permissions ? 'payroll'
        OR r.permissions ? 'payroll.input'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_payroll_input_permission() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_payroll_input_permission() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.copy_payroll_manual_inputs_from_previous(
  p_target_period text,
  p_source_period text
)
RETURNS TABLE (
  updated_count integer,
  without_source_count integer,
  unchanged_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source_total integer;
  v_source_worksheet integer;
  v_source_draft integer;
BEGIN
  -- 1. Izin server-side: payroll penuh atau payroll.input (bukan view-only).
  IF NOT public.has_payroll_input_permission() THEN
    RAISE EXCEPTION 'insufficient_payroll_permission' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Format periode YYYY-MM dan kedekatan tepat satu bulan.
  IF p_target_period !~ '^\d{4}-(0[1-9]|1[0-2])$'
     OR p_source_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid_period_format' USING ERRCODE = 'P0001';
  END IF;
  IF to_date(p_source_period, 'YYYY-MM') <> (to_date(p_target_period, 'YYYY-MM') - INTERVAL '1 month')::date THEN
    RAISE EXCEPTION 'source_period_not_previous' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Tolak duplikat defensif agar hasil join per pegawai deterministik.
  IF EXISTS (
    SELECT 1 FROM public.payrolls
    WHERE periode IN (p_target_period, p_source_period)
    GROUP BY employee_id, periode
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_payroll_rows' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status = 'Worksheet')::integer,
    count(*) FILTER (WHERE status = 'Draft')::integer
  INTO v_source_total, v_source_worksheet, v_source_draft
  FROM public.payrolls
  WHERE periode = p_source_period;

  IF v_source_total = 0 THEN
    RAISE EXCEPTION 'source_period_empty' USING ERRCODE = 'P0001';
  END IF;

  IF v_source_worksheet > 0 THEN
    RAISE EXCEPTION 'source_period_has_worksheet' USING ERRCODE = 'P0001';
  END IF;

  IF v_source_draft > 0 THEN
    RAISE EXCEPTION 'source_period_has_draft' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH target_rows AS (
    SELECT
      id,
      employee_id,
      extra_job,
      uang_makan,
      insentif,
      tunjangan_jabatan,
      transport,
      tunjangan_lain,
      tambahan_lain,
      koperasi,
      koperasi_keterangan,
      pinjaman_perusahaan,
      potongan_lain,
      jht,
      bpjs_kesehatan,
      extra_job_keterangan,
      insentif_keterangan,
      pinjaman_perusahaan_keterangan,
      potongan_lain_keterangan,
      catatan
    FROM public.payrolls
    WHERE periode = p_target_period
      AND status = 'Worksheet'
  ),
  source_rows AS (
    SELECT
      employee_id,
      extra_job,
      uang_makan,
      insentif,
      tunjangan_jabatan,
      transport,
      tunjangan_lain,
      tambahan_lain,
      koperasi,
      koperasi_keterangan,
      pinjaman_perusahaan,
      potongan_lain,
      jht,
      bpjs_kesehatan,
      extra_job_keterangan,
      insentif_keterangan,
      pinjaman_perusahaan_keterangan,
      potongan_lain_keterangan,
      catatan
    FROM public.payrolls
    WHERE periode = p_source_period
      AND status = 'Final'
  ),
  matched AS (
    SELECT
      t.id,
      CASE WHEN t.extra_job = 0 AND s.extra_job > 0 THEN s.extra_job ELSE t.extra_job END AS extra_job,
      CASE WHEN t.uang_makan = 0 AND s.uang_makan > 0 THEN s.uang_makan ELSE t.uang_makan END AS uang_makan,
      CASE WHEN t.insentif = 0 AND s.insentif > 0 THEN s.insentif ELSE t.insentif END AS insentif,
      CASE WHEN t.tunjangan_jabatan = 0 AND s.tunjangan_jabatan > 0 THEN s.tunjangan_jabatan ELSE t.tunjangan_jabatan END AS tunjangan_jabatan,
      CASE WHEN t.transport = 0 AND s.transport > 0 THEN s.transport ELSE t.transport END AS transport,
      CASE WHEN t.tunjangan_lain = 0 AND s.tunjangan_lain > 0 THEN s.tunjangan_lain ELSE t.tunjangan_lain END AS tunjangan_lain,
      CASE WHEN t.tambahan_lain = 0 AND s.tambahan_lain > 0 THEN s.tambahan_lain ELSE t.tambahan_lain END AS tambahan_lain,
      CASE WHEN t.koperasi = 0 AND s.koperasi > 0 THEN s.koperasi ELSE t.koperasi END AS koperasi,
      CASE WHEN btrim(coalesce(t.koperasi_keterangan, '')) = '' AND btrim(coalesce(s.koperasi_keterangan, '')) <> '' THEN s.koperasi_keterangan ELSE t.koperasi_keterangan END AS koperasi_keterangan,
      CASE WHEN t.pinjaman_perusahaan = 0 AND s.pinjaman_perusahaan > 0 THEN s.pinjaman_perusahaan ELSE t.pinjaman_perusahaan END AS pinjaman_perusahaan,
      CASE WHEN t.potongan_lain = 0 AND s.potongan_lain > 0 THEN s.potongan_lain ELSE t.potongan_lain END AS potongan_lain,
      CASE WHEN t.jht = 0 AND s.jht > 0 THEN s.jht ELSE t.jht END AS jht,
      CASE WHEN t.bpjs_kesehatan = 0 AND s.bpjs_kesehatan > 0 THEN s.bpjs_kesehatan ELSE t.bpjs_kesehatan END AS bpjs_kesehatan,
      CASE WHEN btrim(coalesce(t.extra_job_keterangan, '')) = '' AND btrim(coalesce(s.extra_job_keterangan, '')) <> '' THEN s.extra_job_keterangan ELSE t.extra_job_keterangan END AS extra_job_keterangan,
      CASE WHEN btrim(coalesce(t.insentif_keterangan, '')) = '' AND btrim(coalesce(s.insentif_keterangan, '')) <> '' THEN s.insentif_keterangan ELSE t.insentif_keterangan END AS insentif_keterangan,
      CASE WHEN btrim(coalesce(t.pinjaman_perusahaan_keterangan, '')) = '' AND btrim(coalesce(s.pinjaman_perusahaan_keterangan, '')) <> '' THEN s.pinjaman_perusahaan_keterangan ELSE t.pinjaman_perusahaan_keterangan END AS pinjaman_perusahaan_keterangan,
      CASE WHEN btrim(coalesce(t.potongan_lain_keterangan, '')) = '' AND btrim(coalesce(s.potongan_lain_keterangan, '')) <> '' THEN s.potongan_lain_keterangan ELSE t.potongan_lain_keterangan END AS potongan_lain_keterangan,
      CASE WHEN btrim(coalesce(t.catatan, '')) = '' AND btrim(coalesce(s.catatan, '')) <> '' THEN s.catatan ELSE t.catatan END AS catatan,
      (
        (t.extra_job = 0 AND s.extra_job > 0) OR
        (t.uang_makan = 0 AND s.uang_makan > 0) OR
        (t.insentif = 0 AND s.insentif > 0) OR
        (t.tunjangan_jabatan = 0 AND s.tunjangan_jabatan > 0) OR
        (t.transport = 0 AND s.transport > 0) OR
        (t.tunjangan_lain = 0 AND s.tunjangan_lain > 0) OR
        (t.tambahan_lain = 0 AND s.tambahan_lain > 0) OR
        (t.koperasi = 0 AND s.koperasi > 0) OR
        (btrim(coalesce(t.koperasi_keterangan, '')) = '' AND btrim(coalesce(s.koperasi_keterangan, '')) <> '') OR
        (t.pinjaman_perusahaan = 0 AND s.pinjaman_perusahaan > 0) OR
        (t.potongan_lain = 0 AND s.potongan_lain > 0) OR
        (t.jht = 0 AND s.jht > 0) OR
        (t.bpjs_kesehatan = 0 AND s.bpjs_kesehatan > 0) OR
        (btrim(coalesce(t.extra_job_keterangan, '')) = '' AND btrim(coalesce(s.extra_job_keterangan, '')) <> '') OR
        (btrim(coalesce(t.insentif_keterangan, '')) = '' AND btrim(coalesce(s.insentif_keterangan, '')) <> '') OR
        (btrim(coalesce(t.pinjaman_perusahaan_keterangan, '')) = '' AND btrim(coalesce(s.pinjaman_perusahaan_keterangan, '')) <> '') OR
        (btrim(coalesce(t.potongan_lain_keterangan, '')) = '' AND btrim(coalesce(s.potongan_lain_keterangan, '')) <> '') OR
        (btrim(coalesce(t.catatan, '')) = '' AND btrim(coalesce(s.catatan, '')) <> '')
      ) AS has_change
    FROM target_rows t
    JOIN source_rows s ON s.employee_id = t.employee_id
  ),
  updated_rows AS (
    UPDATE public.payrolls p
    SET
      extra_job = m.extra_job,
      uang_makan = m.uang_makan,
      insentif = m.insentif,
      tunjangan_jabatan = m.tunjangan_jabatan,
      transport = m.transport,
      tunjangan_lain = m.tunjangan_lain,
      tambahan_lain = m.tambahan_lain,
      koperasi = m.koperasi,
      koperasi_keterangan = m.koperasi_keterangan,
      pinjaman_perusahaan = m.pinjaman_perusahaan,
      potongan_lain = m.potongan_lain,
      jht = m.jht,
      bpjs_kesehatan = m.bpjs_kesehatan,
      extra_job_keterangan = m.extra_job_keterangan,
      insentif_keterangan = m.insentif_keterangan,
      pinjaman_perusahaan_keterangan = m.pinjaman_perusahaan_keterangan,
      potongan_lain_keterangan = m.potongan_lain_keterangan,
      catatan = m.catatan
    FROM matched m
    WHERE p.id = m.id
      AND p.status = 'Worksheet'
      AND m.has_change
    RETURNING p.id
  )
  SELECT
    (SELECT count(*) FROM updated_rows)::integer AS updated_count,
    (
      SELECT count(*)
      FROM target_rows t
      LEFT JOIN source_rows s ON s.employee_id = t.employee_id
      WHERE s.employee_id IS NULL
    )::integer AS without_source_count,
    (SELECT count(*) FROM matched WHERE NOT has_change)::integer AS unchanged_count;
END;
$$;

REVOKE ALL ON FUNCTION public.copy_payroll_manual_inputs_from_previous(text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.copy_payroll_manual_inputs_from_previous(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
