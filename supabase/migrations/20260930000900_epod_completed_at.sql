-- e-POD: catat waktu bukti selesai (completed_at) untuk filter Riwayat.
--
-- `snapshot_at` adalah waktu FO masuk pool, bukan waktu e-POD selesai.
-- Kolom baru ini diisi oleh `tms_epod_recompute_status` saat status berubah
-- menjadi COMPLETED, dikosongkan saat e-POD dibuka kembali, dan dikirim ke
-- aplikasi mobile via overview/detail. Aplikasi lama aman karena field JSON
-- tambahan diabaikan.

alter table public.tms_epod_assignments
  add column if not exists completed_at timestamptz;

-- ─── Recompute: kelola completed_at ───
create or replace function public.tms_epod_recompute_status(p_assignment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_loading text;
  v_total integer;
  v_done integer;
  v_has_submission boolean;
  v_has_roster boolean;
  v_completed_at timestamptz;
  v_next text;
begin
  select status, loading_status,
         (assigned_employee_id is not null),
         completed_at
  into v_current, v_loading, v_has_roster, v_completed_at
  from public.tms_epod_assignments
  where id = p_assignment_id
  for update;

  if not found then
    return null;
  end if;

  if v_current = 'CANCELLED' then
    return v_current;
  end if;

  select
    count(*) filter (where s.stop_type = 'DELIVERY'),
    count(*) filter (
      where s.stop_type = 'DELIVERY'
        and exists (
          select 1 from public.tms_epod_submissions sub
          where sub.stop_id = s.id and sub.is_current
        )
    ),
    exists (
      select 1
      from public.tms_epod_submissions sub
      join public.tms_epod_stops st on st.id = sub.stop_id
      where st.assignment_id = p_assignment_id and sub.is_current
    )
  into v_total, v_done, v_has_submission
  from public.tms_epod_stops s
  where s.assignment_id = p_assignment_id;

  v_total := coalesce(v_total, 0);
  v_done := coalesce(v_done, 0);

  if v_loading = 'LOADING_COMPLETED' and v_total > 0 and v_done >= v_total then
    v_next := 'COMPLETED';
  elsif v_has_submission then
    v_next := 'IN_PROGRESS';
  elsif v_has_roster then
    v_next := 'CLAIMED';
  else
    v_next := 'OPEN';
  end if;

  -- Pertahankan tanggal selesai pertama; kosongkan saat e-POD terbuka lagi.
  update public.tms_epod_assignments
  set status = v_next,
      delivery_done_count = v_done,
      delivery_total_count = v_total,
      completed_at = case
        when v_next = 'COMPLETED' then coalesce(v_completed_at, now())
        else null
      end
  where id = p_assignment_id;

  return v_next;
end;
$$;

-- ─── Cancel: FO yang dibatalkan tidak menyimpan tanggal selesai ───
create or replace function public.tms_epod_cancel_assignment(
  p_assignment_id uuid,
  p_reason text,
  p_actor_user uuid
)
returns public.tms_epod_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated public.tms_epod_assignments%rowtype;
  v_actor_role text;
  v_old_status text;
begin
  if not public.tms_epod_is_manager(p_actor_user) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Alasan pembatalan wajib diisi.';
  end if;

  select status into v_old_status
  from public.tms_epod_assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment e-POD tidak ditemukan.';
  end if;

  if v_old_status = 'CANCELLED' then
    raise exception 'Assignment e-POD sudah dibatalkan.';
  end if;

  update public.tms_epod_assignments
  set status = 'CANCELLED',
      completed_at = null
  where id = p_assignment_id
  returning * into v_updated;

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_epod_events (
    assignment_id, event_type, actor_user_id, actor_role, old_status, new_status, payload
  ) values (
    p_assignment_id, 'assignment_cancelled', p_actor_user, v_actor_role,
    v_old_status, 'CANCELLED', jsonb_build_object('reason', p_reason)
  );

  return v_updated;
end;
$$;

revoke all on function public.tms_epod_cancel_assignment(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tms_epod_cancel_assignment(uuid, text, uuid) to service_role;

-- ─── Backfill: tanggal selesai FO yang sudah COMPLETED ───
-- Prioritas: submission aktif terakhir → loading selesai → sync terakhir → snapshot.
update public.tms_epod_assignments a
set completed_at = coalesce(
  (
    select max(sub.captured_at_server)
    from public.tms_epod_stops s
    join public.tms_epod_submissions sub on sub.stop_id = s.id and sub.is_current
    where s.assignment_id = a.id
  ),
  a.loading_completed_at,
  a.last_synced_at,
  a.snapshot_at
)
where a.status = 'COMPLETED'
  and a.completed_at is null;

-- ─── Overview mobile: mine membawa completed_at ───
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
      a.completed_at,
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

-- ─── Detail mobile: assignment membawa completed_at ───
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
      'completed_at', v_assignment.completed_at,
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

revoke all on function public.tms_epod_mobile_detail(uuid, text) from public, anon;
grant execute on function public.tms_epod_mobile_detail(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
