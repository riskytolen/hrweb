-- e-POD mobile self-claim (Fase 1: claim + list).
--
-- Aplikasi mobile (Flutter `jams_absen`) terautentikasi sebagai akun
-- operasional bersama lalu memanggil RPC di bawah langsung via PostgREST.
-- Karena tidak ada identitas Supabase per-pegawai, identitas aktor dikirim
-- sebagai `p_employee_id` dan divalidasi ketat di server: pegawai aktif,
-- jabatan sesuai konfigurasi gapok_settings, serta belum terikat FO aktif
-- lain. Device binding sengaja belum dipakai (keputusan MVP).
--
-- Semua fungsi SECURITY DEFINER, `search_path` dikunci, dan hanya boleh
-- dieksekusi `authenticated` + `service_role` (anon/PUBLIC dicabut). Tabel
-- e-POD tetap tertutup untuk service_role.

-- 1. Guard pemanggil: sesi authenticated dari akun mobile operasional atau
--    user internal yang aktif. Menutup anon dan akun signup liar.
create or replace function public.tms_epod_mobile_is_caller()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and (
      lower(coalesce(auth.jwt() ->> 'email', '')) = 'pegawai@jamslogistic.com'
      or exists (
        select 1
        from public.user_profiles up
        where up.id = auth.uid()
          and up.status = 'Aktif'
      )
    );
$$;

-- 2. Role mobile pegawai berdasarkan jabatan vs konfigurasi gapok terbaru.
--    Mengembalikan 'DRIVER', 'HELPER', atau null bila bukan keduanya.
create or replace function public.tms_epod_mobile_role(p_employee_id text)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_jabatan integer;
  v_status text;
  v_driver_jabatan integer;
  v_helper_jabatan integer;
begin
  if not public.tms_epod_mobile_is_caller() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_employee_id, '')), '') is null then
    return null;
  end if;

  select jabatan_id, status
  into v_jabatan, v_status
  from public.pegawai
  where id = p_employee_id;

  if not found or v_status <> 'Aktif' then
    return null;
  end if;

  select driver_jabatan_id, helper_jabatan_id
  into v_driver_jabatan, v_helper_jabatan
  from public.gapok_settings
  order by effective_from desc nulls last, id desc
  limit 1;

  if v_jabatan is not null and v_jabatan = v_driver_jabatan then
    return 'DRIVER';
  elsif v_jabatan is not null and v_jabatan = v_helper_jabatan then
    return 'HELPER';
  end if;

  return null;
end;
$$;

-- 3. Overview untuk layar e-POD: role, FO milik saya, dan FO tersedia.
--    Bila pegawai sudah punya FO aktif, daftar `available` dikosongkan.
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
      end as my_role,
      (a.driver_employee_id is not null) as driver_filled,
      (a.helper_employee_id is not null) as helper_filled
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
        a.snapshot_at,
        (a.driver_employee_id is not null) as driver_filled,
        (a.helper_employee_id is not null) as helper_filled
      from public.tms_epod_assignments a
      where a.status not in ('COMPLETED', 'CANCELLED')
        and a.frozen_at is null
        and (
          (v_role = 'DRIVER' and a.driver_employee_id is null)
          or (v_role = 'HELPER' and a.helper_employee_id is null)
        )
    ) t;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'mine', v_mine,
    'available', v_available
  );
end;
$$;

-- 4. Self-claim: pegawai mengambil slot role-nya pada satu FO.
--
-- Role ditentukan server (bukan dari aplikasi). Baris pegawai dan assignment
-- dikunci FOR UPDATE agar tidak ada dua claim bersamaan yang lolos validasi.
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

  if v_role = 'DRIVER' then
    if v_assignment.driver_employee_id is not null then
      raise exception 'Slot Driver pada FO ini sudah terisi.';
    end if;
    if v_assignment.helper_employee_id = p_employee_id then
      raise exception 'Anda sudah terpasang sebagai Helper pada FO ini.';
    end if;
  else
    if v_assignment.helper_employee_id is not null then
      raise exception 'Slot Helper pada FO ini sudah terisi.';
    end if;
    if v_assignment.driver_employee_id = p_employee_id then
      raise exception 'Anda sudah terpasang sebagai Driver pada FO ini.';
    end if;
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

-- Kunci eksekusi: anon/PUBLIC dicabut; authenticated hanya untuk RPC publik.
revoke all on function public.tms_epod_mobile_is_caller() from public, anon, authenticated;
revoke all on function public.tms_epod_mobile_role(text) from public, anon;
revoke all on function public.tms_epod_mobile_overview(text) from public, anon;
revoke all on function public.tms_epod_mobile_claim(uuid, text) from public, anon;

grant execute on function public.tms_epod_mobile_is_caller() to service_role;
grant execute on function public.tms_epod_mobile_role(text) to authenticated, service_role;
grant execute on function public.tms_epod_mobile_overview(text) to authenticated, service_role;
grant execute on function public.tms_epod_mobile_claim(uuid, text) to authenticated, service_role;
