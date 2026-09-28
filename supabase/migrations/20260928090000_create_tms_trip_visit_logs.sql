-- Logger Trips: arsip kunjungan toko dari timeline Fleet Task Instant.
-- Sumber waktu utama adalah arrival_time.actual / departure_time.actual
-- milik McEasy. Seluruh titik rute dicatat, termasuk titik loading.
-- Browser tidak membaca tabel ini langsung; akses lewat Route Handler
-- /api/tms/logger-trips setelah permission TMS diverifikasi.

create table if not exists public.tms_trip_visit_logs (
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  task_number text,
  task_status text,
  vehicle_id bigint,
  license_plate text,
  driver_name text,
  route_sequence integer not null check (route_sequence >= 1),
  point_id text,
  address_id text,
  point_type text,
  location_name text,
  location_address text,
  latitude double precision,
  longitude double precision,
  visit_status text,
  arrival_actual timestamptz,
  departure_actual timestamptz,
  source text not null default 'MCEASY_TIMELINE' check (source in ('MCEASY_TIMELINE', 'GPS_GEOFENCE')),
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_trip_visit_logs_task_sequence_key
    unique (task_id, route_sequence)
);

create index if not exists tms_trip_visit_logs_arrival_idx
  on public.tms_trip_visit_logs (arrival_actual desc nulls last);

create index if not exists tms_trip_visit_logs_departure_idx
  on public.tms_trip_visit_logs (departure_actual desc nulls last);

create index if not exists tms_trip_visit_logs_plate_idx
  on public.tms_trip_visit_logs (license_plate);

create index if not exists tms_trip_visit_logs_task_idx
  on public.tms_trip_visit_logs (task_id);

alter table public.tms_trip_visit_logs enable row level security;

revoke all on table public.tms_trip_visit_logs
  from public, anon, authenticated;
grant select on table public.tms_trip_visit_logs to authenticated;
grant all on table public.tms_trip_visit_logs to service_role;

create policy "tms_trip_visit_logs: authenticated can read"
  on public.tms_trip_visit_logs for select
  to authenticated
  using (true);

-- Upsert idempotent: timestamp nyata yang sudah tersimpan tidak boleh
-- ditimpa NULL dari respons vendor yang sementara tidak lengkap.
create or replace function public.tms_trip_visit_log_upsert(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_was_inserted boolean;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a json array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if nullif(btrim(v_row ->> 'task_id'), '') is null then
      raise exception 'task_id is required';
    end if;
    if (v_row ->> 'route_sequence')::integer is null
      or (v_row ->> 'route_sequence')::integer < 1 then
      raise exception 'route_sequence must be >= 1';
    end if;

    insert into public.tms_trip_visit_logs (
        task_id, task_number, task_status, vehicle_id, license_plate,
        driver_name, route_sequence, point_id, address_id, point_type,
        location_name, location_address, latitude, longitude, visit_status,
        arrival_actual, departure_actual, source, last_synced_at, updated_at
      ) values (
        nullif(btrim(v_row ->> 'task_id'), ''),
        nullif(btrim(v_row ->> 'task_number'), ''),
        nullif(btrim(v_row ->> 'task_status'), ''),
        nullif(v_row ->> 'vehicle_id', '')::bigint,
        nullif(btrim(v_row ->> 'license_plate'), ''),
        nullif(btrim(v_row ->> 'driver_name'), ''),
        (v_row ->> 'route_sequence')::integer,
        nullif(btrim(v_row ->> 'point_id'), ''),
        nullif(btrim(v_row ->> 'address_id'), ''),
        nullif(btrim(v_row ->> 'point_type'), ''),
        nullif(btrim(v_row ->> 'location_name'), ''),
        nullif(btrim(v_row ->> 'location_address'), ''),
        nullif(v_row ->> 'latitude', '')::double precision,
        nullif(v_row ->> 'longitude', '')::double precision,
        nullif(btrim(v_row ->> 'visit_status'), ''),
        nullif(v_row ->> 'arrival_actual', '')::timestamptz,
        nullif(v_row ->> 'departure_actual', '')::timestamptz,
        coalesce(nullif(btrim(v_row ->> 'source'), ''), 'MCEASY_TIMELINE'),
        now(),
        now()
      )
      on conflict (task_id, route_sequence) do update set
        task_number = excluded.task_number,
        task_status = excluded.task_status,
        vehicle_id = coalesce(excluded.vehicle_id, public.tms_trip_visit_logs.vehicle_id),
        license_plate = coalesce(excluded.license_plate, public.tms_trip_visit_logs.license_plate),
        driver_name = coalesce(excluded.driver_name, public.tms_trip_visit_logs.driver_name),
        point_id = coalesce(excluded.point_id, public.tms_trip_visit_logs.point_id),
        address_id = coalesce(excluded.address_id, public.tms_trip_visit_logs.address_id),
        point_type = coalesce(excluded.point_type, public.tms_trip_visit_logs.point_type),
        location_name = coalesce(excluded.location_name, public.tms_trip_visit_logs.location_name),
        location_address = coalesce(excluded.location_address, public.tms_trip_visit_logs.location_address),
        latitude = coalesce(excluded.latitude, public.tms_trip_visit_logs.latitude),
        longitude = coalesce(excluded.longitude, public.tms_trip_visit_logs.longitude),
        visit_status = coalesce(excluded.visit_status, public.tms_trip_visit_logs.visit_status),
        arrival_actual = coalesce(excluded.arrival_actual, public.tms_trip_visit_logs.arrival_actual),
        departure_actual = coalesce(excluded.departure_actual, public.tms_trip_visit_logs.departure_actual),
        source = excluded.source,
        last_synced_at = now(),
        updated_at = now()
      returning (xmax = 0) into v_was_inserted;

    if v_was_inserted then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

revoke all on function public.tms_trip_visit_log_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.tms_trip_visit_log_upsert(jsonb) to service_role;

notify pgrst, 'reload schema';
