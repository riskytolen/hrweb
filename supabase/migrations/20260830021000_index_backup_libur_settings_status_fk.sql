CREATE INDEX IF NOT EXISTS idx_backup_libur_settings_delivery_status_id
  ON public.backup_libur_settings (delivery_status_id);

NOTIFY pgrst, 'reload schema';
