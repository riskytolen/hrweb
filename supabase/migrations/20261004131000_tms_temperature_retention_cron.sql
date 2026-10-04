-- Pindahkan retention tms_route_point_temperatures dari worker capture
-- setiap-menit ke cron database harian.
--
-- Semantik dipertahankan persis dari worker lama:
-- - Batas: measured_at < now() - interval '360 days' (360 hari elapsed,
--   BUKAN interval '12 months' kalender).
-- - Berlaku global untuk semua tenant termasuk client_id IS NULL.
-- - Tidak menyentuh kolom selain menghapus row expired.
--
-- Index measured_at ditambahkan karena index existing (vehicle_id,
-- measured_at) tidak efisien untuk range global berdasarkan measured_at.

create index if not exists tms_route_point_temperatures_measured_at_idx
  on public.tms_route_point_temperatures (measured_at);

create or replace function public.tms_purge_expired_route_point_temperatures()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '360 days';
  v_deleted integer := 0;
begin
  delete from public.tms_route_point_temperatures
  where measured_at < v_cutoff;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted,
    'cutoff', v_cutoff
  );
end;
$$;

revoke all on function public.tms_purge_expired_route_point_temperatures() from public, anon, authenticated;
grant execute on function public.tms_purge_expired_route_point_temperatures() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-tms-point-temperatures') then
    perform cron.unschedule('purge-tms-point-temperatures');
  end if;
end;
$$;

-- Harian 18:30 UTC = 01:30 WIB (di luar jam cron lain).
select cron.schedule(
  'purge-tms-point-temperatures',
  '30 18 * * *',
  $job$
  select public.tms_purge_expired_route_point_temperatures();
  $job$
);

notify pgrst, 'reload schema';
