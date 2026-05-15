-- Hardening lanjutan trigger enforce_server_timestamp:
-- Selain hitung ulang status/durasi_telat untuk channel non-admin,
-- juga ambil schedule_jam_masuk + toleransi_menit + denda dari sumber otoritatif
-- (division_schedules & attendance_penalty_rates), TIDAK trust nilai dari client.
-- 
-- Ini menutup celah client mengirim toleransi=999 atau denda=0 untuk
-- mengelabui hitungan.

CREATE OR REPLACE FUNCTION public.enforce_server_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_role        INT;
  v_user_id          UUID;
  v_is_admin         BOOLEAN;
  v_now_wib_ts       TIMESTAMP;
  v_jam_masuk_min    INT;
  v_schedule_min     INT;
  v_toleransi_min    INT;
  v_diff             INT;
  v_sched_row        RECORD;
  v_penalty          RECORD;
BEGIN
  IF NEW.status IN ('Libur', 'Alpha', 'Izin', 'Sakit', 'Cuti') THEN
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT role_id INTO v_user_role FROM user_profiles WHERE id = v_user_id;
  END IF;
  v_is_admin := v_user_role IN (1, 2, 3, 4);

  IF v_is_admin THEN
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  -- Channel non-admin (mobile/anon): force semua nilai dari server.
  v_now_wib_ts := (now() AT TIME ZONE 'Asia/Jakarta')::timestamp;
  NEW.jam_masuk := v_now_wib_ts::time;
  NEW.tanggal   := v_now_wib_ts::date;

  -- Override schedule + toleransi dari division_schedules.
  IF NEW.division_id IS NOT NULL THEN
    SELECT jam_masuk, toleransi_menit
      INTO v_sched_row
    FROM division_schedules
    WHERE division_id = NEW.division_id AND status = 'Aktif'
    LIMIT 1;

    IF v_sched_row.jam_masuk IS NOT NULL THEN
      NEW.schedule_jam_masuk := v_sched_row.jam_masuk;
      NEW.toleransi_menit    := COALESCE(v_sched_row.toleransi_menit, 0);
    END IF;
  END IF;

  -- Hitung ulang status & durasi_telat.
  IF NEW.schedule_jam_masuk IS NOT NULL THEN
    v_jam_masuk_min := EXTRACT(HOUR FROM NEW.jam_masuk) * 60
                     + EXTRACT(MINUTE FROM NEW.jam_masuk);
    v_schedule_min  := EXTRACT(HOUR FROM NEW.schedule_jam_masuk) * 60
                     + EXTRACT(MINUTE FROM NEW.schedule_jam_masuk);
    v_toleransi_min := COALESCE(NEW.toleransi_menit, 0);
    v_diff := v_jam_masuk_min - v_schedule_min;

    IF v_diff <= v_toleransi_min THEN
      NEW.status := 'Hadir';
      NEW.durasi_telat := 0;
    ELSE
      NEW.status := 'Terlambat';
      NEW.durasi_telat := v_diff;
    END IF;
  END IF;

  -- Hitung ulang denda dari penalty rate divisi.
  IF NEW.status = 'Hadir' OR NEW.durasi_telat <= 0 THEN
    NEW.denda := 0;
  ELSIF NEW.division_id IS NOT NULL THEN
    SELECT denda_per_menit, batas_menit, denda_maksimum
      INTO v_penalty
    FROM attendance_penalty_rates
    WHERE division_id = NEW.division_id AND status = 'Aktif'
    LIMIT 1;

    IF v_penalty.denda_per_menit IS NOT NULL THEN
      IF NEW.durasi_telat > COALESCE(v_penalty.batas_menit, 20) THEN
        NEW.denda := COALESCE(v_penalty.denda_maksimum, 60000);
      ELSE
        NEW.denda := NEW.durasi_telat * v_penalty.denda_per_menit;
      END IF;
    ELSE
      NEW.denda := 0;
    END IF;
  ELSE
    NEW.denda := 0;
  END IF;

  NEW.created_at := now();
  RETURN NEW;
END;
$function$;
