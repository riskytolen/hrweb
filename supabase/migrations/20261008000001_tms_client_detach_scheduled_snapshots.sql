-- TMS multi-client: detach juga mencakup snapshot SCHEDULED (perjalanan
-- yang belum terjadi bukan riwayat). Menutup loop re-attach pada assignment
-- e-POD dari unit yang sudah keluar dari kelompok.
create or replace function public.tms_client_detach_removed_unit_data(
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignments integer := 0;
  v_snapshots integer := 0;
  v_occurrences integer := 0;
  v_stops integer := 0;
  v_submissions integer := 0;
  v_evidence integer := 0;
  v_events integer := 0;
begin
  if p_client_id is null then
    return jsonb_build_object('detached', false, 'reason', 'no_client');
  end if;

  update public.tms_epod_assignments a
  set client_id = null, updated_at = now()
  where a.client_id = p_client_id
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED')
    and not public.tms_client_unit_in_active_group(p_client_id, a.vehicle_id, a.license_plate);
  get diagnostics v_assignments = row_count;

  update public.tms_live_track_task_snapshots s
  set client_id = null, updated_at = now()
  where s.client_id = p_client_id
    and s.status_raw in ('SCHEDULED', 'STARTED')
    and not public.tms_client_unit_in_active_group(p_client_id, s.vehicle_id, s.license_plate);
  get diagnostics v_snapshots = row_count;

  update public.tms_live_track_task_occurrences o
  set client_id = null, updated_at = now()
  from public.tms_live_track_task_snapshots s
  where o.task_id = s.task_id
    and o.client_id = p_client_id
    and o.visible_until > now()
    and not public.tms_client_unit_in_active_group(p_client_id, s.vehicle_id, s.license_plate);
  get diagnostics v_occurrences = row_count;

  update public.tms_epod_stops s
  set client_id = null, updated_at = now()
  from public.tms_epod_assignments a
  where s.assignment_id = a.id
    and s.client_id = p_client_id
    and a.client_id is null
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED');
  get diagnostics v_stops = row_count;

  update public.tms_epod_submissions su
  set client_id = null
  from public.tms_epod_stops s
  join public.tms_epod_assignments a on a.id = s.assignment_id
  where su.stop_id = s.id
    and su.client_id = p_client_id
    and a.client_id is null
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED');
  get diagnostics v_submissions = row_count;

  update public.tms_epod_evidence e
  set client_id = null
  from public.tms_epod_submissions su
  join public.tms_epod_stops s on s.id = su.stop_id
  join public.tms_epod_assignments a on a.id = s.assignment_id
  where e.submission_id = su.id
    and e.client_id = p_client_id
    and a.client_id is null
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED');
  get diagnostics v_evidence = row_count;

  update public.tms_epod_events e
  set client_id = null
  from public.tms_epod_assignments a
  where e.assignment_id = a.id
    and e.client_id = p_client_id
    and a.client_id is null
    and a.status in ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    and a.task_status_raw in ('SCHEDULED', 'STARTED');
  get diagnostics v_events = row_count;

  return jsonb_build_object(
    'detached', true,
    'assignments', v_assignments,
    'snapshots', v_snapshots,
    'occurrences', v_occurrences,
    'stops', v_stops,
    'submissions', v_submissions,
    'evidence', v_evidence,
    'events', v_events
  );
end;
$$;

revoke all on function public.tms_client_detach_removed_unit_data(uuid) from public, anon, authenticated;
grant execute on function public.tms_client_detach_removed_unit_data(uuid) to service_role;

select public.tms_client_sweep_stale_assignments(1000);

notify pgrst, 'reload schema';
