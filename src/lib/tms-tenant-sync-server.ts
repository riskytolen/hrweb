import "server-only";

import { createAdminClient } from "./supabase-admin";
import { normalizeTenantPlateKey } from "./tms-tenant-auth";

type Admin = ReturnType<typeof createAdminClient>;

interface VehicleMapping {
  byMceasyId: Map<number, string>;
  byPlateKey: Map<string, string>;
}

export interface TenantStampSummary {
  vehicles: number;
  snapshots: number;
  occurrences: number;
  assignments: number;
  stops: number;
  submissions: number;
  evidence: number;
  visitLogs: number;
  temperatures: number;
  groups: number;
}

/**
 * Cap client_id pada baris TMS yang masih null setelah sync, berdasarkan
 * mapping unit aktif (`tms_client_vehicle_assignments`) dan relasi parent.
 * Baris yang tidak bisa dipetakan tetap null (= UNASSIGNED, disembunyikan
 * dari user scoped). Idempotent dan aman dipanggil setiap siklus sync.
 */
export async function stampUnmappedTmsRows(admin: Admin): Promise<TenantStampSummary> {
  const summary: TenantStampSummary = {
    vehicles: 0,
    snapshots: 0,
    occurrences: 0,
    assignments: 0,
    stops: 0,
    submissions: 0,
    evidence: 0,
    visitLogs: 0,
    temperatures: 0,
    groups: 0,
  };

  const today = new Date().toISOString().slice(0, 10);
  const mapping: VehicleMapping = { byMceasyId: new Map(), byPlateKey: new Map() };
  try {
    const { data: rows } = await admin
      .from("tms_client_vehicle_assignments")
      .select("client_id,mceasy_vehicle_id,license_plate_key,effective_from,effective_until,status")
      .eq("status", "active")
      .limit(2000);
    for (
      const row of (Array.isArray(rows) ? rows : []) as {
        client_id: string;
        mceasy_vehicle_id: number;
        license_plate_key: string;
        effective_from: string | null;
        effective_until: string | null;
      }[]
    ) {
      if (typeof row.effective_from === "string" && row.effective_from.slice(0, 10) > today) continue;
      if (typeof row.effective_until === "string" && row.effective_until.slice(0, 10) < today) continue;
      if (typeof row.mceasy_vehicle_id === "number") mapping.byMceasyId.set(row.mceasy_vehicle_id, row.client_id);
      const key = normalizeTenantPlateKey(row.license_plate_key);
      if (key) mapping.byPlateKey.set(key, row.client_id);
    }
  } catch {
    return summary;
  }
  if (mapping.byMceasyId.size === 0 && mapping.byPlateKey.size === 0) return summary;

  const resolveClient = (vehicleId: unknown, plate: unknown, plateKey?: unknown): string | null => {
    if (typeof vehicleId === "number" && mapping.byMceasyId.has(vehicleId)) {
      return mapping.byMceasyId.get(vehicleId) ?? null;
    }
    const key =
      typeof plateKey === "string" && plateKey
        ? normalizeTenantPlateKey(plateKey)
        : normalizeTenantPlateKey(typeof plate === "string" ? plate : null);
    if (key && mapping.byPlateKey.has(key)) return mapping.byPlateKey.get(key) ?? null;
    return null;
  };

  // Tabel ber-basis kendaraan: cocokkan langsung dari mapping.
  const vehicleTables: { table: string; select: string }[] = [
    { table: "tms_live_track_vehicles", select: "id,mceasy_vehicle_id,license_plate,license_plate_key" },
    { table: "tms_live_track_task_snapshots", select: "task_id,vehicle_id,license_plate,license_plate_key" },
    { table: "tms_epod_assignments", select: "id,vehicle_id,license_plate" },
    { table: "tms_trip_visit_logs", select: "id,vehicle_id,license_plate" },
    { table: "tms_route_point_temperatures", select: "id,vehicle_id,license_plate" },
  ];
  const idColumn: Record<string, string> = {
    tms_live_track_vehicles: "id",
    tms_live_track_task_snapshots: "task_id",
    tms_epod_assignments: "id",
    tms_trip_visit_logs: "id",
    tms_route_point_temperatures: "id",
  };
  const summaryKey: Record<string, keyof TenantStampSummary> = {
    tms_live_track_vehicles: "vehicles",
    tms_live_track_task_snapshots: "snapshots",
    tms_epod_assignments: "assignments",
    tms_trip_visit_logs: "visitLogs",
    tms_route_point_temperatures: "temperatures",
  };
  for (const { table, select } of vehicleTables) {
    try {
      const { data } = await admin.from(table).select(select).is("client_id", null).limit(1000);
      const rows = (Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : []);
      if (rows.length === 0) continue;
      const byClient = new Map<string, string[]>();
      for (const row of rows) {
        const clientId = resolveClient(
          row.vehicle_id ?? row.mceasy_vehicle_id,
          row.license_plate,
          row.license_plate_key,
        );
        if (!clientId) continue;
        const idValue = row[idColumn[table]];
        if (typeof idValue !== "string" && typeof idValue !== "number") continue;
        const list = byClient.get(clientId) ?? [];
        list.push(String(idValue));
        byClient.set(clientId, list);
      }
      for (const [clientId, ids] of byClient) {
        const { error } = await admin.from(table).update({ client_id: clientId }).in(idColumn[table], ids);
        if (!error) summary[summaryKey[table]] += ids.length;
      }
    } catch {
      // Lanjut ke tabel berikutnya; kegagalan dicatat di sync summary pemanggil bila perlu.
    }
  }

  // Occurrence: dari snapshot (task) sonst grup.
  try {
    const { data } = await admin
      .from("tms_live_track_task_occurrences")
      .select("id,task_id,group_id")
      .is("client_id", null)
      .limit(1000);
    const rows = (Array.isArray(data) ? data : []) as { id: string; task_id: string; group_id: string }[];
    if (rows.length > 0) {
      const taskIds = [...new Set(rows.map((r) => r.task_id))];
      const groupIds = [...new Set(rows.map((r) => r.group_id))];
      const [{ data: snaps }, { data: groups }] = await Promise.all([
        admin.from("tms_live_track_task_snapshots").select("task_id,client_id").in("task_id", taskIds),
        admin.from("tms_live_track_groups").select("id,client_id").in("id", groupIds),
      ]);
      const snapClient = new Map(
        ((Array.isArray(snaps) ? snaps : []) as { task_id: string; client_id: string | null }[]).map((s) => [
          s.task_id,
          s.client_id,
        ]),
      );
      const groupClient = new Map(
        ((Array.isArray(groups) ? groups : []) as { id: string; client_id: string | null }[]).map((g) => [
          g.id,
          g.client_id,
        ]),
      );
      const byClient = new Map<string, string[]>();
      for (const row of rows) {
        const clientId = snapClient.get(row.task_id) ?? groupClient.get(row.group_id) ?? null;
        if (!clientId) continue;
        const list = byClient.get(clientId) ?? [];
        list.push(row.id);
        byClient.set(clientId, list);
      }
      for (const [clientId, ids] of byClient) {
        const { error } = await admin
          .from("tms_live_track_task_occurrences")
          .update({ client_id: clientId })
          .in("id", ids);
        if (!error) summary.occurrences += ids.length;
      }
    }
  } catch {
    // Abaikan; baris tetap UNASSIGNED.
  }

  // e-POD turunan + membership grup + config events: dari parent.
  const cascades: { table: string; parentTable: string; parentKey: string; summaryKey: keyof TenantStampSummary }[] = [
    { table: "tms_epod_stops", parentTable: "tms_epod_assignments", parentKey: "assignment_id", summaryKey: "stops" },
    { table: "tms_epod_submissions", parentTable: "tms_epod_stops", parentKey: "stop_id", summaryKey: "submissions" },
    { table: "tms_epod_evidence", parentTable: "tms_epod_submissions", parentKey: "submission_id", summaryKey: "evidence" },
    { table: "tms_live_track_group_vehicles", parentTable: "tms_live_track_groups", parentKey: "group_id", summaryKey: "groups" },
  ];
  for (const { table, parentTable, parentKey, summaryKey } of cascades) {
    try {
      const parentIdColumn = parentTable === "tms_live_track_groups" ? "id" : "id";
      const { data } = await admin.from(table).select(`id,${parentKey}`).is("client_id", null).limit(1000);
      const rows = (
        Array.isArray(data) ? (data as unknown as { id: string; [k: string]: unknown }[]) : []
      );
      if (rows.length === 0) continue;
      const parentIds = [...new Set(rows.map((r) => String(r[parentKey])))];
      const { data: parents } = await admin
        .from(parentTable)
        .select(`${parentIdColumn},client_id`)
        .in(parentIdColumn, parentIds);
      const parentClient = new Map(
        ((Array.isArray(parents) ? parents : []) as { id: string; client_id: string | null }[]).map((p) => [
          String(p.id),
          p.client_id,
        ]),
      );
      const byClient = new Map<string, string[]>();
      for (const row of rows) {
        const clientId = parentClient.get(String(row[parentKey])) ?? null;
        if (!clientId) continue;
        const list = byClient.get(clientId) ?? [];
        list.push(row.id);
        byClient.set(clientId, list);
      }
      for (const [clientId, ids] of byClient) {
        const { error } = await admin.from(table).update({ client_id: clientId }).in("id", ids);
        if (!error) summary[summaryKey] += ids.length;
      }
    } catch {
      // Abaikan; baris tetap UNASSIGNED.
    }
  }

  return summary;
}
