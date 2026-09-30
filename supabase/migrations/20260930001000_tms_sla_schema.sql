-- SLA kedatangan toko per client + kelompok kendaraan.
--
-- Sumber kebenaran SLA adalah jadwal internal client (mis. Tuku CP:
-- profil VAN 1-12), BUKAN status bawaan McEasy. Setiap FO dicocokkan ke
-- satu profil rute berdasarkan susunan toko (address_id McEasy), lalu
-- arrival_actual/departure_actual Logger Trips dinilai terhadap target.
--
-- Browser tidak membaca tabel ini langsung; akses lewat Route Handler
-- server-side setelah permission TMS diverifikasi, mengikuti pola e-POD.

-- ─── Profil rute SLA ───
create table if not exists public.tms_sla_route_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.tms_clients (id) on delete cascade,
  group_id uuid not null references public.tms_live_track_groups (id) on delete cascade,
  code text not null,
  name text not null,
  timezone text not null default 'Asia/Jakarta',
  departure_target_time time,
  departure_day_offset integer not null default 0 check (departure_day_offset >= 0),
  effective_from date not null,
  effective_until date,
  status text not null default 'Aktif' check (status in ('Aktif', 'Tidak Aktif')),
  source_file text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_sla_route_profiles_effective_check
    check (effective_until is null or effective_until >= effective_from),
  constraint tms_sla_route_profiles_code_key unique (group_id, code, effective_from)
);

-- Satu kode profil aktif dalam satu kelompok (versioning via nonaktifkan + insert baru).
create unique index if not exists tms_sla_route_profiles_active_key
  on public.tms_sla_route_profiles (group_id, code)
  where status = 'Aktif';

create index if not exists tms_sla_route_profiles_client_idx
  on public.tms_sla_route_profiles (client_id);

-- ─── Titik SLA per profil ───
create table if not exists public.tms_sla_route_stops (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.tms_sla_route_profiles (id) on delete cascade,
  route_order integer not null check (route_order >= 1),
  store_name text not null,
  store_name_key text not null,
  target_time time not null,
  target_day_offset integer not null default 0 check (target_day_offset >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_sla_route_stops_order_key unique (profile_id, route_order),
  constraint tms_sla_route_stops_name_key unique (profile_id, store_name_key)
);

create index if not exists tms_sla_route_stops_profile_idx
  on public.tms_sla_route_stops (profile_id, route_order);

-- ─── Mapping titik SLA -> address_id McEasy (mendukung alias historis) ───
create table if not exists public.tms_sla_route_stop_addresses (
  id uuid primary key default gen_random_uuid(),
  route_stop_id uuid not null references public.tms_sla_route_stops (id) on delete cascade,
  vendor_address_id text not null,
  store_name_snapshot text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tms_sla_route_stop_addresses_key unique (route_stop_id, vendor_address_id)
);

create index if not exists tms_sla_route_stop_addresses_vendor_idx
  on public.tms_sla_route_stop_addresses (vendor_address_id);

-- ─── Snapshot profil terpilih per FO ───
create table if not exists public.tms_sla_task_assignments (
  task_id text primary key,
  client_id uuid not null references public.tms_clients (id) on delete cascade,
  group_id uuid not null references public.tms_live_track_groups (id) on delete cascade,
  profile_id uuid not null references public.tms_sla_route_profiles (id) on delete restrict,
  service_date date not null,
  match_score numeric not null default 0,
  match_method text not null default 'store_set_overlap',
  matched_at timestamptz not null default now()
);

create index if not exists tms_sla_task_assignments_profile_idx
  on public.tms_sla_task_assignments (profile_id);

-- ─── Kolom snapshot SLA pada arsip Logger Trips ───
alter table public.tms_trip_visit_logs
  add column if not exists live_track_group_id uuid references public.tms_live_track_groups (id) on delete set null,
  add column if not exists sla_profile_id uuid references public.tms_sla_route_profiles (id) on delete set null,
  add column if not exists sla_route_stop_id uuid references public.tms_sla_route_stops (id) on delete set null,
  add column if not exists sla_kind text check (sla_kind in ('DEPARTURE', 'ARRIVAL')),
  add column if not exists sla_target_at timestamptz,
  add column if not exists sla_status text check (sla_status in ('ON_TIME', 'LATE', 'PENDING', 'UNSET')),
  add column if not exists sla_delta_seconds integer,
  add column if not exists sla_evaluated_at timestamptz;

create index if not exists tms_trip_visit_logs_sla_status_idx
  on public.tms_trip_visit_logs (sla_status);
create index if not exists tms_trip_visit_logs_sla_profile_idx
  on public.tms_trip_visit_logs (sla_profile_id);

-- ─── RLS: tutup dari browser, hanya service_role ───
alter table public.tms_sla_route_profiles enable row level security;
alter table public.tms_sla_route_stops enable row level security;
alter table public.tms_sla_route_stop_addresses enable row level security;
alter table public.tms_sla_task_assignments enable row level security;

revoke all on table public.tms_sla_route_profiles from public, anon, authenticated;
revoke all on table public.tms_sla_route_stops from public, anon, authenticated;
revoke all on table public.tms_sla_route_stop_addresses from public, anon, authenticated;
revoke all on table public.tms_sla_task_assignments from public, anon, authenticated;

grant all on table public.tms_sla_route_profiles to service_role;
grant all on table public.tms_sla_route_stops to service_role;
grant all on table public.tms_sla_route_stop_addresses to service_role;
grant all on table public.tms_sla_task_assignments to service_role;

-- ─── Backfill + hitung ulang SLA (idempotent, aman dijalankan ulang) ───
--
-- Hanya FO yang memiliki occurrence kelompok (hubungan FO-ke-kelompok
-- tercatat eksplisit). Profil dipilih dari kecocokan susunan toko
-- (store_set_overlap): minimal 1 toko cocok dan skor >= 0,5.
-- Tanpa toleransi: actual > target sedetik pun = LATE.
-- Tanpa actual = PENDING (belum tiba/berangkat), bukan LATE.
create or replace function public.tms_sla_backfill(p_since date default '2026-09-29')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_task_addrs text[];
  v_task_count integer;
  v_profile_id uuid;
  v_matched integer;
  v_score numeric;
  v_tasks integer := 0;
  v_assigned integer := 0;
  v_visits integer := 0;
  v_rows integer := 0;
begin
  for r in
    select distinct on (o.task_id)
      o.task_id,
      o.group_id,
      g.client_id,
      (o.window_started_at at time zone 'Asia/Jakarta')::date as service_date
    from public.tms_live_track_task_occurrences o
    join public.tms_live_track_groups g on g.id = o.group_id
    where (o.window_started_at at time zone 'Asia/Jakarta')::date >= p_since
    order by o.task_id, o.window_started_at desc
  loop
    v_tasks := v_tasks + 1;

    select coalesce(array_agg(distinct l.address_id), '{}')
      into v_task_addrs
    from public.tms_trip_visit_logs l
    where l.task_id = r.task_id
      and l.address_id is not null
      and l.route_sequence > 1;

    v_task_count := coalesce(array_length(v_task_addrs, 1), 0);
    if v_task_count = 0 then
      continue;
    end if;

    select p.id, count(distinct a.vendor_address_id) as matched
      into v_profile_id, v_matched
    from public.tms_sla_route_profiles p
    join public.tms_sla_route_stops s on s.profile_id = p.id
    join public.tms_sla_route_stop_addresses a on a.route_stop_id = s.id
    where p.group_id = r.group_id
      and p.status = 'Aktif'
      and p.effective_from <= r.service_date
      and (p.effective_until is null or p.effective_until >= r.service_date)
      and a.vendor_address_id = any (v_task_addrs)
    group by p.id
    order by count(distinct a.vendor_address_id) desc, p.code asc
    limit 1;

    if v_profile_id is null then
      continue;
    end if;
    v_score := v_matched::numeric / v_task_count::numeric;
    if v_matched < 1 or v_score < 0.5 then
      v_profile_id := null;
      continue;
    end if;

    insert into public.tms_sla_task_assignments
      (task_id, client_id, group_id, profile_id, service_date, match_score, match_method, matched_at)
    values
      (r.task_id, r.client_id, r.group_id, v_profile_id, r.service_date, v_score, 'store_set_overlap', now())
    on conflict (task_id) do update set
      client_id = excluded.client_id,
      group_id = excluded.group_id,
      profile_id = excluded.profile_id,
      service_date = excluded.service_date,
      match_score = excluded.match_score,
      match_method = excluded.match_method,
      matched_at = now();
    v_assigned := v_assigned + 1;

    with computed as (
      select
        l2.id as visit_id,
        case when l2.route_sequence = 1 then 'DEPARTURE' else 'ARRIVAL' end as kind,
        case when l2.route_sequence = 1 then l2.departure_actual else l2.arrival_actual end as actual,
        case
          when l2.route_sequence = 1 then
            case when prof.departure_target_time is null then null
              else (((r.service_date + prof.departure_target_time) + make_interval(days => prof.departure_day_offset)) at time zone 'Asia/Jakarta')
            end
          else
            case when m.stop_id is null then null
              else (((r.service_date + m.target_time) + make_interval(days => m.target_day_offset)) at time zone 'Asia/Jakarta')
            end
        end as target,
        m.stop_id as stop_id
      from public.tms_trip_visit_logs l2
      cross join (
        select departure_target_time, departure_day_offset
        from public.tms_sla_route_profiles
        where id = v_profile_id
      ) prof
      left join lateral (
        select s.id as stop_id, s.target_time, s.target_day_offset
        from public.tms_sla_route_stops s
        join public.tms_sla_route_stop_addresses a on a.route_stop_id = s.id
        where s.profile_id = v_profile_id
          and a.vendor_address_id = l2.address_id
        order by a.is_primary desc
        limit 1
      ) m on true
      where l2.task_id = r.task_id
    )
    update public.tms_trip_visit_logs l
    set live_track_group_id = r.group_id,
        sla_profile_id = v_profile_id,
        sla_route_stop_id = computed.stop_id,
        sla_kind = computed.kind,
        sla_target_at = computed.target,
        sla_status = case
          when computed.target is null then 'UNSET'
          when computed.actual is null then 'PENDING'
          when computed.actual <= computed.target then 'ON_TIME'
          else 'LATE'
        end,
        sla_delta_seconds = case
          when computed.target is not null and computed.actual is not null
            then floor(extract(epoch from (computed.actual - computed.target)))::integer
          else null
        end,
        sla_evaluated_at = now()
    from computed
    where l.id = computed.visit_id;

    get diagnostics v_rows = row_count;
    v_visits := v_visits + v_rows;
  end loop;

  return jsonb_build_object(
    'tasks', v_tasks,
    'assigned', v_assigned,
    'visits_updated', v_visits
  );
end;
$$;

revoke all on function public.tms_sla_backfill(date) from public, anon, authenticated;
grant execute on function public.tms_sla_backfill(date) to service_role;

notify pgrst, 'reload schema';
