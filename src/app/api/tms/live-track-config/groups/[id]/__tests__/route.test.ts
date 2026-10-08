import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/tms-tenant-auth", () => ({
  authorizeTmsScope: vi.fn(async () => ({
    ok: true,
    scope: { allowedClientIds: "all", isSuperAdmin: false, canAccessAllClients: true },
    selectedClientId: null,
  })),
  applyClientScope: (query: unknown) => query,
  isRecordInScope: () => true,
  fetchScopedVehicleMap: vi.fn(async () => "all"),
  isVehicleInScopedMap: () => true,
  normalizeTenantPlateKey: (value: string | null | undefined) => (value ?? "").toUpperCase(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { PUT } from "@/app/api/tms/live-track-config/groups/[id]/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);

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

const validBody = {
  name: "CP",
  color: "#0284c7",
  defaultWindowStart: "06:00",
  defaultWindowEnd: "18:00",
  members: [
    {
      mceasyVehicleId: 14576,
      licensePlate: "B 9402 BCU",
      vendorGroups: [],
      useGroupSchedule: true,
      overrideWindowStart: null,
      overrideWindowEnd: null,
      enabled: true,
    },
  ],
};

function putRequest(body: unknown) {
  return new NextRequest("http://localhost/api/tms/live-track-config/groups/group-1", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function mockAdmin(existingClientId: string | null, rpcImpl?: () => Promise<unknown>) {
  const rpc = vi.fn(
    rpcImpl ?? (async () => ({ data: { group_id: "group-1", member_count: 1 }, error: null })),
  );
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { client_id: existingClientId }, error: null }),
      }),
    }),
  }));
  createAdminMock.mockReturnValue({ from, rpc } as never);
  return { from, rpc };
}

const params = Promise.resolve({ id: "group-1" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/tms/live-track-config/groups/[id]", () => {
  it("rejects users without manage permission with 403", async () => {
    mockAuth(activeProfile(["tms.view"]));
    createAdminMock.mockReturnValue({ from: vi.fn(), rpc: vi.fn() } as never);
    const response = await PUT(putRequest(validBody), { params });
    expect(response.status).toBe(403);
  });

  it("keeps the existing client and forwards it for reconciliation", async () => {
    mockAuth(activeProfile(["tms.live-track-config.manage"]));
    const { rpc } = mockAdmin("client-tuku");
    const response = await PUT(putRequest(validBody), { params });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "tms_live_track_config_save_group",
      expect.objectContaining({ p_client_id: "client-tuku" }),
    );
  });

  it("uses the requested client when the group has none yet", async () => {
    mockAuth(activeProfile(["tms.live-track-config.manage"]));
    const { rpc } = mockAdmin(null);
    const response = await PUT(putRequest({ ...validBody, clientId: "client-tuku" }), { params });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "tms_live_track_config_save_group",
      expect.objectContaining({ p_client_id: "client-tuku" }),
    );
  });

  it("maps reconciliation conflicts to 400 with the database message", async () => {
    mockAuth(activeProfile(["tms.live-track-config.manage"]));
    mockAdmin("client-tuku", async () => ({
      data: null,
      error: { message: "Unit B 1 A masih aktif pada client Lain" },
    }));
    const response = await PUT(putRequest(validBody), { params });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("masih aktif pada client");
  });
});
