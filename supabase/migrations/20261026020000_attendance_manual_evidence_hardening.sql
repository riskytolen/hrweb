-- Hardening trigger eviden absensi manual:
-- fungsi hanya memanipulasi NEW, tidak butuh SECURITY DEFINER, dan tidak
-- boleh dieksekusi sebagai RPC publik/authenticated.

CREATE OR REPLACE FUNCTION public.enforce_attendance_manual_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND NEW.is_manual IS TRUE
     AND NEW.status IN ('Hadir', 'Terlambat')
     AND NULLIF(btrim(NEW.evidence_path), '') IS NULL THEN
    RAISE EXCEPTION 'Eviden foto wajib dilampirkan untuk absen manual Hadir/Terlambat.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_attendance_manual_evidence()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
