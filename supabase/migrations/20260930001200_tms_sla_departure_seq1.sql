-- SLA: titik keberangkatan dikenali dari route_sequence = 1.
--
-- Data McEasy pada arsip Logger Trips menyimpan point_type 'DEFAULT'
-- untuk gudang (titik START hanya ada pada snapshot timeline detail),
-- sehingga baris gudang sempat dinilai sebagai ARRIVAL dan berstatus
-- UNSET. Kini baris pertama rute selalu memakai SLA keberangkatan
-- (departure_actual vs departure_target_time profil) dan dikeluarkan
-- dari himpunan pencocokan profil.

create or replace function public.tms_sla_backfill(p_since date default '2026-09-29')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_task_addrs text[];
  v_task_count integer;
  v_profile_id uuid;
  v_matched integer;
  v_score numeric;
  v_tasks integer := 0;
  v_assigned integer := 0;
  v_visits integer := 0;
  v_rows integer := 0;
begin
  for r in
    select distinct on (o.task_id)
      o.task_id,
      o.group_id,
      g.client_id,
      (o.window_started_at at time zone 'Asia/Jakarta')::date as service_date
    from public.tms_live_track_task_occurrences o
    join public.tms_live_track_groups g on g.id = o.group_id
    where (o.window_started_at at time zone 'Asia/Jakarta')::date >= p_since
    order by o.task_id, o.window_started_at desc
  loop
    v_tasks := v_tasks + 1;

    select coalesce(array_agg(distinct l.address_id), '{}')
      into v_task_addrs
    from public.tms_trip_visit_logs l
    where l.task_id = r.task_id
      and l.address_id is not null
      and l.route_sequence > 1;

    v_task_count := coalesce(array_length(v_task_addrs, 1), 0);
    if v_task_count = 0 then
      continue;
    end if;

    select p.id, count(distinct a.vendor_address_id) as matched
      into v_profile_id, v_matched
    from public.tms_sla_route_profiles p
    join public.tms_sla_route_stops s on s.profile_id = p.id
    join public.tms_sla_route_stop_addresses a on a.route_stop_id = s.id
    where p.group_id = r.group_id
      and p.status = 'Aktif'
      and p.effective_from <= r.service_date
      and (p.effective_until is null or p.effective_until >= r.service_date)
      and a.vendor_address_id = any (v_task_addrs)
    group by p.id
    order by count(distinct a.vendor_address_id) desc, p.code asc
    limit 1;

    if v_profile_id is null then
      continue;
    end if;
    v_score := v_matched::numeric / v_task_count::numeric;
    if v_matched < 1 or v_score < 0.5 then
      v_profile_id := null;
      continue;
    end if;

    insert into public.tms_sla_task_assignments
      (task_id, client_id, group_id, profile_id, service_date, match_score, match_method, matched_at)
    values
      (r.task_id, r.client_id, r.group_id, v_profile_id, r.service_date, v_score, 'store_set_overlap', now())
    on conflict (task_id) do update set
      client_id = excluded.client_id,
      group_id = excluded.group_id,
      profile_id = excluded.profile_id,
      service_date = excluded.service_date,
      match_score = excluded.match_score,
      match_method = excluded.match_method,
      matched_at = now();
    v_assigned := v_assigned + 1;

    with computed as (
      select
        l2.id as visit_id,
        case when l2.route_sequence = 1 then 'DEPARTURE' else 'ARRIVAL' end as kind,
        case when l2.route_sequence = 1 then l2.departure_actual else l2.arrival_actual end as actual,
        case
          when l2.route_sequence = 1 then
            case when prof.departure_target_time is null then null
              else (((r.service_date + prof.departure_target_time) + make_interval(days => prof.departure_day_offset)) at time zone 'Asia/Jakarta')
            end
          else
            case when m.stop_id is null then null
              else (((r.service_date + m.target_time) + make_interval(days => m.target_day_offset)) at time zone 'Asia/Jakarta')
            end
        end as target,
        m.stop_id as stop_id
      from public.tms_trip_visit_logs l2
      cross join (
        select departure_target_time, departure_day_offset
        from public.tms_sla_route_profiles
        where id = v_profile_id
      ) prof
      left join lateral (
        select s.id as stop_id, s.target_time, s.target_day_offset
        from public.tms_sla_route_stops s
        join public.tms_sla_route_stop_addresses a on a.route_stop_id = s.id
        where s.profile_id = v_profile_id
          and a.vendor_address_id = l2.address_id
        order by a.is_primary desc
        limit 1
      ) m on true
      where l2.task_id = r.task_id
    )
    update public.tms_trip_visit_logs l
    set live_track_group_id = r.group_id,
        sla_profile_id = v_profile_id,
        sla_route_stop_id = computed.stop_id,
        sla_kind = computed.kind,
        sla_target_at = computed.target,
        sla_status = case
          when computed.target is null then 'UNSET'
          when computed.actual is null then 'PENDING'
          when computed.actual <= computed.target then 'ON_TIME'
          else 'LATE'
        end,
        sla_delta_seconds = case
          when computed.target is not null and computed.actual is not null
            then floor(extract(epoch from (computed.actual - computed.target)))::integer
          else null
        end,
        sla_evaluated_at = now()
    from computed
    where l.id = computed.visit_id;

    get diagnostics v_rows = row_count;
    v_visits := v_visits + v_rows;
  end loop;

  return jsonb_build_object(
    'tasks', v_tasks,
    'assigned', v_assigned,
    'visits_updated', v_visits
  );
end;
$$;

revoke all on function public.tms_sla_backfill(date) from public, anon, authenticated;
grant execute on function public.tms_sla_backfill(date) to service_role;

-- Hitung ulang snapshot dengan aturan route_sequence = 1.
select public.tms_sla_backfill('2026-09-29');

notify pgrst, 'reload schema';
