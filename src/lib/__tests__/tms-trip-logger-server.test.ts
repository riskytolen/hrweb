import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/tms-tenant-sync-server", () => ({ stampUnmappedTmsRows: vi.fn() }));
vi.mock("@/lib/mceasy-server", () => ({ fetchFleetTaskInstantList: vi.fn() }));
vi.mock("@/lib/fleet-task-track", () => ({ normalizeFleetTaskInstantItem: vi.fn() }));
vi.mock("@/lib/tms-trip-logger", () => ({ normalizeTaskTripVisits: vi.fn() }));
vi.mock("@/lib/tms-sla-server", () => ({ evaluateSlaForTasks: vi.fn() }));

import { syncTripVisitLogs } from "@/lib/tms-trip-logger-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { stampUnmappedTmsRows } from "@/lib/tms-tenant-sync-server";
import { fetchFleetTaskInstantList } from "@/lib/mceasy-server";
import { normalizeFleetTaskInstantItem } from "@/lib/fleet-task-track";
import { normalizeTaskTripVisits } from "@/lib/tms-trip-logger";
import { evaluateSlaForTasks } from "@/lib/tms-sla-server";

const rpcMock = vi.fn();
const createAdminClientMock = vi.mocked(createAdminClient);
const stampRowsMock = vi.mocked(stampUnmappedTmsRows);
const fetchTasksMock = vi.mocked(fetchFleetTaskInstantList);
const normalizeItemMock = vi.mocked(normalizeFleetTaskInstantItem);
const normalizeVisitsMock = vi.mocked(normalizeTaskTripVisits);
const evaluateSlaMock = vi.mocked(evaluateSlaForTasks);

function visit(taskId: string, arrivedAt: string) {
  return {
    taskId,
    taskNumber: taskId === "task-1" ? "FO-1" : "FO-tua",
    taskStatus: "ENDED",
    vehicleId: 1,
    unit: "B 1234 TES",
    driverName: "ASEP SURAHMAN",
    routeSequence: 2,
    pointId: "point-1",
    addressId: "43690",
    pointType: "END",
    locationName: "Toko A",
    locationAddress: "Jl. A",
    latitude: -6.2,
    longitude: 106.8,
    visitStatusName: "Selesai",
    arrivalActual: arrivedAt,
    departureActual: arrivedAt,
  } as never;
}

describe("syncTripVisitLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("menilai SLA hanya untuk task backfill yang masuk jendela", async () => {
    createAdminClientMock.mockReturnValue({ rpc: rpcMock } as never);
    rpcMock.mockResolvedValue({ data: { inserted: 1, updated: 0 }, error: null });
    fetchTasksMock.mockImplementation(async (args: unknown) => {
      const status = (args as { status?: unknown }).status;
      const items =
        status === "STARTED"
          ? [
              { id: "task-1", status: "STARTED" },
              { id: "task-tua", status: "STARTED" },
            ]
          : [];
      return { items, total: items.length, page: 1, counts: null } as never;
    });
    normalizeItemMock.mockImplementation((raw: unknown) => {
      const source = raw as { id?: unknown; status?: unknown };
      return { id: String(source.id), statusRaw: String(source.status) } as never;
    });
    normalizeVisitsMock.mockImplementation((task: unknown) => {
      const id = (task as { id?: unknown }).id;
      if (id === "task-tua") return [visit("task-tua", "2026-09-01T00:00:00Z")];
      return [visit("task-1", "2026-10-03T00:00:00Z")];
    });
    stampRowsMock.mockResolvedValue({
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
    });
    evaluateSlaMock.mockResolvedValue({ tasksChecked: 1, assigned: 1, visitsUpdated: 1 });

    const summary = await syncTripVisitLogs({
      mode: "backfill",
      days: 1,
      maxPages: 1,
      now: Date.parse("2026-10-03T01:00:00Z"),
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "tms_trip_visit_log_upsert",
      expect.objectContaining({ p_rows: expect.any(Array) }),
    );
    expect(evaluateSlaMock).toHaveBeenCalledTimes(1);
    expect(evaluateSlaMock).toHaveBeenCalledWith(expect.objectContaining({ rpc: rpcMock }), ["task-1"]);
    expect(summary).toMatchObject({ slaTasks: 1, slaAssigned: 1, slaVisits: 1, failures: [] });
  });
});
