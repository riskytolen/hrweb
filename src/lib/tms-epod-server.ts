import "server-only";

import { createAdminClient } from "./supabase-admin";
import { fetchFleetTaskInstantDetail, fetchFleetTaskInstantList } from "./mceasy-server";
import { normalizeFleetTaskInstantItem, type FleetTaskInstantItem } from "./fleet-task-track";
import { resolveRoutePointSequence } from "./tms-point-temperature";
import {
  normalizeEpodAssignment,
  resolveLoadingStopSequence,
  TMS_EPOD_BUCKET,
  TMS_EPOD_RETENTION_MONTHS,
  type EpodAssignment,
} from "./tms-epod";

const ASSIGNMENTS = "tms_epod_assignments";
const STOPS = "tms_epod_stops";
const SUBMISSIONS = "tms_epod_submissions";
const EVIDENCE = "tms_epod_evidence";

/** Batas FO aktif yang diproses per eksekusi. */
const MAX_ACTIVE_TASKS = 100;
/** Batas assignment yang perlu di-refresh status akhirnya per eksekusi. */
const MAX_RECONCILE = 50;
/** Ukuran batch penghapusan objek Storage. */
const STORAGE_DELETE_BATCH = 100;

export interface EpodSyncSummary {
  requestedAt: string;
  scheduledScanned: number;
  startedScanned: number;
  assignmentsCreated: number;
  assignmentsRefreshed: number;
  assignmentsReconciled: number;
  stopsUpserted: number;
  stopsRemoved: number;
  evidencePurged: number;
  failures: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Kesalahan tidak diketahui.";
}

async function fetchTasksByStatus(
  status: "SCHEDULED" | "STARTED",
): Promise<{ tasks: FleetTaskInstantItem[]; scanned: number }> {
  const result = await fetchFleetTaskInstantList({ limit: MAX_ACTIVE_TASKS, page: 1, status });
  const tasks: FleetTaskInstantItem[] = [];
  for (const raw of result.items) {
    const normalized = normalizeFleetTaskInstantItem(raw);
    if (normalized && normalized.statusRaw === status) tasks.push(normalized);
  }
  return { tasks, scanned: result.items.length };
}

/**
 * Kolom yang boleh diperbarui pada setiap sinkronisasi sebelum snapshot
 * dibekukan. `snapshot_at` sengaja tidak ikut agar waktu snapshot pertama
 * tidak tertimpa dan urutan daftar tetap stabil.
 */
function syncRow(task: FleetTaskInstantItem, nowIso: string) {
  return {
    task_number: task.number,
    task_status_raw: task.statusRaw,
    vehicle_id: task.vehicleId,
    license_plate: task.licensePlate,
    vendor_driver_name: task.driverName,
    last_synced_at: nowIso,
  };
}

/** Baris lengkap saat assignment pertama kali dibuat. */
function insertRow(task: FleetTaskInstantItem, nowIso: string) {
  return {
    task_id: task.id,
    ...syncRow(task, nowIso),
    snapshot_at: nowIso,
  };
}

/**
 * Segarkan jumlah titik pengiriman dan status assignment dari data stop.
 * Tanpa ini assignment baru akan tampil `e-POD 0/0` sampai submission
 * pertama masuk.
 */
async function recomputeAssignment(
  admin: ReturnType<typeof createAdminClient>,
  assignmentId: string,
): Promise<void> {
  const { error } = await admin.rpc("tms_epod_recompute_status", {
    p_assignment_id: assignmentId,
  });
  if (error) throw new Error(error.message);
}

function stopRows(assignmentId: string, task: FleetTaskInstantItem) {
  const loadingSequence = resolveLoadingStopSequence(task.timeline);
  return task.timeline.map((point, index) => {
    const sequence = resolveRoutePointSequence(point, index);
    return {
      assignment_id: assignmentId,
      stop_sequence: sequence,
      stop_type: sequence === loadingSequence ? "LOADING" : "DELIVERY",
      vendor_point_id: point.pointId,
      vendor_address_id: point.addressId,
      point_name: point.name,
      address: point.address,
      latitude: point.latitude,
      longitude: point.longitude,
      arrival_target: point.arrivalTarget,
      arrival_actual: point.arrivalActual,
      departure_target: point.departureTarget,
      departure_actual: point.departureActual,
      visit_status_raw: point.visitStatusRaw,
    };
  });
}

/** Buang stop yang sudah tidak ada di upstream, kecuali yang sudah punya bukti. */
async function removeStaleStops(
  admin: ReturnType<typeof createAdminClient>,
  assignmentId: string,
  keepSequences: number[],
): Promise<number> {
  const { data, error } = await admin
    .from(STOPS)
    .select("id,stop_sequence")
    .eq("assignment_id", assignmentId);
  if (error) throw new Error(error.message);

  const stale = (data ?? []).filter(
    (row) => !keepSequences.includes(Number((row as { stop_sequence: number }).stop_sequence)),
  );
  if (stale.length === 0) return 0;

  const staleIds = stale.map((row) => String((row as { id: string }).id));
  const { data: withSubmission, error: submissionError } = await admin
    .from(SUBMISSIONS)
    .select("stop_id")
    .in("stop_id", staleIds);
  if (submissionError) throw new Error(submissionError.message);

  const protectedIds = new Set((withSubmission ?? []).map((row) => String((row as { stop_id: string }).stop_id)));
  const removable = staleIds.filter((id) => !protectedIds.has(id));
  if (removable.length === 0) return 0;

  const { error: deleteError } = await admin.from(STOPS).delete().in("id", removable);
  if (deleteError) throw new Error(deleteError.message);
  return removable.length;
}

async function upsertStops(
  admin: ReturnType<typeof createAdminClient>,
  assignmentId: string,
  task: FleetTaskInstantItem,
): Promise<number> {
  const rows = stopRows(assignmentId, task);
  if (rows.length === 0) return 0;
  const { error } = await admin.from(STOPS).upsert(rows, {
    onConflict: "assignment_id,stop_sequence",
  });
  if (error) throw new Error(error.message);
  return rows.length;
}

/**
 * Salin FO aktif (SCHEDULED + STARTED) ke pool e-POD.
 *
 * Snapshot dibekukan setelah bukti pertama dikirim (`frozen_at`), sehingga
 * perubahan upstream berikutnya tidak menimpa data bukti.
 */
export async function syncActiveEpodAssignments(
  now: number = Date.now(),
): Promise<EpodSyncSummary> {
  const admin = createAdminClient();
  const nowIso = new Date(now).toISOString();
  const failures: string[] = [];

  let scheduledScanned = 0;
  let startedScanned = 0;
  let assignmentsCreated = 0;
  let assignmentsRefreshed = 0;
  let assignmentsReconciled = 0;
  let stopsUpserted = 0;
  let stopsRemoved = 0;

  const taskMap = new Map<string, FleetTaskInstantItem>();

  const settled = await Promise.allSettled([
    fetchTasksByStatus("SCHEDULED"),
    fetchTasksByStatus("STARTED"),
  ]);
  const [scheduledResult, startedResult] = settled;
  if (scheduledResult.status === "fulfilled") {
    scheduledScanned = scheduledResult.value.scanned;
    for (const task of scheduledResult.value.tasks) taskMap.set(task.id, task);
  } else {
    failures.push(`Gagal memuat FO SCHEDULED: ${errorMessage(scheduledResult.reason)}`);
  }
  if (startedResult.status === "fulfilled") {
    startedScanned = startedResult.value.scanned;
    for (const task of startedResult.value.tasks) taskMap.set(task.id, task);
  } else {
    failures.push(`Gagal memuat FO STARTED: ${errorMessage(startedResult.reason)}`);
  }

  const { data: existingRows, error: existingError } = await admin
    .from(ASSIGNMENTS)
    .select("id,task_id,frozen_at,status,task_status_raw");
  if (existingError) {
    failures.push(`Gagal membaca assignment e-POD: ${existingError.message}`);
    return {
      requestedAt: nowIso,
      scheduledScanned,
      startedScanned,
      assignmentsCreated,
      assignmentsRefreshed,
      assignmentsReconciled,
      stopsUpserted,
      stopsRemoved,
      evidencePurged: 0,
      failures,
    };
  }

  const existingByTask = new Map<string, EpodAssignment>();
  for (const row of existingRows ?? []) {
    const normalized = normalizeEpodAssignment(row);
    if (normalized) existingByTask.set(normalized.taskId, normalized);
  }

  for (const task of taskMap.values()) {
    const existing = existingByTask.get(task.id);
    try {
      if (!existing) {
        const { data: inserted, error: insertError } = await admin
          .from(ASSIGNMENTS)
          .insert(insertRow(task, nowIso))
          .select("id")
          .single();
        if (insertError || !inserted) {
          failures.push(`Gagal membuat assignment FO ${task.number ?? task.id}: ${insertError?.message ?? "tidak ada data"}`);
          continue;
        }
        assignmentsCreated += 1;
        stopsUpserted += await upsertStops(admin, String(inserted.id), task);
        await recomputeAssignment(admin, String(inserted.id));
        continue;
      }

      if (existing.frozenAt) {
        await admin
          .from(ASSIGNMENTS)
          .update({ task_status_raw: task.statusRaw, last_synced_at: nowIso })
          .eq("id", existing.id);
        continue;
      }

      const { error: updateError } = await admin
        .from(ASSIGNMENTS)
        .update(syncRow(task, nowIso))
        .eq("id", existing.id);
      if (updateError) {
        failures.push(`Gagal memperbarui assignment FO ${task.number ?? task.id}: ${updateError.message}`);
        continue;
      }
      assignmentsRefreshed += 1;
      stopsUpserted += await upsertStops(admin, existing.id, task);
      const keep = task.timeline.map((point, index) => resolveRoutePointSequence(point, index));
      stopsRemoved += await removeStaleStops(admin, existing.id, keep);
      await recomputeAssignment(admin, existing.id);
    } catch (error) {
      failures.push(`FO ${task.number ?? task.id}: ${errorMessage(error)}`);
    }
  }

  // Assignment yang sudah tidak muncul di Index (kemungkinan ENDED/CANCELED)
  // disinkronkan statusnya sekali agar tidak selamanya "STARTED".
  const orphaned = [...existingByTask.values()]
    .filter(
      (assignment) =>
        !taskMap.has(assignment.taskId) &&
        !assignment.frozenAt &&
        assignment.status !== "CANCELLED" &&
        assignment.taskStatusRaw !== "ENDED" &&
        assignment.taskStatusRaw !== "CANCELED",
    )
    .slice(0, MAX_RECONCILE);

  for (const assignment of orphaned) {
    try {
      const detail = normalizeFleetTaskInstantItem(await fetchFleetTaskInstantDetail(assignment.taskId));
      await admin
        .from(ASSIGNMENTS)
        .update({
          task_status_raw: detail?.statusRaw ?? assignment.taskStatusRaw,
          last_synced_at: nowIso,
        })
        .eq("id", assignment.id);
      assignmentsReconciled += 1;
    } catch (error) {
      failures.push(`Rekonsiliasi FO ${assignment.taskNumber ?? assignment.taskId}: ${errorMessage(error)}`);
    }
  }

  const evidencePurged = await purgeExpiredEvidence(admin, now, failures);

  return {
    requestedAt: nowIso,
    scheduledScanned,
    startedScanned,
    assignmentsCreated,
    assignmentsRefreshed,
    assignmentsReconciled,
    stopsUpserted,
    stopsRemoved,
    evidencePurged,
    failures,
  };
}

/**
 * Hapus foto bukti yang lebih tua dari masa retensi. Objek Storage dihapus
 * lebih dulu, baru baris metadata, supaya tidak ada file yatim.
 */
async function purgeExpiredEvidence(
  admin: ReturnType<typeof createAdminClient>,
  now: number,
  failures: string[],
): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - TMS_EPOD_RETENTION_MONTHS);

  const { data: expiredSubmissions, error: submissionError } = await admin
    .from(SUBMISSIONS)
    .select("id")
    .lt("captured_at_server", cutoff.toISOString())
    .is("evidence_purged_at", null)
    .limit(200);

  if (submissionError) {
    failures.push(`Gagal membaca submission kedaluwarsa: ${submissionError.message}`);
    return 0;
  }

  const submissionIds = (expiredSubmissions ?? []).map((row) => String((row as { id: string }).id));
  if (submissionIds.length === 0) return 0;

  const { data: evidenceRows, error: evidenceError } = await admin
    .from(EVIDENCE)
    .select("id,bucket_id,object_path")
    .in("submission_id", submissionIds);
  if (evidenceError) {
    failures.push(`Gagal membaca bukti kedaluwarsa: ${evidenceError.message}`);
    return 0;
  }

  const rows = (evidenceRows ?? []) as { id: string; bucket_id: string; object_path: string }[];
  const byBucket = new Map<string, string[]>();
  for (const row of rows) {
    const paths = byBucket.get(row.bucket_id) ?? [];
    paths.push(row.object_path);
    byBucket.set(row.bucket_id, paths);
  }

  for (const [bucket, paths] of byBucket) {
    for (let index = 0; index < paths.length; index += STORAGE_DELETE_BATCH) {
      const batch = paths.slice(index, index + STORAGE_DELETE_BATCH);
      const { error } = await admin.storage.from(bucket).remove(batch);
      if (error) failures.push(`Gagal menghapus foto ${bucket}: ${error.message}`);
    }
  }

  if (rows.length > 0) {
    const { error: deleteError } = await admin
      .from(EVIDENCE)
      .delete()
      .in("id", rows.map((row) => row.id));
    if (deleteError) failures.push(`Gagal menghapus metadata bukti: ${deleteError.message}`);
  }

  const { error: markError } = await admin
    .from(SUBMISSIONS)
    .update({ evidence_purged_at: new Date(now).toISOString() })
    .in("id", submissionIds);
  if (markError) failures.push(`Gagal menandai submission dibersihkan: ${markError.message}`);

  return rows.length;
}

export const TMS_EPOD_STORAGE_BUCKET = TMS_EPOD_BUCKET;
