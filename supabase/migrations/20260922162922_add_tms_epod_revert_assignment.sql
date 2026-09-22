-- Kembalikan assignment e-POD yang sudah dibatalkan (admin override).
--
-- Pembatalan hanya mengubah `status` + mencatat event, jadi bisa dibalik.
-- Status dikembalikan ke kondisi sebenarnya lewat `tms_epod_recompute_status`
-- (roster/submission/loading) sehingga tidak bergantung pada tebakan aplikasi.
-- Hanya service_role yang boleh mengeksekusi; Route Handler memanggilnya
-- setelah permission pengelola diverifikasi.

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

  -- Status sebelum dibatalkan, dari event pembatalan terakhir.
  select e.old_status, e.id
  into v_prev_status, v_cancel_event_id
  from public.tms_epod_events e
  where e.assignment_id = p_assignment_id
    and e.event_type = 'assignment_cancelled'
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

revoke all on function public.tms_epod_revert_cancellation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tms_epod_revert_cancellation(uuid, uuid) to service_role;
