import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/tms-tenant-auth", () => ({
  normalizeTenantPlateKey: (value: unknown) => String(value ?? "").toUpperCase().replace(/[\s.\-]/g, ""),
}));

import { GROUP_SAVE_ASSIGNMENT_SOURCE, stampGroupMembersClient } from "@/lib/tms-group-client";

interface Call {
  table: string;
  op: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
  column?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ids?: any;
  groupId?: string;
}

function mockAdmin(existing: { mceasy_vehicle_id: number; license_plate_key: string }[], failUpdate = false) {
  const calls: Call[] = [];
  const terminal = { error: failUpdate ? { message: "boom" } : null };
  const from = (table: string) => ({
    update: (payload: unknown) => ({
      is: () => ({
        in: async (column: string, ids: unknown) => {
          calls.push({ table, op: "update", payload, column, ids });
          return terminal;
        },
      }),
      eq: (col: string, val: unknown) => ({
        is: async () => {
          calls.push({ table, op: "update", payload, column: col, groupId: val as string });
          return terminal;
        },
      }),
    }),
    select: () => ({
      eq: () => ({
        in: async () => ({ data: existing, error: null }),
      }),
    }),
    insert: async (rows: unknown) => {
      calls.push({ table, op: "insert", payload: rows });
      return { error: null };
    },
  });
  return { admin: { from } as never, calls };
}

function member(mceasyVehicleId: number, licensePlate: string, enabled: boolean) {
  return {
    mceasyVehicleId,
    licensePlate,
    vendorGroups: [],
    useGroupSchedule: true,
    overrideWindowStart: null,
    overrideWindowEnd: null,
    enabled,
    sortOrder: 0,
  };
}

describe("stampGroupMembersClient", () => {
  it("menandai unit/anggota dan mendaftarkan mapping yang belum ada", async () => {
    const { admin, calls } = mockAdmin([{ mceasy_vehicle_id: 1, license_plate_key: "B1A" }]);
    const result = await stampGroupMembersClient(admin, "group-1", "client-tuku", [
      member(1, "B 1 A", true),
      member(2, "B 2 B", true),
      member(2, "B 2 B", true),
      member(3, "B 3 C", false),
      member(0, "B 0 Z", true),
    ]);

    expect(result).toBeNull();
    // Kendaraan dicap untuk semua id valid (termasuk nonaktif), tanpa duplikat dan tanpa id 0.
    expect(calls).toContainEqual({
      table: "tms_live_track_vehicles",
      op: "update",
      payload: expect.objectContaining({ client_id: "client-tuku" }),
      column: "mceasy_vehicle_id",
      ids: [1, 2, 3],
    });
    expect(calls).toContainEqual({
      table: "tms_live_track_group_vehicles",
      op: "update",
      payload: expect.objectContaining({ client_id: "client-tuku" }),
      column: "group_id",
      groupId: "group-1",
    });
    // Hanya unit 2 yang di-insert (unit 1 sudah terdaftar, 3 nonaktif, 0 invalid).
    const inserts = calls.filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toEqual([
      expect.objectContaining({
        client_id: "client-tuku",
        mceasy_vehicle_id: 2,
        license_plate: "B 2 B",
        license_plate_key: "B2B",
        status: "active",
        source: GROUP_SAVE_ASSIGNMENT_SOURCE,
      }),
    ]);
  });

  it("tidak insert bila semua unit sudah terdaftar", async () => {
    const { admin, calls } = mockAdmin([
      { mceasy_vehicle_id: 1, license_plate_key: "B1A" },
      { mceasy_vehicle_id: 2, license_plate_key: "B2B" },
    ]);
    const result = await stampGroupMembersClient(admin, "group-1", "client-tuku", [
      member(1, "B 1 A", true),
      member(2, "B 2 B", true),
    ]);
    expect(result).toBeNull();
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("mengembalikan pesan error bila update unit gagal", async () => {
    const { admin, calls } = mockAdmin([], true);
    const result = await stampGroupMembersClient(admin, "group-1", "client-tuku", [member(9, "B 9 Z", true)]);
    expect(result).toContain("Gagal menandai client unit");
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
});
