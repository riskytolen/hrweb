import "server-only";

import { createAdminClient } from "./supabase-admin";
import { stampUnmappedTmsRows } from "./tms-tenant-sync-server";
import {
  fetchFleetTaskInstantList,
  type FleetTaskInstantStatus,
} from "./mceasy-server";
import { normalizeTaskTripVisits, type TmsTripVisit } from "./tms-trip-logger";
import { normalizeFleetTaskInstantItem } from "./fleet-task-track";
import { evaluateSlaForTasks } from "./tms-sla-server";

export interface TripLoggerSyncSummary {
  requestedAt: string;
  mode: "incremental" | "backfill";
  tasksChecked: number;
  visitsFound: number;
  visitsInWindow: number;
  rowsInserted: number;
  rowsUpdated: number;
  reconciledTasks: number;
  truncated: boolean;
  failures: string[];
  slaTasks: number;
  slaAssigned: number;
  slaVisits: number;
}

interface SyncOptions {
  mode?: "incremental" | "backfill";
  /** Rentang backfill dalam hari (default 7). */
  days?: number;
  /** Batas halaman upstream yang dipindai saat backfill. */
  maxPages?: number;
  now?: number;
}

const INCREMENTAL_STARTED_LIMIT = 100;
const INCREMENTAL_ENDED_LIMIT = 50;
const UPSTREAM_PAGE_LIMIT = 100;
const DEFAULT_BACKFILL_PAGES = 30;
const RECONCILE_TASK_LIMIT = 50;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Kesalahan tidak diketahui.";
}

function toRowPayload(visit: TmsTripVisit): Record<string, unknown> {
  return {
    task_id: visit.taskId,
    task_number: visit.taskNumber,
    task_status: visit.taskStatus,
    vehicle_id: visit.vehicleId,
    license_plate: visit.unit,
    driver_name: visit.driverName,
    route_sequence: visit.routeSequence,
    point_id: visit.pointId,
    address_id: visit.addressId,
    point_type: visit.pointType,
    location_name: visit.locationName,
    location_address: visit.locationAddress,
    latitude: visit.latitude,
    longitude: visit.longitude,
    visit_status: visit.visitStatusName,
    arrival_actual: visit.arrivalActual,
    departure_actual: visit.departureActual,
    source: "MCEASY_TIMELINE",
  };
}

async function upsertVisitRows(
  admin: ReturnType<typeof createAdminClient>,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };
  const { data, error } = await admin.rpc("tms_trip_visit_log_upsert", { p_rows: rows });
  if (error) throw new Error(`Gagal menyimpan log kunjungan: ${error.message}`);
  const payload = data as { inserted?: unknown; updated?: unknown } | null;
  const inserted = typeof payload?.inserted === "number" ? payload.inserted : 0;
  const updated = typeof payload?.updated === "number" ? payload.updated : 0;
  return { inserted, updated };
}

interface CollectedTask {
  raw: unknown;
  id: string;
}

/** Kumpulkan task mentah berstatus tertentu dari endpoint Index. */
async function collectTasksByStatus(
  status: FleetTaskInstantStatus,
  limit: number,
  page: number,
  summary: TripLoggerSyncSummary,
): Promise<CollectedTask[]> {
  try {
    const result = await fetchFleetTaskInstantList({ limit, page, status, sort: "created_on desc" });
    const tasks: CollectedTask[] = [];
    for (const raw of result.items) {
      const normalized = normalizeFleetTaskInstantItem(raw);
      if (normalized && normalized.statusRaw === status) {
        tasks.push({ raw, id: normalized.id });
      }
    }
    return tasks;
  } catch (error) {
    summary.failures.push(`Daftar task ${status} halaman ${page}: ${errorMessage(error)}`);
    return [];
  }
}

/**
 * Sinkronisasi log kunjungan dari timeline McEasy ke Supabase.
 *
 * Mode incremental: task STARTED + ENDED terbaru, lalu rekonsiliasi visit
 * yang masih ONGOING di database tetapi task-nya tidak lagi aktif.
 * Mode backfill: pindai halaman task terbaru dan simpan visit yang
 * timestamp-nya berada dalam rentang hari yang diminta.
 */
export async function syncTripVisitLogs(options: SyncOptions = {}): Promise<TripLoggerSyncSummary> {
  const mode = options.mode ?? "incremental";
  const now = options.now ?? Date.now();
  const admin = createAdminClient();
  const summary: TripLoggerSyncSummary = {
    requestedAt: new Date(now).toISOString(),
    mode,
    tasksChecked: 0,
    visitsFound: 0,
    visitsInWindow: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    reconciledTasks: 0,
    truncated: false,
    failures: [],
    slaTasks: 0,
    slaAssigned: 0,
    slaVisits: 0,
  };

  const windowStartMs = now - (options.days ?? 7) * 24 * 60 * 60 * 1000;

  const collectRows = (tasks: CollectedTask[]): Record<string, unknown>[] => {
    const rows: Record<string, unknown>[] = [];
    for (const task of tasks) {
      summary.tasksChecked += 1;
      try {
        const normalized = normalizeFleetTaskInstantItem(task.raw);
        if (!normalized) continue;
        for (const visit of normalizeTaskTripVisits(normalized)) {
          summary.visitsFound += 1;
          if (mode === "backfill") {
            const arrivalMs = visit.arrivalActual ? Date.parse(visit.arrivalActual) : NaN;
            const departureMs = visit.departureActual ? Date.parse(visit.departureActual) : NaN;
            const inWindow =
              (!Number.isNaN(arrivalMs) && arrivalMs >= windowStartMs) ||
              (!Number.isNaN(departureMs) && departureMs >= windowStartMs);
            if (!inWindow) continue;
          }
          summary.visitsInWindow += 1;
          rows.push(toRowPayload(visit));
        }
      } catch (error) {
        summary.failures.push(`Task ${task.id}: ${errorMessage(error)}`);
      }
    }
    return rows;
  };

  const flush = async (rows: Record<string, unknown>[]) => {
    try {
      const { inserted, updated } = await upsertVisitRows(admin, rows);
      summary.rowsInserted += inserted;
      summary.rowsUpdated += updated;
    } catch (error) {
      summary.failures.push(errorMessage(error));
    }
  };

  if (mode === "backfill") {
    const maxPages = options.maxPages ?? DEFAULT_BACKFILL_PAGES;
    for (const status of ["STARTED", "ENDED"] as const) {
      for (let page = 1; page <= maxPages; page += 1) {
        const tasks = await collectTasksByStatus(status, UPSTREAM_PAGE_LIMIT, page, summary);
        if (tasks.length === 0) break;
        await flush(collectRows(tasks));
        if (tasks.length < UPSTREAM_PAGE_LIMIT) break;
        if (page === maxPages) summary.truncated = true;
      }
    }
    await stampUnmappedTmsRows(admin);
    return summary;
  }

  // Incremental: STARTED untuk kunjungan berjalan, ENDED terbaru untuk departure terakhir.
  const started = await collectTasksByStatus("STARTED", INCREMENTAL_STARTED_LIMIT, 1, summary);
  const ended = await collectTasksByStatus("ENDED", INCREMENTAL_ENDED_LIMIT, 1, summary);
  const seen = new Set<string>();
  const unique = [...started, ...ended].filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
  await flush(collectRows(unique));

  // Rekonsiliasi: visit ONGOING yang task-nya sudah tidak aktif.
  const reconciledIds: string[] = [];
  try {
    const { data: ongoing, error: ongoingError } = await admin
      .from("tms_trip_visit_logs")
      .select("task_id, task_number")
      .not("arrival_actual", "is", null)
      .is("departure_actual", null)
      .order("arrival_actual", { ascending: false })
      .limit(RECONCILE_TASK_LIMIT * 4);
    if (ongoingError) throw new Error(`Gagal membaca visit berlangsung: ${ongoingError.message}`);
    const candidates = new Map<string, string | null>();
    for (const row of Array.isArray(ongoing) ? ongoing : []) {
      const taskId = typeof (row as { task_id?: unknown }).task_id === "string"
        ? ((row as { task_id: string }).task_id as string)
        : "";
      if (!taskId || seen.has(taskId) || candidates.has(taskId)) continue;
      const taskNumber = typeof (row as { task_number?: unknown }).task_number === "string"
        ? ((row as { task_number: string }).task_number as string)
        : null;
      candidates.set(taskId, taskNumber);
      if (candidates.size >= RECONCILE_TASK_LIMIT) break;
    }
    for (const [taskId, taskNumber] of candidates) {
      summary.reconciledTasks += 1;
      reconciledIds.push(taskId);
      try {
        const search = taskNumber?.trim() ? taskNumber.trim() : taskId;
        const result = await fetchFleetTaskInstantList({ limit: 10, page: 1, search });
        const match = result.items
          .map((raw) => normalizeFleetTaskInstantItem(raw))
          .find((item) => item && (item.id === taskId || item.number === taskNumber));
        if (!match) continue;
        const raw = result.items.find((item) => {
          const normalized = normalizeFleetTaskInstantItem(item);
          return normalized?.id === match.id;
        });
        if (!raw) continue;
        await flush(collectRows([{ raw, id: match.id }]));
      } catch (error) {
        summary.failures.push(`Rekonsiliasi ${taskId}: ${errorMessage(error)}`);
      }
    }
  } catch (error) {
    summary.failures.push(errorMessage(error));
  }

  // Visit log baru hasil sync langsung dicap client.
  await stampUnmappedTmsRows(admin);

  // Evaluasi SLA untuk task yang disentuh sync (failure-isolated agar
  // tidak menggagalkan arsip kunjungan bila konfigurasi SLA bermasalah).
  try {
    const slaTaskIds = [...seen];
    for (const taskId of reconciledIds) {
      if (!slaTaskIds.includes(taskId)) slaTaskIds.push(taskId);
    }
    const slaSummary = await evaluateSlaForTasks(admin, slaTaskIds);
    summary.slaTasks = slaSummary.tasksChecked;
    summary.slaAssigned = slaSummary.assigned;
    summary.slaVisits = slaSummary.visitsUpdated;
  } catch (error) {
    summary.failures.push(`Evaluasi SLA: ${errorMessage(error)}`);
  }

  return summary;
}
