import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase-admin";
import {
  applyClientScope,
  authorizeTmsScope,
  isRecordInScope,
  isVehicleInScopedMap,
  normalizeTenantPlateKey,
  resolveClientScope,
} from "@/lib/tms-tenant-auth";

const createAdminMock = vi.mocked(createAdminClient);

function mockMemberships(clientIds: string[]) {
  const rows = clientIds.map((client_id) => ({ client_id, client: { status: "Aktif" } }));
  createAdminMock.mockReturnValue({
    from: (table: string) => {
      if (table === "tms_clients") {
        return {
          select: () => ({
            eq: () => ({
              or: () => ({ maybeSingle: async () => ({ data: { id: "client-b" }, error: null }) }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: rows, error: null }),
          }),
        }),
      };
    },
  } as never);
}

describe("resolveClientScope", () => {
  it("super admin (level>=100 atau all) melihat semua client", () => {
    expect(
      resolveClientScope({ accountType: "internal", permissions: ["tms"], roleLevel: 100, membershipClientIds: [] }),
    ).toMatchObject({ allowedClientIds: "all", isSuperAdmin: true });
    expect(
      resolveClientScope({ accountType: "external", permissions: ["all"], roleLevel: 0, membershipClientIds: [] }),
    ).toMatchObject({ allowedClientIds: "all", isSuperAdmin: true });
  });

  it("internal dengan tms.clients.all melihat semua client", () => {
    expect(
      resolveClientScope({
        accountType: "internal",
        permissions: ["tms.live-view", "tms.clients.all"],
        roleLevel: 10,
        membershipClientIds: ["client-a"],
      }),
    ).toMatchObject({ allowedClientIds: "all", canAccessAllClients: true });
  });

  it("internal biasa mengikuti membership", () => {
    expect(
      resolveClientScope({
        accountType: "internal",
        permissions: ["tms.live-view"],
        roleLevel: 10,
        membershipClientIds: ["client-a", "client-a", "client-b"],
      }),
    ).toMatchObject({ allowedClientIds: ["client-a", "client-b"] });
  });

  it("external mengabaikan tms.clients.all", () => {
    expect(
      resolveClientScope({
        accountType: "external",
        permissions: ["tms.live-view", "tms.clients.all"],
        roleLevel: 10,
        membershipClientIds: ["client-a"],
      }),
    ).toMatchObject({ allowedClientIds: ["client-a"], canAccessAllClients: false });
  });
});

describe("authorizeTmsScope", () => {
  it("menolak user tanpa membership dengan 403", async () => {
    mockMemberships([]);
    const result = await authorizeTmsScope({
      userId: "user-1",
      accountType: "internal",
      permissions: ["tms.live-view"],
      roleLevel: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("memilih client otomatis bila membership tunggal", async () => {
    mockMemberships(["client-a"]);
    const result = await authorizeTmsScope({
      userId: "user-1",
      accountType: "internal",
      permissions: ["tms.live-view"],
      roleLevel: 10,
    });
    expect(result).toMatchObject({ ok: true, selectedClientId: "client-a" });
  });

  it("menolak requestedClientId di luar scope dengan 404", async () => {
    mockMemberships(["client-a"]);
    const result = await authorizeTmsScope({
      userId: "user-1",
      accountType: "internal",
      permissions: ["tms.live-view"],
      roleLevel: 10,
      requestedClientId: "client-b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("menerima requestedClientId dalam scope", async () => {
    mockMemberships(["client-a", "client-b"]);
    const result = await authorizeTmsScope({
      userId: "user-1",
      accountType: "internal",
      permissions: ["tms.live-view"],
      roleLevel: 10,
      requestedClientId: "client-b",
    });
    expect(result).toMatchObject({ ok: true, selectedClientId: "client-b" });
  });

  it("menyempitkan scope efektif ke client yang diminta", async () => {
    mockMemberships(["client-a", "client-b"]);
    createAdminMock.mockReturnValue({
      from: (table: string) => {
        if (table === "tms_clients") {
          return {
            select: () => ({
              eq: () => ({
                or: () => ({
                  maybeSingle: async () => ({ data: { id: "client-b" }, error: null }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [{ client_id: "client-a" }, { client_id: "client-b" }],
                error: null,
              }),
            }),
          }),
        };
      },
    } as never);
    const result = await authorizeTmsScope({
      userId: "user-1",
      accountType: "internal",
      permissions: ["tms.live-view"],
      roleLevel: 10,
      requestedClientRef: "client-b",
    });
    expect(result).toMatchObject({ ok: true, selectedClientId: "client-b" });
    if (result.ok) expect(result.scope.allowedClientIds).toEqual(["client-b"]);
  });
});

describe("isRecordInScope", () => {
  it("all-scope selalu lolos, null tidak lolos untuk scope spesifik", () => {
    expect(isRecordInScope("client-a", "all")).toBe(true);
    expect(isRecordInScope(null, "all")).toBe(true);
    expect(isRecordInScope("client-a", ["client-a"])).toBe(true);
    expect(isRecordInScope("client-b", ["client-a"])).toBe(false);
    expect(isRecordInScope(null, ["client-a"])).toBe(false);
  });
});

describe("isVehicleInScopedMap", () => {
  it("all-scope selalu lolos", () => {
    expect(isVehicleInScopedMap("all", 123, "B 1 A")).toBe(true);
  });

  it("cocok via mceasy id atau plat", () => {
    const map = { byMceasyId: new Map([[123, "client-a"]]), byPlateKey: new Map([["B1A", "client-a"]]) };
    expect(isVehicleInScopedMap(map, 123, null)).toBe(true);
    expect(isVehicleInScopedMap(map, "123", null)).toBe(true);
    expect(isVehicleInScopedMap(map, 999, "B 1 A")).toBe(true);
    expect(isVehicleInScopedMap(map, 999, "B 9 Z")).toBe(false);
  });
});

describe("normalizeTenantPlateKey", () => {
  it("menormalkan plat seperti seed mapping", () => {
    expect(normalizeTenantPlateKey("B 9913 UXR")).toBe("B9913UXR");
    expect(normalizeTenantPlateKey("b-9700.ecc")).toBe("B9700ECC");
    expect(normalizeTenantPlateKey(null)).toBe("");
  });
});

describe("applyClientScope", () => {
  it("melewatkan query bila all, menerapkan filter bila spesifik", () => {
    const passthrough = { marker: true };
    expect(applyClientScope(passthrough, "all", () => ({}) as never)).toBe(passthrough);
    const applied = applyClientScope("q", ["client-a"], ((q: unknown, ids: string[]) => ({ q, ids })) as never);
    expect(applied).toEqual({ q: "q", ids: ["client-a"] });
  });
});
