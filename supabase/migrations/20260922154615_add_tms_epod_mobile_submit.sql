-- e-POD mobile Fase 2: detail FO + input loading/pengantaran.
--
-- Melengkapi RPC Fase 1 (`tms_epod_mobile_claim` dkk). Aplikasi mobile tetap
-- memanggil RPC langsung via PostgREST. Semua aturan bisnis berat (urutan
-- loading sebelum pengantaran, jumlah foto, daftar barang, geofence, versi
-- koreksi) TIDAK ditulis ulang di sini — `tms_epod_mobile_submit` hanya
-- menentukan aktor lalu mendelegasikan ke `tms_epod_submit` sebagai satu
-- sumber kebenaran. Role ditentukan server dari jabatan pegawai.
--
-- Upload foto memakai bucket privat `tms-epod-evidence`. Karena bucket itu
-- tidak punya policy untuk authenticated, migrasi ini menambah policy INSERT
-- khusus akun operasional mobile dengan pola path yang ketat. Unduh tetap
-- lewat signed URL server-side sehingga bukti tetap privat.

-- 1. Detail satu FO: ringkasan + daftar titik berurutan + submission aktif
--    per titik. Hanya boleh dibaca pegawai yang terpasang pada FO tersebut.
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

  if v_assignment.driver_employee_id is distinct from p_employee_id
     and v_assignment.helper_employee_id is distinct from p_employee_id then
    raise exception 'Anda tidak terpasang pada FO ini.' using errcode = '42501';
  end if;

  v_role := public.tms_epod_mobile_role(p_employee_id);

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

-- 2. Kirim bukti loading/pengantaran dari mobile.
--
-- Aktor ditentukan server: role dari jabatan, identitas dari p_employee_id,
-- dan sesi Supabase (akun mobile) dipakai sebagai actor_user_id untuk audit.
-- Validasi inti tetap di `tms_epod_submit`.
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

  v_role := public.tms_epod_mobile_role(p_employee_id);
  if v_role is null then
    raise exception 'Jabatan Anda bukan Driver atau Helper.';
  end if;

  select a.* into v_assignment
  from public.tms_epod_stops s
  join public.tms_epod_assignments a on a.id = s.assignment_id
  where s.id = p_stop_id;

  if not found then
    raise exception 'Titik e-POD tidak ditemukan.';
  end if;

  if v_assignment.driver_employee_id is distinct from p_employee_id
     and v_assignment.helper_employee_id is distinct from p_employee_id then
    raise exception 'Anda tidak terpasang pada FO ini.' using errcode = '42501';
  end if;

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

-- 3. Policy upload foto mobile ke bucket privat.
--
-- Hanya akun operasional mobile yang boleh menulis langsung, dan hanya pada
-- pola path yang dipakai server: assignments/<uuid>/stops/<uuid>/<file>.
-- Unduh tetap via signed URL server-side.
drop policy if exists "tms_epod_evidence_mobile_insert" on storage.objects;
create policy "tms_epod_evidence_mobile_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'tms-epod-evidence'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'pegawai@jamslogistic.com'
  and name ~ '^assignments/[0-9a-fA-F-]{36}/stops/[0-9a-fA-F-]{36}/[^/]+$'
);

-- 4. Kunci eksekusi: anon/PUBLIC dicabut; authenticated hanya untuk RPC publik.
revoke all on function public.tms_epod_mobile_detail(uuid, text) from public, anon;
revoke all on function public.tms_epod_mobile_submit(
  uuid, text, text, text, text, double precision, double precision, double precision,
  timestamptz, text, jsonb, jsonb
) from public, anon;

grant execute on function public.tms_epod_mobile_detail(uuid, text) to authenticated, service_role;
grant execute on function public.tms_epod_mobile_submit(
  uuid, text, text, text, text, double precision, double precision, double precision,
  timestamptz, text, jsonb, jsonb
) to authenticated, service_role;
