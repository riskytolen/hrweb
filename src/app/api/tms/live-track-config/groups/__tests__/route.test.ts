import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { GET, POST } from "@/app/api/tms/live-track-config/groups/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);

function chainable(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ["or", "ilike", "not", "is", "order", "range", "in", "eq", "lte", "gt", "limit"]) {
    chain[name] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
  chain.upsert = vi.fn(async () => ({ data: null, error: null }));
  chain.update = vi.fn(() => chain);
  chain.rpc = vi.fn(async () => ({ data: { group_id: "g-1", member_count: 1 }, error: null }));
  chain.single = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

function mockAuth(profile: unknown) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: profile, error: null }),
        }),
      }),
    }),
  } as never);
}

function activeProfile(permissions: string[]) {
  return {
    status: "Aktif",
    account_type: "internal",
    roles: { id: 1, nama: "Ops", level: 10, permissions, status: "Aktif" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/live-track-config/groups", () => {
  it("rejects users without config view access with 403", async () => {
    mockAuth(activeProfile(["dashboard"]));
    const admin = { from: vi.fn(() => chainable({ data: [], error: null })) };
    createAdminMock.mockReturnValue(admin as never);
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("allows tms viewers to read groups with canManage=false", async () => {
    mockAuth(activeProfile(["tms.view"]));
    const from = vi.fn((table: string) => {
      if (table === "tms_live_track_groups") {
        return chainable({ data: [], error: null });
      }
      return chainable({ data: [], error: null });
    });
    createAdminMock.mockReturnValue({ from } as never);
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { meta: { canManage: boolean } };
    expect(payload.meta.canManage).toBe(false);
  });
});

describe("POST /api/tms/live-track-config/groups", () => {
  const validBody = {
    name: "CP Suka",
    color: "#0284c7",
    defaultWindowStart: "06:00",
    defaultWindowEnd: "18:00",
    members: [
      {
        mceasyVehicleId: 11418,
        licensePlate: "B 1234 TES",
        vendorGroups: [],
        useGroupSchedule: true,
        overrideWindowStart: null,
        overrideWindowEnd: null,
        enabled: true,
      },
    ],
  };

  function postRequest(body: unknown) {
    return new NextRequest("http://localhost/api/tms/live-track-config/groups", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("rejects tms viewers without manage permission with 403", async () => {
    mockAuth(activeProfile(["tms"]));
    createAdminMock.mockReturnValue({ from: vi.fn(), rpc: vi.fn() } as never);
    const response = await POST(postRequest(validBody));
    expect(response.status).toBe(403);
  });

  it("rejects invalid payloads with 400", async () => {
    mockAuth(activeProfile(["tms.live-track-config.manage"]));
    createAdminMock.mockReturnValue({ from: vi.fn(), rpc: vi.fn() } as never);
    const response = await POST(postRequest({ name: "", members: [] }));
    expect(response.status).toBe(400);
  });

  it("saves groups atomically via RPC for managers", async () => {
    mockAuth(activeProfile(["tms.live-track-config.manage"]));
    const rpc = vi.fn(async () => ({ data: { group_id: "g-1", member_count: 1 }, error: null }));
    createAdminMock.mockReturnValue({ rpc } as never);
    const response = await POST(postRequest(validBody));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "tms_live_track_config_save_group",
      expect.objectContaining({
        p_members: expect.arrayContaining([
          expect.objectContaining({ mceasy_vehicle_id: 11418, license_plate: "B 1234 TES" }),
        ]),
      }),
    );
  });
});
