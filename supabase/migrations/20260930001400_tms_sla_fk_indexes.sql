-- SLA: index penutup foreign key (temuan database linter).
create index if not exists tms_sla_task_assignments_client_idx
  on public.tms_sla_task_assignments (client_id);
create index if not exists tms_sla_task_assignments_group_idx
  on public.tms_sla_task_assignments (group_id);
create index if not exists tms_trip_visit_logs_live_track_group_idx
  on public.tms_trip_visit_logs (live_track_group_id);
create index if not exists tms_trip_visit_logs_sla_stop_idx
  on public.tms_trip_visit_logs (sla_route_stop_id);

notify pgrst, 'reload schema';
