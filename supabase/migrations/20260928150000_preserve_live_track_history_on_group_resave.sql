-- Live Track: jangan hapus riwayat occurrence saat grup disimpan ulang.
--
-- Akar masalah: `tms_live_track_config_save_group` menghapus seluruh
-- membership (`delete ... where group_id = ...`) lalu insert ulang. Karena
-- `tms_live_track_task_occurrences.group_vehicle_id` memakai
-- `on delete cascade`, seluruh riwayat FO pada grup ikut terhapus diam-diam
-- setiap grup diedit (mis. ubah periode berlaku). Snapshot FO tetap ada,
-- sehingga tab Riwayat menghitung total tetapi list-nya kosong.
--
-- Perbaikan:
-- 1. FK `group_vehicle_id` menjadi nullable + `on delete set null` supaya
--    riwayat tetap menunjuk `group_id` walau baris membership diganti.
-- 2. Fungsi save grup memakai upsert membership (pertahankan ID bila unit
--    masih ada) dan hanya menghapus membership yang benar-benar dikeluarkan.
-- 3. Repair khusus FO-9445 dan FO-9447 yang occurrence-nya hilang.

-- ─── 1. Longgarkan FK occurrence ───
alter table public.tms_live_track_task_occurrences
  drop constraint if exists tms_live_track_task_occurrences_group_vehicle_id_fkey;

alter table public.tms_live_track_task_occurrences
  alter column group_vehicle_id drop not null;

alter table public.tms_live_track_task_occurrences
  add constraint tms_live_track_task_occurrences_group_vehicle_id_fkey
  foreign key (group_vehicle_id)
  references public.tms_live_track_group_vehicles (id)
  on delete set null;

-- ─── 2. Save grup tanpa menghapus membership yang masih ada ───
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
  v_kept_vehicle_ids uuid[] := '{}'::uuid[];
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

-- ─── 3. Repair occurrence FO-9445 dan FO-9447 (grup Gudang, 28 Sep 2026) ───
-- Idempotent: aman dijalankan ulang.
insert into public.tms_live_track_task_occurrences (
  task_id, group_id, group_vehicle_id, window_started_at, visible_until, terminal_at, updated_at
)
select
  v.task_id,
  v.group_id,
  v.group_vehicle_id,
  v.window_started_at,
  v.visible_until,
  coalesce(s.terminal_at, s.actual_arrival_on),
  now()
from (values
  (
    '220e119a-bf46-4c00-b56c-066e74f553f8',
    '78151676-e4c9-4389-a07d-40b8ba991207'::uuid,
    '4b91b26e-9cd3-4048-aeb6-b02e2b779c73'::uuid,
    timestamptz '2026-09-28 00:00:00+00',
    timestamptz '2026-09-28 12:00:00+00'
  ),
  (
    'a8aaef0d-3cbc-4de1-8815-e75881a82fba',
    '78151676-e4c9-4389-a07d-40b8ba991207'::uuid,
    '4b91b26e-9cd3-4048-aeb6-b02e2b779c73'::uuid,
    timestamptz '2026-09-28 00:00:00+00',
    timestamptz '2026-09-28 12:00:00+00'
  )
) as v (task_id, group_id, group_vehicle_id, window_started_at, visible_until)
join public.tms_live_track_task_snapshots s on s.task_id = v.task_id
join public.tms_live_track_group_vehicles gv on gv.id = v.group_vehicle_id and gv.group_id = v.group_id
on conflict (task_id, group_vehicle_id, window_started_at) do update set
  visible_until = greatest(
    public.tms_live_track_task_occurrences.visible_until,
    excluded.visible_until
  ),
  terminal_at = coalesce(excluded.terminal_at, public.tms_live_track_task_occurrences.terminal_at),
  updated_at = now();

notify pgrst, 'reload schema';
