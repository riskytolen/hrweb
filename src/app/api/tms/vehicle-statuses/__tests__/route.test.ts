import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/mceasy-server", () => ({
  McEasyError: class McEasyError extends Error {
    status: number;
    constructor(message: string, status = 502) {
      super(message);
      this.status = status;
    }
  },
  fetchMcEasyVehicleStatuses: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { fetchMcEasyVehicleStatuses } from "@/lib/mceasy-server";
import { GET } from "@/app/api/tms/vehicle-statuses/route";

const createClientMock = vi.mocked(createClient);
const fetchStatusesMock = vi.mocked(fetchMcEasyVehicleStatuses);

function mockProfile(permissions: string[], accountType = "internal") {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              status: "Aktif",
              account_type: accountType,
              roles: { id: 1, nama: "Ops", level: 10, permissions, status: "Aktif" },
            },
            error: null,
          }),
        }),
      }),
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/vehicle-statuses", () => {
  it("rejects unauthenticated callers with 401", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);

    const response = await GET(new NextRequest("http://localhost/api/tms/vehicle-statuses"));
    expect(response.status).toBe(401);
    expect(fetchStatusesMock).not.toHaveBeenCalled();
  });

  it("rejects users without tms permission with 403", async () => {
    mockProfile(["dashboard"]);
    const response = await GET(new NextRequest("http://localhost/api/tms/vehicle-statuses"));
    expect(response.status).toBe(403);
    expect(fetchStatusesMock).not.toHaveBeenCalled();
  });

  it("returns sanitized fleet data with no-store headers", async () => {
    mockProfile(["tms.view"]);
    fetchStatusesMock.mockResolvedValue([
      {
        vehicleId: 123,
        licensePlate: "L 123 TES",
        latitude: -7.26,
        longitude: 112.75,
        altitude: 0,
        speed: 8,
        calculatedSpeed: 8,
        direction: 328,
        engineOn: true,
        motionStatus: "M",
        calculatedMotionStatus: "M",
        lastPacket: null,
        lastReceive: new Date().toISOString(),
        lastMotion: null,
        address: "Surabaya",
        province: "",
        city: "",
        district: "",
        vehicleGroups: [],
        driverName: null,
        temperatures: [8],
        signalStrength: 5,
        status: "moving",
        hasValidLocation: true,
      },
    ]);

    const response = await GET(new NextRequest("http://localhost/api/tms/vehicle-statuses"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const payload = (await response.json()) as { data: unknown[]; meta: { total: number } };
    expect(payload.meta.total).toBe(1);
    expect(JSON.stringify(payload)).not.toContain("test-token");
  });
});
