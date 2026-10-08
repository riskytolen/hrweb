import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/tms-tenant-auth", () => ({
  normalizeTenantPlateKey: (value: unknown) => String(value ?? "").toUpperCase(),
}));

import { stampUnmappedTmsRows } from "@/lib/tms-tenant-sync-server";

interface Stub {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function resultFor(table: string, columns: string | undefined) {
  const selected = columns ?? "";
  if (table === "tms_client_vehicle_assignments") {
    return [
      {
        client_id: "client-mapping",
        mceasy_vehicle_id: 1,
        license_plate_key: "B-999",
        effective_from: null,
        effective_until: null,
      },
    ];
  }
  if (table === "tms_trip_visit_logs") {
    if (selected.includes("vehicle_id")) {
      return [{ id: "visit-1", vehicle_id: 999, license_plate: "B UNKNOWN" }];
    }
    return [{ id: "visit-1", task_id: "task-1" }];
  }
  if (table === "tms_live_track_task_occurrences" && selected.includes("client_id")) {
    return [
      {
        task_id: "task-1",
        client_id: "client-occurrence",
        window_started_at: "2026-10-03T00:00:00Z",
      },
    ];
  }
  return [];
}

describe("stampUnmappedTmsRows", () => {
  it("mengambil client visit log dari occurrence bila mapping unit tidak cocok", async () => {
    const updates: Stub[] = [];
    const from = (table: string) => {
      const state: { table: string; columns?: string } = { table };
      const builder: Stub = {
        select: (columns: string) => {
          state.columns = columns;
          return builder;
        },
        eq: () => builder,
        is: () => builder,
        limit: () => builder,
        order: () => builder,
        in: () => builder,
        update: (payload: unknown) => ({
          in: async (column: string, ids: unknown) => {
            updates.push({ table, payload, column, ids });
            return { error: null };
          },
        }),
        then: (resolve: (value: unknown) => void) => resolve({ data: resultFor(state.table, state.columns) }),
      };
      return builder;
    };

    const summary = await stampUnmappedTmsRows({ from } as never);

    expect(summary.visitLogs).toBe(1);
    expect(updates).toContainEqual({
      table: "tms_trip_visit_logs",
      payload: { client_id: "client-occurrence" },
      column: "id",
      ids: ["visit-1"],
    });
  });
});
