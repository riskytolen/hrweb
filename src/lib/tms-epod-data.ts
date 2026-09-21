import "server-only";

import { createAdminClient } from "./supabase-admin";
import {
  normalizeEpodAssignment,
  normalizeEpodStop,
  normalizeEpodSubmission,
  type EpodAssignment,
  type EpodAssignmentListItem,
  type EpodStop,
  type EpodSubmission,
} from "./tms-epod";

const ASSIGNMENTS = "tms_epod_assignments";
const STOPS = "tms_epod_stops";
const SUBMISSIONS = "tms_epod_submissions";

export type { EpodAssignmentListItem };

export interface EpodAssignmentDetail {
  assignment: EpodAssignment;
  driverName: string | null;
  helperName: string | null;
  stops: EpodStop[];
  currentByStop: Record<string, EpodSubmission>;
}

export interface EpodStopDetail {
  stop: EpodStop;
  assignment: EpodAssignment;
  submissions: EpodSubmission[];
}

export interface EpodAssignmentFilters {
  search?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
}

async function loadEmployeeNames(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return names;
  const { data } = await admin.from("pegawai").select("id,nama").in("id", unique);
  for (const row of data ?? []) {
    names.set(String((row as { id: string }).id), String((row as { nama: string }).nama));
  }
  return names;
}

export async function listAssignments(
  filters: EpodAssignmentFilters,
): Promise<{ items: EpodAssignmentListItem[]; total: number }> {
  const admin = createAdminClient();
  let query = admin.from(ASSIGNMENTS).select("*", { count: "exact" });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.dateFrom) query = query.gte("snapshot_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("snapshot_at", filters.dateTo);
  if (filters.search) {
    const term = filters.search.replace(/[%,]/g, " ").trim();
    if (term) query = query.or(`task_number.ilike.%${term}%,license_plate.ilike.%${term}%`);
  }

  const from = (filters.page - 1) * filters.limit;
  const { data, count, error } = await query
    .order("snapshot_at", { ascending: false })
    .range(from, from + filters.limit - 1);

  if (error) throw new Error(error.message);

  const assignments = (data ?? [])
    .map(normalizeEpodAssignment)
    .filter((item): item is EpodAssignment => item !== null);

  const names = await loadEmployeeNames(
    admin,
    assignments.flatMap((item) => [item.driverEmployeeId, item.helperEmployeeId].filter((v): v is string => !!v)),
  );

  return {
    items: assignments.map((item) => ({
      ...item,
      driverName: item.driverEmployeeId ? names.get(item.driverEmployeeId) ?? null : null,
      helperName: item.helperEmployeeId ? names.get(item.helperEmployeeId) ?? null : null,
    })),
    total: count ?? assignments.length,
  };
}

export async function getAssignmentDetail(
  assignmentId: string,
): Promise<EpodAssignmentDetail | null> {
  const admin = createAdminClient();
  const { data: assignmentRow, error } = await admin
    .from(ASSIGNMENTS)
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const assignment = normalizeEpodAssignment(assignmentRow);
  if (!assignment) return null;

  const { data: stopRows, error: stopError } = await admin
    .from(STOPS)
    .select("*")
    .eq("assignment_id", assignmentId)
    .order("stop_sequence", { ascending: true });
  if (stopError) throw new Error(stopError.message);
  const stops = (stopRows ?? [])
    .map(normalizeEpodStop)
    .filter((item): item is EpodStop => item !== null);

  const currentByStop: Record<string, EpodSubmission> = {};
  if (stops.length > 0) {
    const { data: submissionRows, error: submissionError } = await admin
      .from(SUBMISSIONS)
      .select("*")
      .in("stop_id", stops.map((stop) => stop.id))
      .eq("is_current", true);
    if (submissionError) throw new Error(submissionError.message);
    for (const row of submissionRows ?? []) {
      const submission = normalizeEpodSubmission(row);
      if (submission) currentByStop[submission.stopId] = submission;
    }
  }

  const names = await loadEmployeeNames(
    admin,
    [assignment.driverEmployeeId, assignment.helperEmployeeId].filter((v): v is string => !!v),
  );

  return {
    assignment,
    driverName: assignment.driverEmployeeId ? names.get(assignment.driverEmployeeId) ?? null : null,
    helperName: assignment.helperEmployeeId ? names.get(assignment.helperEmployeeId) ?? null : null,
    stops,
    currentByStop,
  };
}

export async function getStopDetail(stopId: string): Promise<EpodStopDetail | null> {
  const admin = createAdminClient();
  const { data: stopRow, error } = await admin.from(STOPS).select("*").eq("id", stopId).maybeSingle();
  if (error) throw new Error(error.message);
  const stop = normalizeEpodStop(stopRow);
  if (!stop) return null;

  const { data: assignmentRow, error: assignmentError } = await admin
    .from(ASSIGNMENTS)
    .select("*")
    .eq("id", stop.assignmentId)
    .maybeSingle();
  if (assignmentError) throw new Error(assignmentError.message);
  const assignment = normalizeEpodAssignment(assignmentRow);
  if (!assignment) return null;

  const { data: submissionRows, error: submissionError } = await admin
    .from(SUBMISSIONS)
    .select("*")
    .eq("stop_id", stopId)
    .order("version", { ascending: false });
  if (submissionError) throw new Error(submissionError.message);

  return {
    stop,
    assignment,
    submissions: (submissionRows ?? [])
      .map(normalizeEpodSubmission)
      .filter((item): item is EpodSubmission => item !== null),
  };
}

export interface EpodTaskSummary {
  assignment: EpodAssignment;
  stops: EpodStop[];
  currentByStop: Record<string, EpodSubmission>;
}

export async function getAssignmentByTask(taskId: string): Promise<EpodTaskSummary | null> {
  const admin = createAdminClient();
  const { data: assignmentRow, error } = await admin
    .from(ASSIGNMENTS)
    .select("*")
    .eq("task_id", taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const assignment = normalizeEpodAssignment(assignmentRow);
  if (!assignment) return null;

  const detail = await getAssignmentDetail(assignment.id);
  if (!detail) return null;
  return { assignment: detail.assignment, stops: detail.stops, currentByStop: detail.currentByStop };
}

export interface EpodEligibleEmployee {
  id: string;
  nama: string;
  jabatanId: number | null;
}

/**
 * Daftar pegawai yang boleh dipilih untuk peran tertentu, memakai acuan
 * jabatan dari gapok_settings (Driver/Helper).
 */
export async function listEligibleEmployees(role: "DRIVER" | "HELPER"): Promise<EpodEligibleEmployee[]> {
  const admin = createAdminClient();
  const { data: settings, error: settingsError } = await admin
    .from("gapok_settings")
    .select("driver_jabatan_id,helper_jabatan_id")
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1);
  if (settingsError) throw new Error(settingsError.message);

  const setting = (settings ?? [])[0] as
    | { driver_jabatan_id: number | null; helper_jabatan_id: number | null }
    | undefined;
  const jabatanId = role === "DRIVER" ? setting?.driver_jabatan_id ?? null : setting?.helper_jabatan_id ?? null;

  let query = admin.from("pegawai").select("id,nama,jabatan_id").eq("status", "Aktif");
  if (jabatanId !== null) query = query.eq("jabatan_id", jabatanId);

  const { data, error } = await query.order("nama", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const record = row as { id: string; nama: string; jabatan_id: number | null };
    return { id: String(record.id), nama: String(record.nama), jabatanId: record.jabatan_id };
  });
}

export async function getAssignmentById(assignmentId: string): Promise<EpodAssignment | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from(ASSIGNMENTS).select("*").eq("id", assignmentId).maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeEpodAssignment(data);
}

export interface EpodStatusCounts {
  open: number;
  claimed: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  total: number;
}

/** Hitung jumlah assignment per status untuk kartu ringkasan. */
export async function countAssignmentsByStatus(): Promise<EpodStatusCounts> {
  const admin = createAdminClient();
  const statuses = ["OPEN", "CLAIMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
  const results = await Promise.all(
    statuses.map((status) =>
      admin.from(ASSIGNMENTS).select("id", { count: "exact", head: true }).eq("status", status),
    ),
  );

  const counts: Record<string, number> = {};
  for (let index = 0; index < statuses.length; index += 1) {
    const result = results[index];
    if (result.error) throw new Error(result.error.message);
    counts[statuses[index]] = result.count ?? 0;
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    open: counts.OPEN ?? 0,
    claimed: counts.CLAIMED ?? 0,
    inProgress: counts.IN_PROGRESS ?? 0,
    completed: counts.COMPLETED ?? 0,
    cancelled: counts.CANCELLED ?? 0,
    total,
  };
}
