-- Mapping unit Operasional Kendaraan (ga_vehicles) -> client TMS.
--
-- Terpisah dari mapping unit TMS/McEasy (tms_client_vehicle_assignments)
-- karena sumber datanya berbeda: odometer memakai ga_vehicles, sedangkan
-- TMS/e-POD memakai data perjalanan McEasy.
--
-- Relasi many-to-many: satu client boleh punya banyak unit, satu unit
-- boleh ditampilkan ke beberapa client. Client hanya read-only
-- (Dashboard + Laporan); Input Odometer tetap khusus internal.
-- Browser tidak mengakses tabel ini langsung; akses lewat Route Handler
-- server-side / RPC setelah permission + membership diverifikasi.

-- ─── Tabel mapping ───
create table if not exists public.client_vehicle_odometer_assignments (
  client_id uuid not null references public.tms_clients (id) on delete cascade,
  vehicle_id integer not null references public.ga_vehicles (id) on delete cascade,
  status text not null default 'Aktif' check (status in ('Aktif', 'Tidak Aktif')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_vehicle_odometer_assignments_pkey primary key (client_id, vehicle_id)
);

create index if not exists client_vehicle_odometer_assignments_vehicle_idx
  on public.client_vehicle_odometer_assignments (vehicle_id);

drop trigger if exists client_vehicle_odometer_assignments_updated_at
  on public.client_vehicle_odometer_assignments;
create trigger client_vehicle_odometer_assignments_updated_at
  before update on public.client_vehicle_odometer_assignments
  for each row execute function public.update_updated_at_column();

-- ─── RLS: tutup dari browser, hanya service_role ───
alter table public.client_vehicle_odometer_assignments enable row level security;

revoke all on table public.client_vehicle_odometer_assignments from public, anon, authenticated;

grant all on table public.client_vehicle_odometer_assignments to service_role;

-- ─── Helper: daftar vehicle_id yang boleh dilihat pemanggil ───
-- Gabungan mapping aktif dari seluruh membership client aktif user.
create or replace function public.vehicle_odometer_allowed_vehicle_ids()
returns table (vehicle_id integer)
language sql
stable
security definer
set search_path = public, auth
as $$
  select distinct a.vehicle_id
  from public.tms_client_memberships m
  join public.tms_clients c on c.id = m.client_id and c.status = 'Aktif'
  join public.client_vehicle_odometer_assignments a
    on a.client_id = m.client_id and a.status = 'Aktif'
  join public.ga_vehicles v on v.id = a.vehicle_id and v.status = 'Aktif'
  where m.user_id = auth.uid()
    and m.status = 'Aktif';
$$;

revoke all on function public.vehicle_odometer_allowed_vehicle_ids() from public, anon;
grant execute on function public.vehicle_odometer_allowed_vehicle_ids() to authenticated, service_role;

-- ─── Perluas akses view: kenali permission granular dashboard/laporan ───
create or replace function public.has_vehicle_odometer_access(p_action text default 'view')
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.user_profiles up
    join public.roles r on r.id = up.role_id
    where up.id = auth.uid()
      and up.status = 'Aktif'
      and r.status = 'Aktif'
      and (
        (
          p_action in ('view', 'read')
          and (
            coalesce(r.permissions, '[]'::jsonb) ? 'all'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.view'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.input'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.manage'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.dashboard'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.dashboard.view'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.dashboard.input'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.report'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.report.view'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.report.input'
          )
        )
        or (
          up.account_type = 'internal'
          and p_action in ('manage', 'create', 'input', 'update', 'delete')
          and (
            coalesce(r.permissions, '[]'::jsonb) ? 'all'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer'
            or coalesce(r.permissions, '[]'::jsonb) ? 'vehicle-odometer.manage'
          )
        )
      )
  );
$$;

revoke all on function public.has_vehicle_odometer_access(text) from public, anon;
grant execute on function public.has_vehicle_odometer_access(text) to authenticated;

-- ─── RPC daftar kendaraan: filter scope untuk akun external ───
create or replace function public.list_vehicle_odometer_vehicles()
returns table (
  id integer,
  unit text,
  jenis text,
  status text,
  last_log_id bigint,
  last_log_date date,
  last_odometer numeric,
  total_jarak numeric
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_is_external boolean := false;
begin
  if not public.has_vehicle_odometer_access('view') then
    raise exception 'Unauthorized';
  end if;

  select coalesce(up.account_type, 'internal') = 'external'
    into v_is_external
    from public.user_profiles up
    where up.id = auth.uid();

  return query
  select
    v.id,
    v.unit,
    v.jenis,
    v.status,
    latest.id as last_log_id,
    latest.tanggal as last_log_date,
    latest.odometer_akhir as last_odometer,
    coalesce(t.total_jarak, 0)::numeric as total_jarak
  from public.ga_vehicles v
  left join lateral (
    select l.id, l.tanggal, l.odometer_akhir
    from public.vehicle_odometer_logs l
    where l.vehicle_id = v.id
    order by l.tanggal desc, l.id desc
    limit 1
  ) latest on true
  left join lateral (
    select sum(l.jarak_km) as total_jarak
    from public.vehicle_odometer_logs l
    where l.vehicle_id = v.id
  ) t on true
  where v.status = 'Aktif'
    and (
      not v_is_external
      or v.id in (select vehicle_id from public.vehicle_odometer_allowed_vehicle_ids())
    )
  order by v.unit;
end;
$$;

revoke all on function public.list_vehicle_odometer_vehicles() from public, anon;
grant execute on function public.list_vehicle_odometer_vehicles() to authenticated;

-- ─── RPC daftar log: filter scope untuk akun external ───
create or replace function public.get_vehicle_odometer_logs(
  p_vehicle_id integer default null,
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  id bigint,
  vehicle_id integer,
  vehicle_unit text,
  vehicle_jenis text,
  vehicle_status text,
  tanggal date,
  odometer_awal numeric,
  odometer_akhir numeric,
  jarak_km numeric,
  catatan text,
  created_by uuid,
  created_by_nama text,
  created_at timestamptz,
  updated_at timestamptz,
  is_latest boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_is_external boolean := false;
begin
  if not public.has_vehicle_odometer_access('view') then
    raise exception 'Unauthorized';
  end if;

  select coalesce(up.account_type, 'internal') = 'external'
    into v_is_external
    from public.user_profiles up
    where up.id = auth.uid();

  -- External tidak boleh mengintip unit di luar mapping via p_vehicle_id.
  if v_is_external and p_vehicle_id is not null
    and not exists (
      select 1 from public.vehicle_odometer_allowed_vehicle_ids() a
      where a.vehicle_id = p_vehicle_id
    ) then
    raise exception 'Unauthorized';
  end if;

  return query
  select
    l.id,
    l.vehicle_id,
    v.unit as vehicle_unit,
    v.jenis as vehicle_jenis,
    v.status as vehicle_status,
    l.tanggal,
    l.odometer_awal,
    l.odometer_akhir,
    l.jarak_km,
    l.catatan,
    l.created_by,
    up.nama as created_by_nama,
    l.created_at,
    l.updated_at,
    not exists (
      select 1
      from public.vehicle_odometer_logs nx
      where nx.vehicle_id = l.vehicle_id
        and (nx.tanggal, nx.id) > (l.tanggal, l.id)
    ) as is_latest
  from public.vehicle_odometer_logs l
  join public.ga_vehicles v on v.id = l.vehicle_id
  left join public.user_profiles up on up.id = l.created_by
  where (p_vehicle_id is null or l.vehicle_id = p_vehicle_id)
    and (p_start_date is null or l.tanggal >= p_start_date)
    and (p_end_date is null or l.tanggal <= p_end_date)
    and (
      not v_is_external
      or l.vehicle_id in (select vehicle_id from public.vehicle_odometer_allowed_vehicle_ids())
    )
  order by l.tanggal desc, l.id desc;
end;
$$;

revoke all on function public.get_vehicle_odometer_logs(integer, date, date) from public, anon;
grant execute on function public.get_vehicle_odometer_logs(integer, date, date) to authenticated;

-- ─── RLS log odometer: external hanya baris unit yang dimapping ───
drop policy if exists auth_select_vehicle_odometer_logs on public.vehicle_odometer_logs;
create policy auth_select_vehicle_odometer_logs
  on public.vehicle_odometer_logs for select to authenticated
  using (
    public.has_vehicle_odometer_access('view')
    and (
      (select coalesce(up.account_type, 'internal') from public.user_profiles up where up.id = auth.uid()) = 'internal'
      or vehicle_id in (select vehicle_id from public.vehicle_odometer_allowed_vehicle_ids())
    )
  );
