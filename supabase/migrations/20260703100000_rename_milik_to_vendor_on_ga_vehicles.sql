-- Rename milik column to vendor for clarity.
ALTER TABLE public.ga_vehicles
  RENAME COLUMN milik TO vendor;
