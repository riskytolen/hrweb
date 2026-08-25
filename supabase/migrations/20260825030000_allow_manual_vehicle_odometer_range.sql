-- Manual odometer range per rute: setiap log wajib isi awal+akhir manual, validasi berurutan.
-- - Dalam satu log: odometer_akhir >= odometer_awal
-- - Antar log: odometer_awal log baru >= odometer_akhir log sebelumnya (gap naik boleh karena pemakaian di luar rute)
-- - Input tanggal tetap berurutan: tidak boleh menyisipkan log lama di bawah tanggal terakhir.
-- - Koreksi log terbaru boleh ubah awal+akhir bersamaan dengan validasi yang sama.

CREATE OR REPLACE FUNCTION public.create_vehicle_odometer_log(
  p_vehicle_id integer,
  p_tanggal date,
  p_odometer_awal numeric,
  p_odometer_akhir numeric,
  p_catatan text DEFAULT NULL
)
RETURNS public.vehicle_odometer_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_vehicle public.ga_vehicles%ROWTYPE;
  v_last public.vehicle_odometer_logs%ROWTYPE;
  v_start numeric(12,1);
  v_end numeric(12,1);
BEGIN
  IF NOT public.has_vehicle_odometer_access('manage') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.ga_vehicles
  WHERE id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kendaraan tidak ditemukan.';
  END IF;

  IF v_vehicle.status <> 'Aktif' THEN
    RAISE EXCEPTION 'Kendaraan tidak aktif tidak bisa dipilih untuk input baru.';
  END IF;

  IF p_odometer_awal IS NULL THEN
    RAISE EXCEPTION 'Odometer awal wajib diisi.';
  END IF;

  IF p_odometer_akhir IS NULL THEN
    RAISE EXCEPTION 'Odometer akhir wajib diisi.';
  END IF;

  v_start := round(p_odometer_awal::numeric, 1);
  v_end := round(p_odometer_akhir::numeric, 1);

  IF v_start < 0 OR v_end < 0 THEN
    RAISE EXCEPTION 'Odometer tidak boleh negatif.';
  END IF;

  IF v_end < v_start THEN
    RAISE EXCEPTION 'Odometer akhir harus lebih besar atau sama dengan odometer awal.';
  END IF;

  SELECT * INTO v_last
  FROM public.vehicle_odometer_logs
  WHERE vehicle_id = p_vehicle_id
  ORDER BY tanggal DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF p_tanggal < v_last.tanggal THEN
      RAISE EXCEPTION 'Tanggal input tidak boleh lebih lama dari log terakhir (%).', v_last.tanggal;
    END IF;

    IF v_start < v_last.odometer_akhir THEN
      RAISE EXCEPTION 'Odometer awal (%) tidak boleh lebih kecil dari odometer akhir terakhir (%). Anomali: odometer turun.', v_start, v_last.odometer_akhir;
    END IF;
  END IF;

  INSERT INTO public.vehicle_odometer_logs (
    vehicle_id, tanggal, odometer_awal, odometer_akhir, catatan, created_by, updated_by
  ) VALUES (
    p_vehicle_id,
    p_tanggal,
    v_start,
    v_end,
    nullif(btrim(p_catatan), ''),
    auth.uid(),
    auth.uid()
  )
  RETURNING * INTO v_last;

  PERFORM public.audit_vehicle_odometer_action(
    'create',
    v_last.id,
    v_vehicle.unit,
    NULL,
    to_jsonb(v_last),
    jsonb_build_object('vehicle_id', p_vehicle_id, 'jarak_km', v_last.jarak_km)
  );

  RETURN v_last;
END;
$$;

-- Edit both odometer values for latest log; keep old signature compatible via wrapper.
CREATE OR REPLACE FUNCTION public.update_vehicle_odometer_log(
  p_log_id bigint,
  p_tanggal date,
  p_odometer_awal numeric,
  p_odometer_akhir numeric,
  p_catatan text DEFAULT NULL
)
RETURNS public.vehicle_odometer_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target public.vehicle_odometer_logs%ROWTYPE;
  v_latest public.vehicle_odometer_logs%ROWTYPE;
  v_previous public.vehicle_odometer_logs%ROWTYPE;
  v_vehicle public.ga_vehicles%ROWTYPE;
  v_updated public.vehicle_odometer_logs%ROWTYPE;
  v_new_start numeric(12,1);
  v_new_end numeric(12,1);
BEGIN
  IF NOT public.has_vehicle_odometer_access('manage') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_target
  FROM public.vehicle_odometer_logs
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Log odometer tidak ditemukan.';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.ga_vehicles
  WHERE id = v_target.vehicle_id
  FOR UPDATE;

  SELECT * INTO v_latest
  FROM public.vehicle_odometer_logs
  WHERE vehicle_id = v_target.vehicle_id
  ORDER BY tanggal DESC, id DESC
  LIMIT 1;

  IF v_latest.id <> v_target.id THEN
    RAISE EXCEPTION 'Hanya log terbaru kendaraan yang boleh dikoreksi.';
  END IF;

  SELECT * INTO v_previous
  FROM public.vehicle_odometer_logs
  WHERE vehicle_id = v_target.vehicle_id
    AND id <> v_target.id
  ORDER BY tanggal DESC, id DESC
  LIMIT 1;

  IF FOUND AND p_tanggal < v_previous.tanggal THEN
    RAISE EXCEPTION 'Tanggal koreksi tidak boleh lebih lama dari log sebelumnya (%).', v_previous.tanggal;
  END IF;

  IF p_odometer_awal IS NULL THEN
    RAISE EXCEPTION 'Odometer awal wajib diisi.';
  END IF;

  IF p_odometer_akhir IS NULL THEN
    RAISE EXCEPTION 'Odometer akhir wajib diisi.';
  END IF;

  v_new_start := round(p_odometer_awal::numeric, 1);
  v_new_end := round(p_odometer_akhir::numeric, 1);

  IF v_new_start < 0 OR v_new_end < 0 THEN
    RAISE EXCEPTION 'Odometer tidak boleh negatif.';
  END IF;

  IF v_new_end < v_new_start THEN
    RAISE EXCEPTION 'Odometer akhir harus lebih besar atau sama dengan odometer awal.';
  END IF;

  IF FOUND AND v_new_start < v_previous.odometer_akhir THEN
    RAISE EXCEPTION 'Odometer awal koreksi (%) tidak boleh lebih kecil dari odometer akhir log sebelumnya (%).', v_new_start, v_previous.odometer_akhir;
  END IF;

  UPDATE public.vehicle_odometer_logs
  SET tanggal = p_tanggal,
      odometer_awal = v_new_start,
      odometer_akhir = v_new_end,
      catatan = nullif(btrim(p_catatan), ''),
      updated_by = auth.uid()
  WHERE id = p_log_id
  RETURNING * INTO v_updated;

  PERFORM public.audit_vehicle_odometer_action(
    'update',
    v_updated.id,
    v_vehicle.unit,
    to_jsonb(v_target),
    to_jsonb(v_updated),
    jsonb_build_object('vehicle_id', v_target.vehicle_id, 'jarak_km', v_updated.jarak_km)
  );

  RETURN v_updated;
END;
$$;

-- Backwards compatibility for clients still calling 4-arg version (only end was editable).
CREATE OR REPLACE FUNCTION public.update_vehicle_odometer_log(
  p_log_id bigint,
  p_tanggal date,
  p_odometer_akhir numeric,
  p_catatan text DEFAULT NULL
)
RETURNS public.vehicle_odometer_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target public.vehicle_odometer_logs%ROWTYPE;
BEGIN
  SELECT * INTO v_target FROM public.vehicle_odometer_logs WHERE id = p_log_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Log odometer tidak ditemukan.';
  END IF;
  RETURN public.update_vehicle_odometer_log(p_log_id, p_tanggal, v_target.odometer_awal, p_odometer_akhir, p_catatan);
END;
$$;

REVOKE ALL ON FUNCTION public.create_vehicle_odometer_log(integer, date, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_vehicle_odometer_log(bigint, date, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_vehicle_odometer_log(bigint, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vehicle_odometer_log(integer, date, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vehicle_odometer_log(bigint, date, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_vehicle_odometer_log(bigint, date, numeric, text) TO authenticated;
