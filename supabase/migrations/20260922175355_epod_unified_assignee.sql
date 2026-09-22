-- e-POD: satu petugas umum per FO; mobile claim untuk 4 jabatan operasional HRM.
--
-- - Role mobile ditentukan dari jabatan HRM via tabel mapping
--   `tms_epod_claim_roles` (Driver, Helper, Koordinator, Wakil Koordinator),
--   bukan lagi dari gapok_settings.
-- - Kolom petugas umum `assigned_*` menggantikan slot driver/helper; web boleh
--   menugaskan pegawai aktif dari jabatan apa pun (alasan wajib untuk jabatan
--   di luar 4 role operasional).

-- 1. Mapping jabatan HRM -> role e-POD yang boleh claim via mobile.
create table if not exists public.tms_epod_claim_roles (
  jabatan_id integer primary key references public.jabatan(id) on delete cascade,
  role_code text not null unique,
  created_at timestamptz not null default now(),
  constraint tms_epod_claim_roles_code_check
    check (role_code in ('DRIVER', 'HELPER', 'COORDINATOR', 'DEPUTY_COORDINATOR'))
);

insert into public.tms_epod_claim_roles (jabatan_id, role_code)
select j.id, m.role_code
from public.jabatan j
join (values
  ('Driver', 'DRIVER'),
  ('Helper', 'HELPER'),
  ('Koordinator', 'COORDINATOR'),
  ('Wakil Koordinator', 'DEPUTY_COORDINATOR')
) as m(nama, role_code) on m.nama = j.nama
on conflict (jabatan_id) do update set role_code = excluded.role_code;

alter table public.tms_epod_claim_roles enable row level security;
revoke all on table public.tms_epod_claim_roles from public, anon, authenticated;
grant all on table public.tms_epod_claim_roles to service_role;

-- 2. Kolom petugas umum.
alter table public.tms_epod_assignments
  add column if not exists assigned_employee_id text references public.pegawai(id) on delete set null,
  add column if not exists assigned_role text,
  add column if not exists assigned_source text,
  add column if not exists assigned_reason text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_jabatan_id integer references public.jabatan(id) on delete set null;

alter table public.tms_epod_assignments
  drop constraint if exists tms_epod_assignments_role_check;
alter table public.tms_epod_assignments
  add constraint tms_epod_assignments_role_check
  check (assigned_role in ('DRIVER', 'HELPER', 'COORDINATOR', 'DEPUTY_COORDINATOR', 'OTHER'));

alter table public.tms_epod_assignments
  drop constraint if exists tms_epod_assignments_source_check;
alter table public.tms_epod_assignments
  add constraint tms_epod_assignments_source_check
  check (assigned_source in ('MOBILE', 'WEB'));

-- Backfill dari slot lama (driver/helper) ke petugas umum.
update public.tms_epod_assignments a
set assigned_employee_id = coalesce(a.driver_employee_id, a.helper_employee_id),
    assigned_role = case when a.driver_employee_id is not null then 'DRIVER' else 'HELPER' end,
    assigned_source = 'WEB',
    assigned_at = coalesce(a.driver_set_at, a.helper_set_at, a.created_at),
    assigned_jabatan_id = p.jabatan_id
from public.pegawai p
where (a.driver_employee_id is not null or a.helper_employee_id is not null)
  and p.id = coalesce(a.driver_employee_id, a.helper_employee_id);

-- Invariant: kolom petugas umum terisi semua atau kosong semua.
alter table public.tms_epod_assignments
  drop constraint if exists tms_epod_assignments_assigned_set_check;
alter table public.tms_epod_assignments
  add constraint tms_epod_assignments_assigned_set_check
  check (
    (assigned_employee_id is null and assigned_role is null and assigned_source is null)
    or (assigned_employee_id is not null and assigned_role is not null and assigned_source is not null)
  );

create index if not exists tms_epod_assignments_assigned_idx
  on public.tms_epod_assignments (assigned_employee_id);

-- Tipe aktor bukti diperluas mengikuti role petugas.
alter table public.tms_epod_submissions
  drop constraint if exists tms_epod_submissions_actor_type_check;
alter table public.tms_epod_submissions
  add constraint tms_epod_submissions_actor_type_check
  check (actor_type in ('WEB_ADMIN', 'DRIVER', 'HELPER', 'COORDINATOR', 'DEPUTY_COORDINATOR', 'OTHER'));

-- 3. Hapus slot lama yang sudah digantikan petugas umum.
alter table public.tms_epod_assignments
  drop constraint if exists tms_epod_assignments_single_claim;
drop index if exists public.tms_epod_assignments_driver_idx;
drop index if exists public.tms_epod_assignments_helper_idx;
alter table public.tms_epod_assignments
  drop column if exists driver_employee_id,
  drop column if exists helper_employee_id,
  drop column if exists driver_set_at,
  drop column if exists helper_set_at;

-- Hapus RPC roster lama (menulis kolom yang sudah tidak ada).
drop function if exists public.tms_epod_set_petugas(uuid, text, uuid);

-- 4. Role mobile pegawai berdasarkan mapping jabatan HRM.
create or replace function public.tms_epod_mobile_role(p_employee_id text)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  if not public.tms_epod_mobile_is_caller() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_employee_id, '')), '') is null then
    return null;
  end if;

  select r.role_code into v_role
  from public.pegawai p
  join public.tms_epod_claim_roles r on r.jabatan_id = p.jabatan_id
  where p.id = p_employee_id
    and p.status = 'Aktif';

  return v_role;
end;
$$;

-- 5. Overview: FO milik saya vs FO tersedia (belum ada petugas umum).
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
begin
  if not public.tms_epod_mobile_is_caller() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  v_role := public.tms_epod_mobile_role(p_employee_id);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.snapshot_at desc), '[]'::jsonb)
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
      a.assigned_role as my_role
    from public.tms_epod_assignments a
    where a.assigned_employee_id = p_employee_id
      and a.status not in ('COMPLETED', 'CANCELLED')
  ) t;

  if v_role is null or jsonb_array_length(v_mine) > 0 then
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
        a.snapshot_at
      from public.tms_epod_assignments a
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

-- 6. Claim: satu FO hanya untuk satu petugas; role dari mapping jabatan HRM.
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

-- 7. Detail: hanya boleh dibaca petugas yang terpasang pada FO tersebut.
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
      'my_role', v_role
    ),
    'stops', v_stops
  );
end;
$$;

-- 8. Submit mobile: aktor adalah petugas yang terpasang; role dari mapping
--    jabatan, atau role penugasan bila jabatan tidak termasuk role mobile.
create or replace function public.tms_epod_mobile_submit(
  p_stop_id uuid,
  p_employee_id text,
  p_result text,
  p_recipient_name text,
  p_note text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_captured_at_device timestamptz,
  p_out_of_radius_reason text,
  p_evidence jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_assignment public.tms_epod_assignments%rowtype;
  v_submission public.tms_epod_submissions%rowtype;
begin
  if not public.tms_epod_mobile_is_caller() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_stop_id is null then
    raise exception 'Titik e-POD tidak valid.';
  end if;

  if nullif(btrim(coalesce(p_employee_id, '')), '') is null then
    raise exception 'Pegawai tidak valid.';
  end if;

  select a.* into v_assignment
  from public.tms_epod_stops s
  join public.tms_epod_assignments a on a.id = s.assignment_id
  where s.id = p_stop_id;

  if not found then
    raise exception 'Titik e-POD tidak ditemukan.';
  end if;

  if v_assignment.assigned_employee_id is distinct from p_employee_id then
    raise exception 'Anda tidak terpasang pada FO ini.' using errcode = '42501';
  end if;

  v_role := coalesce(
    public.tms_epod_mobile_role(p_employee_id),
    v_assignment.assigned_role
  );

  v_submission := public.tms_epod_submit(
    p_stop_id := p_stop_id,
    p_result := p_result,
    p_recipient_name := p_recipient_name,
    p_note := p_note,
    p_latitude := p_latitude,
    p_longitude := p_longitude,
    p_accuracy_meters := p_accuracy_meters,
    p_captured_at_device := p_captured_at_device,
    p_out_of_radius_reason := p_out_of_radius_reason,
    p_evidence := coalesce(p_evidence, '[]'::jsonb),
    p_actor_user := auth.uid(),
    p_actor_employee_id := p_employee_id,
    p_actor_type := v_role,
    p_source := 'MOBILE',
    p_items := coalesce(p_items, '[]'::jsonb)
  );

  return to_jsonb(v_submission);
end;
$$;

-- 9. Submit inti: hak kirim untuk pengelola atau petugas yang terpasang.
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
    and (v_assignment.assigned_employee_id = p_actor_employee_id);

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

-- 10. Hitung ulang status: petugas = assigned_employee_id.
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
         (assigned_employee_id is not null)
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

-- 11. Web: tetapkan satu petugas dari jabatan apa pun (alasan wajib untuk
--     jabatan di luar role operasional e-POD).
create function public.tms_epod_set_petugas(
  p_assignment_id uuid,
  p_employee_id text,
  p_reason text,
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
  v_jabatan text;
  v_role text;
  v_reason text;
  v_actor_role text;
  v_updated public.tms_epod_assignments%rowtype;
begin
  if not public.tms_epod_is_manager(p_actor_user) then
    raise exception 'Unauthorized' using errcode = '42501';
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

  if nullif(btrim(coalesce(p_employee_id, '')), '') is not null then
    select * into v_employee from public.pegawai where id = p_employee_id;
    if not found then
      raise exception 'Pegawai tidak ditemukan.';
    end if;
    if v_employee.status <> 'Aktif' then
      raise exception 'Pegawai % tidak aktif.', v_employee.nama;
    end if;

    select r.role_code into v_role
    from public.tms_epod_claim_roles r
    where r.jabatan_id = v_employee.jabatan_id;

    if v_role is null then
      v_role := 'OTHER';
      select j.nama into v_jabatan
      from public.jabatan j
      where j.id = v_employee.jabatan_id;

      v_reason := nullif(btrim(coalesce(p_reason, '')), '');
      if v_reason is null then
        raise exception 'Penugasan untuk jabatan % wajib menyertakan alasan.', coalesce(v_jabatan, 'lainnya');
      end if;
    else
      v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    end if;

    if exists (
      select 1 from public.tms_epod_assignments a
      where a.id <> p_assignment_id
        and a.frozen_at is null
        and a.status not in ('COMPLETED', 'CANCELLED')
        and a.assigned_employee_id = p_employee_id
    ) then
      raise exception 'Pegawai % masih terikat FO lain yang aktif.', v_employee.nama;
    end if;

    update public.tms_epod_assignments
    set assigned_employee_id = p_employee_id,
        assigned_role = v_role,
        assigned_source = 'WEB',
        assigned_reason = v_reason,
        assigned_at = now(),
        assigned_jabatan_id = v_employee.jabatan_id
    where id = p_assignment_id
    returning * into v_updated;
  else
    update public.tms_epod_assignments
    set assigned_employee_id = null,
        assigned_role = null,
        assigned_source = null,
        assigned_reason = null,
        assigned_at = null,
        assigned_jabatan_id = null
    where id = p_assignment_id
    returning * into v_updated;

    v_role := null;
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
    case when v_role is null then 'roster_cleared' else 'roster_set' end,
    p_actor_user,
    v_actor_role,
    jsonb_build_object(
      'role', v_role,
      'source', 'WEB',
      'reason', case when v_role is null then null else v_reason end,
      'employee_id', case when v_role is null then null else p_employee_id end
    )
  );

  select * into v_updated from public.tms_epod_assignments where id = p_assignment_id;
  return v_updated;
end;
$$;

-- 12. Kunci eksekusi fungsi baru.
revoke all on function public.tms_epod_set_petugas(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.tms_epod_set_petugas(uuid, text, text, uuid) to service_role;
