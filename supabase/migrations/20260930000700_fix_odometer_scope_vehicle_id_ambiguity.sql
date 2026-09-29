-- Perbaiki "column reference vehicle_id is ambiguous" (SQLSTATE 42702)
-- pada RPC odometer tenant-aware.
--
-- Di dalam fungsi RETURNS TABLE, nama kolom output (vehicle_id, id, ...)
-- juga menjadi variabel PL/pgSQL. Referensi tak terkualifikasi
-- `select vehicle_id from ...` bertabrakan dengan variabel tersebut.
-- Semua referensi ke helper scope sekarang dikualifikasi eksplisit
-- (`allowed.vehicle_id`) agar tidak ambigu untuk semua akun,
-- termasuk Super Admin.

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
      select 1 from public.vehicle_odometer_allowed_vehicle_ids() as allowed
      where allowed.vehicle_id = p_vehicle_id
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
      or l.vehicle_id in (select allowed.vehicle_id from public.vehicle_odometer_allowed_vehicle_ids() as allowed)
    )
  order by l.tanggal desc, l.id desc;
end;
$$;

revoke all on function public.get_vehicle_odometer_logs(integer, date, date) from public, anon;
grant execute on function public.get_vehicle_odometer_logs(integer, date, date) to authenticated;

-- Samakan kualifikasi pada RPC daftar kendaraan agar konsisten dan
-- tahan terhadap perubahan kolom output di masa depan.
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
      or v.id in (select allowed.vehicle_id from public.vehicle_odometer_allowed_vehicle_ids() as allowed)
    )
  order by v.unit;
end;
$$;

revoke all on function public.list_vehicle_odometer_vehicles() from public, anon;
grant execute on function public.list_vehicle_odometer_vehicles() to authenticated;
