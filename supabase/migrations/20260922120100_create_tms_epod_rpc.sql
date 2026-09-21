-- e-POD server-side RPCs.
--
-- Semua fungsi tms_epod_* di sini SECURITY DEFINER dan HANYA boleh
-- dieksekusi oleh service_role. Route Handler server memverifikasi
-- permission lebih dulu lalu memanggil RPC dengan service_role. Fungsi
-- tidak di-grant ke authenticated supaya user tidak bisa memalsukan actor
-- lewat parameter p_actor_user.

-- 1. Permission helper berbasis actor eksplisit (karena service_role
--    membuat auth.uid() bernilai null). Logika sama dengan
--    has_app_permission lama agar tidak mengubah perilaku RLS yang ada.
create or replace function public.has_app_permission_for(
  p_user uuid,
  p_permission text,
  p_allow_view boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    join public.roles r on r.id = up.role_id
    where up.id = p_user
      and up.status = 'Aktif'
      and r.status = 'Aktif'
      and (
        r.permissions ? 'all'
        or r.permissions ? p_permission
        or (
          p_allow_view
          and (
            r.permissions ? (p_permission || '.view')
            or r.permissions ? (p_permission || '.input')
          )
        )
      )
  );
$$;

-- 2. has_app_permission lama didelegasikan agar konsisten.
create or replace function public.has_app_permission(
  required_permission text,
  allow_view boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_app_permission_for(auth.uid(), required_permission, allow_view);
$$;

-- 3. Cek pengelola e-POD: akun internal + permission kelola.
--    tms.input dan tms (induk) ikut dianggap boleh kelola, sesuai matriks
--    permission yang disepakati. tms.view hanya boleh melihat.
create or replace function public.tms_epod_is_manager(p_actor_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    join public.roles r on r.id = up.role_id
    where up.id = p_actor_user
      and up.status = 'Aktif'
      and up.account_type = 'internal'
      and r.status = 'Aktif'
      and (
        r.permissions ? 'all'
        or r.permissions ? 'tms'
        or r.permissions ? 'tms.input'
        or r.permissions ? 'tms.epod'
        or r.permissions ? 'tms.epod.manage'
      )
  );
$$;

-- 4. Hitung ulang status assignment dari data stop dan submission.
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
  v_next text;
begin
  select status, loading_status,
         (driver_employee_id is not null or helper_employee_id is not null)
  into v_current, v_loading, v_has_roster
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

  update public.tms_epod_assignments
  set status = v_next,
      delivery_done_count = v_done,
      delivery_total_count = v_total
  where id = p_assignment_id;

  return v_next;
end;
$$;

-- 5. Tetapkan/lepas driver atau helper dari web (sekaligus fondasi admin override).
create or replace function public.tms_epod_set_roster(
  p_assignment_id uuid,
  p_role text,
  p_employee_id text,
  p_actor_user uuid
)
returns public.tms_epod_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.tms_epod_assignments%rowtype;
  v_employee public.pegawai%rowtype;
  v_driver_jabatan integer;
  v_helper_jabatan integer;
  v_required_jabatan integer;
  v_actor_role text;
  v_updated public.tms_epod_assignments%rowtype;
begin
  if not public.tms_epod_is_manager(p_actor_user) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_role not in ('DRIVER', 'HELPER') then
    raise exception 'Peran harus DRIVER atau HELPER.';
  end if;

  select * into v_assignment
  from public.tms_epod_assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment e-POD tidak ditemukan.';
  end if;

  if v_assignment.frozen_at is not null then
    raise exception 'Assignment sudah terkunci karena bukti sudah dikirim.';
  end if;

  if p_employee_id is not null then
    select driver_jabatan_id, helper_jabatan_id
    into v_driver_jabatan, v_helper_jabatan
    from public.gapok_settings
    order by effective_from desc nulls last, id desc
    limit 1;

    v_required_jabatan := case when p_role = 'DRIVER' then v_driver_jabatan else v_helper_jabatan end;

    select * into v_employee from public.pegawai where id = p_employee_id;
    if not found then
      raise exception 'Pegawai tidak ditemukan.';
    end if;
    if v_employee.status <> 'Aktif' then
      raise exception 'Pegawai % tidak aktif.', v_employee.nama;
    end if;
    if v_required_jabatan is not null and v_employee.jabatan_id is distinct from v_required_jabatan then
      raise exception 'Jabatan pegawai % tidak sesuai untuk peran %.', v_employee.nama, p_role;
    end if;

    if exists (
      select 1 from public.tms_epod_assignments a
      where a.id <> p_assignment_id
        and a.frozen_at is null
        and a.status not in ('COMPLETED', 'CANCELLED')
        and (a.driver_employee_id = p_employee_id or a.helper_employee_id = p_employee_id)
    ) then
      raise exception 'Pegawai % masih terikat FO lain yang aktif.', v_employee.nama;
    end if;
  end if;

  if p_role = 'DRIVER' then
    update public.tms_epod_assignments
    set driver_employee_id = p_employee_id,
        driver_set_at = case when p_employee_id is null then null else now() end
    where id = p_assignment_id
    returning * into v_updated;
  else
    update public.tms_epod_assignments
    set helper_employee_id = p_employee_id,
        helper_set_at = case when p_employee_id is null then null else now() end
    where id = p_assignment_id
    returning * into v_updated;
  end if;

  perform public.tms_epod_recompute_status(p_assignment_id);

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_epod_events (
    assignment_id, event_type, actor_user_id, actor_role, payload
  ) values (
    p_assignment_id,
    case when p_employee_id is null then 'roster_cleared' else 'roster_set' end,
    p_actor_user,
    v_actor_role,
    jsonb_build_object('role', p_role, 'employee_id', p_employee_id)
  );

  select * into v_updated from public.tms_epod_assignments where id = p_assignment_id;
  return v_updated;
end;
$$;

-- 6. Kirim bukti loading/delivery. Final dan immutable; koreksi = versi baru.
create or replace function public.tms_epod_submit(
  p_stop_id uuid,
  p_result text,
  p_recipient_name text,
  p_note text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_captured_at_device timestamptz,
  p_out_of_radius_reason text,
  p_evidence jsonb,
  p_actor_user uuid,
  p_actor_employee_id text,
  p_actor_type text,
  p_source text
)
returns public.tms_epod_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stop public.tms_epod_stops%rowtype;
  v_assignment public.tms_epod_assignments%rowtype;
  v_is_manager boolean;
  v_is_assigned boolean;
  v_evidence_count integer;
  v_distance double precision;
  v_geofence_ok boolean;
  v_version integer;
  v_submission public.tms_epod_submissions%rowtype;
  v_actor_role text;
  v_bad_path text;
begin
  select * into v_stop from public.tms_epod_stops where id = p_stop_id;
  if not found then
    raise exception 'Titik e-POD tidak ditemukan.';
  end if;

  select * into v_assignment
  from public.tms_epod_assignments
  where id = v_stop.assignment_id
  for update;

  v_is_manager := public.tms_epod_is_manager(p_actor_user);
  v_is_assigned :=
    (p_actor_employee_id is not null)
    and (v_assignment.driver_employee_id = p_actor_employee_id
         or v_assignment.helper_employee_id = p_actor_employee_id);

  if not (v_is_manager or v_is_assigned) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if v_assignment.status = 'CANCELLED' then
    raise exception 'Assignment e-POD sudah dibatalkan.';
  end if;

  if v_stop.stop_type = 'LOADING' then
    if p_result is not null then
      raise exception 'Titik loading tidak memakai hasil pengiriman.';
    end if;
  else
    if p_result is null or p_result not in ('DELIVERED', 'PARTIAL', 'REJECTED') then
      raise exception 'Hasil pengiriman wajib DELIVERED, PARTIAL, atau REJECTED.';
    end if;
    if v_assignment.loading_status <> 'LOADING_COMPLETED' then
      raise exception 'Bukti loading harus diselesaikan sebelum pengiriman.';
    end if;
  end if;

  v_evidence_count := coalesce(jsonb_array_length(p_evidence), 0);
  if v_evidence_count < 1 or v_evidence_count > 5 then
    raise exception 'Jumlah foto harus 1 sampai 5.';
  end if;

  select e->>'path' into v_bad_path
  from jsonb_array_elements(p_evidence) e
  where not exists (
    select 1 from storage.objects o
    where o.bucket_id = coalesce(e->>'bucket_id', 'tms-epod-evidence')
      and o.name = e->>'path'
  )
  limit 1;

  if v_bad_path is not null then
    raise exception 'Foto bukti belum terunggah: %', v_bad_path;
  end if;

  if v_stop.stop_type = 'DELIVERY' then
    if p_result in ('DELIVERED', 'PARTIAL') and nullif(btrim(coalesce(p_recipient_name, '')), '') is null then
      raise exception 'Nama penerima wajib untuk hasil %.', p_result;
    end if;
    if p_result in ('PARTIAL', 'REJECTED') and nullif(btrim(coalesce(p_note, '')), '') is null then
      raise exception 'Alasan wajib untuk hasil %.', p_result;
    end if;
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'Lokasi GPS wajib diisi.';
  end if;

  if v_stop.latitude is not null and v_stop.longitude is not null then
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians((p_latitude - v_stop.latitude) / 2)), 2)
      + cos(radians(v_stop.latitude)) * cos(radians(p_latitude))
        * power(sin(radians((p_longitude - v_stop.longitude) / 2)), 2)
    ));
    v_geofence_ok := v_distance <= 500;
  else
    v_distance := null;
    v_geofence_ok := null;
  end if;

  if v_geofence_ok is false and nullif(btrim(coalesce(p_out_of_radius_reason, '')), '') is null then
    raise exception 'Alasan wajib bila lokasi lebih dari 500 meter dari titik.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.tms_epod_submissions
  where stop_id = p_stop_id;

  update public.tms_epod_submissions
  set is_current = false
  where stop_id = p_stop_id and is_current;

  insert into public.tms_epod_submissions (
    stop_id, version, result, recipient_name, note,
    latitude, longitude, accuracy_meters, distance_meters, geofence_ok,
    out_of_radius_reason, captured_at_device, actor_type, actor_employee_id,
    actor_user_id, source, is_current
  ) values (
    p_stop_id, v_version, p_result,
    nullif(btrim(coalesce(p_recipient_name, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    p_latitude, p_longitude, p_accuracy_meters, v_distance, v_geofence_ok,
    nullif(btrim(coalesce(p_out_of_radius_reason, '')), ''),
    p_captured_at_device, coalesce(p_actor_type, 'WEB_ADMIN'), p_actor_employee_id,
    p_actor_user, coalesce(p_source, 'WEB'), true
  )
  returning * into v_submission;

  insert into public.tms_epod_evidence (
    submission_id, bucket_id, object_path, mime_type, size_bytes, original_filename, sort_order
  )
  select
    v_submission.id,
    coalesce(e->>'bucket_id', 'tms-epod-evidence'),
    e->>'path',
    e->>'mime_type',
    nullif(e->>'size_bytes', '')::bigint,
    e->>'original_filename',
    coalesce(nullif(e->>'sort_order', '')::integer, 0)
  from jsonb_array_elements(p_evidence) e;

  if v_assignment.frozen_at is null then
    update public.tms_epod_assignments
    set frozen_at = now()
    where id = v_assignment.id;
  end if;

  if v_stop.stop_type = 'LOADING' then
    update public.tms_epod_assignments
    set loading_status = 'LOADING_COMPLETED',
        loading_completed_at = now()
    where id = v_assignment.id;
  end if;

  perform public.tms_epod_recompute_status(v_assignment.id);

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_epod_events (
    assignment_id, stop_id, submission_id, event_type,
    actor_user_id, actor_employee_id, actor_role, payload
  ) values (
    v_assignment.id, p_stop_id, v_submission.id,
    case when v_stop.stop_type = 'LOADING' then 'loading_submitted' else 'delivery_submitted' end,
    p_actor_user, p_actor_employee_id, v_actor_role,
    jsonb_build_object(
      'version', v_version,
      'result', p_result,
      'distance_meters', v_distance,
      'geofence_ok', v_geofence_ok,
      'evidence_count', v_evidence_count
    )
  );

  return v_submission;
end;
$$;

-- 7. Batalkan assignment (admin override).
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

  update public.tms_epod_assignments
  set status = 'CANCELLED'
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

-- Kunci eksekusi: hanya service_role.
revoke all on function public.has_app_permission_for(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.has_app_permission(text, boolean) from public, anon, authenticated;
revoke all on function public.tms_epod_is_manager(uuid) from public, anon, authenticated;
revoke all on function public.tms_epod_recompute_status(uuid) from public, anon, authenticated;
revoke all on function public.tms_epod_set_roster(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.tms_epod_submit(uuid, text, text, text, double precision, double precision, double precision, timestamptz, text, jsonb, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.tms_epod_cancel_assignment(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.has_app_permission_for(uuid, text, boolean) to service_role;
grant execute on function public.has_app_permission(text, boolean) to authenticated, service_role;
grant execute on function public.tms_epod_is_manager(uuid) to service_role;
grant execute on function public.tms_epod_recompute_status(uuid) to service_role;
grant execute on function public.tms_epod_set_roster(uuid, text, text, uuid) to service_role;
grant execute on function public.tms_epod_submit(uuid, text, text, text, double precision, double precision, double precision, timestamptz, text, jsonb, uuid, text, text, text) to service_role;
grant execute on function public.tms_epod_cancel_assignment(uuid, text, uuid) to service_role;
