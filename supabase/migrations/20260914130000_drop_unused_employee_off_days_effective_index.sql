-- Drop index yang tidak dibutuhkan oleh query saat ini.
-- Partial unique index uniq_employee_off_days_active tetap menjaga satu jadwal aktif per pegawai/hari.

DROP INDEX IF EXISTS public.idx_employee_off_days_effective;
