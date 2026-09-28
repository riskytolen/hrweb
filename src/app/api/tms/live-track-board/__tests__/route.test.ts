import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { GET } from "@/app/api/tms/live-track-board/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);

function chainable(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ["or", "lte", "gt", "order", "limit"]) {
    chain[name] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
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

function request(query = "") {
  return new NextRequest(`http://localhost/api/tms/live-track-board${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/live-track-board", () => {
  it("rejects unauthenticated callers with 401", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("rejects users without tms permission with 403", async () => {
    mockAuth(activeProfile(["dashboard"]));
    createAdminMock.mockReturnValue({ from: vi.fn() } as never);
    const response = await GET(request());
    expect(response.status).toBe(403);
  });

  it("groups active occurrences and skips inactive groups or missing snapshots", async () => {
    mockAuth(activeProfile(["tms.view"]));
    const rows = [
      {
        task_id: "task-1",
        group_id: "group-1",
        group_vehicle_id: "rel-1",
        window_started_at: "2026-09-27T23:00:00.000Z",
        visible_until: "2026-09-28T11:00:00.000Z",
        terminal_at: null,
        first_visible_at: "2026-09-27T23:05:00.000Z",
        group: {
          id: "group-1",
          name: "CP Suka",
          color: "#0284c7",
          status: "Aktif",
          default_window_start: "06:00:00",
          default_window_end: "18:00:00",
        },
        snapshot: {
          task_id: "task-1",
          task_number: "FO-9445",
          vehicle_id: 11418,
          license_plate: "B 9448 BRO",
          driver_name: "ABDUL YAMAN",
          status_raw: "STARTED",
          expected_started_on: null,
          actual_started_on: "2026-09-27T23:10:00.000Z",
          actual_arrival_on: null,
          terminal_at: null,
          timeline: [],
          planned_routes: [],
          actual_routes: [],
          track_id: null,
          frozen_at: null,
          last_synced_at: "2026-09-28T00:00:00.000Z",
        },
      },
      {
        task_id: "task-2",
        group_id: "group-2",
        group_vehicle_id: "rel-2",
        window_started_at: "2026-09-27T23:00:00.000Z",
        visible_until: "2026-09-28T11:00:00.000Z",
        terminal_at: null,
        first_visible_at: "2026-09-27T23:05:00.000Z",
        group: { id: "group-2", name: "Nonaktif", color: "#64748b", status: "Tidak Aktif", default_window_start: "06:00:00", default_window_end: "18:00:00" },
        snapshot: null,
      },
    ];
    createAdminMock.mockReturnValue({
      from: vi.fn(() => chainable({ data: rows, error: null })),
    } as never);

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const payload = (await response.json()) as {
      data: { id: string; name: string; tasks: { id: string; number: string }[] }[];
      meta: { groupCount: number; taskCount: number };
    };
    expect(payload.meta.groupCount).toBe(1);
    expect(payload.data[0]).toMatchObject({ id: "group-1", name: "CP Suka" });
    expect(payload.data[0].tasks).toHaveLength(1);
    expect(payload.data[0].tasks[0]).toMatchObject({ id: "task-1", number: "FO-9445" });
  });
});
