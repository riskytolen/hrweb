import { describe, expect, it, vi } from "vitest";
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
import { GET, PATCH } from "@/app/api/admin/tms-client-memberships/route";

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

describe("GET /api/admin/tms-client-memberships", () => {
  it("menolak non super admin dengan 403", async () => {
    mockNonAdmin();
    const response = await GET(
      new NextRequest("http://localhost/api/admin/tms-client-memberships?userId=u1"),
    );
    expect(response.status).toBe(403);
  });

  it("mengembalikan daftar client user", async () => {
    mockSuperAdmin();
    createAdminMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: [{ client_id: "c1" }], error: null }),
          }),
        }),
      }),
    } as never);
    const response = await GET(
      new NextRequest("http://localhost/api/admin/tms-client-memberships?userId=u1"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: string[] };
    expect(payload.data).toEqual(["c1"]);
  });
});

describe("PATCH /api/admin/tms-client-memberships", () => {
  function patchRequest(body: unknown) {
    return new NextRequest("http://localhost/api/admin/tms-client-memberships", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  it("menolak client tidak valid dengan 400", async () => {
    mockSuperAdmin();
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_clients") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never);
    const response = await PATCH(patchRequest({ userId: "u1", clientIds: ["nope"] }));
    expect(response.status).toBe(400);
  });

  it("mengganti membership dengan valid", async () => {
    mockSuperAdmin();
    const deleted: string[] = [];
    const inserted: unknown[] = [];
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_clients") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({ data: [{ id: "c1" }], error: null }),
              }),
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
    const response = await PATCH(patchRequest({ userId: "u1", clientIds: ["c1"] }));
    expect(response.status).toBe(200);
    expect(deleted).toEqual(["tms_client_memberships"]);
    expect(inserted).toHaveLength(1);
  });
});
