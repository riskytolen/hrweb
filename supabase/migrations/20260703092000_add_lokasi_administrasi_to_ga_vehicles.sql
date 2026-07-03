-- Add administration location metadata for each GA vehicle.

ALTER TABLE public.ga_vehicles
  ADD COLUMN IF NOT EXISTS lokasi_administrasi text;
