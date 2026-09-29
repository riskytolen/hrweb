-- e-POD mobile: sertakan identitas client pada overview/detail/preview.
--
-- Aplikasi Jams Absen menampilkan badge client (Tuku/Manginue) pada kartu
-- FO dan filter client. Tidak ada perubahan aturan klaim/submit.

-- ─── Overview: mine + available membawa client ───
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
    ) t;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'mine', v_mine,
    'available', v_available
  );
end;
$$;

-- ─── Detail: assignment membawa client ───
create or replace function public.tms_epod_mobile_detail(
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

  select * into v_assignment
  from public.tms_epod_assignments
  where id = p_assignment_id;

  if not found then
    raise exception 'FO e-POD tidak ditemukan.';
  end if;

  if v_assignment.assigned_employee_id is distinct from p_employee_id then
    raise exception 'Anda tidak terpasang pada FO ini.' using errcode = '42501';
  end if;

  select c.code, c.slug, c.name into v_client_code, v_client_slug, v_client_name
  from public.tms_clients c
  where c.id = v_assignment.client_id;

  v_role := coalesce(
    public.tms_epod_mobile_role(p_employee_id),
    v_assignment.assigned_role
  );

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
               'arrival_target', s.arrival_target,
               'visit_status_raw', s.visit_status_raw,
               'current', case
                 when sub.id is null then null
                 else jsonb_build_object(
                   'id', sub.id,
                   'version', sub.version,
                   'result', sub.result,
                   'recipient_name', sub.recipient_name,
                   'note', sub.note,
                   'items', sub.items,
                   'distance_meters', sub.distance_meters,
                   'geofence_ok', sub.geofence_ok,
                   'out_of_radius_reason', sub.out_of_radius_reason,
                   'captured_at_device', sub.captured_at_device,
                   'captured_at_server', sub.captured_at_server,
                   'actor_type', sub.actor_type,
                   'source', sub.source,
                   'evidence_count', (
                     select count(*)
                     from public.tms_epod_evidence ev
                     where ev.submission_id = sub.id
                   )
                 )
               end
             )
             order by s.stop_sequence
           ),
           '[]'::jsonb
         )
  into v_stops
  from public.tms_epod_stops s
  left join public.tms_epod_submissions sub
    on sub.stop_id = s.id and sub.is_current
  where s.assignment_id = p_assignment_id;

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', v_assignment.id,
      'task_number', v_assignment.task_number,
      'license_plate', v_assignment.license_plate,
      'vendor_driver_name', v_assignment.vendor_driver_name,
      'status', v_assignment.status,
      'loading_status', v_assignment.loading_status,
      'delivery_done_count', v_assignment.delivery_done_count,
      'delivery_total_count', v_assignment.delivery_total_count,
      'frozen_at', v_assignment.frozen_at,
      'snapshot_at', v_assignment.snapshot_at,
      'my_role', v_role,
      'client_id', v_assignment.client_id,
      'client_code', v_client_code,
      'client_slug', v_client_slug,
      'client_name', v_client_name
    ),
    'stops', v_stops
  );
end;
$$;

-- ─── Preview pra-klaim: assignment membawa client ───
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
