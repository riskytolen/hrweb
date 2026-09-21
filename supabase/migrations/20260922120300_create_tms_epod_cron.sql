-- Jadwalkan sinkronisasi FO aktif ke pool e-POD setiap 2 menit.
--
-- Memakai pola yang sama dengan capture suhu titik: pg_cron + pg_net dan
-- base URL dari Vault. Secret yang dipakai adalah `tms_point_capture_secret`
-- yang sudah ada, sehingga endpoint /api/cron/tms-epod-sync memakai
-- TMS_POINT_CAPTURE_SECRET selama TMS_EPOD_SYNC_SECRET belum diisi.
--
-- Untuk memakai secret terpisah: simpan `tms_epod_sync_secret` di Vault dan
-- ganti nama secret pada blok Authorization di bawah.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-tms-epod') then
    perform cron.unschedule('sync-tms-epod');
  end if;
end;
$$;

select cron.schedule(
  'sync-tms-epod',
  '*/2 * * * *',
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
