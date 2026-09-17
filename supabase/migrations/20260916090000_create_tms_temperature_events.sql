-- Webhook suhu kendaraan (Temperature Data Update DVC-DU/T1).
-- Payload dokumentasi tidak menyertakan timestamp, jadi received_at
-- (waktu server menerima webhook) dipakai sebagai waktu pengukuran.

create table if not exists public.tms_temperature_events (
  id uuid primary key default gen_random_uuid(),
  license_plate text,
  imei text,
  driver_name text,
  latitude double precision,
  longitude double precision,
  temperature_num integer,
  temperature double precision not null,
  engine_on boolean,
  received_at timestamptz not null default now(),
  raw_payload jsonb
);

create index if not exists tms_temperature_events_plate_time_idx
  on public.tms_temperature_events (license_plate, received_at desc);

create index if not exists tms_temperature_events_imei_time_idx
  on public.tms_temperature_events (imei, received_at desc);

alter table public.tms_temperature_events enable row level security;
