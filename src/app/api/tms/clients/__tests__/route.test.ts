import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { GET } from "@/app/api/tms/clients/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);

function mockSession(profile: unknown) {
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

function internalProfile(permissions: string[], level = 10) {
  return {
    status: "Aktif",
    account_type: "internal",
    roles: { id: 1, nama: "Ops", level, permissions, status: "Aktif" },
  };
}

const TUKU = {
  id: "client-tuku",
  code: "TUKU",
  slug: "tuku",
  name: "Tuku",
  logo_url: null,
  timezone: "Asia/Jakarta",
  status: "Aktif",
};

describe("GET /api/tms/clients", () => {
  it("menolak tanpa sesi dengan 401", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("mengembalikan membership untuk user biasa", async () => {
    mockSession(internalProfile(["tms.live-view"]));
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_client_memberships") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({ data: [{ client_id: "client-tuku" }], error: null }),
              }),
            }),
          };
        }
        const terminal = { data: [TUKU], error: null };
        const chain: Record<string, unknown> = {};
        chain.order = vi.fn(() => chain);
        chain.in = vi.fn(() => chain);
        chain.then = (resolve: (value: unknown) => void) => resolve(terminal);
        return {
          select: () => ({
            eq: () => chain,
          }),
        };
      },
    } as never);
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { code: string }[];
      meta: { allAllowed: boolean };
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].code).toBe("TUKU");
    expect(payload.meta.allAllowed).toBe(false);
  });

  it("menandai allAllowed untuk super admin", async () => {
    mockSession(internalProfile(["tms"], 100));
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_client_memberships") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [TUKU], error: null }),
            }),
          }),
        };
      },
    } as never);
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { meta: { allAllowed: boolean } };
    expect(payload.meta.allAllowed).toBe(true);
  });
});
