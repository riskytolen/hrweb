-- Live Track Task berkelompok: snapshot task per unit terkonfigurasi dan
-- occurrence window agar FO selesai tetap tampil sampai jadwal berakhir
-- tanpa muncul kembali pada window hari berikutnya.
--
-- Browser tidak mengakses tabel ini langsung; board membaca lewat
-- GET /api/tms/live-track-board setelah permission TMS diverifikasi.

-- ─── Snapshot task ───
create table if not exists public.tms_live_track_task_snapshots (
  task_id text primary key,
  task_number text,
  vehicle_id bigint,
  license_plate text,
  license_plate_key text,
  driver_name text,
  status_raw text,
  expected_started_on timestamptz,
  actual_started_on timestamptz,
  actual_arrival_on timestamptz,
  terminal_at timestamptz,
  timeline jsonb not null default '[]'::jsonb,
  planned_routes jsonb not null default '[]'::jsonb,
  actual_routes jsonb not null default '[]'::jsonb,
  track_id text,
  frozen_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tms_live_track_task_snapshots_vehicle_idx
  on public.tms_live_track_task_snapshots (vehicle_id);

create index if not exists tms_live_track_task_snapshots_plate_key_idx
  on public.tms_live_track_task_snapshots (license_plate_key);

create index if not exists tms_live_track_task_snapshots_status_idx
  on public.tms_live_track_task_snapshots (status_raw);

-- ─── Occurrence window ───
create table if not exists public.tms_live_track_task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.tms_live_track_task_snapshots (task_id) on delete cascade,
  group_id uuid not null references public.tms_live_track_groups (id) on delete cascade,
  group_vehicle_id uuid not null references public.tms_live_track_group_vehicles (id) on delete cascade,
  window_started_at timestamptz not null,
  visible_until timestamptz not null,
  first_visible_at timestamptz not null default now(),
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_live_track_task_occurrences_unique unique (task_id, group_vehicle_id, window_started_at),
  constraint tms_live_track_task_occurrences_window_check check (visible_until > window_started_at)
);

create index if not exists tms_live_track_task_occurrences_visible_idx
  on public.tms_live_track_task_occurrences (visible_until desc);

create index if not exists tms_live_track_task_occurrences_group_idx
  on public.tms_live_track_task_occurrences (group_id, visible_until desc);

-- ─── RLS: tutup dari browser, hanya service_role ───
alter table public.tms_live_track_task_snapshots enable row level security;
alter table public.tms_live_track_task_occurrences enable row level security;

revoke all on table public.tms_live_track_task_snapshots from public, anon, authenticated;
revoke all on table public.tms_live_track_task_occurrences from public, anon, authenticated;

grant all on table public.tms_live_track_task_snapshots to service_role;
grant all on table public.tms_live_track_task_occurrences to service_role;

-- ─── Upsert snapshot: data terminal yang sudah beku tidak ditimpa ───
create or replace function public.tms_live_track_task_snapshot_upsert(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a json array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if nullif(btrim(v_row ->> 'task_id'), '') is null then
      raise exception 'task_id is required';
    end if;

    insert into public.tms_live_track_task_snapshots (
      task_id, task_number, vehicle_id, license_plate, license_plate_key,
      driver_name, status_raw, expected_started_on, actual_started_on,
      actual_arrival_on, terminal_at, timeline, planned_routes, actual_routes,
      track_id, frozen_at, last_synced_at, updated_at
    ) values (
      nullif(btrim(v_row ->> 'task_id'), ''),
      nullif(btrim(v_row ->> 'task_number'), ''),
      nullif(v_row ->> 'vehicle_id', '')::bigint,
      nullif(btrim(v_row ->> 'license_plate'), ''),
      nullif(btrim(v_row ->> 'license_plate_key'), ''),
      nullif(btrim(v_row ->> 'driver_name'), ''),
      nullif(btrim(v_row ->> 'status_raw'), ''),
      nullif(v_row ->> 'expected_started_on', '')::timestamptz,
      nullif(v_row ->> 'actual_started_on', '')::timestamptz,
      nullif(v_row ->> 'actual_arrival_on', '')::timestamptz,
      nullif(v_row ->> 'terminal_at', '')::timestamptz,
      coalesce(v_row -> 'timeline', '[]'::jsonb),
      coalesce(v_row -> 'planned_routes', '[]'::jsonb),
      coalesce(v_row -> 'actual_routes', '[]'::jsonb),
      nullif(btrim(v_row ->> 'track_id'), ''),
      nullif(v_row ->> 'frozen_at', '')::timestamptz,
      now(), now()
    )
    on conflict (task_id) do update set
      task_number = excluded.task_number,
      vehicle_id = coalesce(excluded.vehicle_id, public.tms_live_track_task_snapshots.vehicle_id),
      license_plate = coalesce(excluded.license_plate, public.tms_live_track_task_snapshots.license_plate),
      license_plate_key = coalesce(excluded.license_plate_key, public.tms_live_track_task_snapshots.license_plate_key),
      driver_name = coalesce(excluded.driver_name, public.tms_live_track_task_snapshots.driver_name),
      status_raw = excluded.status_raw,
      expected_started_on = coalesce(excluded.expected_started_on, public.tms_live_track_task_snapshots.expected_started_on),
      actual_started_on = coalesce(excluded.actual_started_on, public.tms_live_track_task_snapshots.actual_started_on),
      actual_arrival_on = coalesce(excluded.actual_arrival_on, public.tms_live_track_task_snapshots.actual_arrival_on),
      terminal_at = coalesce(excluded.terminal_at, public.tms_live_track_task_snapshots.terminal_at),
      -- Timeline dan rute hanya diperbarui selama snapshot belum dibekukan.
      timeline = case
        when public.tms_live_track_task_snapshots.frozen_at is null then excluded.timeline
        else public.tms_live_track_task_snapshots.timeline
      end,
      planned_routes = case
        when public.tms_live_track_task_snapshots.frozen_at is null then excluded.planned_routes
        else public.tms_live_track_task_snapshots.planned_routes
      end,
      actual_routes = case
        when public.tms_live_track_task_snapshots.frozen_at is null then excluded.actual_routes
        else public.tms_live_track_task_snapshots.actual_routes
      end,
      track_id = coalesce(excluded.track_id, public.tms_live_track_task_snapshots.track_id),
      frozen_at = coalesce(excluded.frozen_at, public.tms_live_track_task_snapshots.frozen_at),
      last_synced_at = now(),
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('upserted', v_count);
end;
$$;

revoke all on function public.tms_live_track_task_snapshot_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.tms_live_track_task_snapshot_upsert(jsonb) to service_role;

-- ─── Upsert occurrence window (idempotent per task/relasi/window) ───
create or replace function public.tms_live_track_task_occurrence_upsert(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a json array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if nullif(btrim(v_row ->> 'task_id'), '') is null
      or nullif(btrim(v_row ->> 'group_id'), '') is null
      or nullif(btrim(v_row ->> 'group_vehicle_id'), '') is null
      or nullif(btrim(v_row ->> 'window_started_at'), '') is null
      or nullif(btrim(v_row ->> 'visible_until'), '') is null then
      raise exception 'occurrence requires task, group, relation, and window bounds';
    end if;
    if (v_row ->> 'visible_until')::timestamptz <= (v_row ->> 'window_started_at')::timestamptz then
      raise exception 'visible_until must be after window_started_at';
    end if;

    insert into public.tms_live_track_task_occurrences (
      task_id, group_id, group_vehicle_id, window_started_at, visible_until, terminal_at, updated_at
    ) values (
      nullif(btrim(v_row ->> 'task_id'), ''),
      nullif(btrim(v_row ->> 'group_id'), '')::uuid,
      nullif(btrim(v_row ->> 'group_vehicle_id'), '')::uuid,
      (v_row ->> 'window_started_at')::timestamptz,
      (v_row ->> 'visible_until')::timestamptz,
      nullif(v_row ->> 'terminal_at', '')::timestamptz,
      now()
    )
    on conflict (task_id, group_vehicle_id, window_started_at) do update set
      visible_until = greatest(
        public.tms_live_track_task_occurrences.visible_until,
        excluded.visible_until
      ),
      terminal_at = coalesce(excluded.terminal_at, public.tms_live_track_task_occurrences.terminal_at),
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('upserted', v_count);
end;
$$;

revoke all on function public.tms_live_track_task_occurrence_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.tms_live_track_task_occurrence_upsert(jsonb) to service_role;

notify pgrst, 'reload schema';
