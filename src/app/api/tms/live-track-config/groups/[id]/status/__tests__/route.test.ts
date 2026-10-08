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
import { PUT } from "@/app/api/tms/live-track-config/groups/[id]/status/route";

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

function statusRequest(status: unknown) {
  return new NextRequest("http://localhost/api/tms/live-track-config/groups/group-1/status", {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

const params = Promise.resolve({ id: "group-1" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/tms/live-track-config/groups/[id]/status", () => {
  it("rejects users without manage permission with 403", async () => {
    mockAuth(activeProfile(["tms.view"]));
    createAdminMock.mockReturnValue({ from: vi.fn(), rpc: vi.fn() } as never);
    const response = await PUT(statusRequest("Tidak Aktif"), { params });
    expect(response.status).toBe(403);
  });

  it("rejects invalid statuses with 400 without calling the RPC", async () => {
    mockAuth(activeProfile(["tms.live-track-config.manage"]));
    const rpc = vi.fn();
    createAdminMock.mockReturnValue({ from: vi.fn(), rpc } as never);
    const response = await PUT(statusRequest("Arsip"), { params });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards status changes to the RPC for reconciliation", async () => {
    mockAuth(activeProfile(["tms.live-track-config.manage"]));
    const rpc = vi.fn(async () => ({ data: { id: "group-1", status: "Tidak Aktif" }, error: null }));
    createAdminMock.mockReturnValue({ from: vi.fn(), rpc } as never);
    const response = await PUT(statusRequest("Tidak Aktif"), { params });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("tms_live_track_config_set_group_status", {
      p_group_id: "group-1",
      p_status: "Tidak Aktif",
      p_actor_user: "user-1",
    });
  });
});
