-- Tambah daftar barang (nama + kuantitas) pada bukti e-POD.
--
-- Barang hanya dipakai pada titik pengantaran; titik loading tetap cukup
-- foto. Disimpan sebagai jsonb agar ikut terversi bersama submission:
-- koreksi membuat versi baru berisi daftar barang yang baru juga.

alter table public.tms_epod_submissions
  add column if not exists items jsonb not null default '[]'::jsonb;

alter table public.tms_epod_submissions
  drop constraint if exists tms_epod_submissions_items_check;

alter table public.tms_epod_submissions
  add constraint tms_epod_submissions_items_check
  check (jsonb_typeof(items) = 'array');

-- Ganti RPC lama (tanpa p_items) dengan versi baru yang menerima daftar barang.
drop function if exists public.tms_epod_submit(
  uuid, text, text, text, double precision, double precision, double precision,
  timestamptz, text, jsonb, uuid, text, text, text
);

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
  p_source text,
  p_items jsonb
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
  v_items jsonb;
  v_items_count integer;
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

  -- Daftar barang: wajib pada titik pengantaran, tidak dipakai di loading.
  if v_stop.stop_type = 'LOADING' then
    v_items := '[]'::jsonb;
    v_items_count := 0;
  else
    v_items_count := coalesce(jsonb_array_length(p_items), 0);
    if v_items_count < 1 then
      raise exception 'Minimal satu barang wajib diisi untuk titik pengantaran.';
    end if;
    if v_items_count > 20 then
      raise exception 'Jumlah barang maksimal 20.';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_items) e
      where nullif(btrim(coalesce(e->>'name', '')), '') is null
         or (
              case
                when (e->>'quantity') ~ '^[0-9]+([.][0-9]+)?$'
                  then (e->>'quantity')::numeric
                else 0
              end
            ) <= 0
    ) then
      raise exception 'Nama barang wajib diisi dan kuantitas harus lebih dari 0.';
    end if;

    select jsonb_agg(
             jsonb_build_object(
               'name', btrim(e->>'name'),
               'quantity', (e->>'quantity')::numeric,
               'unit', nullif(btrim(coalesce(e->>'unit', '')), '')
             )
           )
    into v_items
    from jsonb_array_elements(p_items) e;
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
    actor_user_id, source, is_current, items
  ) values (
    p_stop_id, v_version, p_result,
    nullif(btrim(coalesce(p_recipient_name, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    p_latitude, p_longitude, p_accuracy_meters, v_distance, v_geofence_ok,
    nullif(btrim(coalesce(p_out_of_radius_reason, '')), ''),
    p_captured_at_device, coalesce(p_actor_type, 'WEB_ADMIN'), p_actor_employee_id,
    p_actor_user, coalesce(p_source, 'WEB'), true, v_items
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
      'evidence_count', v_evidence_count,
      'items_count', v_items_count
    )
  );

  return v_submission;
end;
$$;

revoke all on function public.tms_epod_submit(
  uuid, text, text, text, double precision, double precision, double precision,
  timestamptz, text, jsonb, uuid, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.tms_epod_submit(
  uuid, text, text, text, double precision, double precision, double precision,
  timestamptz, text, jsonb, uuid, text, text, text, jsonb
) to service_role;
