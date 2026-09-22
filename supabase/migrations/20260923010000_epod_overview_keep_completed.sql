-- e-POD mobile overview: FO yang sudah COMPLETED tetap tampil di "FO Saya".
--
-- Masalah: `mine` sebelumnya memfilter `status not in ('COMPLETED','CANCELLED')`
-- sehingga FO langsung hilang dari aplikasi begitu semua titik selesai dan
-- petugas tidak bisa lagi membuka detail bukti yang sudah dikirim.
--
-- Aturan baru:
-- - `mine`: semua FO yang masih terpasang ke pegawai, kecuali CANCELLED.
--   FO aktif diurutkan di atas, FO selesai di bawah.
-- - `available`: tetap kosong bila pegawai masih punya FO *aktif*
--   (COMPLETED tidak menghalangi klaim FO baru).

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
      case when a.status = 'COMPLETED' then 1 else 0 end as is_completed
    from public.tms_epod_assignments a
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
