import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/mceasy-server", () => ({
  fetchFleetTaskInstantList: vi.fn(),
  fetchMcEasyVehicleStatus: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { fetchFleetTaskInstantList, fetchMcEasyVehicleStatus } from "@/lib/mceasy-server";
import { normalizeMcEasyVehicleStatus } from "@/lib/tms-status";
import { createAdminClient } from "@/lib/supabase-admin";
import { captureActiveRoutePointTemperatures } from "@/lib/tms-point-temperature-server";

const fetchListMock = vi.mocked(fetchFleetTaskInstantList);
const fetchStatusMock = vi.mocked(fetchMcEasyVehicleStatus);
const createAdminClientMock = vi.mocked(createAdminClient);

function mockStore(existing: unknown[] = []) {
  const upsert = vi.fn(async (_rows: unknown, _options: unknown) => {
    void _rows;
    void _options;
    return { error: null };
  });
  const inFilter = vi.fn(async () => ({ data: existing, error: null }));
  const select = vi.fn(() => ({ in: inFilter }));
  const lt = vi.fn(async () => ({ error: null }));
  const remove = vi.fn(() => ({ lt }));
  const from = vi.fn(() => ({ select, upsert, delete: remove }));
  createAdminClientMock.mockReturnValue({ from } as never);
  return { from, select, inFilter, upsert, remove, lt };
}

function activeTask() {
  return {
    id: "task-1",
    number: "FO-1",
    vehicle: { id: 7, license_plate: "B 9206 BXT" },
    status: { raw_type: "STARTED", name: "Berjalan" },
    timeline_route: [
      {
        plan_sequence: 2,
        address: {
          name: "Titik 2",
          full_name: "Jl. Dua",
          geolocation: { coordinate: { latitude: -6.2, longitude: 106.8 } },
        },
        visit_status: { raw_type: "WILL_VISITED", name: "Akan dikunjungi" },
        arrival_time: { target: null, actual: null },
        departure_time: { target: null, actual: null },
      },
    ],
  };
}

function vehicleStatus(now: number) {
  const normalized = normalizeMcEasyVehicleStatus({
    vehicleId: 7,
    licensePlate: "B 9206 BXT",
    latitude: -6.2,
    longitude: 106.8,
    lastPacket: new Date(now - 30_000).toISOString(),
    lastReceive: new Date(now - 30_000).toISOString(),
    temperature: [18.9, null],
  });
  if (!normalized) throw new Error("Status kendaraan fixture tidak valid.");
  return normalized;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureActiveRoutePointTemperatures", () => {
  it("captures one snapshot when an active vehicle reaches a route point", async () => {
    const now = Date.now();
    const store = mockStore();
    fetchListMock.mockResolvedValue({ items: [activeTask()], total: 1, page: 1, counts: null });
    fetchStatusMock.mockResolvedValue(vehicleStatus(now) as never);

    const summary = await captureActiveRoutePointTemperatures(now);

    expect(fetchListMock).toHaveBeenCalledWith({ limit: 100, page: 1, status: "STARTED" });
    expect(fetchStatusMock).toHaveBeenCalledWith("7", { withAddress: false });
    expect(store.upsert).toHaveBeenCalledTimes(1);
    expect(store.upsert.mock.calls[0][0]).toMatchObject([
      {
        task_id: "task-1",
        vehicle_id: 7,
        route_sequence: 2,
        temperatures: [18.9, null],
        measured_at: new Date(now - 30_000).toISOString(),
      },
    ]);
    expect(store.upsert.mock.calls[0][1]).toEqual({
      onConflict: "task_id,route_sequence",
      ignoreDuplicates: true,
    });
    expect(summary).toMatchObject({
      activeTasksProcessed: 1,
      vehiclesChecked: 1,
      snapshotsUpserted: 1,
      pointsSkipped: 0,
      failures: [],
    });
  });

  it("does not rewrite a point that already has a snapshot", async () => {
    const now = Date.now();
    const store = mockStore([{ task_id: "task-1", route_sequence: 2 }]);
    fetchListMock.mockResolvedValue({ items: [activeTask()], total: 1, page: 1, counts: null });
    fetchStatusMock.mockResolvedValue(vehicleStatus(now) as never);

    const summary = await captureActiveRoutePointTemperatures(now);

    expect(store.upsert).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ snapshotsUpserted: 0, pointsSkipped: 1 });
  });
});
