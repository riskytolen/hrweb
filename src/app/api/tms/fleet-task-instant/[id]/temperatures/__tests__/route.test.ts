import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/mceasy-server", () => ({
  McEasyError: class McEasyError extends Error {
    status: number;
    constructor(message: string, status = 502) {
      super(message);
      this.status = status;
    }
  },
  fetchFleetTaskInstantDetail: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { fetchFleetTaskInstantDetail } from "@/lib/mceasy-server";
import { GET } from "@/app/api/tms/fleet-task-instant/[id]/temperatures/route";

const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);
const fetchDetailMock = vi.mocked(fetchFleetTaskInstantDetail);

function mockProfile(permissions: string[]) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              status: "Aktif",
              account_type: "internal",
              roles: { id: 1, nama: "Ops", level: 10, permissions, status: "Aktif" },
            },
            error: null,
          }),
        }),
      }),
    }),
  } as never);
}

function request(uuid = "task-uuid") {
  return new NextRequest(`http://localhost/api/tms/fleet-task-instant/${uuid}/temperatures`);
}

const DETAIL_FIXTURE = {
  id: "task-uuid",
  number: "FO-9262",
  vehicle: { license_plate: "B 9402 BCU" },
  timeline_route: [
    {
      plan_sequence: 1,
      address: { name: "Gudang", full_name: "Jl. Gudang" },
      visit_status: { raw_type: "VISITED", name: "Dikunjungi" },
      arrival_time: { actual: "2026-09-16T10:00:00+07:00" },
    },
    {
      plan_sequence: 2,
      address: { name: "Toko", full_name: "Jl. Toko" },
      visit_status: { raw_type: "WILL_VISITED", name: "Akan Dikunjungi" },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/fleet-task-instant/[id]/temperatures", () => {
  it("rejects users without tms permission with 403", async () => {
    mockProfile(["dashboard"]);
    const response = await GET(request(), { params: Promise.resolve({ id: "task-uuid" }) });
    expect(response.status).toBe(403);
    expect(fetchDetailMock).not.toHaveBeenCalled();
  });

  it("matches the nearest reading to each visited point", async () => {
    mockProfile(["tms.view"]);
    fetchDetailMock.mockResolvedValue(DETAIL_FIXTURE);
    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          license_plate: "B 9402 BCU",
          temperature: 4.5,
          temperature_num: 1,
          received_at: "2026-09-16T10:05:00+07:00",
        },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const ilike = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ ilike });
    createAdminClientMock.mockReturnValue({ from: () => ({ select }) } as never);

    const response = await GET(request(), { params: Promise.resolve({ id: "task-uuid" }) });
    expect(response.status).toBe(200);
    expect(ilike).toHaveBeenCalledWith("license_plate", "B 9402 BCU");
    const payload = (await response.json()) as {
      data: Array<{ sequence: number; temperature: number }>;
      meta: { licensePlate: string; windowMinutes: number };
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({ sequence: 1, temperature: 4.5 });
    expect(payload.meta).toMatchObject({ licensePlate: "B 9402 BCU", windowMinutes: 30 });
  });

  it("returns empty data when the task has no license plate", async () => {
    mockProfile(["tms.view"]);
    fetchDetailMock.mockResolvedValue({ id: "task-uuid" });
    const response = await GET(request(), { params: Promise.resolve({ id: "task-uuid" }) });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: unknown[] };
    expect(payload.data).toEqual([]);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});
