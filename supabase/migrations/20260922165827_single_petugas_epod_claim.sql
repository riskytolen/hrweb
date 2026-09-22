-- e-POD: satu FO = satu petugas (Driver atau Helper).
--
-- Sebelumnya slot Driver dan Helper bisa terisi bersamaan sehingga satu FO
-- bisa diklaim dua orang. Aturan baru: maksimal satu slot terisi, dan FO yang
-- sudah diklaim hilang dari daftar tersedia untuk semua pegawai.

-- 1. Invariant di level DB.
alter table public.tms_epod_assignments
  add constraint tms_epod_assignments_single_claim
  check (not (driver_employee_id is not null and helper_employee_id is not null));

-- 2. Overview: FO tersedia hanya yang belum diklaim siapa pun.
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
      case
        when a.driver_employee_id = p_employee_id then 'DRIVER'
        when a.helper_employee_id = p_employee_id then 'HELPER'
        else null
      end as my_role
    from public.tms_epod_assignments a
    where (a.driver_employee_id = p_employee_id or a.helper_employee_id = p_employee_id)
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
        and a.driver_employee_id is null
        and a.helper_employee_id is null
    ) t;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'mine', v_mine,
    'available', v_available
  );
end;
$$;

-- 3. Claim: tolak bila FO sudah diklaim siapa pun.
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
    raise exception 'Jabatan Anda bukan Driver atau Helper.';
  end if;

  -- Kunci baris assignment: cegah dua pegawai mengambil slot yang sama.
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

  if v_assignment.driver_employee_id = p_employee_id
     or v_assignment.helper_employee_id = p_employee_id then
    raise exception 'Anda sudah terpasang pada FO ini.';
  end if;

  if v_assignment.driver_employee_id is not null
     or v_assignment.helper_employee_id is not null then
    raise exception 'FO ini sudah diklaim.';
  end if;

  -- Satu pegawai hanya boleh terikat satu FO aktif.
  if exists (
    select 1
    from public.tms_epod_assignments a
    where a.id <> p_assignment_id
      and a.frozen_at is null
      and a.status not in ('COMPLETED', 'CANCELLED')
      and (a.driver_employee_id = p_employee_id or a.helper_employee_id = p_employee_id)
  ) then
    raise exception 'Anda masih terikat FO lain yang aktif.';
  end if;

  if v_role = 'DRIVER' then
    update public.tms_epod_assignments
    set driver_employee_id = p_employee_id,
        driver_set_at = now()
    where id = p_assignment_id
    returning * into v_updated;
  else
    update public.tms_epod_assignments
    set helper_employee_id = p_employee_id,
        helper_set_at = now()
    where id = p_assignment_id
    returning * into v_updated;
  end if;

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

-- 4. Web: tetapkan satu petugas e-POD (role ditentukan server dari jabatan).
--
-- Menggantikan `tms_epod_set_roster` yang lama (dua slot bebas). Sekarang satu
-- FO hanya punya satu petugas; memilih pegawai mengosongkan slot lawan, dan
-- memilih kosong melepas seluruh petugas.
create or replace function public.tms_epod_set_petugas(
  p_assignment_id uuid,
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
  v_role text;
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
    select driver_jabatan_id, helper_jabatan_id
    into v_driver_jabatan, v_helper_jabatan
    from public.gapok_settings
    order by effective_from desc nulls last, id desc
    limit 1;

    select * into v_employee from public.pegawai where id = p_employee_id;
    if not found then
      raise exception 'Pegawai tidak ditemukan.';
    end if;
    if v_employee.status <> 'Aktif' then
      raise exception 'Pegawai % tidak aktif.', v_employee.nama;
    end if;

    if v_driver_jabatan is not null and v_employee.jabatan_id = v_driver_jabatan then
      v_role := 'DRIVER';
    elsif v_helper_jabatan is not null and v_employee.jabatan_id = v_helper_jabatan then
      v_role := 'HELPER';
    else
      raise exception 'Jabatan pegawai % bukan Driver atau Helper.', v_employee.nama;
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

  update public.tms_epod_assignments
  set driver_employee_id = case when v_role = 'DRIVER' then p_employee_id else null end,
      driver_set_at = case when v_role = 'DRIVER' then now() else null end,
      helper_employee_id = case when v_role = 'HELPER' then p_employee_id else null end,
      helper_set_at = case when v_role = 'HELPER' then now() else null end
  where id = p_assignment_id
  returning * into v_updated;

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
      'employee_id', case when v_role is null then null else p_employee_id end
    )
  );

  select * into v_updated from public.tms_epod_assignments where id = p_assignment_id;
  return v_updated;
end;
$$;

-- 5. Ganti RPC roster lama (dua slot) dengan yang baru (satu petugas).
drop function if exists public.tms_epod_set_roster(uuid, text, text, uuid);

-- 6. Kunci eksekusi: anon/PUBLIC dicabut; mobile hanya untuk RPC publiknya.
revoke all on function public.tms_epod_mobile_overview(text) from public, anon;
revoke all on function public.tms_epod_mobile_claim(uuid, text) from public, anon;
revoke all on function public.tms_epod_set_petugas(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.tms_epod_mobile_overview(text) to authenticated, service_role;
grant execute on function public.tms_epod_mobile_claim(uuid, text) to authenticated, service_role;
grant execute on function public.tms_epod_set_petugas(uuid, text, uuid) to service_role;
