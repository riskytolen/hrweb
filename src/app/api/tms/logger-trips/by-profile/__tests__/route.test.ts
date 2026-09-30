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

import { createClient } from "@/lib/supabase-server";
import { GET } from "@/app/api/tms/logger-trips/by-profile/route";

const createClientMock = vi.mocked(createClient);

function chainable(result: unknown) {
  const chain: Record<string, unknown> = {};
  const terminal = ["or", "ilike", "not", "is", "order", "range", "in", "eq", "gte", "lte", "limit"];
  for (const name of terminal) {
    chain[name] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

function activeProfile(permissions: string[]) {
  return {
    status: "Aktif",
    account_type: "internal",
    roles: { id: 1, nama: "Ops", level: 10, permissions, status: "Aktif" },
  };
}

function mockSupabase(tables: Record<string, unknown>) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => chainable(tables[table] ?? { data: [], error: null }),
  } as never);
}

function baseTables(overrides: Record<string, unknown> = {}) {
  return {
    user_profiles: { data: activeProfile(["tms.view"]), error: null },
    tms_sla_route_profiles: {
      data: {
        id: "profile-van1",
        code: "VAN 1",
        name: "VAN 1",
        client_id: "client-tuku",
        group_id: "group-cp",
        status: "Aktif",
      },
      error: null,
    },
    tms_live_track_groups: { data: { id: "group-cp", name: "CP" }, error: null },
    tms_sla_route_stops: {
      data: [
        { id: "stop-1", route_order: 1, store_name: "Gudang", target_time: "04:15:00", target_day_offset: 0 },
        { id: "stop-2", route_order: 2, store_name: "Toko A", target_time: "04:58:00", target_day_offset: 0 },
      ],
      error: null,
    },
    tms_sla_task_assignments: {
      data: [{ task_id: "task-1", service_date: "2026-09-30", match_score: 1 }],
      error: null,
    },
    tms_trip_visit_logs: {
      data: [
        {
          id: "v-1",
          task_id: "task-1",
          task_number: "FO-1",
          task_status: "ENDED",
          license_plate: "B 1 TES",
          driver_name: "DRIVER",
          route_sequence: 1,
          location_name: "Gudang",
          arrival_actual: null,
          departure_actual: "2026-09-29T21:20:00+07:00",
          last_synced_at: "2026-09-30T00:00:00+07:00",
          sla_route_stop_id: "stop-1",
          sla_kind: "DEPARTURE",
          sla_target_at: "2026-09-30T04:15:00+07:00",
          sla_status: "LATE",
          sla_delta_seconds: 300,
        },
        {
          id: "v-2",
          task_id: "task-1",
          task_number: "FO-1",
          task_status: "ENDED",
          license_plate: "B 1 TES",
          driver_name: "DRIVER",
          route_sequence: 2,
          location_name: "Toko A",
          arrival_actual: "2026-09-30T04:50:00+07:00",
          departure_actual: "2026-09-30T05:00:00+07:00",
          last_synced_at: "2026-09-30T00:00:00+07:00",
          sla_route_stop_id: "stop-2",
          sla_kind: "ARRIVAL",
          sla_target_at: "2026-09-30T04:58:00+07:00",
          sla_status: "ON_TIME",
          sla_delta_seconds: -480,
        },
      ],
      error: null,
    },
    tms_route_point_temperatures: { data: [], error: null },
    ...overrides,
  };
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/tms/logger-trips/by-profile${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/logger-trips/by-profile", () => {
  it("rejects missing profileId with 400", async () => {
    mockSupabase(baseTables());
    const response = await GET(request("?dateFrom=2026-09-30"));
    expect(response.status).toBe(400);
  });

  it("rejects invalid date ranges with 400", async () => {
    mockSupabase(baseTables());
    const response = await GET(request("?profileId=profile-van1&dateFrom=2026-09-30&dateTo=2026-09-29"));
    expect(response.status).toBe(400);
  });

  it("returns 404 for unknown profiles", async () => {
    mockSupabase(baseTables({ tms_sla_route_profiles: { data: null, error: null } }));
    const response = await GET(request("?profileId=missing&dateFrom=2026-09-30"));
    expect(response.status).toBe(404);
  });

  it("groups visits per run ordered by the SLA route", async () => {
    mockSupabase(baseTables());
    const response = await GET(request("?profileId=profile-van1&dateFrom=2026-09-30&dateTo=2026-09-30"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const payload = (await response.json()) as {
      data: {
        profile: { code: string; groupName: string };
        stops: { id: string; routeOrder: number; kind: string }[];
        runs: {
          taskNumber: string;
          serviceDate: string;
          summary: { totalStops: number; visitedStops: number; onTime: number; late: number; compliance: number };
          stopVisits: Record<string, { slaStatus: string } | null>;
          extras: unknown[];
        }[];
      };
      meta: { totalRuns: number; truncated: boolean };
    };
    expect(payload.data.profile).toMatchObject({ code: "VAN 1", groupName: "CP" });
    expect(payload.data.stops.map((s) => s.routeOrder)).toEqual([1, 2]);
    expect(payload.data.stops[0].kind).toBe("DEPARTURE");
    expect(payload.meta).toMatchObject({ totalRuns: 1, truncated: false });
    const run = payload.data.runs[0];
    expect(run).toMatchObject({ taskNumber: "FO-1", serviceDate: "2026-09-30" });
    expect(run.summary).toMatchObject({ totalStops: 2, visitedStops: 2, onTime: 1, late: 1, compliance: 0.5 });
    expect(run.stopVisits["stop-1"]?.slaStatus).toBe("LATE");
    expect(run.stopVisits["stop-2"]?.slaStatus).toBe("ON_TIME");
    expect(run.extras).toHaveLength(0);
  });

  it("shows the profile route with empty runs when no FO is assigned", async () => {
    mockSupabase(baseTables({ tms_sla_task_assignments: { data: [], error: null } }));
    const response = await GET(request("?profileId=profile-van1&dateFrom=2026-09-30"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { stops: unknown[]; runs: unknown[] };
      meta: { totalRuns: number };
    };
    expect(payload.data.stops).toHaveLength(2);
    expect(payload.data.runs).toHaveLength(0);
    expect(payload.meta.totalRuns).toBe(0);
  });

  it("filters runs by search across FO, unit, and driver", async () => {
    mockSupabase(baseTables());
    const response = await GET(request("?profileId=profile-van1&dateFrom=2026-09-30&search=tidak-ada"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { runs: unknown[] } };
    expect(payload.data.runs).toHaveLength(0);
  });
});
