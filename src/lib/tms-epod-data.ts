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
  type EpodLifecycleBucket,
  type EpodPetugasRole,
  type EpodStop,
  type EpodSubmission,
} from "./tms-epod";
import {
  normalizePointTemperatureList,
  type TmsRoutePointTemperature,
} from "./tms-point-temperature";
import { slaServiceDate } from "./tms-sla";
import { isRecordInScope, type ClientScope } from "./tms-tenant-auth";

const ASSIGNMENTS = "tms_epod_assignments";
const STOPS = "tms_epod_stops";
const SUBMISSIONS = "tms_epod_submissions";
const EVIDENCE = "tms_epod_evidence";
const POINT_TEMPERATURES = "tms_route_point_temperatures";

/**
 * Status FO McEasy yang ditampilkan di Monitoring e-POD: dijadwalkan,
 * berjalan, dan selesai. FO DRAFT/CANCELED tidak masuk pool monitoring.
 */
const VISIBLE_TASK_STATUSES = ["SCHEDULED", "STARTED", "ENDED"];

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
  /** Subfilter status e-POD di dalam tab terbuka (OPEN/CLAIMED/IN_PROGRESS). */
  status?: string;
  /** Tab lifecycle; tanpa bucket berarti seluruh pool monitoring. */
  bucket?: EpodLifecycleBucket;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
}

/** Status e-POD yang masih terbuka (belum COMPLETED/CANCELLED). */
const OPEN_EPOD_STATUSES = ["OPEN", "CLAIMED", "IN_PROGRESS"];

/** Trip McEasy yang masih berjalan dan boleh diklaim mandiri dari aplikasi. */
const CLAIMABLE_TRIP_STATUSES = ["SCHEDULED", "STARTED"];

function cleanSearchTerm(search?: string): string {
  if (!search) return "";
  return search.replace(/[%,]/g, " ").trim();
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

/**
 * Ubah batas filter ISO (mis. `2026-09-27T00:00:00+07:00`) menjadi tanggal
 * operasional YYYY-MM-DD dalam zona Asia/Jakarta.
 */
export function operationalDateBound(value: string | undefined): string | null {
  if (!value) return null;
  const viaService = slaServiceDate(value);
  if (viaService) return viaService;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
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
  clientScope: ClientScope = "all",
): Promise<{ items: EpodAssignmentListItem[]; total: number }> {
  if (clientScope !== "all" && clientScope.length === 0) {
    return { items: [], total: 0 };
  }
  const admin = createAdminClient();
  let query = admin
    .from(ASSIGNMENTS)
    .select("*, client:tms_clients(code, slug, name)", { count: "exact" })
    // Monitoring hanya menampilkan FO Dijadwalkan/Berjalan/Selesai.
    .in("task_status_raw", VISIBLE_TASK_STATUSES);

  if (clientScope !== "all") query = query.in("client_id", clientScope);

  // Tab lifecycle memisahkan status perjalanan dari status bukti e-POD.
  // Bucket saling eksklusif agar satu FO tidak muncul di dua tab.
  if (filters.bucket === "ACTIONABLE") {
    query = query.in("status", OPEN_EPOD_STATUSES).in("task_status_raw", CLAIMABLE_TRIP_STATUSES);
  } else if (filters.bucket === "TRIP_ENDED_PENDING") {
    query = query.in("status", OPEN_EPOD_STATUSES).eq("task_status_raw", "ENDED");
  } else if (filters.bucket === "EPOD_COMPLETED") {
    query = query.eq("status", "COMPLETED");
  } else if (filters.bucket === "CANCELLED") {
    query = query.eq("status", "CANCELLED");
  }

  if (filters.status) query = query.eq("status", filters.status);
  const fromDate = operationalDateBound(filters.dateFrom);
  const toDate = operationalDateBound(filters.dateTo);
  if (fromDate) query = query.gte("operational_date", fromDate);
  if (toDate) query = query.lte("operational_date", toDate);
  if (filters.search) {
    const term = cleanSearchTerm(filters.search);
    if (term) query = query.or(`task_number.ilike.%${term}%,license_plate.ilike.%${term}%`);
  }

  const from = (filters.page - 1) * filters.limit;
  const { data, count, error } = await query
    .order("operational_date", { ascending: false, nullsFirst: false })
    .order("snapshot_at", { ascending: false })
    .range(from, from + filters.limit - 1);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Record<string, unknown>[];
  const assignments = rows
    .map((row) => {
      const item = normalizeEpodAssignment(row);
      if (!item) return null;
      const client =
        row.client && typeof row.client === "object"
          ? (row.client as { code?: unknown; slug?: unknown; name?: unknown })
          : null;
      const text = (value: unknown, max: number): string | null => {
        const str = typeof value === "string" ? value.trim() : "";
        return str ? str.slice(0, max) : null;
      };
      return {
        item,
        clientCode: text(client?.code, 40),
        clientSlug: text(client?.slug, 60),
        clientName: text(client?.name, 120),
      };
    })
    .filter((entry): entry is { item: EpodAssignment; clientCode: string | null; clientSlug: string | null; clientName: string | null } => entry !== null);

  const info = await loadPetugasInfo(
    admin,
    assignments.map((entry) => entry.item.assignedEmployeeId).filter((v): v is string => !!v),
  );

  return {
    items: assignments.map((entry) => {
      const petugas = entry.item.assignedEmployeeId ? info.get(entry.item.assignedEmployeeId) : undefined;
      return {
        ...entry.item,
        clientCode: entry.clientCode,
        clientSlug: entry.clientSlug,
        clientName: entry.clientName,
        assignedName: petugas?.nama ?? null,
        assignedRoleLabel: entry.item.assignedEmployeeId
          ? resolvePetugasRoleLabel(entry.item.assignedRole, petugas?.jabatanNama ?? null)
          : null,
      };
    }),
    total: count ?? assignments.length,
  };
}

export async function getAssignmentDetail(
  assignmentId: string,
  clientScope: ClientScope = "all",
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
  // Endpoint detail lintas client dikembalikan sebagai tidak ada (404 di route).
  if (!isRecordInScope(assignment.clientId, clientScope)) return null;

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

export async function getStopDetail(
  stopId: string,
  clientScope: ClientScope = "all",
): Promise<EpodStopDetail | null> {
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
  if (!isRecordInScope(assignment.clientId, clientScope)) return null;

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

export async function getAssignmentByTask(
  taskId: string,
  clientScope: ClientScope = "all",
): Promise<EpodTaskSummary | null> {
  const admin = createAdminClient();
  const { data: assignmentRow, error } = await admin
    .from(ASSIGNMENTS)
    .select("*")
    .eq("task_id", taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const assignment = normalizeEpodAssignment(assignmentRow);
  if (!assignment) return null;
  if (!isRecordInScope(assignment.clientId, clientScope)) return null;

  const detail = await getAssignmentDetail(assignment.id, clientScope);
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
      record.jabatan_id !== null ? (roleByJabatan.get(Number(record.jabatan_id)) ?? "OTHER") : "OTHER";
    return {
      id: String(record.id),
      nama: String(record.nama),
      jabatanId: record.jabatan_id,
      jabatanNama: jabatan ? String(jabatan.nama) : null,
      role,
      mobileAllowed: true,
    };
  });
}

export async function getAssignmentById(
  assignmentId: string,
  clientScope: ClientScope = "all",
): Promise<EpodAssignment | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from(ASSIGNMENTS).select("*").eq("id", assignmentId).maybeSingle();
  if (error) throw new Error(error.message);
  const assignment = normalizeEpodAssignment(data);
  if (!assignment) return null;
  if (!isRecordInScope(assignment.clientId, clientScope)) return null;
  return assignment;
}

export interface EpodLifecycleCounts {
  actionable: number;
  tripEndedPending: number;
  epodCompleted: number;
  cancelled: number;
  total: number;
}

export interface EpodCountFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Hitung jumlah assignment per bucket lifecycle untuk kartu/tab ringkasan.
 * Mengikuti filter global (search, client, tanggal) agar angka konsisten
 * dengan daftar yang ditampilkan.
 */
export async function countAssignmentsByLifecycle(
  filters: EpodCountFilters = {},
  clientScope: ClientScope = "all",
): Promise<EpodLifecycleCounts> {
  const zero: EpodLifecycleCounts = {
    actionable: 0,
    tripEndedPending: 0,
    epodCompleted: 0,
    cancelled: 0,
    total: 0,
  };
  if (clientScope !== "all" && clientScope.length === 0) return zero;
  const admin = createAdminClient();
  const term = cleanSearchTerm(filters.search);

  function baseQuery() {
    return admin
      .from(ASSIGNMENTS)
      .select("id", { count: "exact", head: true })
      .in("task_status_raw", VISIBLE_TASK_STATUSES);
  }
  const bucketQueries: Record<EpodLifecycleBucket, () => ReturnType<typeof baseQuery>> = {
    ACTIONABLE: () => baseQuery().in("status", OPEN_EPOD_STATUSES).in("task_status_raw", CLAIMABLE_TRIP_STATUSES),
    TRIP_ENDED_PENDING: () => baseQuery().in("status", OPEN_EPOD_STATUSES).eq("task_status_raw", "ENDED"),
    EPOD_COMPLETED: () => baseQuery().eq("status", "COMPLETED"),
    CANCELLED: () => baseQuery().eq("status", "CANCELLED"),
  };

  const countFromDate = operationalDateBound(filters.dateFrom);
  const countToDate = operationalDateBound(filters.dateTo);
  const results = await Promise.all(
    (Object.keys(bucketQueries) as EpodLifecycleBucket[]).map((bucket) => {
      let query = bucketQueries[bucket]();
      if (clientScope !== "all") query = query.in("client_id", clientScope);
      if (countFromDate) query = query.gte("operational_date", countFromDate);
      if (countToDate) query = query.lte("operational_date", countToDate);
      if (term) query = query.or(`task_number.ilike.%${term}%,license_plate.ilike.%${term}%`);
      return query;
    }),
  );

  const keys: EpodLifecycleBucket[] = ["ACTIONABLE", "TRIP_ENDED_PENDING", "EPOD_COMPLETED", "CANCELLED"];
  const out: Record<string, number> = {};
  for (let index = 0; index < keys.length; index += 1) {
    const result = results[index];
    if (result.error) throw new Error(result.error.message);
    out[keys[index]] = result.count ?? 0;
  }

  const actionable = out.ACTIONABLE ?? 0;
  const tripEndedPending = out.TRIP_ENDED_PENDING ?? 0;
  const epodCompleted = out.EPOD_COMPLETED ?? 0;
  const cancelled = out.CANCELLED ?? 0;
  return {
    actionable,
    tripEndedPending,
    epodCompleted,
    cancelled,
    total: actionable + tripEndedPending + epodCompleted + cancelled,
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
  clientScope: ClientScope = "all",
): Promise<EpodAssignmentExport | null> {
  const detail = await getAssignmentDetail(assignmentId, clientScope);
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
