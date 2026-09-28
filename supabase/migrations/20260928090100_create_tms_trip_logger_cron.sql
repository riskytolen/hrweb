-- Jadwalkan sinkronisasi Logger Trips setiap 2 menit.
--
-- Memakai pola yang sama dengan capture suhu titik dan sync e-POD:
-- pg_cron + pg_net dengan base URL dari Vault. Secret yang dipakai adalah
-- `tms_point_capture_secret` yang sudah ada, sehingga endpoint
-- /api/cron/tms-trip-logger-sync memakai TMS_POINT_CAPTURE_SECRET selama
-- TMS_TRIP_LOGGER_SYNC_SECRET belum diisi.
--
-- Untuk memakai secret terpisah: simpan `tms_trip_logger_sync_secret` di
-- Vault dan ganti nama secret pada blok Authorization di bawah.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-tms-trip-logger') then
    perform cron.unschedule('sync-tms-trip-logger');
  end if;
end;
$$;

select cron.schedule(
  'sync-tms-trip-logger',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'tms_capture_base_url'
    ) || '/api/cron/tms-trip-logger-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'tms_point_capture_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $job$
);
