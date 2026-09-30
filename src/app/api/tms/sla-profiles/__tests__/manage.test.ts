import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/tms-sla-auth", () => ({
  authorizeSlaConfig: vi.fn(),
  slaConfigError: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
  slaConfigJson: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status }),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { authorizeSlaConfig } from "@/lib/tms-sla-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { GET as getDetail, PATCH as patchProfile } from "@/app/api/tms/sla-profiles/[id]/route";
import { POST as createStop } from "@/app/api/tms/sla-profiles/[id]/stops/route";
import { POST as importProfiles } from "@/app/api/tms/sla-profiles/import/route";

const authorizeMock = vi.mocked(authorizeSlaConfig);
const createAdminMock = vi.mocked(createAdminClient);

function chainable(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ["or", "ilike", "not", "is", "order", "range", "in", "eq", "gte", "lte", "limit"]) {
    chain[name] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

function mockAdmin(handler: (table: string) => Record<string, unknown>) {
  createAdminMock.mockReturnValue({ from: handler } as never);
}

function allowManage(scope: "all" | string[] = "all") {
  authorizeMock.mockResolvedValue({
    ok: true,
    context: {
      userId: "user-1",
      permissions: ["tms.sla-config.manage"],
      canManage: true,
      accountType: "internal",
      allowedClientIds: scope,
    },
  } as never);
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, { method, body: JSON.stringify(body) });
}

const PROFILE = {
  id: "profile-van9",
  code: "VAN 9",
  name: "VAN 9 CP Tuku",
  client_id: "client-tuku",
  group_id: "group-cp",
  departure_target_time: null,
  departure_day_offset: 0,
  effective_from: "2026-09-29",
  effective_until: null,
  status: "Aktif",
  source_file: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  allowManage();
});

describe("GET /api/tms/sla-profiles/[id]", () => {
  it("returns detail with stops, addresses, and unresolved flags", async () => {
    mockAdmin((table: string) => {
      if (table === "tms_sla_route_profiles") return chainable({ data: PROFILE, error: null });
      if (table === "tms_live_track_groups")
        return chainable({ data: { id: "group-cp", name: "CP" }, error: null });
      if (table === "tms_sla_route_stops") {
        return chainable({
          data: [
            { id: "stop-1", profile_id: "profile-van9", route_order: 1, store_name: "Toko A", target_time: "05:05:00", target_day_offset: 0 },
            { id: "stop-2", profile_id: "profile-van9", route_order: 2, store_name: "Toko B", target_time: "05:54:00", target_day_offset: 0 },
          ],
          error: null,
        });
      }
      if (table === "tms_sla_route_stop_addresses") {
        return chainable({
          data: [{ id: "addr-1", route_stop_id: "stop-1", vendor_address_id: "43690", store_name_snapshot: "Toko A", is_primary: true }],
          error: null,
        });
      }
      return chainable({ data: [], error: null });
    });
    const response = await getDetail(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ id: "profile-van9" }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { stops: { storeName: string; unresolved: boolean; addresses: unknown[] }[] };
    };
    expect(payload.data.stops).toHaveLength(2);
    expect(payload.data.stops[0]).toMatchObject({ storeName: "Toko A", unresolved: false });
    expect(payload.data.stops[1]).toMatchObject({ storeName: "Toko B", unresolved: true });
  });

  it("rejects profiles outside the caller scope", async () => {
    allowManage(["client-tuku"]);
    mockAdmin((table: string) => {
      if (table === "tms_sla_route_profiles") {
        return chainable({ data: { ...PROFILE, client_id: "client-lain" }, error: null });
      }
      return chainable({ data: [], error: null });
    });
    const response = await getDetail(new NextRequest("http://localhost/x"), {
      params: Promise.resolve({ id: "profile-van9" }),
    });
    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/tms/sla-profiles/[id]", () => {
  function patchAdmin(updateResult: unknown = { data: null, error: null }) {
    const updateSpy = vi.fn(() => chainable(updateResult));
    mockAdmin((table: string) => {
      if (table === "tms_sla_route_profiles") {
        const chain = chainable({ data: PROFILE, error: null });
        chain.update = updateSpy;
        return chain;
      }
      return chainable({ data: [], error: null });
    });
    return updateSpy;
  }

  function patchParams() {
    return { params: Promise.resolve({ id: "profile-van9" }) };
  }

  it("updates code and name with normalization", async () => {
    const updateSpy = patchAdmin();
    const response = await patchProfile(
      jsonRequest("http://localhost/x", "PATCH", { code: "  van  a ", name: "Rute Pagi CP" }),
      patchParams(),
    );
    expect(response.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: "VAN A", name: "Rute Pagi CP" }),
    );
  });

  it("rejects empty code with 400", async () => {
    patchAdmin();
    const response = await patchProfile(
      jsonRequest("http://localhost/x", "PATCH", { code: "   " }),
      patchParams(),
    );
    expect(response.status).toBe(400);
  });

  it("maps duplicate code conflicts to 409", async () => {
    patchAdmin({ data: null, error: { message: "duplicate key value violates unique constraint" } });
    const response = await patchProfile(
      jsonRequest("http://localhost/x", "PATCH", { code: "VAN 9" }),
      patchParams(),
    );
    expect(response.status).toBe(409);
  });

  it("rejects profiles outside the caller scope", async () => {
    allowManage(["client-tuku"]);
    mockAdmin((table: string) => {
      if (table === "tms_sla_route_profiles") {
        return chainable({ data: { ...PROFILE, client_id: "client-lain" }, error: null });
      }
      return chainable({ data: [], error: null });
    });
    const response = await patchProfile(
      jsonRequest("http://localhost/x", "PATCH", { name: "Lain" }),
      patchParams(),
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /api/tms/sla-profiles/[id]/stops", () => {
  it("creates a stop with address mappings", async () => {
    const insertChain = chainable({ data: { id: "stop-new" }, error: null });
    mockAdmin((table: string) => {
      if (table === "tms_sla_route_profiles") return chainable({ data: PROFILE, error: null });
      if (table === "tms_sla_route_stops") {
        const chain = chainable({ data: [{ route_order: 1 }], error: null });
        // Insert path: select().single() -> created id; reuse same chain.
        chain.single = vi.fn(async () => ({ data: { id: "stop-new" }, error: null }));
        return chain;
      }
      if (table === "tms_sla_route_stop_addresses") return insertChain;
      return chainable({ data: [], error: null });
    });
    const response = await createStop(
      jsonRequest("http://localhost/x", "POST", {
        storeName: "Toko Baru",
        targetTime: "08:30",
        addressIds: ["12345"],
      }),
      { params: Promise.resolve({ id: "profile-van9" }) },
    );
    expect(response.status).toBe(201);
    expect(insertChain.insert).toHaveBeenCalled();
  });

  it("rejects duplicate route order with 409", async () => {
    mockAdmin((table: string) => {
      if (table === "tms_sla_route_profiles") return chainable({ data: PROFILE, error: null });
      if (table === "tms_sla_route_stops") {
        return chainable({ data: [{ route_order: 1 }, { route_order: 2 }], error: null });
      }
      return chainable({ data: [], error: null });
    });
    const response = await createStop(
      jsonRequest("http://localhost/x", "POST", {
        storeName: "Toko Baru",
        targetTime: "08:30",
        routeOrder: 2,
      }),
      { params: Promise.resolve({ id: "profile-van9" }) },
    );
    expect(response.status).toBe(409);
  });
});

describe("POST /api/tms/sla-profiles/import", () => {
  const payload = {
    groupId: "group-cp",
    effectiveFrom: "2026-10-01",
    dryRun: true,
    profiles: [
      {
        code: "VAN 13",
        stops: [
          { storeName: "Toko A", targetTime: "05:00", addressIds: ["43690"] },
          { storeName: "Toko Baru", targetTime: "06:00", addressIds: ["999999"] },
          { storeName: "Toko Tanpa ID", targetTime: "07:00" },
        ],
      },
    ],
  };

  function importAdmin() {
    mockAdmin((table: string) => {
      if (table === "tms_live_track_groups") {
        return chainable({ data: { id: "group-cp", name: "CP", client_id: "client-tuku" }, error: null });
      }
      if (table === "tms_trip_visit_logs") {
        return chainable({ data: [{ address_id: "43690" }], error: null });
      }
      return chainable({ data: [], error: null });
    });
  }

  it("previews without writing on dryRun", async () => {
    importAdmin();
    const insertSpy = vi.fn();
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_live_track_groups") {
          return chainable({ data: { id: "group-cp", name: "CP", client_id: "client-tuku" }, error: null });
        }
        if (table === "tms_trip_visit_logs") {
          return chainable({ data: [{ address_id: "43690" }], error: null });
        }
        const chain = chainable({ data: [], error: null });
        chain.insert = insertSpy;
        return chain;
      },
    } as never);
    const response = await importProfiles(jsonRequest("http://localhost/x", "POST", payload));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { profiles: { code: string; unresolvedCount: number }[]; issues: { type: string }[]; wrote: boolean };
    };
    expect(body.data.wrote).toBe(false);
    expect(body.data.profiles[0]).toMatchObject({ code: "VAN 13", unresolvedCount: 2 });
    expect(body.data.issues.map((i) => i.type)).toContain("UNKNOWN_ADDRESS");
    expect(body.data.issues.map((i) => i.type)).toContain("MISSING_MAPPING");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid times with 400", async () => {
    importAdmin();
    const bad = {
      ...payload,
      dryRun: true,
      profiles: [{ code: "VAN 13", stops: [{ storeName: "Toko A", targetTime: "jam lima" }] }],
    };
    const response = await importProfiles(jsonRequest("http://localhost/x", "POST", bad));
    expect(response.status).toBe(400);
  });

  it("rejects groups outside the caller scope", async () => {
    allowManage(["client-tuku"]);
    mockAdmin((table: string) => {
      if (table === "tms_live_track_groups") {
        return chainable({ data: { id: "group-x", name: "X", client_id: "client-lain" }, error: null });
      }
      return chainable({ data: [], error: null });
    });
    const response = await importProfiles(
      jsonRequest("http://localhost/x", "POST", { ...payload, dryRun: true, groupId: "group-x" }),
    );
    expect(response.status).toBe(403);
  });
});
