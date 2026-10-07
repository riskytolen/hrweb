-- TMS multi-client: daftarkan unit CP/Gudang yang belum punya mapping kanonik
-- (mis. B 9044 ECD, B 9046 ECD, B 9152 TYK yang ditambahkan ke grup CP setelah
-- seed awal) lalu backfill client_id yang masih NULL.
--
-- Seluruh statement idempotent (aman dijalankan ulang).
-- NULL client_id berarti UNASSIGNED (belum dipetakan ke client mana pun).

-- ─── 1. Mapping unit -> TUKU untuk anggota aktif CP/Gudang yang belum terdaftar ───
insert into public.tms_client_vehicle_assignments (
  client_id, mceasy_vehicle_id, license_plate, license_plate_key,
  effective_from, effective_until, status, source
)
select
  (select id from public.tms_clients where code = 'TUKU'),
  v.mceasy_vehicle_id,
  v.license_plate,
  v.license_plate_key,
  current_date,
  null,
  'active',
  'live_track_group_save'
from public.tms_live_track_groups g
join public.tms_live_track_group_vehicles gv on gv.group_id = g.id
join public.tms_live_track_vehicles v on v.id = gv.vehicle_id
where lower(g.name) in ('cp', 'gudang')
  and gv.enabled
  and not exists (
    select 1 from public.tms_client_vehicle_assignments a
    where a.client_id = (select id from public.tms_clients where code = 'TUKU')
      and a.status = 'active'
      and (a.mceasy_vehicle_id = v.mceasy_vehicle_id or a.license_plate_key = v.license_plate_key)
  )
group by v.mceasy_vehicle_id, v.license_plate, v.license_plate_key;

-- ─── 2. Grup + kendaraan + membership grup ───
update public.tms_live_track_groups g
set client_id = (select id from public.tms_clients where code = 'TUKU'),
    updated_at = now()
where lower(g.name) in ('cp', 'gudang')
  and g.client_id is null;

update public.tms_live_track_vehicles v
set client_id = (select id from public.tms_clients where code = 'TUKU'),
    updated_at = now()
where v.client_id is null
  and exists (
    select 1 from public.tms_client_vehicle_assignments a
    where a.client_id = (select id from public.tms_clients where code = 'TUKU')
      and a.mceasy_vehicle_id = v.mceasy_vehicle_id
      and a.status = 'active'
  );

update public.tms_live_track_group_vehicles gv
set client_id = (select id from public.tms_clients where code = 'TUKU')
where gv.client_id is null
  and exists (
    select 1 from public.tms_live_track_groups g
    where g.id = gv.group_id
      and g.client_id = (select id from public.tms_clients where code = 'TUKU')
  );

update public.tms_live_track_config_events e
set client_id = (select id from public.tms_clients where code = 'TUKU')
where e.client_id is null
  and e.group_id is not null
  and exists (
    select 1 from public.tms_live_track_groups g
    where g.id = e.group_id
      and g.client_id = (select id from public.tms_clients where code = 'TUKU')
  );

-- ─── 3. Task snapshots + occurrences ───
update public.tms_live_track_task_snapshots s
set client_id = (select id from public.tms_clients where code = 'TUKU'),
    updated_at = now()
where s.client_id is null
  and (
    s.vehicle_id in (
      select a.mceasy_vehicle_id from public.tms_client_vehicle_assignments a
      where a.client_id = (select id from public.tms_clients where code = 'TUKU')
        and a.status = 'active'
    )
    or s.license_plate_key in (
      select v.license_plate_key from public.tms_live_track_vehicles v
      where v.client_id = (select id from public.tms_clients where code = 'TUKU')
    )
  );

update public.tms_live_track_task_occurrences o
set client_id = (select id from public.tms_clients where code = 'TUKU'),
    updated_at = now()
where o.client_id is null
  and (
    exists (
      select 1 from public.tms_live_track_task_snapshots s
      where s.task_id = o.task_id
        and s.client_id = (select id from public.tms_clients where code = 'TUKU')
    )
    or exists (
      select 1 from public.tms_live_track_groups g
      where g.id = o.group_id
        and g.client_id = (select id from public.tms_clients where code = 'TUKU')
    )
  );

-- ─── 4. e-POD assignments + turunan ───
update public.tms_epod_assignments a
set client_id = (select id from public.tms_clients where code = 'TUKU'),
    updated_at = now()
where a.client_id is null
  and (
    a.vehicle_id in (
      select va.mceasy_vehicle_id from public.tms_client_vehicle_assignments va
      where va.client_id = (select id from public.tms_clients where code = 'TUKU')
        and va.status = 'active'
    )
    or upper(regexp_replace(coalesce(a.license_plate, ''), '[\s.\-]', '', 'g')) in (
      select v.license_plate_key from public.tms_live_track_vehicles v
      where v.client_id = (select id from public.tms_clients where code = 'TUKU')
    )
  );

update public.tms_epod_stops s
set client_id = a.client_id,
    updated_at = now()
from public.tms_epod_assignments a
where s.assignment_id = a.id
  and s.client_id is null
  and a.client_id is not null;

update public.tms_epod_submissions s
set client_id = st.client_id
from public.tms_epod_stops st
where s.stop_id = st.id
  and s.client_id is null
  and st.client_id is not null;

update public.tms_epod_evidence e
set client_id = s.client_id
from public.tms_epod_submissions s
where e.submission_id = s.id
  and e.client_id is null
  and s.client_id is not null;

update public.tms_epod_events e
set client_id = coalesce(
  (select s.client_id from public.tms_epod_submissions s where s.id = e.submission_id),
  (select st.client_id from public.tms_epod_stops st where st.id = e.stop_id),
  (select a.client_id from public.tms_epod_assignments a where a.id = e.assignment_id)
)
where e.client_id is null
  and coalesce(
    (select s.client_id from public.tms_epod_submissions s where s.id = e.submission_id),
    (select st.client_id from public.tms_epod_stops st where st.id = e.stop_id),
    (select a.client_id from public.tms_epod_assignments a where a.id = e.assignment_id)
  ) is not null;

-- ─── 5. Trip visit logs + point temperatures ───
update public.tms_trip_visit_logs l
set client_id = (select id from public.tms_clients where code = 'TUKU'),
    updated_at = now()
where l.client_id is null
  and (
    l.vehicle_id in (
      select va.mceasy_vehicle_id from public.tms_client_vehicle_assignments va
      where va.client_id = (select id from public.tms_clients where code = 'TUKU')
        and va.status = 'active'
    )
    or upper(regexp_replace(coalesce(l.license_plate, ''), '[\s.\-]', '', 'g')) in (
      select v.license_plate_key from public.tms_live_track_vehicles v
      where v.client_id = (select id from public.tms_clients where code = 'TUKU')
    )
  );

update public.tms_route_point_temperatures t
set client_id = (select id from public.tms_clients where code = 'TUKU')
where t.client_id is null
  and (
    t.vehicle_id in (
      select va.mceasy_vehicle_id from public.tms_client_vehicle_assignments va
      where va.client_id = (select id from public.tms_clients where code = 'TUKU')
        and va.status = 'active'
    )
    or upper(regexp_replace(coalesce(t.license_plate, ''), '[\s.\-]', '', 'g')) in (
      select v.license_plate_key from public.tms_live_track_vehicles v
      where v.client_id = (select id from public.tms_clients where code = 'TUKU')
    )
  );

notify pgrst, 'reload schema';
