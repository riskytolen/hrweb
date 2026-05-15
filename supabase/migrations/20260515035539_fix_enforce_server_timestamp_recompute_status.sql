-- Fix trigger enforce_server_timestamp: hitung ulang status & durasi_telat saat override
-- 
-- Bug sebelumnya: trigger override jam_masuk + tanggal saat user bukan role 1-4,
-- TAPI tidak menghitung ulang status/durasi_telat. Akibatnya: form admin yang
-- jam_masuk-nya ditimpa ke jam submit, tetap berstatus 'Hadir' meski seharusnya
-- 'Terlambat'. Selektif terjadi saat JWT admin expired (auth.uid() NULL).
-- 
-- Perbaikan:
-- 1. Skip total override untuk role admin (1-4) -- trust input form.
-- 2. Skip total untuk status special: Libur, Alpha, Izin, Sakit, Cuti.
-- 3. Untuk channel non-admin (mobile/anon): override jam_masuk+tanggal,
--    DAN hitung ulang status & durasi_telat dari schedule + toleransi.

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

  v_now_wib_ts := (now() AT TIME ZONE 'Asia/Jakarta')::timestamp;
  NEW.jam_masuk := v_now_wib_ts::time;
  NEW.tanggal   := v_now_wib_ts::date;

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

  NEW.created_at := now();
  RETURN NEW;
END;
$function$;
