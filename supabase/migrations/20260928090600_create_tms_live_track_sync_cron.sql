-- Jadwalkan sinkronisasi Live Track berkelompok setiap 2 menit.
--
-- Memakai pola yang sama dengan cron TMS lain: pg_cron + pg_net dengan base
-- URL dari Vault dan secret `tms_point_capture_secret` yang sudah ada.
-- Endpoint /api/cron/tms-live-track-sync memakai TMS_POINT_CAPTURE_SECRET
-- selama TMS_LIVE_TRACK_SYNC_SECRET belum diisi.
--
-- Untuk memakai secret terpisah: simpan `tms_live_track_sync_secret` di
-- Vault dan ganti nama secret pada blok Authorization di bawah.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-tms-live-track') then
    perform cron.unschedule('sync-tms-live-track');
  end if;
end;
$$;

select cron.schedule(
  'sync-tms-live-track',
  '*/2 * * * *',
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
