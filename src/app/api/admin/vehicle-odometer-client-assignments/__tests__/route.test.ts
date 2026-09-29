import { describe, expect, it, vi, beforeEach } from "vitest";
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
import { GET, PATCH } from "@/app/api/admin/vehicle-odometer-client-assignments/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);

function mockSuperAdmin() {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              status: "Aktif",
              account_type: "internal",
              roles: { id: 1, nama: "Super Admin", level: 100, permissions: ["all"], status: "Aktif" },
            },
            error: null,
          }),
        }),
      }),
    }),
  } as never);
}

function mockNonAdmin() {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              status: "Aktif",
              account_type: "internal",
              roles: { id: 2, nama: "Ops", level: 10, permissions: ["tms"], status: "Aktif" },
            },
            error: null,
          }),
        }),
      }),
    }),
  } as never);
}

function mockProfile(accountType: string, permissions: string[], level = 10) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-2" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              status: "Aktif",
              account_type: accountType,
              roles: { id: 3, nama: "Khusus", level, permissions, status: "Aktif" },
            },
            error: null,
          }),
        }),
      }),
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/vehicle-odometer-client-assignments", () => {
  it("menolak non super admin dengan 403", async () => {
    mockNonAdmin();
    const response = await GET(
      new NextRequest("http://localhost/api/admin/vehicle-odometer-client-assignments?clientId=c1"),
    );
    expect(response.status).toBe(403);
  });

  it("mengembalikan daftar client aktif tanpa clientId", async () => {
    mockSuperAdmin();
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_clients") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [{ id: "c1", code: "TUKU", slug: "tuku", name: "Tuku", timezone: "Asia/Jakarta", status: "Aktif" }],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: async () => ({ data: [{ client_id: "c1" }], error: null }),
          }),
        };
      },
    } as never);
    const response = await GET(new NextRequest("http://localhost/api/admin/vehicle-odometer-client-assignments"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { clients: { id: string; odometerVehicleCount: number }[] } };
    expect(payload.data.clients).toHaveLength(1);
    expect(payload.data.clients[0]?.odometerVehicleCount).toBe(1);
  });

  it("mengizinkan internal dengan permission khusus", async () => {
    mockProfile("internal", ["vehicle-odometer.client-unit-config.manage"]);
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_clients") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      },
    } as never);
    const response = await GET(new NextRequest("http://localhost/api/admin/vehicle-odometer-client-assignments"));
    expect(response.status).toBe(200);
  });

  it("menolak external walau punya permission khusus", async () => {
    mockProfile("external", ["vehicle-odometer.client-unit-config.manage"]);
    const response = await GET(
      new NextRequest("http://localhost/api/admin/vehicle-odometer-client-assignments?clientId=c1"),
    );
    expect(response.status).toBe(403);
  });

  it("mengembalikan daftar kendaraan + pilihan client", async () => {
    mockSuperAdmin();
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_clients") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: { id: "c1", code: "TUKU", name: "Tuku", status: "Aktif" }, error: null }),
              }),
            }),
          };
        }
        if (table === "ga_vehicles") {
          return {
            select: () => ({
              order: async () => ({
                data: [{ id: 1, unit: "B 1", jenis: "BOX", status: "Aktif" }],
                error: null,
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: [{ vehicle_id: 1 }], error: null }),
            }),
          }),
        };
      },
    } as never);
    const response = await GET(
      new NextRequest("http://localhost/api/admin/vehicle-odometer-client-assignments?clientId=c1"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { vehicleIds: number[] } };
    expect(payload.data.vehicleIds).toEqual([1]);
  });
});

describe("PATCH /api/admin/vehicle-odometer-client-assignments", () => {
  function patchRequest(body: unknown) {
    return new NextRequest("http://localhost/api/admin/vehicle-odometer-client-assignments", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  it("menolak vehicleIds bukan number dengan 400", async () => {
    mockSuperAdmin();
    const response = await PATCH(patchRequest({ clientId: "c1", vehicleIds: ["x"] }));
    expect(response.status).toBe(400);
  });

  it("menolak client tidak aktif dengan 400", async () => {
    mockSuperAdmin();
    createAdminMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: null, error: { message: "no rows" } }),
            }),
          }),
        }),
      }),
    } as never);
    const response = await PATCH(patchRequest({ clientId: "c1", vehicleIds: [] }));
    expect(response.status).toBe(400);
  });

  it("mengganti mapping dengan valid", async () => {
    mockSuperAdmin();
    const deleted: string[] = [];
    const inserted: unknown[] = [];
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_clients") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({ data: { id: "c1", status: "Aktif" }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "ga_vehicles") {
          return {
            select: () => ({
              in: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }),
            }),
          };
        }
        return {
          delete: () => ({
            eq: async () => {
              deleted.push(table);
              return { error: null };
            },
          }),
          insert: async (rows: unknown) => {
            inserted.push(rows);
            return { error: null };
          },
        };
      },
    } as never);
    const response = await PATCH(patchRequest({ clientId: "c1", vehicleIds: [1, 2, 2] }));
    expect(response.status).toBe(200);
    expect(deleted).toEqual(["client_vehicle_odometer_assignments"]);
    expect(inserted).toHaveLength(1);
    const payload = (await response.json()) as { data: { vehicleIds: number[] } };
    expect(payload.data.vehicleIds).toEqual([1, 2]);
  });
});
