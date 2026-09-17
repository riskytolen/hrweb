-- Capture one vehicle temperature snapshot per visited route point.
-- Only active Fleet Task Instant vehicles are sampled by the scheduled
-- capture endpoint. A unique task/sequence key prevents repeated polling
-- from multiplying rows for the same visit.

create table if not exists public.tms_route_point_temperatures (
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  task_number text,
  vehicle_id bigint not null,
  license_plate text,
  route_sequence integer not null,
  point_name text,
  temperatures jsonb not null default '[]'::jsonb,
  measured_at timestamptz not null,
  arrival_actual timestamptz,
  distance_meters double precision not null check (distance_meters >= 0),
  captured_at timestamptz not null default now(),
  constraint tms_route_point_temperatures_task_sequence_key
    unique (task_id, route_sequence)
);

create index if not exists tms_route_point_temperatures_task_time_idx
  on public.tms_route_point_temperatures (task_id, captured_at desc);

create index if not exists tms_route_point_temperatures_vehicle_time_idx
  on public.tms_route_point_temperatures (vehicle_id, measured_at desc);

alter table public.tms_route_point_temperatures enable row level security;

revoke all on table public.tms_route_point_temperatures
  from public, anon, authenticated;
grant select on table public.tms_route_point_temperatures to authenticated;
grant all on table public.tms_route_point_temperatures to service_role;

create policy "tms_route_point_temperatures: authenticated can read"
  on public.tms_route_point_temperatures for select
  to authenticated
  using (true);
