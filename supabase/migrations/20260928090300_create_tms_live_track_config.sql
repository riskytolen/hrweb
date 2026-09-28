-- Pengaturan Live Track Task: kelompok operasional customer (mis. CP Suka),
-- keanggotaan unit McEasy, dan jadwal tampil harian berbasis kontrak.
--
-- Jadwal bersifat konfigurasi berulang (bukan input harian): satu jam
-- operasional per kelompok yang diwarisi unit, dengan opsi override per unit.
-- Zona waktu tetap Asia/Jakarta. Browser tidak mengakses tabel ini langsung;
-- akses lewat Route Handler setelah permission tms.live-track-config
-- diverifikasi (view/manage), mengikuti pola keamanan e-POD.

-- ─── Katalog unit McEasy ───
create table if not exists public.tms_live_track_vehicles (
  id uuid primary key default gen_random_uuid(),
  mceasy_vehicle_id bigint not null,
  license_plate text not null,
  license_plate_key text not null,
  vendor_groups jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_synced_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'stale', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_live_track_vehicles_mceasy_key unique (mceasy_vehicle_id)
);

create index if not exists tms_live_track_vehicles_plate_key_idx
  on public.tms_live_track_vehicles (license_plate_key);

-- ─── Kelompok operasional ───
create table if not exists public.tms_live_track_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  color text not null default '#0284c7',
  sort_order integer not null default 0,
  status text not null default 'Aktif' check (status in ('Aktif', 'Tidak Aktif')),
  default_window_start time not null default '06:00',
  default_window_end time not null default '18:00',
  timezone text not null default 'Asia/Jakarta',
  effective_from date,
  effective_until date,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_live_track_groups_name_key unique (name),
  constraint tms_live_track_groups_window_check check (default_window_start <> default_window_end),
  constraint tms_live_track_groups_color_check check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint tms_live_track_groups_effective_check check (effective_until is null or effective_from is null or effective_until >= effective_from)
);

create index if not exists tms_live_track_groups_status_idx
  on public.tms_live_track_groups (status, sort_order);

-- Nama kelompok unik tanpa membedakan huruf besar/kecil.
create unique index if not exists tms_live_track_groups_name_key_ci
  on public.tms_live_track_groups (lower(name));

-- ─── Keanggotaan + jadwal per unit ───
create table if not exists public.tms_live_track_group_vehicles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.tms_live_track_groups (id) on delete cascade,
  vehicle_id uuid not null references public.tms_live_track_vehicles (id) on delete cascade,
  use_group_schedule boolean not null default true,
  override_window_start time,
  override_window_end time,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_live_track_group_vehicles_unique unique (group_id, vehicle_id),
  constraint tms_live_track_group_vehicles_override_check check (
    use_group_schedule
    or (override_window_start is not null and override_window_end is not null and override_window_start <> override_window_end)
  )
);

create index if not exists tms_live_track_group_vehicles_group_idx
  on public.tms_live_track_group_vehicles (group_id, sort_order);

create index if not exists tms_live_track_group_vehicles_vehicle_idx
  on public.tms_live_track_group_vehicles (vehicle_id);

-- ─── Audit konfigurasi ───
create table if not exists public.tms_live_track_config_events (
  id bigint generated always as identity primary key,
  group_id uuid references public.tms_live_track_groups (id) on delete set null,
  event_type text not null,
  actor_user_id uuid,
  actor_role text,
  old_value jsonb,
  new_value jsonb,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tms_live_track_config_events_group_idx
  on public.tms_live_track_config_events (group_id, created_at desc);

-- ─── RLS: tutup dari browser, hanya service_role ───
alter table public.tms_live_track_vehicles enable row level security;
alter table public.tms_live_track_groups enable row level security;
alter table public.tms_live_track_group_vehicles enable row level security;
alter table public.tms_live_track_config_events enable row level security;

revoke all on table public.tms_live_track_vehicles from public, anon, authenticated;
revoke all on table public.tms_live_track_groups from public, anon, authenticated;
revoke all on table public.tms_live_track_group_vehicles from public, anon, authenticated;
revoke all on table public.tms_live_track_config_events from public, anon, authenticated;

grant all on table public.tms_live_track_vehicles to service_role;
grant all on table public.tms_live_track_groups to service_role;
grant all on table public.tms_live_track_group_vehicles to service_role;
grant all on table public.tms_live_track_config_events to service_role;

-- ─── Simpan grup + membership secara atomik ───
create or replace function public.tms_live_track_config_save_group(
  p_group jsonb,
  p_members jsonb,
  p_actor_user uuid
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

  -- Upsert katalog unit + ganti membership atomik.
  delete from public.tms_live_track_group_vehicles where group_id = v_group_id;

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
      );
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
      );
    end if;
    v_member_count := v_member_count + 1;
  end loop;

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_live_track_config_events (
    group_id, event_type, actor_user_id, actor_role, old_value, new_value, payload
  ) values (
    v_group_id,
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
grant execute on function public.tms_live_track_config_save_group(jsonb, jsonb, uuid) to service_role;

-- ─── Nonaktifkan grup (soft delete) ───
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

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_live_track_config_events (
    group_id, event_type, actor_user_id, actor_role, new_value
  ) values (
    p_group_id,
    case when p_status = 'Aktif' then 'group_activated' else 'group_deactivated' end,
    p_actor_user, v_actor_role,
    jsonb_build_object('status', p_status)
  );

  return v_updated;
end;
$$;

revoke all on function public.tms_live_track_config_set_group_status(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tms_live_track_config_set_group_status(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
