-- Independent operational import archive. API checks internal role permissions.
create table public.route_in_out_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text not null,
  storage_path text not null unique,
  sheet_name text not null,
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  issues jsonb not null default '[]'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid
);
create unique index route_in_out_active_hash on public.route_in_out_imports(file_hash) where deleted_at is null;
create index route_in_out_active_created on public.route_in_out_imports(created_at desc, id) where deleted_at is null;
alter table public.route_in_out_imports enable row level security;
revoke all on public.route_in_out_imports from public, anon, authenticated;
grant select, insert, update, delete on public.route_in_out_imports to service_role;
insert into storage.buckets(id,name,public,file_size_limit)
values ('route-in-out-files','route-in-out-files',false,3145728);
