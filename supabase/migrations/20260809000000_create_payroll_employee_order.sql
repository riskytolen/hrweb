-- Urutan tampilan baris payroll per pegawai (global, berlaku semua periode).
-- `sort_order` naik = tampil lebih dulu. Pegawai tanpa record otomatis di urutan bawah.

CREATE TABLE IF NOT EXISTS public.payroll_employee_order (
  employee_id VARCHAR(20) PRIMARY KEY REFERENCES public.pegawai(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL,
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_employee_order_sort_order_idx
  ON public.payroll_employee_order (sort_order);

CREATE TRIGGER payroll_employee_order_updated_at
  BEFORE UPDATE ON public.payroll_employee_order
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed urutan awal: semua pegawai berdasarkan nama lalu id (stabil).
INSERT INTO public.payroll_employee_order (employee_id, sort_order)
SELECT p.id, ROW_NUMBER() OVER (ORDER BY p.nama, p.id)
FROM public.pegawai p
ON CONFLICT (employee_id) DO NOTHING;

ALTER TABLE public.payroll_employee_order ENABLE ROW LEVEL SECURITY;

-- Semua authenticated bisa baca urutan.
CREATE POLICY payroll_order_select ON public.payroll_employee_order
  FOR SELECT TO authenticated
  USING (true);

-- Hanya yang punya permission payroll (edit/full) yang bisa mengubah urutan.
CREATE POLICY payroll_order_insert ON public.payroll_employee_order
  FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('payroll'));

CREATE POLICY payroll_order_update ON public.payroll_employee_order
  FOR UPDATE TO authenticated
  USING (public.has_app_permission('payroll'))
  WITH CHECK (public.has_app_permission('payroll'));

CREATE POLICY payroll_order_delete ON public.payroll_employee_order
  FOR DELETE TO authenticated
  USING (public.has_app_permission('payroll'));