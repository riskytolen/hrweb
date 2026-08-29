-- Fix missing INSERT schedule for gapok increments (pegawai Aktif baru tidak ter-jadwal)

CREATE OR REPLACE FUNCTION public.handle_pegawai_gapok_schedule_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_setting RECORD;
BEGIN
  SELECT * INTO v_setting FROM public.gapok_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.status = 'Aktif' AND NEW.jabatan_id IN (v_setting.driver_jabatan_id, v_setting.helper_jabatan_id) AND NEW.tanggal_bergabung IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.gapok_increment_events WHERE employee_id = NEW.id AND status='Scheduled') THEN
      PERFORM public.reconcile_gapok_schedule_for_employee(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pegawai_gapok_schedule_ins ON public.pegawai;
CREATE TRIGGER trg_pegawai_gapok_schedule_ins
  AFTER INSERT ON public.pegawai
  FOR EACH ROW EXECUTE FUNCTION public.handle_pegawai_gapok_schedule_insert();

-- Backfill any eligible Aktif without schedule (e.g. test inserts before this fix)
SELECT public.reconcile_gapok_schedules();

NOTIFY pgrst, 'reload schema';
