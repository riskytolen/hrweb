-- Kelompok pegawai untuk payroll: prioritas penggajian + pengelompokan visual di spreadsheet.
-- Satu pegawai hanya bisa berada di satu kelompok (PK employee_id).

CREATE TABLE IF NOT EXISTS public.payroll_groups (
  id         SERIAL PRIMARY KEY,
  nama       TEXT NOT NULL UNIQUE,
  warna      TEXT NOT NULL DEFAULT '#3b82f6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_groups_sort_order_idx
  ON public.payroll_groups (sort_order);

CREATE TABLE IF NOT EXISTS public.payroll_employee_groups (
  employee_id       VARCHAR(20) PRIMARY KEY REFERENCES public.pegawai(id) ON DELETE CASCADE,
  group_id          INTEGER NOT NULL REFERENCES public.payroll_groups(id) ON DELETE CASCADE,
  member_sort_order INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_employee_groups_group_idx
  ON public.payroll_employee_groups (group_id, member_sort_order);

CREATE TRIGGER payroll_groups_updated_at
  BEFORE UPDATE ON public.payroll_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER payroll_employee_groups_updated_at
  BEFORE UPDATE ON public.payroll_employee_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payroll_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_employee_groups ENABLE ROW LEVEL SECURITY;

-- Semua authenticated bisa baca kelompok.
CREATE POLICY payroll_groups_select ON public.payroll_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY payroll_groups_insert ON public.payroll_groups
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('payroll'));

CREATE POLICY payroll_groups_update ON public.payroll_groups
  FOR UPDATE TO authenticated
  USING (public.has_app_permission('payroll'))
  WITH CHECK (public.has_app_permission('payroll'));

CREATE POLICY payroll_groups_delete ON public.payroll_groups
  FOR DELETE TO authenticated USING (public.has_app_permission('payroll'));

CREATE POLICY payroll_employee_groups_select ON public.payroll_employee_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY payroll_employee_groups_insert ON public.payroll_employee_groups
  FOR INSERT TO authenticated WITH CHECK (public.has_app_permission('payroll'));

CREATE POLICY payroll_employee_groups_update ON public.payroll_employee_groups
  FOR UPDATE TO authenticated
  USING (public.has_app_permission('payroll'))
  WITH CHECK (public.has_app_permission('payroll'));

CREATE POLICY payroll_employee_groups_delete ON public.payroll_employee_groups
  FOR DELETE TO authenticated USING (public.has_app_permission('payroll'));
