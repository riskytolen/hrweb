-- Remove the effective-date RPC after restoring same-day weekly off-day changes.

DROP FUNCTION IF EXISTS public.apply_employee_off_day_changes(date, jsonb, jsonb);
