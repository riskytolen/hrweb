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
import { GET } from "@/app/api/tms/sla-groups/route";

const authorizeMock = vi.mocked(authorizeSlaConfig);
const createAdminMock = vi.mocked(createAdminClient);

function chainable(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ["or", "ilike", "not", "is", "order", "range", "in", "eq", "gte", "lte"]) {
    chain[name] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizeMock.mockResolvedValue({
    ok: true,
    context: {
      userId: "user-1",
      permissions: ["tms.sla-config.view"],
      canManage: false,
      accountType: "internal",
      allowedClientIds: "all",
    },
  } as never);
});

describe("GET /api/tms/sla-groups", () => {
  it("returns scoped groups with client labels", async () => {
    const from = (table: string) => {
      if (table === "tms_live_track_groups") {
        return chainable({
          data: [{ id: "group-cp", name: "CP", status: "Aktif", client_id: "client-tuku" }],
          error: null,
        });
      }
      if (table === "tms_clients") {
        return chainable({ data: [{ id: "client-tuku", code: "TUKU", name: "Tuku" }], error: null });
      }
      return chainable({ data: [], error: null });
    };
    createAdminMock.mockReturnValue({ from } as never);
    const response = await GET(new NextRequest("http://localhost/api/tms/sla-groups"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { id: string; clientCode: string; clientName: string }[];
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({ id: "group-cp", clientCode: "TUKU", clientName: "Tuku" });
  });
});
