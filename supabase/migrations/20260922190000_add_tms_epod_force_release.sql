-- Force release: reset e-POD & lepas petugas walau evidence sudah dikirim.
--
-- Risiko disengaja: seluruh foto bukti dan submission pada assignment ini
-- dihapus permanen (file Storage dihapus Route Handler sebelum/bersama RPC
-- memakai path yang dibaca lebih dulu). Riwayat aksi tetap tersimpan di
-- `tms_epod_events` (alasan, petugas lama, jumlah submission/evidence).
--
-- Setelah RPC: petugas kosong, frozen dibuka, loading kembali PENDING,
-- status recomputed ke OPEN sehingga FO bisa diklaim/dikerjakan ulang.
-- Hanya service_role yang boleh mengeksekusi.

create or replace function public.tms_epod_force_release(
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
  v_assignment public.tms_epod_assignments%rowtype;
  v_updated public.tms_epod_assignments%rowtype;
  v_actor_role text;
  v_old_status text;
  v_old_employee_id text;
  v_old_role text;
  v_submission_count integer;
  v_evidence_count integer;
  v_next_status text;
begin
  if not public.tms_epod_is_manager(p_actor_user) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_assignment_id is null then
    raise exception 'Assignment e-POD tidak valid.';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Alasan reset e-POD wajib diisi.';
  end if;

  select * into v_assignment
  from public.tms_epod_assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment e-POD tidak ditemukan.';
  end if;

  if v_assignment.status = 'CANCELLED' then
    raise exception 'Assignment yang dibatalkan tidak bisa di-reset. Kembalikan dulu bila perlu.';
  end if;

  v_old_status := v_assignment.status;
  v_old_employee_id := v_assignment.assigned_employee_id;
  v_old_role := v_assignment.assigned_role;

  select count(*)
  into v_submission_count
  from public.tms_epod_submissions sub
  join public.tms_epod_stops st on st.id = sub.stop_id
  where st.assignment_id = p_assignment_id;

  select count(*)
  into v_evidence_count
  from public.tms_epod_evidence ev
  join public.tms_epod_submissions sub on sub.id = ev.submission_id
  join public.tms_epod_stops st on st.id = sub.stop_id
  where st.assignment_id = p_assignment_id;

  delete from public.tms_epod_evidence ev
  using public.tms_epod_submissions sub, public.tms_epod_stops st
  where ev.submission_id = sub.id
    and sub.stop_id = st.id
    and st.assignment_id = p_assignment_id;

  delete from public.tms_epod_submissions sub
  using public.tms_epod_stops st
  where sub.stop_id = st.id
    and st.assignment_id = p_assignment_id;

  update public.tms_epod_assignments
  set assigned_employee_id = null,
      assigned_role = null,
      assigned_source = null,
      assigned_reason = null,
      assigned_at = null,
      assigned_jabatan_id = null,
      frozen_at = null,
      loading_status = 'PENDING_LOADING',
      loading_completed_at = null,
      delivery_done_count = 0,
      updated_at = now()
  where id = p_assignment_id;

  v_next_status := public.tms_epod_recompute_status(p_assignment_id);

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_epod_events (
    assignment_id, event_type, actor_user_id, actor_role,
    old_status, new_status, payload
  ) values (
    p_assignment_id,
    'assignment_force_released',
    p_actor_user,
    v_actor_role,
    v_old_status,
    v_next_status,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'previous_employee_id', v_old_employee_id,
      'previous_role', v_old_role,
      'submission_count', v_submission_count,
      'evidence_count', v_evidence_count
    )
  );

  select * into v_updated
  from public.tms_epod_assignments
  where id = p_assignment_id;

  return v_updated;
end;
$$;

revoke all on function public.tms_epod_force_release(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tms_epod_force_release(uuid, text, uuid) to service_role;
