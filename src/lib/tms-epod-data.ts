import "server-only";

import { createAdminClient } from "./supabase-admin";
import {
  EPOD_PETUGAS_ROLE_LABELS,
  normalizeEpodAssignment,
  normalizeEpodEvidence,
  normalizeEpodStop,
  normalizeEpodSubmission,
  type EpodAssignment,
  type EpodAssignmentListItem,
  type EpodEvidence,
  type EpodPetugasRole,
  type EpodStop,
  type EpodSubmission,
} from "./tms-epod";
import {
  normalizePointTemperatureList,
  type TmsRoutePointTemperature,
} from "./tms-point-temperature";

const ASSIGNMENTS = "tms_epod_assignments";
const STOPS = "tms_epod_stops";
const SUBMISSIONS = "tms_epod_submissions";
const EVIDENCE = "tms_epod_evidence";
const POINT_TEMPERATURES = "tms_route_point_temperatures";

/** Masa berlaku signed URL foto pada laporan PDF. */
const EXPORT_SIGNED_URL_TTL_SECONDS = 600;

export type { EpodAssignmentListItem };

export interface EpodAssignmentDetail {
  assignment: EpodAssignment;
  assignedName: string | null;
  assignedRoleLabel: string | null;
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

interface EpodPetugasInfo {
  nama: string;
  jabatanNama: string | null;
}

async function loadPetugasInfo(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, EpodPetugasInfo>> {
  const info = new Map<string, EpodPetugasInfo>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return info;
  const { data } = await admin
    .from("pegawai")
    .select("id,nama,jabatan:jabatan_id(nama)")
    .in("id", unique);
  for (const row of data ?? []) {
    const record = row as {
      id: string;
      nama: string;
      jabatan: { nama: string } | { nama: string }[] | null;
    };
    const jabatan = Array.isArray(record.jabatan) ? record.jabatan[0] : record.jabatan;
    info.set(String(record.id), {
      nama: String(record.nama),
      jabatanNama: jabatan ? String(jabatan.nama) : null,
    });
  }
  return info;
}

/** Label tampil role petugas: label baku untuk 4 role operasional, nama jabatan untuk OTHER. */
export function resolvePetugasRoleLabel(
  role: EpodAssignment["assignedRole"],
  jabatanNama: string | null,
): string | null {
  if (!role) return null;
  if (role === "OTHER") return jabatanNama ?? "Petugas";
  return EPOD_PETUGAS_ROLE_LABELS[role] ?? role;
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

  const info = await loadPetugasInfo(
    admin,
    assignments.map((item) => item.assignedEmployeeId).filter((v): v is string => !!v),
  );

  return {
    items: assignments.map((item) => {
      const petugas = item.assignedEmployeeId ? info.get(item.assignedEmployeeId) : undefined;
      return {
        ...item,
        assignedName: petugas?.nama ?? null,
        assignedRoleLabel: item.assignedEmployeeId
          ? resolvePetugasRoleLabel(item.assignedRole, petugas?.jabatanNama ?? null)
          : null,
      };
    }),
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

  const info = await loadPetugasInfo(
    admin,
    [assignment.assignedEmployeeId].filter((v): v is string => !!v),
  );
  const petugas = assignment.assignedEmployeeId ? info.get(assignment.assignedEmployeeId) : undefined;

  return {
    assignment,
    assignedName: petugas?.nama ?? null,
    assignedRoleLabel: assignment.assignedEmployeeId
      ? resolvePetugasRoleLabel(assignment.assignedRole, petugas?.jabatanNama ?? null)
      : null,
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

export interface EpodPetugasOption {
  id: string;
  nama: string;
  jabatanId: number | null;
  jabatanNama: string | null;
  /** Role e-POD bila jabatan termasuk mapping mobile, selain itu null (OTHER). */
  role: EpodPetugasRole | null;
  /** True bila pegawai boleh claim sendiri via aplikasi mobile. */
  mobileAllowed: boolean;
}

/**
 * Seluruh pegawai aktif untuk dropdown Petugas e-POD web. Role operasional
 * (Driver/Helper/Koordinator/Wakil Koordinator) dibaca dari mapping
 * `tms_epod_claim_roles` berbasis jabatan HRM; jabatan lain tetap bisa
 * dipilih sebagai OTHER dengan alasan wajib di sisi RPC.
 */
export async function listEpodPetugas(): Promise<EpodPetugasOption[]> {
  const admin = createAdminClient();

  const { data: roleRows, error: roleError } = await admin
    .from("tms_epod_claim_roles")
    .select("jabatan_id,role_code");
  if (roleError) throw new Error(roleError.message);
  const roleByJabatan = new Map<number, EpodPetugasRole>();
  for (const row of roleRows ?? []) {
    const record = row as { jabatan_id: number; role_code: EpodPetugasRole };
    roleByJabatan.set(Number(record.jabatan_id), record.role_code);
  }

  const { data, error } = await admin
    .from("pegawai")
    .select("id,nama,jabatan_id,jabatan:jabatan_id(nama)")
    .eq("status", "Aktif")
    .order("nama", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const record = row as {
      id: string;
      nama: string;
      jabatan_id: number | null;
      jabatan: { nama: string } | { nama: string }[] | null;
    };
    const jabatan = Array.isArray(record.jabatan) ? record.jabatan[0] : record.jabatan;
    const role =
      record.jabatan_id !== null ? (roleByJabatan.get(Number(record.jabatan_id)) ?? null) : null;
    return {
      id: String(record.id),
      nama: String(record.nama),
      jabatanId: record.jabatan_id,
      jabatanNama: jabatan ? String(jabatan.nama) : null,
      role,
      mobileAllowed: role !== null,
    };
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

export interface EpodExportEvidence extends EpodEvidence {
  signedUrl: string | null;
}

export interface EpodAssignmentExport extends EpodAssignmentDetail {
  /** Foto per submission aktif, sudah dilengkapi signed URL untuk laporan PDF. */
  evidenceBySubmission: Record<string, EpodExportEvidence[]>;
  /** Snapshot suhu kendaraan per titik rute (hasil capture otomatis). */
  pointTemperatures: TmsRoutePointTemperature[];
}

/**
 * Data lengkap satu assignment untuk laporan PDF: ringkasan, seluruh titik,
 * submission aktif tiap titik, foto bukti (signed URL 10 menit), dan suhu
 * kendaraan per titik rute.
 */
export async function getAssignmentExportData(
  assignmentId: string,
): Promise<EpodAssignmentExport | null> {
  const detail = await getAssignmentDetail(assignmentId);
  if (!detail) return null;

  const admin = createAdminClient();
  const submissionIds = Object.values(detail.currentByStop).map((submission) => submission.id);
  const evidenceBySubmission: Record<string, EpodExportEvidence[]> = {};

  if (submissionIds.length > 0) {
    const { data, error } = await admin
      .from(EVIDENCE)
      .select("*")
      .in("submission_id", submissionIds)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);

    const rows = (data ?? [])
      .map(normalizeEpodEvidence)
      .filter((item): item is EpodEvidence => item !== null);

    for (const row of rows) {
      const { data: signed } = await admin.storage
        .from(row.bucketId)
        .createSignedUrl(row.objectPath, EXPORT_SIGNED_URL_TTL_SECONDS);
      const list = evidenceBySubmission[row.submissionId] ?? [];
      list.push({ ...row, signedUrl: signed?.signedUrl ?? null });
      evidenceBySubmission[row.submissionId] = list;
    }
  }

  const { data: temperatureRows, error: temperatureError } = await admin
    .from(POINT_TEMPERATURES)
    .select("*")
    .eq("task_id", detail.assignment.taskId);
  if (temperatureError) throw new Error(temperatureError.message);
  const pointTemperatures = normalizePointTemperatureList(temperatureRows);

  return { ...detail, evidenceBySubmission, pointTemperatures };
}
