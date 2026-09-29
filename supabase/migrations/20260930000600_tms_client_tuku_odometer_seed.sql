-- Seed awal mapping unit Operasional Kendaraan (ga_vehicles) untuk TUKU.
--
-- Unit yang dipetakan adalah ga_vehicles aktif yang nomor polisinya cocok
-- dengan mapping TMS aktif TUKU (tms_client_vehicle_assignments).
-- Idempotent: insert hanya bila pasangan (client_id, vehicle_id) belum ada.
-- Super Admin dapat menambah/menghapus mapping lewat tab Client TMS.

insert into public.client_vehicle_odometer_assignments (client_id, vehicle_id, status)
select tuku.id, ga.id, 'Aktif'
from (select id from public.tms_clients where code = 'TUKU') tuku
join public.ga_vehicles ga
  on ga.status = 'Aktif'
  and upper(regexp_replace(coalesce(ga.unit, ''), '[[:space:].-]', '', 'g')) in (
    select a.license_plate_key
    from public.tms_client_vehicle_assignments a
    where a.client_id = tuku.id
      and a.status = 'active'
      and a.effective_from <= current_date
      and (a.effective_until is null or a.effective_until >= current_date)
  )
on conflict (client_id, vehicle_id) do nothing;
