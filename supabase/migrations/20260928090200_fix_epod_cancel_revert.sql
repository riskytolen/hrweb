-- Perbaiki revert assignment e-POD yang macet di CANCELLED.
--
-- Akar masalah: `tms_epod_cancel_assignment` tidak mencegah cancel ulang,
-- sehingga event `assignment_cancelled` bisa tercatat dengan
-- old_status = CANCELLED. Fungsi revert selalu membaca event cancel terakhir,
-- lalu mengembalikan status ke CANCELLED lagi dan `tms_epod_recompute_status`
-- langsung berhenti karena guard CANCELLED.
--
-- Perbaikan:
-- 1. Cancel menolak assignment yang sudah CANCELLED (tidak membuat event baru).
-- 2. Revert mengabaikan event cancel yang old_status-nya CANCELLED, sehingga
--    status sebelum pembatalan yang valid tetap ditemukan.

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

create or replace function public.tms_epod_revert_cancellation(
  p_assignment_id uuid,
  p_actor_user uuid
)
returns public.tms_epod_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.tms_epod_assignments%rowtype;
  v_updated public.tms_epod_assignments%rowtype;
  v_actor_role text;
  v_prev_status text;
  v_cancel_event_id bigint;
  v_next_status text;
begin
  if not public.tms_epod_is_manager(p_actor_user) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_assignment_id is null then
    raise exception 'Assignment e-POD tidak valid.';
  end if;

  select * into v_current
  from public.tms_epod_assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'Assignment e-POD tidak ditemukan.';
  end if;

  if v_current.status <> 'CANCELLED' then
    raise exception 'Assignment e-POD tidak sedang dibatalkan.';
  end if;

  -- Status sebelum dibatalkan, dari event pembatalan terakhir yang valid.
  -- Event cancel ulang (old_status = CANCELLED) diabaikan agar revert tidak
  -- mengembalikan status ke CANCELLED lagi.
  select e.old_status, e.id
  into v_prev_status, v_cancel_event_id
  from public.tms_epod_events e
  where e.assignment_id = p_assignment_id
    and e.event_type = 'assignment_cancelled'
    and e.old_status is distinct from 'CANCELLED'
  order by e.created_at desc, e.id desc
  limit 1;

  -- Lepas dari CANCELLED lebih dulu; recompute menentukan status sebenarnya.
  update public.tms_epod_assignments
  set status = coalesce(v_prev_status, 'OPEN'),
      updated_at = now()
  where id = p_assignment_id;

  v_next_status := public.tms_epod_recompute_status(p_assignment_id);

  select * into v_updated
  from public.tms_epod_assignments
  where id = p_assignment_id;

  select r.nama into v_actor_role
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id
  where up.id = p_actor_user;

  insert into public.tms_epod_events (
    assignment_id, event_type, actor_user_id, actor_role, old_status, new_status, payload
  ) values (
    p_assignment_id, 'assignment_cancelled_reverted', p_actor_user, v_actor_role,
    'CANCELLED', v_next_status,
    jsonb_build_object(
      'previous_status', v_prev_status,
      'restored_status', v_next_status,
      'cancel_event_id', v_cancel_event_id
    )
  );

  return v_updated;
end;
$$;

revoke all on function public.tms_epod_cancel_assignment(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tms_epod_cancel_assignment(uuid, text, uuid) to service_role;
revoke all on function public.tms_epod_revert_cancellation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tms_epod_revert_cancellation(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
