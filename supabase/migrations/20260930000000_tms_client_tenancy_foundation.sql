-- TMS multi-client tenancy: fondasi (Tahap 1).
--
-- Membuat master client, membership akun, dan mapping unit->client.
-- Kolom client_id ditambahkan NULLABLE agar code lama tetap berjalan
-- selama masa migrasi. NULL berarti UNASSIGNED (belum dipetakan).
-- Browser tidak mengakses tabel ini langsung; akses lewat Route Handler
-- server-side setelah permission + membership diverifikasi.

-- ─── Master client ───
create table if not exists public.tms_clients (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  slug text not null,
  name text not null,
  logo_url text,
  timezone text not null default 'Asia/Jakarta',
  status text not null default 'Aktif' check (status in ('Aktif', 'Tidak Aktif')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_clients_code_key unique (code),
  constraint tms_clients_slug_key unique (slug)
);

drop trigger if exists tms_clients_updated_at on public.tms_clients;
create trigger tms_clients_updated_at
  before update on public.tms_clients
  for each row execute function public.update_updated_at_column();

-- ─── Membership akun -> client (many-to-many) ───
create table if not exists public.tms_client_memberships (
  client_id uuid not null references public.tms_clients (id) on delete cascade,
  user_id uuid not null,
  status text not null default 'Aktif' check (status in ('Aktif', 'Tidak Aktif')),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint tms_client_memberships_pkey primary key (client_id, user_id)
);

create index if not exists tms_client_memberships_user_idx
  on public.tms_client_memberships (user_id);

-- ─── Mapping unit McEasy -> client dengan tanggal efektif ───
create table if not exists public.tms_client_vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.tms_clients (id) on delete cascade,
  mceasy_vehicle_id bigint not null,
  license_plate text,
  license_plate_key text not null,
  effective_from date not null default CURRENT_DATE,
  effective_until date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source text not null default 'manual',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tms_client_vehicle_assignments_effective_check check (
    effective_until is null or effective_until >= effective_from
  )
);

drop trigger if exists tms_client_vehicle_assignments_updated_at on public.tms_client_vehicle_assignments;
create trigger tms_client_vehicle_assignments_updated_at
  before update on public.tms_client_vehicle_assignments
  for each row execute function public.update_updated_at_column();

create index if not exists tms_client_vehicle_assignments_client_idx
  on public.tms_client_vehicle_assignments (client_id, status);

create index if not exists tms_client_vehicle_assignments_plate_key_idx
  on public.tms_client_vehicle_assignments (license_plate_key);

-- Satu unit hanya boleh punya satu assignment aktif terbuka dalam satu waktu.
create unique index if not exists tms_client_vehicle_assignments_open_active_key
  on public.tms_client_vehicle_assignments (mceasy_vehicle_id)
  where status = 'active' and effective_until is null;

-- ─── RLS: tutup dari browser, hanya service_role ───
alter table public.tms_clients enable row level security;
alter table public.tms_client_memberships enable row level security;
alter table public.tms_client_vehicle_assignments enable row level security;

revoke all on table public.tms_clients from public, anon, authenticated;
revoke all on table public.tms_client_memberships from public, anon, authenticated;
revoke all on table public.tms_client_vehicle_assignments from public, anon, authenticated;

grant all on table public.tms_clients to service_role;
grant all on table public.tms_client_memberships to service_role;
grant all on table public.tms_client_vehicle_assignments to service_role;

-- ─── Kolom client_id NULLABLE pada tabel TMS existing ───
alter table public.tms_live_track_vehicles
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_live_track_groups
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_live_track_group_vehicles
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_live_track_config_events
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_live_track_task_snapshots
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_live_track_task_occurrences
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_epod_assignments
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_epod_stops
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_epod_submissions
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_epod_evidence
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_epod_events
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_trip_visit_logs
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;
alter table public.tms_route_point_temperatures
  add column if not exists client_id uuid references public.tms_clients (id) on delete set null;

create index if not exists tms_live_track_vehicles_client_idx
  on public.tms_live_track_vehicles (client_id);
create index if not exists tms_live_track_groups_client_idx
  on public.tms_live_track_groups (client_id);
create index if not exists tms_live_track_group_vehicles_client_idx
  on public.tms_live_track_group_vehicles (client_id);
create index if not exists tms_live_track_task_snapshots_client_idx
  on public.tms_live_track_task_snapshots (client_id);
create index if not exists tms_live_track_task_occurrences_client_idx
  on public.tms_live_track_task_occurrences (client_id);
create index if not exists tms_epod_assignments_client_idx
  on public.tms_epod_assignments (client_id);
create index if not exists tms_epod_stops_client_idx
  on public.tms_epod_stops (client_id);
create index if not exists tms_epod_submissions_client_idx
  on public.tms_epod_submissions (client_id);
create index if not exists tms_epod_evidence_client_idx
  on public.tms_epod_evidence (client_id);
create index if not exists tms_trip_visit_logs_client_idx
  on public.tms_trip_visit_logs (client_id);
create index if not exists tms_route_point_temperatures_client_idx
  on public.tms_route_point_temperatures (client_id);

-- ─── Seed client TUKU ───
insert into public.tms_clients (code, slug, name, timezone, status)
values ('TUKU', 'tuku', 'Tuku', 'Asia/Jakarta', 'Aktif')
on conflict (code) do nothing;

notify pgrst, 'reload schema';
