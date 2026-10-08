-- TMS multi-client: rekonsiliasi dua arah mapping unit <-> kelompok aktif.
--
-- Prinsip: kelompok unit AKTIF adalah sumber kebenaran kepemilikan unit client.
-- - Unit ditambah/diaktifkan di kelompok -> assignment client aktif dibuat.
-- - Unit dihapus/dinonaktifkan dari semua kelompok aktif client -> assignment
--   group-managed dinonaktifkan dan data FO AKTIF dilepas dari client.
-- - Riwayat (FO ENDED, e-POD COMPLETED, bukti lama) tidak pernah diubah.
-- - Assignment sumber manual tidak pernah disentuh.
--
-- Seluruh rekonsiliasi berjalan dalam transaksi yang sama dengan penyimpanan
-- kelompok, lewat satu fungsi modular: tms_client_reconcile_group_units.

-- ─── 1. Predikat: unit berada di kelompok aktif client ───
create or replace function public.tms_client_unit_in_active_group(
  p_client_id uuid,
  p_vehicle_id bigint,
  p_plate text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tms_live_track_group_vehicles gv
    join public.tms_live_track_groups g on g.id = gv.group_id
    join public.tms_live_track_vehicles v on v.id = gv.vehicle_id
    where gv.enabled
      and g.client_id = p_client_id
      and g.status = 'Aktif'
      and (g.effective_from is null or g.effective_from <= current_date)
      and (g.effective_until is null or g.effective_until >= current_date)
      and (
        (p_vehicle_id is not null and v.mceasy_vehicle_id = p_vehicle_id)
        or (
          nullif(btrim(coalesce(p_plate, '')), '') is not null
          and v.license_plate_key = upper(regexp_replace(p_plate, '[\s.\-]', '', 'g'))
        )
      )
  );
$$;

revoke all on function public.tms_client_unit_in_active_group(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.tms_client_unit_in_active_group(uuid, bigint, text) to service_role;

-- ─── 2. Lepas data FO AKTIF milik unit yang sudah keluar dari kelompok ───
-- Hanya menyentuh perjalanan/bukti yang masih berjalan. Riwayat dipertahankan.
create or replace function public.tms_client_detach_removed_unit_data(
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignments integer := 0;
  v_snapshots integer := 0;
  v_occurrences integer := 0;
  v_stops integer := 0;
  v_submissions integer := 0;
  v_evidence integer := 0;
  v_events integer := 0;
begin
  if p_client_id is null then
    return jsonb_build_object('detached', false, 'reason', 'no_client');
  end if;

  -- e-POD yang masih perlu dikerjakan pada perjalanan terjadwal/berjalan.
  update public.tms_epod_assignments a
  set client_id = null, updated_at = now()
  where a.client_id = p_client_id
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED')
    and not public.tms_client_unit_in_active_group(p_client_id, a.vehicle_id, a.license_plate);
  get diagnostics v_assignments = row_count;

  -- Snapshot perjalanan yang belum selesai (terjadwal/berjalan).
  update public.tms_live_track_task_snapshots s
  set client_id = null, updated_at = now()
  where s.client_id = p_client_id
    and s.status_raw in ('SCHEDULED', 'STARTED')
    and not public.tms_client_unit_in_active_group(p_client_id, s.vehicle_id, s.license_plate);
  get diagnostics v_snapshots = row_count;

  -- Occurrence pada jendela yang masih berlaku (riwayat jendela lampau dipertahankan).
  update public.tms_live_track_task_occurrences o
  set client_id = null, updated_at = now()
  from public.tms_live_track_task_snapshots s
  where o.task_id = s.task_id
    and o.client_id = p_client_id
    and o.visible_until > now()
    and not public.tms_client_unit_in_active_group(p_client_id, s.vehicle_id, s.license_plate);
  get diagnostics v_occurrences = row_count;

  -- Turunan e-POD mengikuti assignment induk yang baru dilepas dan masih aktif.
  update public.tms_epod_stops s
  set client_id = null, updated_at = now()
  from public.tms_epod_assignments a
  where s.assignment_id = a.id
    and s.client_id = p_client_id
    and a.client_id is null
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED');
  get diagnostics v_stops = row_count;

  update public.tms_epod_submissions su
  set client_id = null
  from public.tms_epod_stops s
  join public.tms_epod_assignments a on a.id = s.assignment_id
  where su.stop_id = s.id
    and su.client_id = p_client_id
    and a.client_id is null
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED');
  get diagnostics v_submissions = row_count;

  update public.tms_epod_evidence e
  set client_id = null
  from public.tms_epod_submissions su
  join public.tms_epod_stops s on s.id = su.stop_id
  join public.tms_epod_assignments a on a.id = s.assignment_id
  where e.submission_id = su.id
    and e.client_id = p_client_id
    and a.client_id is null
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED');
  get diagnostics v_evidence = row_count;

  update public.tms_epod_events e
  set client_id = null
  from public.tms_epod_assignments a
  where e.assignment_id = a.id
    and e.client_id = p_client_id
    and a.client_id is null
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED');
  get diagnostics v_events = row_count;

  return jsonb_build_object(
    'detached', true,
    'assignments', v_assignments,
    'snapshots', v_snapshots,
    'occurrences', v_occurrences,
    'stops', v_stops,
    'submissions', v_submissions,
    'evidence', v_evidence,
    'events', v_events
  );
end;
$$;

revoke all on function public.tms_client_detach_removed_unit_data(uuid) from public, anon, authenticated;
grant execute on function public.tms_client_detach_removed_unit_data(uuid) to service_role;

-- ─── 3. Rekonsiliasi unit satu kelompok (dipanggil dalam transaksi save) ───
create or replace function public.tms_client_reconcile_group_units(
  p_group_id uuid,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_client uuid;
  v_group_status text;
  v_plate text;
  v_other_client_name text;
  v_activated integer := 0;
  v_deactivated integer := 0;
  v_detach jsonb;
begin
  if p_group_id is null then
    raise exception 'ID kelompok tidak valid.';
  end if;

  select g.client_id, g.status into v_group_client, v_group_status
  from public.tms_live_track_groups g
  where g.id = p_group_id
  for update;
  if not found then
    raise exception 'Kelompok tidak ditemukan.';
  end if;

  if v_group_client is null then
    if p_client_id is null then
      return jsonb_build_object('reconciled', false, 'reason', 'no_client');
    end if;
    update public.tms_live_track_groups
    set client_id = p_client_id, updated_at = now()
    where id = p_group_id;
    v_group_client := p_client_id;
  end if;

  -- Cap unit + membership yang masih null (tidak menimpa milik client lain).
  update public.tms_live_track_vehicles v
  set client_id = v_group_client, updated_at = now()
  from public.tms_live_track_group_vehicles gv
  where gv.group_id = p_group_id
    and gv.vehicle_id = v.id
    and v.client_id is null;

  update public.tms_live_track_group_vehicles
  set client_id = v_group_client
  where group_id = p_group_id
    and client_id is null;

  -- Tolak bila unit masih aktif pada client lain (transfer harus eksplisit:
  -- keluarkan dulu dari kelompok client lama).
  select v.license_plate, c.name into v_plate, v_other_client_name
  from public.tms_live_track_group_vehicles gv
  join public.tms_live_track_vehicles v on v.id = gv.vehicle_id
  join public.tms_client_vehicle_assignments a
    on a.status = 'active'
    and a.effective_from <= current_date
    and (a.effective_until is null or a.effective_until >= current_date)
    and a.client_id <> v_group_client
    and (a.mceasy_vehicle_id = v.mceasy_vehicle_id or a.license_plate_key = v.license_plate_key)
  join public.tms_clients c on c.id = a.client_id
  where gv.group_id = p_group_id
    and gv.enabled
  limit 1;
  if found then
    raise exception 'Unit % masih aktif pada client % — keluarkan dari kelompok client tersebut terlebih dahulu.', v_plate, v_other_client_name;
  end if;

  -- Daftarkan mapping untuk anggota aktif yang belum terdaftar.
  insert into public.tms_client_vehicle_assignments (
    client_id, mceasy_vehicle_id, license_plate, license_plate_key,
    effective_from, effective_until, status, source
  )
  select
    v_group_client,
    v.mceasy_vehicle_id,
    v.license_plate,
    v.license_plate_key,
    current_date,
    null,
    'active',
    'live_track_group_save'
  from public.tms_live_track_group_vehicles gv
  join public.tms_live_track_vehicles v on v.id = gv.vehicle_id
  where gv.group_id = p_group_id
    and gv.enabled
    and not exists (
      select 1 from public.tms_client_vehicle_assignments a
      where a.client_id = v_group_client
        and a.status = 'active'
        and a.effective_from <= current_date
        and (a.effective_until is null or a.effective_until >= current_date)
        and (a.mceasy_vehicle_id = v.mceasy_vehicle_id or a.license_plate_key = v.license_plate_key)
    );
  get diagnostics v_activated = row_count;

  -- Nonaktifkan mapping group-managed yang unitnya sudah tidak berada di
  -- kelompok aktif mana pun milik client yang sama.
  update public.tms_client_vehicle_assignments a
  set status = 'inactive',
      effective_until = greatest(a.effective_from, current_date - 1),
      updated_at = now()
  where a.client_id = v_group_client
    and a.status = 'active'
    and a.source in ('live_track_group_seed', 'live_track_group_save')
    and not public.tms_client_unit_in_active_group(a.client_id, a.mceasy_vehicle_id, a.license_plate);
  get diagnostics v_deactivated = row_count;

  -- Lepas data FO aktif milik unit yang sudah keluar.
  v_detach := public.tms_client_detach_removed_unit_data(v_group_client);

  return jsonb_build_object(
    'reconciled', true,
    'group_id', p_group_id,
    'client_id', v_group_client,
    'activated', v_activated,
    'deactivated', v_deactivated,
    'detach', v_detach
  );
end;
$$;

revoke all on function public.tms_client_reconcile_group_units(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tms_client_reconcile_group_units(uuid, uuid) to service_role;

-- ─── 4. Sweeper periodik: tangani kelompok kedaluwarsa tanpa edit manual ───
create or replace function public.tms_client_sweep_stale_assignments(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 500), 1);
  v_deactivated integer := 0;
  v_client record;
  v_detach jsonb;
  v_detached integer := 0;
begin
  with stale as (
    select a.id
    from public.tms_client_vehicle_assignments a
    where a.status = 'active'
      and a.source in ('live_track_group_seed', 'live_track_group_save')
      and not public.tms_client_unit_in_active_group(a.client_id, a.mceasy_vehicle_id, a.license_plate)
    order by a.updated_at
    limit v_limit
  )
  update public.tms_client_vehicle_assignments a
  set status = 'inactive',
      effective_until = greatest(a.effective_from, current_date - 1),
      updated_at = now()
  from stale s
  where s.id = a.id;
  get diagnostics v_deactivated = row_count;

  for v_client in
    select distinct a.client_id
    from public.tms_client_vehicle_assignments a
    where a.source in ('live_track_group_seed', 'live_track_group_save')
  loop
    v_detach := public.tms_client_detach_removed_unit_data(v_client.client_id);
    v_detached := v_detached + coalesce((v_detach ->> 'assignments')::integer, 0);
  end loop;

  return jsonb_build_object('deactivated', v_deactivated, 'detached', v_detached);
end;
$$;

revoke all on function public.tms_client_sweep_stale_assignments(integer) from public, anon, authenticated;
grant execute on function public.tms_client_sweep_stale_assignments(integer) to service_role;

-- ─── 5. save_group: tambah client + rekonsiliasi dalam satu transaksi ───
-- Hapus varian 3-argumen agar tidak ada dua versi fungsi yang beredar.
drop function if exists public.tms_live_track_config_save_group(jsonb, jsonb, uuid);

create or replace function public.tms_live_track_config_save_group(
  p_group jsonb,
  p_members jsonb,
  p_actor_user uuid,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_is_new boolean := false;
  v_name text;
  v_old jsonb;
  v_old_members jsonb;
  v_member jsonb;
  v_vehicle_id uuid;
  v_vehicle_mceasy bigint;
  v_plate text;
  v_plate_key text;
  v_start time;
  v_end time;
  v_use_group boolean;
  v_member_count integer := 0;
  v_actor_role text;
  v_kept_vehicle_ids uuid[] := '{}'::uuid[];
  v_group_client uuid;
begin
  if p_group is null or jsonb_typeof(p_group) <> 'object' then
    raise exception 'Data kelompok tidak valid.';
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'Data anggota tidak valid.';
  end if;

  v_name := nullif(btrim(p_group ->> 'name'), '');
  if v_name is null then
    raise exception 'Nama kelompok wajib diisi.';
  end if;

  v_start := nullif(btrim(p_group ->> 'default_window_start'), '')::time;
  v_end := nullif(btrim(p_group ->> 'default_window_end'), '')::time;
  if v_start is null or v_end is null then
    raise exception 'Jam operasional kelompok wajib diisi.';
  end if;
  if v_start = v_end then
    raise exception 'Jam mulai dan jam selesai tidak boleh sama.';
  end if;
  if nullif(btrim(p_group ->> 'color'), '') is not null
    and nullif(btrim(p_group ->> 'color'), '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Warna kelompok tidak valid.';
  end if;
  if (p_group ->> 'effective_from') is not null
    and (p_group ->> 'effective_from') <> ''
    and (p_group ->> 'effective_until') is not null
    and (p_group ->> 'effective_until') <> ''
    and (p_group ->> 'effective_until')::date < (p_group ->> 'effective_from')::date then
    raise exception 'Tanggal berlaku sampai tidak boleh sebelum tanggal mulai.';
  end if;

  v_group_id := nullif(btrim(p_group ->> 'id'), '')::uuid;

  if v_group_id is null then
    v_is_new := true;
    insert into public.tms_live_track_groups (
      name, description, color, sort_order, status,
      default_window_start, default_window_end, timezone,
      effective_from, effective_until, created_by, updated_by
    ) values (
      v_name,
      nullif(btrim(p_group ->> 'description'), ''),
      coalesce(nullif(btrim(p_group ->> 'color'), ''), '#0284c7'),
      coalesce(nullif(p_group ->> 'sort_order', '')::integer, 0),
      coalesce(nullif(btrim(p_group ->> 'status'), ''), 'Aktif'),
      v_start, v_end,
      coalesce(nullif(btrim(p_group ->> 'timezone'), ''), 'Asia/Jakarta'),
      nullif(p_group ->> 'effective_from', '')::date,
      nullif(p_group ->> 'effective_until', '')::date,
      p_actor_user, p_actor_user
    )
    returning id into v_group_id;
  else
    select to_jsonb(g) into v_old
    from public.tms_live_track_groups g
    where g.id = v_group_id
    for update;
    if v_old is null then
      raise exception 'Kelompok tidak ditemukan.';
    end if;

    update public.tms_live_track_groups set
      name = v_name,
      description = nullif(btrim(p_group ->> 'description'), ''),
      color = coalesce(nullif(btrim(p_group ->> 'color'), ''), color),
      sort_order = coalesce(nullif(p_group ->> 'sort_order', '')::integer, sort_order),
      status = coalesce(nullif(btrim(p_group ->> 'status'), ''), status),
      default_window_start = v_start,
      default_window_end = v_end,
      timezone = coalesce(nullif(btrim(p_group ->> 'timezone'), ''), timezone),
      effective_from = nullif(p_group ->> 'effective_from', '')::date,
      effective_until = nullif(p_group ->> 'effective_until', '')::date,
      updated_by = p_actor_user,
      updated_at = now()
    where id = v_group_id;

    select coalesce(jsonb_agg(to_jsonb(m) order by m.sort_order), '[]'::jsonb) into v_old_members
    from public.tms_live_track_group_vehicles m
    where m.group_id = v_group_id;
  end if;

  -- Upsert katalog unit + sinkron membership.
  -- Membership yang unitnya masih ada dipertahankan ID-nya (upsert) agar
  -- occurrence riwayat yang menunjuk group_vehicle_id tidak ikut terhapus.
  -- Hanya membership yang benar-benar dikeluarkan dari form yang dihapus;
  -- occurrence peninggalannya aman karena FK memakai on delete set null.
  for v_member in select * from jsonb_array_elements(p_members)
  loop
    v_vehicle_mceasy := nullif(v_member ->> 'mceasy_vehicle_id', '')::bigint;
    v_plate := nullif(btrim(v_member ->> 'license_plate'), '');
    if v_vehicle_mceasy is null or v_plate is null then
      raise exception 'Setiap unit wajib memiliki ID McEasy dan nomor polisi.';
    end if;
    v_plate_key := upper(regexp_replace(v_plate, '[\s.\-]', '', 'g'));

    insert into public.tms_live_track_vehicles (
      mceasy_vehicle_id, license_plate, license_plate_key, vendor_groups, last_seen_at, last_synced_at, status
    ) values (
      v_vehicle_mceasy,
      v_plate,
      v_plate_key,
      coalesce(v_member -> 'vendor_groups', '[]'::jsonb),
      now(), now(), 'active'
    )
    on conflict (mceasy_vehicle_id) do update set
      license_plate = excluded.license_plate,
      license_plate_key = excluded.license_plate_key,
      vendor_groups = excluded.vendor_groups,
      last_seen_at = now(),
      last_synced_at = now(),
      status = 'active',
      updated_at = now()
    returning id into v_vehicle_id;

    v_use_group := coalesce((v_member ->> 'use_group_schedule')::boolean, true);
    if v_use_group then
      insert into public.tms_live_track_group_vehicles (
        group_id, vehicle_id, use_group_schedule, enabled, sort_order, created_by, updated_by
      ) values (
        v_group_id, v_vehicle_id, true,
        coalesce((v_member ->> 'enabled')::boolean, true),
        v_member_count, p_actor_user, p_actor_user
      )
      on conflict (group_id, vehicle_id) do update set
        use_group_schedule = true,
        override_window_start = null,
        override_window_end = null,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        updated_by = excluded.updated_by,
        updated_at = now();
    else
      if nullif(btrim(v_member ->> 'override_window_start'), '') is null
        or nullif(btrim(v_member ->> 'override_window_end'), '') is null then
        raise exception 'Jam khusus unit % wajib diisi.', v_plate;
      end if;
      if (v_member ->> 'override_window_start')::time = (v_member ->> 'override_window_end')::time then
        raise exception 'Jam mulai dan selesai unit % tidak boleh sama.', v_plate;
      end if;
      insert into public.tms_live_track_group_vehicles (
        group_id, vehicle_id, use_group_schedule,
        override_window_start, override_window_end,
        enabled, sort_order, created_by, updated_by
      ) values (
        v_group_id, v_vehicle_id, false,
        (v_member ->> 'override_window_start')::time,
        (v_member ->> 'override_window_end')::time,
        coalesce((v_member ->> 'enabled')::boolean, true),
        v_member_count, p_actor_user, p_actor_user
      )
      on conflict (group_id, vehicle_id) do update set
        use_group_schedule = false,
        override_window_start = excluded.override_window_start,
        override_window_end = excluded.override_window_end,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        updated_by = excluded.updated_by,
        updated_at = now();
    end if;
    v_kept_vehicle_ids := v_kept_vehicle_ids || v_vehicle_id;
    v_member_count := v_member_count + 1;
  end loop;

  delete from public.tms_live_track_group_vehicles
  where group_id = v_group_id
    and not (vehicle_id = any (v_kept_vehicle_ids));

  -- Rekonsiliasi mapping + data aktif dalam transaksi yang sama.
  perform public.tms_client_reconcile_group_units(v_group_id, p_client_id);

  select client_id into v_group_client
  from public.tms_live_track_groups
  where id = v_group_id;

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_live_track_config_events (
    group_id, client_id, event_type, actor_user_id, actor_role, old_value, new_value, payload
  ) values (
    v_group_id,
    v_group_client,
    case when v_is_new then 'group_created' else 'group_updated' end,
    p_actor_user, v_actor_role,
    jsonb_build_object('group', v_old, 'members', v_old_members),
    jsonb_build_object('group_id', v_group_id, 'member_count', v_member_count),
    jsonb_build_object('member_count', v_member_count)
  );

  return jsonb_build_object('group_id', v_group_id, 'member_count', v_member_count, 'is_new', v_is_new);
exception
  when unique_violation then
    raise exception 'Nama kelompok sudah dipakai.';
end;
$$;

revoke all on function public.tms_live_track_config_save_group(jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.tms_live_track_config_save_group(jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.tms_live_track_config_save_group(jsonb, jsonb, uuid, uuid) to service_role;

-- ─── 6. set_group_status ikut merekonsiliasi dalam satu transaksi ───
create or replace function public.tms_live_track_config_set_group_status(
  p_group_id uuid,
  p_status text,
  p_actor_user uuid
)
returns public.tms_live_track_groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated public.tms_live_track_groups%rowtype;
  v_actor_role text;
begin
  if p_group_id is null then
    raise exception 'ID kelompok tidak valid.';
  end if;
  if p_status not in ('Aktif', 'Tidak Aktif') then
    raise exception 'Status kelompok tidak valid.';
  end if;

  update public.tms_live_track_groups
  set status = p_status, updated_by = p_actor_user, updated_at = now()
  where id = p_group_id
  returning * into v_updated;

  if not found then
    raise exception 'Kelompok tidak ditemukan.';
  end if;

  perform public.tms_client_reconcile_group_units(p_group_id);

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_live_track_config_events (
    group_id, client_id, event_type, actor_user_id, actor_role, new_value
  ) values (
    p_group_id,
    v_updated.client_id,
    case when p_status = 'Aktif' then 'group_activated' else 'group_deactivated' end,
    p_actor_user, v_actor_role,
    jsonb_build_object('status', p_status)
  );

  return v_updated;
end;
$$;

revoke all on function public.tms_live_track_config_set_group_status(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tms_live_track_config_set_group_status(uuid, text, uuid) to service_role;

-- ─── 7. Pembersihan satu kali: mapping basi + FO aktif yang seharusnya lepas ───
select public.tms_client_sweep_stale_assignments(1000);

notify pgrst, 'reload schema';
