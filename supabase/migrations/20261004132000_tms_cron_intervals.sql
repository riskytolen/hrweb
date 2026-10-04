-- Longgarkan interval cron TMS untuk menurunkan Log Ingestion.
-- Capture temperature tetap setiap menit (geofence sensitif interval).
--
-- - sync-tms-live-track: 2 menit -> 3 menit.
-- - sync-tms-epod: 2 menit -> 5 menit (offset menit 1,6,11,...).
-- - sync-tms-trip-logger: 2 menit -> 5 menit (offset menit 3,8,13,...).
--
-- Offset dibuat berbeda agar ketiga worker tidak berjalan serentak.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-tms-live-track') then
    perform cron.unschedule('sync-tms-live-track');
  end if;
end;
$$;

select cron.schedule(
  'sync-tms-live-track',
  '*/3 * * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'tms_capture_base_url'
    ) || '/api/cron/tms-live-track-sync',
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

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-tms-epod') then
    perform cron.unschedule('sync-tms-epod');
  end if;
end;
$$;

select cron.schedule(
  'sync-tms-epod',
  '1-59/5 * * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'tms_capture_base_url'
    ) || '/api/cron/tms-epod-sync',
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

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-tms-trip-logger') then
    perform cron.unschedule('sync-tms-trip-logger');
  end if;
end;
$$;

select cron.schedule(
  'sync-tms-trip-logger',
  '3-59/5 * * * *',
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
