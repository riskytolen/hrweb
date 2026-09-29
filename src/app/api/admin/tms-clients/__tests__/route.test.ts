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
import { GET, POST, PATCH } from "@/app/api/admin/tms-clients/route";

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

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, { method, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/tms-clients", () => {
  it("menolak non super admin dengan 403", async () => {
    mockNonAdmin();
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("mengembalikan semua client untuk super admin", async () => {
    mockSuperAdmin();
    createAdminMock.mockReturnValue({
      from: () => ({
        select: () => ({
          order: async () => ({
            data: [
              { id: "c1", code: "TUKU", slug: "tuku", name: "Tuku", logo_url: null, timezone: "Asia/Jakarta", status: "Aktif" },
            ],
            error: null,
          }),
        }),
      }),
    } as never);
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { code: string }[] };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.code).toBe("TUKU");
  });
});

describe("POST /api/admin/tms-clients", () => {
  it("menolak payload invalid dengan 400", async () => {
    mockSuperAdmin();
    const response = await POST(jsonRequest("http://localhost/api/admin/tms-clients", "POST", { name: "x" }));
    expect(response.status).toBe(400);
  });

  it("membuat client baru dengan 201", async () => {
    mockSuperAdmin();
    createAdminMock.mockReturnValue({
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: "c2", code: "BARU", slug: "baru", name: "Baru", logo_url: null, timezone: "Asia/Jakarta", status: "Aktif" },
              error: null,
            }),
          }),
        }),
      }),
    } as never);
    const response = await POST(
      jsonRequest("http://localhost/api/admin/tms-clients", "POST", { name: "Baru", code: "baru", slug: "Baru" }),
    );
    expect(response.status).toBe(201);
  });

  it("mengembalikan 409 untuk duplikat code/slug", async () => {
    mockSuperAdmin();
    createAdminMock.mockReturnValue({
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: 'duplicate key value violates unique constraint "tms_clients_code_key"' } }),
          }),
        }),
      }),
    } as never);
    const response = await POST(
      jsonRequest("http://localhost/api/admin/tms-clients", "POST", { name: "Tuku", code: "TUKU", slug: "tuku" }),
    );
    expect(response.status).toBe(409);
  });
});

describe("PATCH /api/admin/tms-clients", () => {
  it("menolak tanpa id dengan 400", async () => {
    mockSuperAdmin();
    const response = await PATCH(jsonRequest("http://localhost/api/admin/tms-clients", "PATCH", { name: "x" }));
    expect(response.status).toBe(400);
  });

  it("memperbarui client dengan normalisasi", async () => {
    mockSuperAdmin();
    let saved: Record<string, unknown> | null = null;
    createAdminMock.mockReturnValue({
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          saved = payload;
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: "c1", code: "TUKU", slug: "tuku", name: "Tuku Baru", logo_url: null, timezone: "Asia/Jakarta", status: "Tidak Aktif" },
                  error: null,
                }),
              }),
            }),
          };
        },
      }),
    } as never);
    const response = await PATCH(
      jsonRequest("http://localhost/api/admin/tms-clients", "PATCH", {
        id: "c1",
        name: "Tuku Baru",
        code: "tuku",
        slug: "TUKU",
        status: "Tidak Aktif",
      }),
    );
    expect(response.status).toBe(200);
    expect(saved).toMatchObject({ code: "TUKU", slug: "tuku", status: "Tidak Aktif" });
  });
});
