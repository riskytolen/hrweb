import "server-only";

import { createAdminClient } from "./supabase-admin";
import {
  fetchFleetTaskInstantDetail,
  fetchFleetTaskInstantList,
  fetchMcEasyVehicleStatuses,
  normalizeFleetTaskInstantStatus,
  type FleetTaskInstantStatus,
} from "./mceasy-server";
import {
  normalizeFleetTaskInstantDetail,
  normalizeFleetTaskInstantItem,
  type FleetTaskInstantItem,
} from "./fleet-task-track";
import {
  currentLiveTrackWindowBounds,
  isLiveTrackWindowActive,
  normalizeLiveTrackPlateKey,
  parseClockToMinutes,
} from "./tms-live-track-schedule";

export interface LiveTrackSyncSummary {
  requestedAt: string;
  vehiclesSeen: number;
  vehiclesCataloged: number;
  groupsActive: number;
  relationsActive: number;
  tasksChecked: number;
  snapshotsUpserted: number;
  occurrencesUpserted: number;
  tasksFrozen: number;
  reconciledTasks: number;
  truncated: boolean;
  failures: string[];
}

interface SyncOptions {
  now?: number;
  maxTaskPages?: number;
  maxDetailFetches?: number;
  maxReconcile?: number;
}

const TERMINAL_STATUSES = new Set(["ENDED", "CANCELED"]);
const ACTIVE_TASK_STATUSES: FleetTaskInstantStatus[] = ["SCHEDULED", "STARTED"];
const TASK_PAGE_LIMIT = 100;
const DEFAULT_MAX_TASK_PAGES = 3;
const DEFAULT_MAX_DETAIL_FETCHES = 10;
const DEFAULT_MAX_RECONCILE = 20;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Kesalahan tidak diketahui.";
}

function upperStatus(value: string | null): string | null {
  return value ? value.toUpperCase() : null;
}

interface ActiveRelation {
  id: string;
  groupId: string;
  groupName: string;
  vehicleId: string;
  mceasyVehicleId: number;
  licensePlate: string;
  licensePlateKey: string;
  windowStart: string;
  windowEnd: string;
  bounds: { windowStartedAt: string; visibleUntil: string };
}

interface GroupRow {
  id: string;
  name: string;
  status: string;
  default_window_start: string;
  default_window_end: string;
  effective_from: string | null;
  effective_until: string | null;
}

interface RelationRow {
  id: string;
  group_id: string;
  vehicle_id: string;
  use_group_schedule: boolean;
  override_window_start: string | null;
  override_window_end: string | null;
  enabled: boolean;
  vehicle: {
    id: string;
    mceasy_vehicle_id: number;
    license_plate: string;
  } | null;
}

function jakartaDate(atMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atMs));
}

export async function syncLiveTrack(now = Date.now(), options: SyncOptions = {}): Promise<LiveTrackSyncSummary> {
  const admin = createAdminClient();
  const summary: LiveTrackSyncSummary = {
    requestedAt: new Date(now).toISOString(),
    vehiclesSeen: 0,
    vehiclesCataloged: 0,
    groupsActive: 0,
    relationsActive: 0,
    tasksChecked: 0,
    snapshotsUpserted: 0,
    occurrencesUpserted: 0,
    tasksFrozen: 0,
    reconciledTasks: 0,
    truncated: false,
    failures: [],
  };
  const maxTaskPages = options.maxTaskPages ?? DEFAULT_MAX_TASK_PAGES;
  const maxDetailFetches = options.maxDetailFetches ?? DEFAULT_MAX_DETAIL_FETCHES;
  const maxReconcile = options.maxReconcile ?? DEFAULT_MAX_RECONCILE;
  let detailFetches = 0;

  // 1. Katalog unit dari McEasy.
  try {
    const statuses = await fetchMcEasyVehicleStatuses({ withAddress: false });
    summary.vehiclesSeen = statuses.length;
    const seenIds = new Set<number>();
    for (const status of statuses) {
      seenIds.add(status.vehicleId);
      const { error } = await admin.from("tms_live_track_vehicles").upsert(
        {
          mceasy_vehicle_id: status.vehicleId,
          license_plate: status.licensePlate,
          license_plate_key: normalizeLiveTrackPlateKey(status.licensePlate),
          vendor_groups: status.vehicleGroups,
          last_seen_at: new Date(now).toISOString(),
          last_synced_at: new Date(now).toISOString(),
          status: "active",
          updated_at: new Date(now).toISOString(),
        },
        { onConflict: "mceasy_vehicle_id" },
      );
      if (error) {
        summary.failures.push(`Katalog unit ${status.vehicleId}: ${error.message}`);
      } else {
        summary.vehiclesCataloged += 1;
      }
    }
    // Tandai stale untuk unit katalog yang tidak terlihat.
    const { data: catalog } = await admin.from("tms_live_track_vehicles").select("mceasy_vehicle_id");
    const missing = ((Array.isArray(catalog) ? catalog : []) as { mceasy_vehicle_id: number }[])
      .map((row) => row.mceasy_vehicle_id)
      .filter((id) => !seenIds.has(id));
    for (const id of missing) {
      await admin
        .from("tms_live_track_vehicles")
        .update({ status: "stale", last_synced_at: new Date(now).toISOString() })
        .eq("mceasy_vehicle_id", id);
    }
  } catch (error) {
    summary.failures.push(`Sinkronisasi katalog unit: ${errorMessage(error)}`);
  }

  // 2. Konfigurasi aktif + relasi yang window-nya berjalan.
  const today = jakartaDate(now);
  const { data: groupRows, error: groupsError } = await admin
    .from("tms_live_track_groups")
    .select("id, name, status, default_window_start, default_window_end, effective_from, effective_until")
    .eq("status", "Aktif")
    .order("sort_order", { ascending: true });
  if (groupsError) {
    summary.failures.push(`Muat kelompok: ${groupsError.message}`);
    return summary;
  }
  const activeGroups = ((Array.isArray(groupRows) ? groupRows : []) as unknown as GroupRow[]).filter(
    (group) =>
      (!group.effective_from || group.effective_from <= today) &&
      (!group.effective_until || group.effective_until >= today),
  );
  summary.groupsActive = activeGroups.length;
  if (activeGroups.length === 0) return summary;

  const { data: relationRows, error: relationsError } = await admin
    .from("tms_live_track_group_vehicles")
    .select(
      "id, group_id, vehicle_id, use_group_schedule, override_window_start, override_window_end, " +
        "enabled, vehicle:tms_live_track_vehicles(id, mceasy_vehicle_id, license_plate)",
    )
    .in(
      "group_id",
      activeGroups.map((g) => g.id),
    )
    .eq("enabled", true);
  if (relationsError) {
    summary.failures.push(`Muat relasi unit: ${relationsError.message}`);
    return summary;
  }

  const groupById = new Map(activeGroups.map((g) => [g.id, g]));
  const activeRelations: ActiveRelation[] = [];
  for (const row of (Array.isArray(relationRows) ? relationRows : []) as unknown as RelationRow[]) {
    const group = groupById.get(row.group_id);
    if (!group || !row.vehicle) continue;
    const start = row.use_group_schedule ? group.default_window_start.slice(0, 5) : row.override_window_start?.slice(0, 5);
    const end = row.use_group_schedule ? group.default_window_end.slice(0, 5) : row.override_window_end?.slice(0, 5);
    if (!start || !end) continue;
    const startMin = parseClockToMinutes(start);
    const endMin = parseClockToMinutes(end);
    if (!isLiveTrackWindowActive(startMin, endMin, now)) continue;
    const bounds = currentLiveTrackWindowBounds(startMin, endMin, now);
    if (!bounds) continue;
    activeRelations.push({
      id: row.id,
      groupId: group.id,
      groupName: group.name,
      vehicleId: row.vehicle.id,
      mceasyVehicleId: row.vehicle.mceasy_vehicle_id,
      licensePlate: row.vehicle.license_plate,
      licensePlateKey: normalizeLiveTrackPlateKey(row.vehicle.license_plate),
      windowStart: start,
      windowEnd: end,
      bounds,
    });
  }
  summary.relationsActive = activeRelations.length;
  if (activeRelations.length === 0) return summary;

  const byMceasyId = new Map<number, ActiveRelation[]>();
  const byPlateKey = new Map<string, ActiveRelation[]>();
  for (const relation of activeRelations) {
    const byId = byMceasyId.get(relation.mceasyVehicleId) ?? [];
    byId.push(relation);
    byMceasyId.set(relation.mceasyVehicleId, byId);
    const byPlate = byPlateKey.get(relation.licensePlateKey) ?? [];
    byPlate.push(relation);
    byPlateKey.set(relation.licensePlateKey, byPlate);
  }

  const matchRelations = (task: FleetTaskInstantItem): ActiveRelation[] => {
    if (task.vehicleId !== null) {
      const direct = byMceasyId.get(task.vehicleId);
      if (direct && direct.length > 0) return direct;
    }
    const key = normalizeLiveTrackPlateKey(task.licensePlate);
    if (key) {
      const fallback = byPlateKey.get(key);
      if (fallback && fallback.length > 0) return fallback;
    }
    return [];
  };

  const snapshotRows: Record<string, unknown>[] = [];
  const occurrenceRows: Record<string, unknown>[] = [];
  const seenTaskIds = new Set<string>();

  const queueTask = (
    task: FleetTaskInstantItem,
    relations: ActiveRelation[],
    detail: { timeline: unknown; plannedRoutes: unknown; actualRoutes: unknown } | null,
  ) => {
    const status = upperStatus(task.statusRaw);
    const terminal = status !== null && TERMINAL_STATUSES.has(status);
    const terminalAt = terminal
      ? (task.actualArrivalOn ?? new Date(now).toISOString())
      : null;
    // Jangan timpa timeline berisi dengan array kosong dari detail vendor.
    const timeline =
      detail && Array.isArray(detail.timeline) && detail.timeline.length > 0
        ? detail.timeline
        : task.timeline;
    snapshotRows.push({
      task_id: task.id,
      task_number: task.number,
      vehicle_id: task.vehicleId,
      license_plate: task.licensePlate,
      license_plate_key: normalizeLiveTrackPlateKey(task.licensePlate),
      driver_name: task.driverName,
      status_raw: status,
      expected_started_on: task.expectedStartedOn,
      actual_started_on: task.actualStartedOn,
      actual_arrival_on: task.actualArrivalOn,
      terminal_at: terminalAt,
      timeline,
      planned_routes: detail ? detail.plannedRoutes : [],
      actual_routes: detail ? detail.actualRoutes : [],
      track_id: task.trackId,
      frozen_at: terminal ? new Date(now).toISOString() : null,
    });
    for (const relation of relations) {
      occurrenceRows.push({
        task_id: task.id,
        group_id: relation.groupId,
        group_vehicle_id: relation.id,
        window_started_at: relation.bounds.windowStartedAt,
        visible_until: relation.bounds.visibleUntil,
        terminal_at: terminalAt,
      });
    }
    if (terminal) summary.tasksFrozen += 1;
  };

  // 3. Task SCHEDULED + STARTED dari vendor.
  const pendingTasks: { task: FleetTaskInstantItem; relations: ActiveRelation[] }[] = [];
  for (const status of ACTIVE_TASK_STATUSES) {
    for (let page = 1; page <= maxTaskPages; page += 1) {
      let items: unknown[] = [];
      try {
        const result = await fetchFleetTaskInstantList({
          limit: TASK_PAGE_LIMIT,
          page,
          sort: "created_on desc",
          status: normalizeFleetTaskInstantStatus(status) ?? undefined,
        });
        items = result.items;
      } catch (error) {
        summary.failures.push(`Daftar task ${status} halaman ${page}: ${errorMessage(error)}`);
        break;
      }
      if (items.length === 0) break;
      for (const raw of items) {
        const task = normalizeFleetTaskInstantItem(raw);
        if (!task) continue;
        const relations = matchRelations(task);
        if (relations.length === 0) continue;
        if (seenTaskIds.has(task.id)) {
          // Task sudah diproses dari status lain; pastikan occurrence relasi ikut.
          for (const relation of relations) {
            occurrenceRows.push({
              task_id: task.id,
              group_id: relation.groupId,
              group_vehicle_id: relation.id,
              window_started_at: relation.bounds.windowStartedAt,
              visible_until: relation.bounds.visibleUntil,
              terminal_at: null,
            });
          }
          continue;
        }
        seenTaskIds.add(task.id);
        summary.tasksChecked += 1;
        pendingTasks.push({ task, relations });
      }
      if (items.length < TASK_PAGE_LIMIT) break;
      if (page === maxTaskPages) summary.truncated = true;
    }
  }

  // Perkaya sebagian task dengan detail vendor (rute planned/actual +
  // timeline penuh) selama kuota detail masih ada, agar snapshot yang kelak
  // dibekukan sudah lengkap. Snapshot beku dilindungi RPC dari penimpaan.
  for (const pending of pendingTasks) {
    let detail: { timeline: unknown; plannedRoutes: unknown; actualRoutes: unknown } | null = null;
    if (detailFetches < maxDetailFetches) {
      detailFetches += 1;
      try {
        const normalized = normalizeFleetTaskInstantDetail(
          await fetchFleetTaskInstantDetail(pending.task.id),
        );
        if (normalized) {
          detail = {
            timeline: normalized.timeline.length > 0 ? normalized.timeline : pending.task.timeline,
            plannedRoutes: normalized.plannedRoutes,
            actualRoutes: normalized.actualRoutes,
          };
        }
      } catch (error) {
        summary.failures.push(
          `Detail task ${pending.task.number ?? pending.task.id}: ${errorMessage(error)}`,
        );
      }
    }
    queueTask(pending.task, pending.relations, detail);
  }

  const flushSnapshots = async (rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return;
    const { data, error } = await admin.rpc("tms_live_track_task_snapshot_upsert", { p_rows: rows });
    if (error) {
      summary.failures.push(`Simpan snapshot: ${error.message}`);
      return;
    }
    summary.snapshotsUpserted += (data as { upserted?: number } | null)?.upserted ?? 0;
  };

  const flushOccurrences = async (rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return;
    const { data, error } = await admin.rpc("tms_live_track_task_occurrence_upsert", { p_rows: rows });
    if (error) {
      summary.failures.push(`Simpan occurrence: ${error.message}`);
      return;
    }
    summary.occurrencesUpserted += (data as { upserted?: number } | null)?.upserted ?? 0;
  };

  await flushSnapshots(snapshotRows);
  await flushOccurrences(occurrenceRows);

  // 4. Rekonsiliasi snapshot aktif yang tidak terlihat + freeze terminal.
  try {
    const { data: activeSnapshots, error: activeError } = await admin
      .from("tms_live_track_task_snapshots")
      .select("task_id, task_number, status_raw, frozen_at")
      .is("frozen_at", null)
      .in("status_raw", ["SCHEDULED", "STARTED"])
      .order("last_synced_at", { ascending: true })
      .limit(maxReconcile * 2);
    if (activeError) throw new Error(`Baca snapshot aktif: ${activeError.message}`);
    const candidates = (
      (Array.isArray(activeSnapshots) ? activeSnapshots : []) as {
        task_id: string;
        task_number: string | null;
      }[]
    ).filter((row) => !seenTaskIds.has(row.task_id));
    let reconciled = 0;
    for (const candidate of candidates) {
      if (reconciled >= maxReconcile || detailFetches >= maxDetailFetches) {
        summary.truncated = true;
        break;
      }
      reconciled += 1;
      summary.reconciledTasks += 1;
      try {
        const search = candidate.task_number?.trim() ? candidate.task_number.trim() : candidate.task_id;
        const result = await fetchFleetTaskInstantList({ limit: 10, page: 1, search });
        const match = result.items
          .map((raw) => normalizeFleetTaskInstantItem(raw))
          .find((item) => item && (item.id === candidate.task_id || item.number === candidate.task_number));
        if (!match) {
          summary.failures.push(`Rekonsiliasi ${candidate.task_number ?? candidate.task_id}: tidak ditemukan di vendor.`);
          continue;
        }
        const status = upperStatus(match.statusRaw);
        if (status !== null && TERMINAL_STATUSES.has(status) && detailFetches < maxDetailFetches) {
          detailFetches += 1;
          const rawDetail = await fetchFleetTaskInstantDetail(match.id);
          const detail = normalizeFleetTaskInstantDetail(rawDetail);
          const relations = matchRelations(match);
          const frozenTimeline =
            detail && detail.timeline.length > 0 ? detail.timeline : match.timeline;
          await flushSnapshots([
            {
              task_id: match.id,
              task_number: match.number,
              vehicle_id: match.vehicleId,
              license_plate: match.licensePlate,
              license_plate_key: normalizeLiveTrackPlateKey(match.licensePlate),
              driver_name: match.driverName,
              status_raw: status,
              expected_started_on: match.expectedStartedOn,
              actual_started_on: match.actualStartedOn,
              actual_arrival_on: match.actualArrivalOn,
              terminal_at: match.actualArrivalOn ?? new Date(now).toISOString(),
              timeline: frozenTimeline,
              planned_routes: detail?.plannedRoutes ?? [],
              actual_routes: detail?.actualRoutes ?? [],
              track_id: match.trackId,
              frozen_at: new Date(now).toISOString(),
            },
          ]);
          if (relations.length > 0) {
            const occurrenceBatch: Record<string, unknown>[] = [];
            for (const relation of relations) {
              occurrenceBatch.push({
                task_id: match.id,
                group_id: relation.groupId,
                group_vehicle_id: relation.id,
                window_started_at: relation.bounds.windowStartedAt,
                visible_until: relation.bounds.visibleUntil,
                terminal_at: match.actualArrivalOn ?? new Date(now).toISOString(),
              });
            }
            await flushOccurrences(occurrenceBatch);
          }
          summary.tasksFrozen += 1;
        }
      } catch (error) {
        summary.failures.push(`Rekonsiliasi ${candidate.task_id}: ${errorMessage(error)}`);
      }
    }
  } catch (error) {
    summary.failures.push(errorMessage(error));
  }

  return summary;
}
