import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
import { GET } from "@/app/api/tms/logger-trips/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);

// Builder rantai Supabase yang bisa di-await dan mengembalikan hasil preset.
function chainable(result: unknown) {
  const chain: Record<string, unknown> = {};
  const terminal = ["or", "ilike", "not", "is", "order", "range", "in", "eq", "gte", "lte"];
  for (const name of terminal) {
    chain[name] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

interface FromHandler {
  (table: string): Record<string, unknown>;
}

function mockSupabase(options: {
  user?: { id: string } | null;
  profile?: unknown;
  visits?: unknown[];
  count?: number | null;
  temperatures?: unknown[];
  countRows?: unknown[];
  slaProfiles?: unknown[];
  groups?: unknown[];
}) {
  const visitsResult = { data: options.visits ?? [], error: null, count: options.count ?? null };
  const countResult = { data: options.countRows ?? [], error: null, count: options.count ?? null };
  const tempResult = { data: options.temperatures ?? [], error: null };
  const profileResult = { data: options.profile ?? null, error: null };

  let visitCalls = 0;
  const visitQueries: Record<string, unknown>[] = [];
  const from: FromHandler = (table: string) => {
    if (table === "user_profiles") return chainable(profileResult);
    if (table === "tms_trip_visit_logs") {
      visitCalls += 1;
      const query = chainable(visitCalls === 1 ? visitsResult : countResult);
      if (visitCalls === 1) visitQueries.push(query);
      return query;
    }
    if (table === "tms_route_point_temperatures") return chainable(tempResult);
    return chainable({ data: [], error: null });
  };

  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: options.user ?? null }, error: null }) },
    from,
  } as never);
  const adminTables: Record<string, unknown[]> = {
    tms_sla_route_profiles: options.slaProfiles ?? [],
    tms_live_track_groups: options.groups ?? [],
  };
  createAdminMock.mockReturnValue({
    from: (table: string) => chainable({ data: adminTables[table] ?? [], error: null }),
  } as never);

  return { visitQueries };
}

function activeProfile(permissions: string[]) {
  return {
    status: "Aktif",
    account_type: "internal",
    roles: { id: 1, nama: "Ops", level: 10, permissions, status: "Aktif" },
  };
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/tms/logger-trips${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/logger-trips", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockSupabase({ user: null });
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("rejects users without tms permission with 403", async () => {
    mockSupabase({ user: { id: "user-1" }, profile: activeProfile(["dashboard"]) });
    const response = await GET(request());
    expect(response.status).toBe(403);
  });

  it("rejects invalid date filters with 400", async () => {
    mockSupabase({ user: { id: "user-1" }, profile: activeProfile(["tms"]) });
    const response = await GET(request("?dateFrom=bukan-tanggal"));
    expect(response.status).toBe(400);
  });

  it("returns visits with temperature join, counts, and no-store headers", async () => {
    mockSupabase({
      user: { id: "user-1" },
      profile: activeProfile(["tms.view"]),
      visits: [
        {
          id: "row-1",
          task_id: "task-1",
          task_number: "FO-1001",
          task_status: "STARTED",
          license_plate: "B 1234 TES",
          driver_name: "ASEP SURAHMAN",
          route_sequence: 2,
          point_type: "END",
          location_name: "Toko A",
          location_address: "Jl. A",
          arrival_actual: "2026-09-22T06:12:00+07:00",
          departure_actual: null,
          last_synced_at: "2026-09-22T06:15:00+07:00",
        },
      ],
      count: 1,
      temperatures: [{ task_id: "task-1", route_sequence: 2, temperatures: [-16.2] }],
      countRows: [{ arrival_actual: "2026-09-22T06:12:00+07:00", departure_actual: null }],
    });

    const response = await GET(request("?visitState=ONGOING"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const payload = (await response.json()) as {
      data: { unit: string; temperatureC: number | null; enteredAt: string; exitedAt: null }[];
      meta: {
        total: number;
        counts: { ongoing: number };
        lastSyncedAt: string | null;
      };
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      unit: "B 1234 TES",
      temperatureC: -16.2,
      enteredAt: "2026-09-22T06:12:00+07:00",
      exitedAt: null,
    });
    expect(payload.meta.total).toBe(1);
    expect(payload.meta.counts.ongoing).toBe(1);
    expect(payload.meta.lastSyncedAt).toBe("2026-09-22T06:15:00+07:00");
  });

  it("memetakan snapshot SLA, label profil/kelompok, dan ringkasan sla", async () => {
    mockSupabase({
      user: { id: "user-1" },
      profile: activeProfile(["tms.view"]),
      visits: [
        {
          id: "row-sla",
          task_id: "task-1",
          task_number: "FO-1001",
          task_status: "STARTED",
          license_plate: "B 1234 TES",
          driver_name: "ASEP SURAHMAN",
          route_sequence: 2,
          point_type: "DEFAULT",
          location_name: "Toko A",
          location_address: "Jl. A",
          arrival_actual: "2026-09-30T05:02:00+07:00",
          departure_actual: "2026-09-30T05:20:00+07:00",
          last_synced_at: "2026-09-30T05:25:00+07:00",
          live_track_group_id: "group-cp",
          sla_profile_id: "profile-van9",
          sla_kind: "ARRIVAL",
          sla_target_at: "2026-09-30T05:05:00+07:00",
          sla_status: "ON_TIME",
          sla_delta_seconds: -180,
        },
      ],
      count: 1,
      temperatures: [],
      countRows: [{ arrival_actual: "2026-09-30T05:02:00+07:00", departure_actual: "2026-09-30T05:20:00+07:00", sla_status: "ON_TIME" }],
      slaProfiles: [{ id: "profile-van9", code: "RUTE 9" }],
      groups: [{ id: "group-cp", name: "CP" }],
    });

    const response = await GET(request("?sla=ON_TIME"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: {
        slaKind: string | null;
        slaStatus: string | null;
        slaTargetAt: string | null;
        slaDeltaSeconds: number | null;
        slaProfileCode: string | null;
        groupName: string | null;
      }[];
      meta: { sla: { onTime: number; late: number; pending: number; unset: number; unevaluated: number } };
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      slaKind: "ARRIVAL",
      slaStatus: "ON_TIME",
      slaTargetAt: "2026-09-30T05:05:00+07:00",
      slaDeltaSeconds: -180,
      slaProfileCode: "RUTE 9",
      groupName: "CP",
    });
    expect(createAdminMock).toHaveBeenCalledOnce();
    expect(payload.meta.sla).toMatchObject({ onTime: 1, late: 0, pending: 0, unset: 0, unevaluated: 0 });
  });

  it("menyertakan baris belum dikunjungi dalam rentang last_synced_at", async () => {
    const { visitQueries } = mockSupabase({
      user: { id: "user-1" },
      profile: activeProfile(["tms.view"]),
      visits: [],
      count: 0,
      temperatures: [],
      countRows: [],
    });

    const response = await GET(request("?visitState=PENDING&dateFrom=2026-10-02&dateTo=2026-10-03"));
    expect(response.status).toBe(200);
    const dataQuery = visitQueries[0] as unknown as { or: { mock: { calls: [string][] } } };
    expect(dataQuery.or.mock.calls[0][0]).toContain(
      "and(arrival_actual.is.null,departure_actual.is.null,last_synced_at.gte.2026-10-02T00:00:00+07:00,last_synced_at.lte.2026-10-03T23:59:59.999+07:00)",
    );
  });
});
