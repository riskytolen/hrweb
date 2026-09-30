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
import { GET, POST } from "@/app/api/tms/sla-profiles/route";

const authorizeMock = vi.mocked(authorizeSlaConfig);
const createAdminMock = vi.mocked(createAdminClient);

function chainable(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ["or", "ilike", "not", "is", "order", "range", "in", "eq", "gte", "lte"]) {
    chain[name] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

function mockAdmin(tables: Record<string, unknown>) {
  const from = (table: string) => chainable({ data: tables[table] ?? [], error: null });
  createAdminMock.mockReturnValue({ from } as never);
}

function allowManage() {
  authorizeMock.mockResolvedValue({
    ok: true,
    context: {
      userId: "user-1",
      permissions: ["tms.sla-config.manage"],
      canManage: true,
      accountType: "internal",
      allowedClientIds: "all",
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  allowManage();
});

describe("GET /api/tms/sla-profiles", () => {
  it("rejects callers without access with 403", async () => {
    authorizeMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "Denied" }), { status: 403 }),
    } as never);
    const response = await GET(new NextRequest("http://localhost/api/tms/sla-profiles"));
    expect(response.status).toBe(403);
  });

  it("returns profiles with stop and unresolved counts", async () => {
    mockAdmin({
      tms_sla_route_profiles: [
        {
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
          source_file: "plan.xlsx",
        },
      ],
      tms_live_track_groups: [{ id: "group-cp", name: "CP", client_id: "client-tuku" }],
      tms_sla_route_stops: [
        { id: "stop-1", profile_id: "profile-van9" },
        { id: "stop-2", profile_id: "profile-van9" },
      ],
      tms_sla_route_stop_addresses: [{ route_stop_id: "stop-1" }],
    });
    const response = await GET(new NextRequest("http://localhost/api/tms/sla-profiles"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { code: string; groupName: string; stopCount: number; unresolvedCount: number }[];
      meta: { canManage: boolean };
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      code: "VAN 9",
      groupName: "CP",
      stopCount: 2,
      unresolvedCount: 1,
    });
    expect(payload.meta.canManage).toBe(true);
  });

  it("orders profiles naturally (VAN 2 before VAN 10)", async () => {
    const makeProfile = (id: string, code: string) => ({
      id,
      code,
      name: code,
      client_id: "client-tuku",
      group_id: "group-cp",
      departure_target_time: null,
      departure_day_offset: 0,
      effective_from: "2026-09-29",
      effective_until: null,
      status: "Aktif",
      source_file: null,
    });
    mockAdmin({
      tms_sla_route_profiles: [makeProfile("p10", "VAN 10"), makeProfile("p2", "VAN 2"), makeProfile("p1", "VAN 1")],
      tms_live_track_groups: [{ id: "group-cp", name: "CP", client_id: "client-tuku" }],
      tms_sla_route_stops: [],
      tms_sla_route_stop_addresses: [],
    });
    const response = await GET(new NextRequest("http://localhost/api/tms/sla-profiles"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { code: string }[] };
    expect(payload.data.map((p) => p.code)).toEqual(["VAN 1", "VAN 2", "VAN 10"]);
  });

  it("hides profiles whose group belongs to another client", async () => {
    authorizeMock.mockResolvedValueOnce({
      ok: true,
      context: {
        userId: "user-1",
        permissions: ["tms.sla-config.view"],
        canManage: false,
        accountType: "internal",
        allowedClientIds: ["client-tuku"],
      },
    } as never);
    mockAdmin({
      tms_sla_route_profiles: [
        {
          id: "profile-x",
          code: "VAN X",
          name: "VAN X",
          client_id: "client-tuku",
          group_id: "group-other",
          departure_target_time: null,
          departure_day_offset: 0,
          effective_from: "2026-09-29",
          effective_until: null,
          status: "Aktif",
          source_file: null,
        },
      ],
      tms_live_track_groups: [{ id: "group-other", name: "Other", client_id: "client-lain" }],
      tms_sla_route_stops: [],
      tms_sla_route_stop_addresses: [],
    });
    const response = await GET(new NextRequest("http://localhost/api/tms/sla-profiles"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: unknown[] };
    expect(payload.data).toHaveLength(0);
  });
});

describe("POST /api/tms/sla-profiles", () => {
  function postRequest(body: unknown) {
    return new NextRequest("http://localhost/api/tms/sla-profiles", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("rejects manage without permission", async () => {
    authorizeMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "Denied" }), { status: 403 }),
    } as never);
    const response = await POST(postRequest({}));
    expect(response.status).toBe(403);
  });

  it("validates required fields", async () => {
    mockAdmin({});
    const response = await POST(postRequest({ code: "VAN 13" }));
    expect(response.status).toBe(400);
  });

  it("creates a profile bound to the group client", async () => {
    const insertChain = chainable({ data: { id: "profile-new" }, error: null });
    const from = (table: string) => {
      if (table === "tms_live_track_groups") {
        return chainable({
          data: { id: "group-cp", name: "CP", client_id: "client-tuku" },
          error: null,
        });
      }
      if (table === "tms_sla_route_profiles") return insertChain;
      return chainable({ data: [], error: null });
    };
    createAdminMock.mockReturnValue({ from } as never);

    const response = await POST(
      postRequest({ groupId: "group-cp", code: "van 13", effectiveFrom: "2026-10-01" }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { data: { id: string } };
    expect(payload.data.id).toBe("profile-new");
    const insertMock = insertChain.insert as unknown as { mock: { calls: unknown[][] } };
    const inserted = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      client_id: "client-tuku",
      group_id: "group-cp",
      code: "VAN 13",
      effective_from: "2026-10-01",
      status: "Aktif",
    });
  });

  it("rejects groups outside the caller scope", async () => {
    authorizeMock.mockResolvedValueOnce({
      ok: true,
      context: {
        userId: "user-1",
        permissions: ["tms.sla-config.manage"],
        canManage: true,
        accountType: "internal",
        allowedClientIds: ["client-tuku"],
      },
    } as never);
    const from = (table: string) => {
      if (table === "tms_live_track_groups") {
        return chainable({
          data: { id: "group-other", name: "Other", client_id: "client-lain" },
          error: null,
        });
      }
      return chainable({ data: [], error: null });
    };
    createAdminMock.mockReturnValue({ from } as never);
    const response = await POST(
      postRequest({ groupId: "group-other", code: "VAN 1", effectiveFrom: "2026-10-01" }),
    );
    expect(response.status).toBe(403);
  });
});
