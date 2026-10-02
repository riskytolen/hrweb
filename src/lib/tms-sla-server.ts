import "server-only";

import { createAdminClient } from "./supabase-admin";
import {
  computeSlaDeltaSeconds,
  computeSlaTargetAt,
  evaluateSlaStatus,
  matchSlaRouteProfile,
  slaServiceDate,
  type SlaStatus,
} from "./tms-sla";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface SlaEvaluationSummary {
  tasksChecked: number;
  assigned: number;
  visitsUpdated: number;
}

interface OccurrenceRow {
  task_id: string;
  group_id: string;
  window_started_at: string;
  group?: { client_id: string | null } | null;
}

interface VisitLogRow {
  id: string;
  task_id: string;
  route_sequence: number;
  address_id: string | null;
  arrival_actual: string | null;
  departure_actual: string | null;
}

interface ProfileStopAddressRow {
  vendor_address_id: string;
  is_primary: boolean | null;
}

interface ProfileStopRow {
  id: string;
  target_time: string;
  target_day_offset: number | null;
  addresses?: ProfileStopAddressRow[] | null;
}

interface ProfileRow {
  id: string;
  code: string;
  group_id: string;
  departure_target_time: string | null;
  departure_day_offset: number | null;
  effective_from: string;
  effective_until: string | null;
  stops?: ProfileStopRow[] | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function profileEffectiveOn(profile: ProfileRow, serviceDate: string): boolean {
  if (profile.effective_from > serviceDate) return false;
  if (profile.effective_until && profile.effective_until < serviceDate) return false;
  return true;
}

/**
 * Evaluasi SLA untuk daftar task yang baru disinkronkan.
 * Cerminan aturan `tms_sla_backfill`: assignment profil via irisan toko,
 * baris route_sequence = 1 memakai SLA keberangkatan, tanpa toleransi,
 * tanpa actual = PENDING, tanpa target = UNSET.
 * Task tanpa profil cocok tidak disentuh (snapshot lama dipertahankan).
 */
export async function evaluateSlaForTasks(
  admin: AdminClient,
  taskIds: string[],
): Promise<SlaEvaluationSummary> {
  const summary: SlaEvaluationSummary = { tasksChecked: 0, assigned: 0, visitsUpdated: 0 };
  const uniqueTaskIds = [...new Set(taskIds.filter(Boolean))];
  if (uniqueTaskIds.length === 0) return summary;

  const { data: occurrenceRows, error: occurrenceError } = await admin
    .from("tms_live_track_task_occurrences")
    .select("task_id, group_id, window_started_at, group:tms_live_track_groups!inner(client_id)")
    .in("task_id", uniqueTaskIds)
    .order("window_started_at", { ascending: false });
  if (occurrenceError) throw new Error(`Gagal memuat occurrence SLA: ${occurrenceError.message}`);

  // Occurrence terbaru per task.
  const occurrenceByTask = new Map<string, { groupId: string; clientId: string; serviceDate: string }>();
  for (const row of asArray<OccurrenceRow>(occurrenceRows)) {
    if (!row || occurrenceByTask.has(row.task_id)) continue;
    const serviceDate = row.window_started_at ? slaServiceDate(row.window_started_at) : null;
    const clientId = row.group?.client_id ?? null;
    if (!row.group_id || !clientId || !serviceDate) continue;
    occurrenceByTask.set(row.task_id, { groupId: row.group_id, clientId, serviceDate });
  }
  if (occurrenceByTask.size === 0) return summary;

  const { data: visitRows, error: visitError } = await admin
    .from("tms_trip_visit_logs")
    .select("id, task_id, route_sequence, address_id, arrival_actual, departure_actual")
    .in("task_id", [...occurrenceByTask.keys()]);
  if (visitError) throw new Error(`Gagal memuat visit log SLA: ${visitError.message}`);

  const visitsByTask = new Map<string, VisitLogRow[]>();
  for (const row of asArray<VisitLogRow>(visitRows)) {
    if (!row || !row.id || !row.task_id) continue;
    const list = visitsByTask.get(row.task_id) ?? [];
    list.push(row);
    visitsByTask.set(row.task_id, list);
  }

  const groupIds = [...new Set([...occurrenceByTask.values()].map((o) => o.groupId))];
  const { data: profileRows, error: profileError } = await admin
    .from("tms_sla_route_profiles")
    .select(
      "id, code, group_id, departure_target_time, departure_day_offset, effective_from, effective_until, " +
        "stops:tms_sla_route_stops(id, target_time, target_day_offset, addresses:tms_sla_route_stop_addresses(vendor_address_id, is_primary))",
    )
    .in("group_id", groupIds)
    .eq("status", "Aktif");
  if (profileError) throw new Error(`Gagal memuat profil SLA: ${profileError.message}`);
  const profiles = asArray<ProfileRow>(profileRows);

  const assignments: Record<string, unknown>[] = [];
  const visitUpdates: Record<string, unknown>[] = [];

  for (const [taskId, occurrence] of occurrenceByTask) {
    summary.tasksChecked += 1;
    const visits = visitsByTask.get(taskId) ?? [];
    if (visits.length === 0) continue;

    const candidates = profiles
      .filter((p) => p.group_id === occurrence.groupId && profileEffectiveOn(p, occurrence.serviceDate))
      .map((p) => ({
        id: p.id,
        code: p.code,
        addressIds: asArray<ProfileStopRow>(p.stops).flatMap((s) =>
          asArray<ProfileStopAddressRow>(s.addresses).map((a) => a.vendor_address_id),
        ),
      }));
    const match = matchSlaRouteProfile(
      visits.filter((v) => v.route_sequence > 1).map((v) => v.address_id),
      candidates,
    );
    if (!match) continue;
    const profile = profiles.find((p) => p.id === match.profileId);
    if (!profile) continue;

    // stop_id per address (primari diutamakan) untuk snapshot baris.
    const stopByAddress = new Map<
      string,
      { stopId: string; targetTime: string; dayOffset: number; primary: boolean }
    >();
    for (const stop of asArray<ProfileStopRow>(profile.stops)) {
      for (const address of asArray<ProfileStopAddressRow>(stop.addresses)) {
        const existing = stopByAddress.get(address.vendor_address_id);
        const primary = address.is_primary === true;
        if (!existing || (primary && !existing.primary)) {
          stopByAddress.set(address.vendor_address_id, {
            stopId: stop.id,
            targetTime: stop.target_time,
            dayOffset: typeof stop.target_day_offset === "number" ? stop.target_day_offset : 0,
            primary,
          });
        }
      }
    }

    assignments.push({
      task_id: taskId,
      client_id: occurrence.clientId,
      group_id: occurrence.groupId,
      profile_id: profile.id,
      service_date: occurrence.serviceDate,
      match_score: match.score,
      match_method: "store_set_overlap",
      matched_at: new Date().toISOString(),
    });
    summary.assigned += 1;

    for (const visit of visits) {
      const isDeparture = visit.route_sequence === 1;
      const actual = isDeparture ? visit.departure_actual : visit.arrival_actual;
      let target: string | null = null;
      let stopId: string | null = null;
      if (isDeparture) {
        if (profile.departure_target_time) {
          target = computeSlaTargetAt(
            occurrence.serviceDate,
            profile.departure_target_time,
            typeof profile.departure_day_offset === "number" ? profile.departure_day_offset : 0,
          );
        }
      } else if (visit.address_id) {
        const stop = stopByAddress.get(visit.address_id);
        if (stop) {
          stopId = stop.stopId;
          target = computeSlaTargetAt(occurrence.serviceDate, stop.targetTime, stop.dayOffset);
        }
      }
      const status: SlaStatus = evaluateSlaStatus(target, actual);
      visitUpdates.push({
        id: visit.id,
        task_id: visit.task_id,
        route_sequence: visit.route_sequence,
        live_track_group_id: occurrence.groupId,
        sla_profile_id: profile.id,
        sla_route_stop_id: stopId,
        sla_kind: isDeparture ? "DEPARTURE" : "ARRIVAL",
        sla_target_at: target,
        sla_status: status,
        sla_delta_seconds: computeSlaDeltaSeconds(target, actual),
        sla_evaluated_at: new Date().toISOString(),
      });
    }
  }

  if (assignments.length > 0) {
    const { error: assignmentError } = await admin
      .from("tms_sla_task_assignments")
      .upsert(assignments, { onConflict: "task_id" });
    if (assignmentError) throw new Error(`Gagal menyimpan assignment SLA: ${assignmentError.message}`);
  }
  if (visitUpdates.length > 0) {
    // Snapshot SLA di-upsert per id baris kunjungan. Sertakan task_id dan
    // route_sequence karena keduanya wajib NOT NULL di tabel.
    const { error: updateError } = await admin
      .from("tms_trip_visit_logs")
      .upsert(visitUpdates, { onConflict: "id" });
    if (updateError) throw new Error(`Gagal menyimpan snapshot SLA: ${updateError.message}`);
  }
  summary.visitsUpdated = visitUpdates.length;
  return summary;
}
