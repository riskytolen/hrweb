-- e-POD web foundation.
--
-- Satu assignment per Fleet Task (FO). Setiap assignment punya beberapa
-- stop: titik pertama bertipe LOADING, sisanya DELIVERY. Bukti disimpan
-- sebagai submission berversi, dengan foto di tabel evidence.
--
-- Semua tabel di sini menyimpan data bukti pengiriman yang sensitif,
-- sehingga akses tabel ditutup total untuk anon/authenticated dan hanya
-- dibuka untuk service_role. Aplikasi mengaksesnya lewat Route Handler
-- server-side yang memverifikasi permission lebih dulu.

create table if not exists public.tms_epod_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  task_number text,
  status text not null default 'OPEN',
  task_status_raw text,
  vehicle_id bigint,
  license_plate text,
  vendor_driver_name text,
  driver_employee_id text references public.pegawai(id) on delete set null,
  helper_employee_id text references public.pegawai(id) on delete set null,
  driver_set_at timestamptz,
  helper_set_at timestamptz,
  loading_status text not null default 'PENDING_LOADING',
  loading_completed_at timestamptz,
  delivery_done_count integer not null default 0,
  delivery_total_count integer not null default 0,
  snapshot_at timestamptz not null default now(),
  frozen_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_epod_assignments_task_id_key unique (task_id),
  constraint tms_epod_assignments_status_check
    check (status in ('OPEN', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  constraint tms_epod_assignments_loading_status_check
    check (loading_status in ('PENDING_LOADING', 'LOADING_COMPLETED')),
  constraint tms_epod_assignments_delivery_counts_check
    check (delivery_done_count >= 0 and delivery_total_count >= 0)
);

create index if not exists tms_epod_assignments_status_idx
  on public.tms_epod_assignments (status, snapshot_at desc);

create index if not exists tms_epod_assignments_synced_idx
  on public.tms_epod_assignments (last_synced_at);

create index if not exists tms_epod_assignments_driver_idx
  on public.tms_epod_assignments (driver_employee_id);

create index if not exists tms_epod_assignments_helper_idx
  on public.tms_epod_assignments (helper_employee_id);

create table if not exists public.tms_epod_stops (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.tms_epod_assignments(id) on delete cascade,
  stop_sequence integer not null,
  stop_type text not null,
  vendor_point_id text,
  vendor_address_id text,
  point_name text,
  address text,
  latitude double precision,
  longitude double precision,
  arrival_target timestamptz,
  arrival_actual timestamptz,
  departure_target timestamptz,
  departure_actual timestamptz,
  visit_status_raw text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_epod_stops_assignment_sequence_key unique (assignment_id, stop_sequence),
  constraint tms_epod_stops_type_check check (stop_type in ('LOADING', 'DELIVERY'))
);

create index if not exists tms_epod_stops_assignment_idx
  on public.tms_epod_stops (assignment_id, stop_sequence);

create table if not exists public.tms_epod_submissions (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid not null references public.tms_epod_stops(id) on delete cascade,
  version integer not null default 1,
  result text,
  recipient_name text,
  note text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  distance_meters double precision,
  geofence_ok boolean,
  out_of_radius_reason text,
  captured_at_device timestamptz,
  captured_at_server timestamptz not null default now(),
  actor_type text not null default 'WEB_ADMIN',
  actor_employee_id text,
  actor_user_id uuid,
  source text not null default 'WEB',
  is_current boolean not null default true,
  superseded_by uuid references public.tms_epod_submissions(id) on delete set null,
  evidence_purged_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tms_epod_submissions_stop_version_key unique (stop_id, version),
  constraint tms_epod_submissions_result_check
    check (result is null or result in ('DELIVERED', 'PARTIAL', 'REJECTED')),
  constraint tms_epod_submissions_actor_type_check
    check (actor_type in ('WEB_ADMIN', 'DRIVER', 'HELPER')),
  constraint tms_epod_submissions_source_check check (source in ('WEB', 'MOBILE')),
  constraint tms_epod_submissions_version_check check (version >= 1)
);

create unique index if not exists tms_epod_submissions_current_key
  on public.tms_epod_submissions (stop_id)
  where is_current;

create index if not exists tms_epod_submissions_stop_idx
  on public.tms_epod_submissions (stop_id, version desc);

create table if not exists public.tms_epod_evidence (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.tms_epod_submissions(id) on delete cascade,
  bucket_id text not null default 'tms-epod-evidence',
  object_path text not null,
  mime_type text,
  size_bytes bigint,
  original_filename text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint tms_epod_evidence_object_key unique (bucket_id, object_path)
);

create index if not exists tms_epod_evidence_submission_idx
  on public.tms_epod_evidence (submission_id, sort_order);

create table if not exists public.tms_epod_events (
  id bigserial primary key,
  assignment_id uuid references public.tms_epod_assignments(id) on delete set null,
  stop_id uuid references public.tms_epod_stops(id) on delete set null,
  submission_id uuid references public.tms_epod_submissions(id) on delete set null,
  event_type text not null,
  actor_user_id uuid,
  actor_employee_id text,
  actor_role text,
  old_status text,
  new_status text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tms_epod_events_assignment_idx
  on public.tms_epod_events (assignment_id, created_at desc);

create index if not exists tms_epod_events_created_idx
  on public.tms_epod_events (created_at desc);

-- Trigger updated_at
drop trigger if exists tms_epod_assignments_updated_at on public.tms_epod_assignments;
create trigger tms_epod_assignments_updated_at
  before update on public.tms_epod_assignments
  for each row execute function public.update_updated_at_column();

drop trigger if exists tms_epod_stops_updated_at on public.tms_epod_stops;
create trigger tms_epod_stops_updated_at
  before update on public.tms_epod_stops
  for each row execute function public.update_updated_at_column();

-- Kunci akses langsung: hanya service_role.
alter table public.tms_epod_assignments enable row level security;
alter table public.tms_epod_stops enable row level security;
alter table public.tms_epod_submissions enable row level security;
alter table public.tms_epod_evidence enable row level security;
alter table public.tms_epod_events enable row level security;

revoke all on table public.tms_epod_assignments from public, anon, authenticated;
revoke all on table public.tms_epod_stops from public, anon, authenticated;
revoke all on table public.tms_epod_submissions from public, anon, authenticated;
revoke all on table public.tms_epod_evidence from public, anon, authenticated;
revoke all on table public.tms_epod_events from public, anon, authenticated;

grant all on table public.tms_epod_assignments to service_role;
grant all on table public.tms_epod_stops to service_role;
grant all on table public.tms_epod_submissions to service_role;
grant all on table public.tms_epod_evidence to service_role;
grant all on table public.tms_epod_events to service_role;

grant usage, select on sequence public.tms_epod_events_id_seq to service_role;
