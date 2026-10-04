import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/mceasy-server", () => ({
  fetchMcEasyVehicleStatuses: vi.fn(),
  fetchFleetTaskInstantList: vi.fn(),
  fetchFleetTaskInstantDetail: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/tms-tenant-sync-server", () => ({
  stampUnmappedTmsRows: vi.fn(),
}));

import { fetchMcEasyVehicleStatuses } from "@/lib/mceasy-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { stampUnmappedTmsRows } from "@/lib/tms-tenant-sync-server";
import { syncLiveTrack } from "@/lib/tms-live-track-sync-server";

const fetchStatusesMock = vi.mocked(fetchMcEasyVehicleStatuses);
const createAdminClientMock = vi.mocked(createAdminClient);
const stampMock = vi.mocked(stampUnmappedTmsRows);

function mockAdmin(options: {
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  groups?: unknown[];
} = {}) {
  const rpc = vi.fn(async (_name: string, _params: unknown) => ({
    data: options.rpcData ?? { upserted: 0, stale_marked: 0, failures: [] },
    error: options.rpcError ?? null,
  }));
  const order = vi.fn(async () => ({ data: options.groups ?? [], error: null }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  createAdminClientMock.mockReturnValue({ from, rpc } as never);
  return { from, rpc, select, eq, order };
}

function vehicleStatus(vehicleId: number, licensePlate: string, vehicleGroups: string[] = []) {
  return { vehicleId, licensePlate, vehicleGroups };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncLiveTrack catalog", () => {
  it("mengkatalogkan kendaraan via satu RPC bulk dengan dedupe (terakhir menang)", async () => {
    const store = mockAdmin({
      rpcData: { upserted: 2, stale_marked: 0, failures: [] },
    });
    fetchStatusesMock.mockResolvedValue([
      vehicleStatus(1, "B 1 A", ["G1"]),
      vehicleStatus(2, "B 2 B"),
      vehicleStatus(1, "B 1 C", ["G2"]),
    ] as never);

    const summary = await syncLiveTrack(Date.now());

    expect(store.rpc).toHaveBeenCalledTimes(1);
    expect(store.rpc).toHaveBeenCalledWith(
      "tms_live_track_apply_catalog",
      expect.objectContaining({ p_synced_at: expect.any(String) }),
    );
    const payload = store.rpc.mock.calls[0][1] as {
      p_vehicles: Record<string, unknown>[];
    };
    expect(payload.p_vehicles).toHaveLength(2);
    // Duplikat vehicleId 1: baris terakhir menang.
    expect(payload.p_vehicles).toMatchObject([
      {
        mceasy_vehicle_id: 1,
        license_plate: "B 1 C",
        license_plate_key: "B1C",
        vendor_groups: ["G2"],
      },
      {
        mceasy_vehicle_id: 2,
        license_plate: "B 2 B",
        license_plate_key: "B2B",
        vendor_groups: [],
      },
    ]);
    // Payload tidak boleh membawa kolom identitas/tenant.
    for (const row of payload.p_vehicles) {
      expect(row).not.toHaveProperty("id");
      expect(row).not.toHaveProperty("client_id");
      expect(row).not.toHaveProperty("first_seen_at");
      expect(row).not.toHaveProperty("created_at");
    }
    // Tidak ada lagi N+1 upsert/select/update via REST.
    expect(store.from).toHaveBeenCalledTimes(1);
    expect(store.from).toHaveBeenCalledWith("tms_live_track_groups");
    expect(summary).toMatchObject({ vehiclesSeen: 3, vehiclesCataloged: 2, failures: [] });
    // Early return (tanpa grup aktif) tidak menjalankan stamping.
    expect(stampMock).not.toHaveBeenCalled();
  });

  it("tidak menandai stale saat respons vendor kosong (guard di RPC)", async () => {
    const store = mockAdmin({
      rpcData: {
        upserted: 0,
        stale_marked: 0,
        failures: [{ vehicle_id: null, error: "Respons katalog kosong." }],
      },
    });
    fetchStatusesMock.mockResolvedValue([]);

    const summary = await syncLiveTrack(Date.now());

    expect(store.rpc).toHaveBeenCalledTimes(1);
    const payload = store.rpc.mock.calls[0][1] as {
      p_vehicles: unknown[];
    };
    expect(payload.p_vehicles).toEqual([]);
    expect(summary).toMatchObject({ vehiclesSeen: 0, vehiclesCataloged: 0 });
    expect(summary.failures).toHaveLength(1);
  });

  it("mencatat kegagalan RPC katalog tanpa menandai stale", async () => {
    const store = mockAdmin({ rpcError: { message: "db down" } });
    fetchStatusesMock.mockResolvedValue([vehicleStatus(7, "B 7 Z")] as never);

    const summary = await syncLiveTrack(Date.now());

    expect(store.rpc).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ vehiclesSeen: 1, vehiclesCataloged: 0 });
    expect(summary.failures.join(" ")).toContain("Sinkronisasi katalog unit");
    // Gagal katalog: tidak ada query lanjutan yang menyentuh tabel kendaraan.
    expect(store.from).not.toHaveBeenCalledWith("tms_live_track_vehicles");
  });

  it("melewati baris invalid di aplikasi dan mencatatnya", async () => {
    const store = mockAdmin({
      rpcData: { upserted: 1, stale_marked: 0, failures: [] },
    });
    fetchStatusesMock.mockResolvedValue([
      vehicleStatus(9, "B 9 X"),
      { vehicleId: Number.NaN, licensePlate: "B 0 Z", vehicleGroups: [] },
      { vehicleId: 10, licensePlate: "   ", vehicleGroups: [] },
    ] as never);

    const summary = await syncLiveTrack(Date.now());

    const payload = store.rpc.mock.calls[0][1] as {
      p_vehicles: Record<string, unknown>[];
    };
    expect(payload.p_vehicles).toHaveLength(1);
    expect(payload.p_vehicles[0]).toMatchObject({ mceasy_vehicle_id: 9 });
    expect(summary).toMatchObject({ vehiclesSeen: 3, vehiclesCataloged: 1 });
    expect(summary.failures).toHaveLength(2);
  });
});
