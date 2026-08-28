-- Snapshot employee identity/payment details when a payroll row becomes Final.
-- This keeps historical payroll exports stable even if master employee data changes later.

ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS final_employee_nama text,
  ADD COLUMN IF NOT EXISTS final_employee_jabatan text,
  ADD COLUMN IF NOT EXISTS final_employee_bank text,
  ADD COLUMN IF NOT EXISTS final_employee_no_rekening text,
  ADD COLUMN IF NOT EXISTS final_employee_nama_rekening text,
  ADD COLUMN IF NOT EXISTS final_snapshot_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_payroll_final_employee_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_employee record;
BEGIN
  IF NEW.status = 'Final' THEN
    SELECT
      p.nama,
      j.nama AS jabatan_nama,
      p.bank,
      p.no_rekening,
      p.nama_rekening
    INTO v_employee
    FROM public.pegawai p
    LEFT JOIN public.jabatan j ON j.id = p.jabatan_id
    WHERE p.id = NEW.employee_id;

    NEW.final_employee_nama := coalesce(nullif(NEW.final_employee_nama, ''), v_employee.nama, NEW.employee_id);
    NEW.final_employee_jabatan := coalesce(nullif(NEW.final_employee_jabatan, ''), v_employee.jabatan_nama, '-');
    NEW.final_employee_bank := coalesce(nullif(NEW.final_employee_bank, ''), v_employee.bank);
    NEW.final_employee_no_rekening := coalesce(nullif(NEW.final_employee_no_rekening, ''), v_employee.no_rekening);
    NEW.final_employee_nama_rekening := coalesce(nullif(NEW.final_employee_nama_rekening, ''), v_employee.nama_rekening);
    NEW.final_snapshot_at := coalesce(NEW.final_snapshot_at, now());
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Final' AND NEW.status <> 'Final' THEN
    NEW.final_employee_nama := NULL;
    NEW.final_employee_jabatan := NULL;
    NEW.final_employee_bank := NULL;
    NEW.final_employee_no_rekening := NULL;
    NEW.final_employee_nama_rekening := NULL;
    NEW.final_snapshot_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_payroll_final_employee_snapshot ON public.payrolls;
CREATE TRIGGER set_payroll_final_employee_snapshot
  BEFORE INSERT OR UPDATE OF status, final_employee_nama, final_employee_jabatan, final_employee_bank, final_employee_no_rekening, final_employee_nama_rekening
  ON public.payrolls
  FOR EACH ROW
  EXECUTE FUNCTION public.set_payroll_final_employee_snapshot();

UPDATE public.payrolls py
SET
  final_employee_nama = coalesce(nullif(py.final_employee_nama, ''), p.nama, py.employee_id),
  final_employee_jabatan = coalesce(nullif(py.final_employee_jabatan, ''), j.nama, '-'),
  final_employee_bank = coalesce(nullif(py.final_employee_bank, ''), p.bank),
  final_employee_no_rekening = coalesce(nullif(py.final_employee_no_rekening, ''), p.no_rekening),
  final_employee_nama_rekening = coalesce(nullif(py.final_employee_nama_rekening, ''), p.nama_rekening),
  final_snapshot_at = coalesce(py.final_snapshot_at, py.locked_at, py.updated_at, now())
FROM public.pegawai p
LEFT JOIN public.jabatan j ON j.id = p.jabatan_id
WHERE py.employee_id = p.id
  AND py.status = 'Final'
  AND (
    py.final_employee_nama IS NULL
    OR py.final_employee_jabatan IS NULL
    OR py.final_employee_bank IS NULL
    OR py.final_employee_no_rekening IS NULL
    OR py.final_employee_nama_rekening IS NULL
    OR py.final_snapshot_at IS NULL
  );

REVOKE ALL ON FUNCTION public.set_payroll_final_employee_snapshot() FROM PUBLIC, anon, authenticated;
