import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/tms-tenant-auth", () => ({
  authorizeTmsScope: vi.fn(async () => ({
    ok: true,
    scope: { allowedClientIds: ["client-tuku"], isSuperAdmin: false, canAccessAllClients: false },
    selectedClientId: "client-tuku",
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
import { GET } from "@/app/api/tms/logger-trips/profiles/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);

function chainable(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ["or", "ilike", "not", "is", "order", "range", "in", "eq", "gte", "lte"]) {
    chain[name] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

let adminFromSpy: ReturnType<typeof vi.fn> = vi.fn();

function mockSupabase(options: {
  user?: { id: string } | null;
  profile?: unknown;
  profiles?: unknown[];
  groups?: unknown[];
}) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: options.user ?? null }, error: null }) },
    from: () => chainable({ data: options.profile ?? null, error: null }),
  } as never);
  const tables: Record<string, unknown> = {
    tms_sla_route_profiles: options.profiles ?? [],
    tms_live_track_groups: options.groups ?? [],
  };
  adminFromSpy = vi.fn((table: string) => chainable({ data: tables[table] ?? [], error: null }));
  createAdminMock.mockReturnValue({ from: adminFromSpy } as never);
}

function externalLoggerProfile() {
  return {
    status: "Aktif",
    account_type: "external",
    roles: { id: 2, nama: "Tuku Client", level: 0, permissions: ["tms.logger-trips.view"], status: "Aktif" },
  };
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/tms/logger-trips/profiles${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/logger-trips/profiles", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockSupabase({ user: null });
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("rejects users without logger permission with 403", async () => {
    mockSupabase({
      user: { id: "user-1" },
      profile: {
        status: "Aktif",
        account_type: "external",
        roles: { id: 3, nama: "Lain", level: 0, permissions: ["dashboard"], status: "Aktif" },
      },
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
  });

  it("serves scoped profiles to external logger viewers in natural order", async () => {
    const makeProfile = (id: string, code: string) => ({ id, code, group_id: "group-cp" });
    mockSupabase({
      user: { id: "user-1" },
      profile: externalLoggerProfile(),
      profiles: [makeProfile("p10", "VAN 10"), makeProfile("p2", "VAN 2"), makeProfile("p1", "VAN 1")],
      groups: [{ id: "group-cp", name: "CP" }],
    });
    const response = await GET(request("?client=tuku"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const payload = (await response.json()) as {
      data: { id: string; code: string; groupName: string | null }[];
    };
    expect(payload.data.map((p) => p.code)).toEqual(["VAN 1", "VAN 2", "VAN 10"]);
    expect(payload.data[0]).toMatchObject({ id: "p1", groupName: "CP" });
    expect(adminFromSpy).toHaveBeenCalledWith("tms_sla_route_profiles");
  });

  it("returns 502 when the profile query fails", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
      from: () => chainable({ data: externalLoggerProfile(), error: null }),
    } as never);
    createAdminMock.mockReturnValue({
      from: (table: string) =>
        chainable(
          table === "tms_sla_route_profiles"
            ? { data: null, error: { message: "permission denied" } }
            : { data: [], error: null },
        ),
    } as never);
    const response = await GET(request());
    expect(response.status).toBe(502);
  });
});
