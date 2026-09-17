import "server-only";

import { createAdminClient } from "./supabase-admin";
import { fetchFleetTaskInstantList, fetchMcEasyVehicleStatus } from "./mceasy-server";
import type { TmsVehicleStatus } from "./tms-status";
import {
  normalizeFleetTaskInstantItem,
  type FleetTaskInstantItem,
  type FleetTaskTimelinePoint,
} from "./fleet-task-track";
import {
  hasValidPointTemperature,
  normalizeCapturedSequence,
  resolveRoutePointSequence,
  selectCapturableRoutePoint,
  TMS_POINT_CAPTURE_MAX_STARTED_TASKS,
  TMS_POINT_CAPTURE_RADIUS_METERS,
  TMS_POINT_CAPTURE_VEHICLE_FRESHNESS_MS,
  TMS_POINT_TEMPERATURE_RETENTION_MONTHS,
} from "./tms-point-temperature";

const TABLE = "tms_route_point_temperatures";
const VEHICLE_STATUS_BATCH_SIZE = 5;
const RETENTION_MS = TMS_POINT_TEMPERATURE_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000;

export interface RoutePointTemperatureCaptureSummary {
  requestedAt: string;
  activeTasksFound: number | null;
  activeTasksProcessed: number;
  truncatedActiveTasks: boolean;
  vehiclesChecked: number;
  snapshotsUpserted: number;
  pointsSkipped: number;
  failures: string[];
}

interface VehicleCaptureGroup {
  vehicleId: number;
  tasks: FleetTaskInstantItem[];
}

function groupTasksByVehicle(tasks: FleetTaskInstantItem[]): VehicleCaptureGroup[] {
  const groups = new Map<number, FleetTaskInstantItem[]>();
  for (const task of tasks) {
    if (task.vehicleId === null) continue;
    const group = groups.get(task.vehicleId) ?? [];
    group.push(task);
    groups.set(task.vehicleId, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([vehicleId, vehicleTasks]) => ({ vehicleId, tasks: vehicleTasks }));
}

function measurementTimeMs(status: TmsVehicleStatus): number | null {
  const raw = status.lastPacket ?? status.lastReceive;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Kesalahan tidak diketahui.";
}

async function fetchActiveTasks(): Promise<{ tasks: FleetTaskInstantItem[]; total: number | null }> {
  const result = await fetchFleetTaskInstantList({
    limit: TMS_POINT_CAPTURE_MAX_STARTED_TASKS,
    page: 1,
    status: "STARTED",
  });
  const tasks: FleetTaskInstantItem[] = [];
  for (const raw of result.items) {
    const normalized = normalizeFleetTaskInstantItem(raw);
    if (normalized && normalized.statusRaw === "STARTED" && normalized.vehicleId !== null) {
      tasks.push(normalized);
    }
  }
  return { tasks, total: result.total };
}

async function readCapturedSequences(
  admin: ReturnType<typeof createAdminClient>,
  taskIds: string[],
): Promise<Map<string, Set<number>>> {
  const captured = new Map<string, Set<number>>();
  if (taskIds.length === 0) return captured;
  const { data, error } = await admin
    .from(TABLE)
    .select("task_id,route_sequence")
    .in("task_id", taskIds);
  if (error) {
    throw new Error(`Gagal membaca snapshot suhu titik: ${error.message}`);
  }
  for (const row of Array.isArray(data) ? data : []) {
    const capturedSequence = normalizeCapturedSequence(row);
    if (!capturedSequence) continue;
    const sequences = captured.get(capturedSequence.taskId) ?? new Set<number>();
    sequences.add(capturedSequence.routeSequence);
    captured.set(capturedSequence.taskId, sequences);
  }
  return captured;
}

function toSnapshotRow(
  task: FleetTaskInstantItem,
  point: FleetTaskTimelinePoint,
  sequence: number,
  status: TmsVehicleStatus,
  measuredAt: string,
  distanceMeters: number,
) {
  return {
    task_id: task.id,
    task_number: task.number,
    vehicle_id: status.vehicleId,
    license_plate: status.licensePlate,
    route_sequence: sequence,
    point_name: point.name,
    temperatures: status.temperatures,
    measured_at: measuredAt,
    arrival_actual: point.arrivalActual ?? point.departureActual,
    distance_meters: Math.round(distanceMeters * 10) / 10,
  };
}

/**
 * Ambil suhu kendaraan FO aktif yang sedang berada pada titik rute.
 * Setiap eksekusi hanya menambahkan snapshot yang belum ada; unique
 * constraint database membuat operasi ini aman terhadap cron ganda.
 */
export async function captureActiveRoutePointTemperatures(
  now: number = Date.now(),
): Promise<RoutePointTemperatureCaptureSummary> {
  const admin = createAdminClient();
  const { tasks, total } = await fetchActiveTasks();
  const failures: string[] = [];
  let vehiclesChecked = 0;
  let snapshotsUpserted = 0;
  let pointsSkipped = 0;

  if (tasks.length > 0) {
    const capturedSequences = await readCapturedSequences(
      admin,
      tasks.map((task) => task.id),
    );
    const groups = groupTasksByVehicle(tasks);

    for (let index = 0; index < groups.length; index += VEHICLE_STATUS_BATCH_SIZE) {
      const batch = groups.slice(index, index + VEHICLE_STATUS_BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(async (group) =>
          fetchMcEasyVehicleStatus(String(group.vehicleId), { withAddress: false }),
        ),
      );
      const batchRows: ReturnType<typeof toSnapshotRow>[] = [];

      settled.forEach((result, batchIndex) => {
        const group = batch[batchIndex];
        if (result.status === "rejected") {
          failures.push(`Kendaraan ${group.vehicleId}: ${errorMessage(result.reason)}`);
          pointsSkipped += group.tasks.length;
          return;
        }

        const status = result.value;
        if (!status) {
          failures.push(`Kendaraan ${group.vehicleId}: data status tidak ditemukan.`);
          pointsSkipped += group.tasks.length;
          return;
        }

        vehiclesChecked += 1;
        const measuredMs = measurementTimeMs(status);
        if (
          measuredMs === null ||
          now - measuredMs > TMS_POINT_CAPTURE_VEHICLE_FRESHNESS_MS ||
          measuredMs > now + 60_000
        ) {
          pointsSkipped += group.tasks.length;
          return;
        }
        if (!status.hasValidLocation || status.latitude === null || status.longitude === null) {
          pointsSkipped += group.tasks.length;
          return;
        }
        if (!hasValidPointTemperature(status.temperatures)) {
          pointsSkipped += group.tasks.length;
          return;
        }

        const measuredAt = new Date(measuredMs).toISOString();
        for (const task of group.tasks) {
          const candidate = selectCapturableRoutePoint(task.timeline, status, {
            radiusMeters: TMS_POINT_CAPTURE_RADIUS_METERS,
            excludeSequences: capturedSequences.get(task.id),
          });
          if (!candidate) {
            pointsSkipped += 1;
            continue;
          }
          const point = task.timeline.find(
            (item, itemIndex) => resolveRoutePointSequence(item, itemIndex) === candidate.sequence,
          );
          if (!point) {
            pointsSkipped += 1;
            continue;
          }
          batchRows.push(
            toSnapshotRow(task, point, candidate.sequence, status, measuredAt, candidate.distanceMeters),
          );
        }
      });

      // Upsert dikumpulkan per batch kendaraan agar satu kegagalan database
      // tidak menghentikan seluruh eksekusi cron.
      if (batchRows.length > 0) {
        const { error: upsertError } = await admin.from(TABLE).upsert(batchRows, {
          onConflict: "task_id,route_sequence",
          ignoreDuplicates: true,
        });
        if (upsertError) {
          failures.push(`Gagal menyimpan snapshot suhu titik: ${upsertError.message}`);
          pointsSkipped += batchRows.length;
        } else {
          snapshotsUpserted += batchRows.length;
        }
      }
    }
  }

  const cutoff = new Date(now - RETENTION_MS).toISOString();
  const { error: purgeError } = await admin.from(TABLE).delete().lt("measured_at", cutoff);
  if (purgeError) {
    failures.push(`Gagal membersihkan snapshot lama: ${purgeError.message}`);
  }

  return {
    requestedAt: new Date(now).toISOString(),
    activeTasksFound: total,
    activeTasksProcessed: tasks.length,
    truncatedActiveTasks: total !== null && total > tasks.length,
    vehiclesChecked,
    snapshotsUpserted,
    pointsSkipped,
    failures,
  };
}
