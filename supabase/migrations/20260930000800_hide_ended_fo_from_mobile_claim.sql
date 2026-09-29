-- e-POD mobile: sembunyikan FO perjalanan selesai dari Claim FO.
--
-- `task_status_raw = 'ENDED'` berarti perjalanan McEasy sudah selesai,
-- sedangkan `status = 'COMPLETED'` berarti bukti e-POD sudah lengkap.
-- Keduanya independen: FO yang perjalanannya selesai tidak boleh diklaim
-- sendiri dari aplikasi, tetapi FO yang sudah memiliki petugas tetap bisa
-- diselesaikan e-POD-nya (daftar `mine` tidak difilter).
--
-- Definisi fungsi disalin penuh dari migration terbaru agar field client
-- (client_id/code/slug/name) tetap terbawa.

-- ─── Overview: available hanya SCHEDULED/STARTED ───
create or replace function public.tms_epod_mobile_overview(p_employee_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_mine jsonb;
  v_available jsonb;
  v_active_count integer;
begin
  if not public.tms_epod_mobile_is_caller() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  v_role := public.tms_epod_mobile_role(p_employee_id);

  select coalesce(
           jsonb_agg(to_jsonb(t) order by t.is_completed, t.snapshot_at desc),
           '[]'::jsonb
         )
  into v_mine
  from (
    select
      a.id,
      a.task_number,
      a.license_plate,
      a.vendor_driver_name,
      a.status,
      a.loading_status,
      a.delivery_done_count,
      a.delivery_total_count,
      a.snapshot_at,
      a.assigned_role as my_role,
      a.client_id,
      c.code as client_code,
      c.slug as client_slug,
      c.name as client_name,
      case when a.status = 'COMPLETED' then 1 else 0 end as is_completed
    from public.tms_epod_assignments a
    left join public.tms_clients c on c.id = a.client_id
    where a.assigned_employee_id = p_employee_id
      and a.status <> 'CANCELLED'
  ) t;

  -- Hanya FO aktif yang menghalangi klaim baru; FO selesai bebas diklaim ulang.
  select count(*)
  into v_active_count
  from public.tms_epod_assignments a
  where a.assigned_employee_id = p_employee_id
    and a.status not in ('COMPLETED', 'CANCELLED');

  if v_role is null or v_active_count > 0 then
    v_available := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(to_jsonb(t) order by t.snapshot_at desc), '[]'::jsonb)
    into v_available
    from (
      select
        a.id,
        a.task_number,
        a.license_plate,
        a.vendor_driver_name,
        a.status,
        a.loading_status,
        a.delivery_total_count,
        a.snapshot_at,
        a.client_id,
        c.code as client_code,
        c.slug as client_slug,
        c.name as client_name
      from public.tms_epod_assignments a
      left join public.tms_clients c on c.id = a.client_id
      where a.status not in ('COMPLETED', 'CANCELLED')
        and a.frozen_at is null
        and a.assigned_employee_id is null
        -- FO perjalanan selesai tidak ditawarkan untuk klaim mandiri.
        -- e-POD yang tertinggal ditangani admin web via Tetapkan Petugas.
        and a.task_status_raw in ('SCHEDULED', 'STARTED')
    ) t;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'mine', v_mine,
    'available', v_available
  );
end;
$$;

revoke all on function public.tms_epod_mobile_overview(text) from public, anon;
grant execute on function public.tms_epod_mobile_overview(text) to authenticated, service_role;

-- ─── Claim: tolak FO yang perjalanannya tidak aktif ───
create or replace function public.tms_epod_mobile_claim(
  p_assignment_id uuid,
  p_employee_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_employee public.pegawai%rowtype;
  v_assignment public.tms_epod_assignments%rowtype;
  v_updated public.tms_epod_assignments%rowtype;
begin
  if not public.tms_epod_mobile_is_caller() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_assignment_id is null then
    raise exception 'FO e-POD tidak valid.';
  end if;

  if nullif(btrim(coalesce(p_employee_id, '')), '') is null then
    raise exception 'Pegawai tidak valid.';
  end if;

  -- Kunci baris pegawai: cegah satu pegawai claim dua FO bersamaan.
  select * into v_employee
  from public.pegawai
  where id = p_employee_id
  for update;

  if not found then
    raise exception 'Pegawai tidak ditemukan.';
  end if;
  if v_employee.status <> 'Aktif' then
    raise exception 'Pegawai % tidak aktif.', v_employee.nama;
  end if;

  v_role := public.tms_epod_mobile_role(p_employee_id);
  if v_role is null then
    raise exception 'Jabatan Anda tidak dapat melakukan klaim FO e-POD.';
  end if;

  -- Kunci baris assignment: cegah dua pegawai mengambil FO yang sama.
  select * into v_assignment
  from public.tms_epod_assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'FO e-POD tidak ditemukan.';
  end if;

  if v_assignment.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'FO sudah selesai atau dibatalkan.';
  end if;

  -- Pertahanan lapis kedua untuk data cache aplikasi lama: daftar overview
  -- sudah menyembunyikan FO ENDED, tetapi klaim langsung tetap ditolak.
  if v_assignment.task_status_raw is distinct from 'SCHEDULED'
     and v_assignment.task_status_raw is distinct from 'STARTED' then
    raise exception 'FO tidak dapat diklaim karena perjalanan sudah selesai atau tidak aktif.';
  end if;

  if v_assignment.frozen_at is not null then
    raise exception 'FO sudah terkunci karena bukti sudah dikirim.';
  end if;

  if v_assignment.assigned_employee_id = p_employee_id then
    raise exception 'Anda sudah terpasang pada FO ini.';
  end if;

  if v_assignment.assigned_employee_id is not null then
    raise exception 'FO ini sudah diklaim.';
  end if;

  -- Satu pegawai hanya boleh terikat satu FO aktif.
  if exists (
    select 1
    from public.tms_epod_assignments a
    where a.id <> p_assignment_id
      and a.frozen_at is null
      and a.status not in ('COMPLETED', 'CANCELLED')
      and a.assigned_employee_id = p_employee_id
  ) then
    raise exception 'Anda masih terikat FO lain yang aktif.';
  end if;

  update public.tms_epod_assignments
  set assigned_employee_id = p_employee_id,
      assigned_role = v_role,
      assigned_source = 'MOBILE',
      assigned_reason = null,
      assigned_at = now(),
      assigned_jabatan_id = v_employee.jabatan_id
  where id = p_assignment_id
  returning * into v_updated;

  perform public.tms_epod_recompute_status(p_assignment_id);

  insert into public.tms_epod_events (
    assignment_id, event_type, actor_employee_id, actor_role, payload
  ) values (
    p_assignment_id,
    'mobile_self_claimed',
    p_employee_id,
    v_role,
    jsonb_build_object('role', v_role, 'source', 'MOBILE')
  );

  select * into v_updated
  from public.tms_epod_assignments
  where id = p_assignment_id;

  return jsonb_build_object(
    'id', v_updated.id,
    'task_number', v_updated.task_number,
    'license_plate', v_updated.license_plate,
    'status', v_updated.status,
    'loading_status', v_updated.loading_status,
    'delivery_done_count', v_updated.delivery_done_count,
    'delivery_total_count', v_updated.delivery_total_count,
    'snapshot_at', v_updated.snapshot_at,
    'my_role', v_role
  );
end;
$$;

revoke all on function public.tms_epod_mobile_claim(uuid, text) from public, anon;
grant execute on function public.tms_epod_mobile_claim(uuid, text) to authenticated, service_role;

-- ─── Preview pra-klaim: konsisten dengan aturan claim ───
create or replace function public.tms_epod_mobile_preview(
  p_assignment_id uuid,
  p_employee_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_assignment public.tms_epod_assignments%rowtype;
  v_client_code text;
  v_client_slug text;
  v_client_name text;
  v_stops jsonb;
begin
  if not public.tms_epod_mobile_is_caller() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_assignment_id is null then
    raise exception 'FO e-POD tidak valid.';
  end if;

  if nullif(btrim(coalesce(p_employee_id, '')), '') is null then
    raise exception 'Pegawai tidak valid.';
  end if;

  v_role := public.tms_epod_mobile_role(p_employee_id);
  if v_role is null then
    raise exception 'Jabatan Anda tidak dapat mengakses e-POD.' using errcode = '42501';
  end if;

  select * into v_assignment
  from public.tms_epod_assignments
  where id = p_assignment_id;

  if not found then
    raise exception 'FO e-POD tidak ditemukan.';
  end if;

  if v_assignment.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'FO sudah selesai atau dibatalkan.';
  end if;

  if v_assignment.task_status_raw is distinct from 'SCHEDULED'
     and v_assignment.task_status_raw is distinct from 'STARTED' then
    raise exception 'FO tidak dapat diklaim karena perjalanan sudah selesai atau tidak aktif.';
  end if;

  if v_assignment.frozen_at is not null then
    raise exception 'FO sudah terkunci karena bukti sudah dikirim.';
  end if;

  if v_assignment.assigned_employee_id is not null then
    raise exception 'FO ini sudah diklaim.';
  end if;

  select c.code, c.slug, c.name into v_client_code, v_client_slug, v_client_name
  from public.tms_clients c
  where c.id = v_assignment.client_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'stop_sequence', s.stop_sequence,
               'stop_type', s.stop_type,
               'point_name', s.point_name,
               'address', s.address,
               'latitude', s.latitude,
               'longitude', s.longitude,
               'arrival_target', s.arrival_target
             )
             order by s.stop_sequence
           ),
           '[]'::jsonb
         )
  into v_stops
  from public.tms_epod_stops s
  where s.assignment_id = p_assignment_id;

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', v_assignment.id,
      'task_number', v_assignment.task_number,
      'license_plate', v_assignment.license_plate,
      'vendor_driver_name', v_assignment.vendor_driver_name,
      'status', v_assignment.status,
      'loading_status', v_assignment.loading_status,
      'delivery_total_count', v_assignment.delivery_total_count,
      'snapshot_at', v_assignment.snapshot_at,
      'client_id', v_assignment.client_id,
      'client_code', v_client_code,
      'client_slug', v_client_slug,
      'client_name', v_client_name
    ),
    'stops', v_stops,
    'role', v_role
  );
end;
$$;

revoke all on function public.tms_epod_mobile_preview(uuid, text) from public, anon;
grant execute on function public.tms_epod_mobile_preview(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
