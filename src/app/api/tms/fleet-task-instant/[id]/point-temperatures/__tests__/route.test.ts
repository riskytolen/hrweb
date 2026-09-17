import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { GET } from "@/app/api/tms/fleet-task-instant/[id]/point-temperatures/route";

const createClientMock = vi.mocked(createClient);
const params = Promise.resolve({ id: "task-1" });

function mockClient(pointQuery: unknown) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => {
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  status: "Aktif",
                  account_type: "internal",
                  roles: { id: 1, nama: "Ops", level: 10, permissions: ["tms.view"], status: "Aktif" },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: async () => pointQuery,
          }),
        }),
      };
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/fleet-task-instant/[id]/point-temperatures", () => {
  it("rejects unauthenticated callers with 401", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);

    const response = await GET(new NextRequest("http://localhost/api/tms/fleet-task-instant/task-1/point-temperatures"), {
      params,
    });
    expect(response.status).toBe(401);
  });

  it("returns normalized snapshots with no-store headers", async () => {
    mockClient({
      data: [
        {
          task_id: "task-1",
          route_sequence: 2,
          point_name: "Titik 2",
          temperatures: [18.9, null],
          measured_at: "2026-09-18T06:00:00.000Z",
          arrival_actual: null,
          distance_meters: 42.5,
          captured_at: "2026-09-18T06:02:00.000Z",
        },
      ],
      error: null,
    });

    const response = await GET(new NextRequest("http://localhost/api/tms/fleet-task-instant/task-1/point-temperatures"), {
      params,
    });
    const payload = (await response.json()) as {
      data: { taskId: string; routeSequence: number; temperatures: (number | null)[] }[];
      meta: { total: number };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload.meta.total).toBe(1);
    expect(payload.data[0]).toMatchObject({
      taskId: "task-1",
      routeSequence: 2,
      temperatures: [18.9, null],
    });
  });
});
