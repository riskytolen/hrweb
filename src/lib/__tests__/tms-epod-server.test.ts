import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/mceasy-server", () => ({
  fetchFleetTaskInstantList: vi.fn(),
  fetchFleetTaskInstantDetail: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

import { fetchFleetTaskInstantDetail, fetchFleetTaskInstantList } from "@/lib/mceasy-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { syncActiveEpodAssignments } from "@/lib/tms-epod-server";

const fetchListMock = vi.mocked(fetchFleetTaskInstantList);
const fetchDetailMock = vi.mocked(fetchFleetTaskInstantDetail);
const createAdminMock = vi.mocked(createAdminClient);

const RAW_STARTED_TASK = {
  id: "t1",
  number: "FO-1",
  status: { raw_type: "STARTED", name: "Berjalan" },
  vehicle: { id: 10, license_plate: "B 1 XYZ" },
  driver: { name: "Andi" },
  timeline_route: [
    {
      id: "p1",
      point_type: "START",
      plan_sequence: 1,
      address: { id: "a1", name: "Gudang", full_name: "Jl. Gudang" },
    },
    {
      id: "p2",
      plan_sequence: 2,
      address: { id: "a2", name: "Toko A", full_name: "Jl. Toko A" },
    },
  ],
};

interface Captured {
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  upserts: { table: string; rows: Record<string, unknown>[] }[];
  rpcs: { name: string; args: Record<string, unknown> }[];
}

interface ReadResults {
  assignments?: unknown[];
  stops?: unknown[];
  submissions?: unknown[];
  evidence?: unknown[];
}

/**
 * Mock admin client yang cukup untuk alur worker: chain select/eq/in/lt
 * bisa di-await, dan operasi tulis direkam untuk diperiksa.
 */
function installAdminMock(options: {
  reads?: ReadResults;
  newAssignmentId?: string;
  captured: Captured;
}) {
  const reads = options.reads ?? {};
  const newAssignmentId = options.newAssignmentId ?? "assign-1";

  function readChain(table: string) {
    const data =
      table === "tms_epod_assignments"
        ? reads.assignments ?? []
        : table === "tms_epod_stops"
          ? reads.stops ?? []
          : table === "tms_epod_submissions"
            ? reads.submissions ?? []
            : reads.evidence ?? [];
    const result = { data, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "lt", "is", "order", "limit", "neq"]) {
      chain[method] = () => chain;
    }
    chain.single = () => Promise.resolve(result);
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected);
    return chain;
  }

  function writeChain(result: unknown) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "lt", "is", "order", "limit"]) {
      chain[method] = () => chain;
    }
    chain.single = () => Promise.resolve(result);
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected);
    return chain;
  }

  const from = (table: string) => ({
    select: () => readChain(table),
    insert: (row: Record<string, unknown>) => {
      options.captured.inserts.push(row);
      return writeChain({ data: { id: newAssignmentId }, error: null });
    },
    update: (row: Record<string, unknown>) => {
      options.captured.updates.push(row);
      return writeChain({ error: null });
    },
    upsert: (rows: Record<string, unknown>[]) => {
      options.captured.upserts.push({ table, rows });
      return writeChain({ error: null });
    },
    delete: () => writeChain({ error: null }),
  });

  const rpc = (name: string, args: Record<string, unknown>) => {
    options.captured.rpcs.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  };

  const storage = { from: () => ({ remove: () => Promise.resolve({ error: null }) }) };

  createAdminMock.mockReturnValue({ from, rpc, storage } as never);
}

function captured(): Captured {
  return { inserts: [], updates: [], upserts: [], rpcs: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchListMock.mockImplementation(async (query = {}) =>
    query.status === "STARTED"
      ? { items: [RAW_STARTED_TASK], total: 1, page: 1, counts: null }
      : { items: [], total: 0, page: 1, counts: null },
  );
});

describe("syncActiveEpodAssignments", () => {
  it("membuat assignment baru dengan snapshot_at dan titik pertama sebagai loading", async () => {
    const store = captured();
    installAdminMock({ captured: store });

    const summary = await syncActiveEpodAssignments(Date.now());

    expect(summary.assignmentsCreated).toBe(1);
    expect(summary.failures).toEqual([]);

    const insert = store.inserts[0];
    expect(insert.task_id).toBe("t1");
    expect(insert.task_number).toBe("FO-1");
    expect(typeof insert.snapshot_at).toBe("string");
    expect(insert.license_plate).toBe("B 1 XYZ");

    const stops = store.upserts.find((entry) => entry.table === "tms_epod_stops");
    expect(stops?.rows).toHaveLength(2);
    expect(stops?.rows[0]).toMatchObject({
      stop_sequence: 1,
      stop_type: "LOADING",
      vendor_point_id: "p1",
      vendor_address_id: "a1",
    });
    expect(stops?.rows[1]).toMatchObject({
      stop_sequence: 2,
      stop_type: "DELIVERY",
      vendor_point_id: "p2",
    });

    expect(store.rpcs).toContainEqual({
      name: "tms_epod_recompute_status",
      args: { p_assignment_id: "assign-1" },
    });
  });

  it("memperbarui assignment tanpa menimpa snapshot_at dan menyegarkan jumlah titik", async () => {
    const store = captured();
    installAdminMock({
      captured: store,
      reads: {
        assignments: [
          {
            id: "assign-1",
            task_id: "t1",
            status: "OPEN",
            task_status_raw: "STARTED",
            frozen_at: null,
          },
        ],
        stops: [],
      },
    });

    const summary = await syncActiveEpodAssignments(Date.now());

    expect(summary.assignmentsRefreshed).toBe(1);
    expect(store.inserts).toHaveLength(0);

    const update = store.updates[0];
    expect(update).not.toHaveProperty("snapshot_at");
    expect(update).not.toHaveProperty("task_id");
    expect(update.task_status_raw).toBe("STARTED");
    expect(typeof update.last_synced_at).toBe("string");

    expect(store.rpcs).toContainEqual({
      name: "tms_epod_recompute_status",
      args: { p_assignment_id: "assign-1" },
    });
  });

  it("tidak menyentuh stop atau jumlah titik saat snapshot sudah dibekukan", async () => {
    const store = captured();
    installAdminMock({
      captured: store,
      reads: {
        assignments: [
          {
            id: "assign-1",
            task_id: "t1",
            status: "IN_PROGRESS",
            task_status_raw: "STARTED",
            frozen_at: "2026-09-22T00:00:00Z",
          },
        ],
      },
    });

    const summary = await syncActiveEpodAssignments(Date.now());

    expect(summary.assignmentsRefreshed).toBe(0);
    expect(store.upserts).toHaveLength(0);
    expect(store.rpcs).toHaveLength(0);
    expect(store.updates).toHaveLength(1);
    expect(Object.keys(store.updates[0]).sort()).toEqual(["last_synced_at", "task_status_raw"]);
  });

  it("merekonsiliasi assignment yang hilang dari Index lewat endpoint Show", async () => {
    const store = captured();
    fetchDetailMock.mockResolvedValue({
      id: "t1",
      number: "FO-1",
      status: { raw_type: "ENDED", name: "Selesai" },
    });
    installAdminMock({
      captured: store,
      reads: {
        assignments: [
          {
            id: "assign-1",
            task_id: "t1",
            status: "IN_PROGRESS",
            task_status_raw: "STARTED",
            frozen_at: null,
          },
        ],
      },
    });
    fetchListMock.mockResolvedValue({ items: [], total: 0, page: 1, counts: null });

    const summary = await syncActiveEpodAssignments(Date.now());

    expect(summary.assignmentsReconciled).toBe(1);
    expect(fetchDetailMock).toHaveBeenCalledWith("t1");
    expect(store.updates[store.updates.length - 1]).toMatchObject({ task_status_raw: "ENDED" });
  });

  it("mencatat kegagalan satu sumber tanpa menghentikan eksekusi", async () => {
    const store = captured();
    installAdminMock({ captured: store });
    fetchListMock.mockImplementation(async (query = {}) => {
      if (query.status === "SCHEDULED") throw new Error("vendor down");
      return { items: [RAW_STARTED_TASK], total: 1, page: 1, counts: null };
    });

    const summary = await syncActiveEpodAssignments(Date.now());

    expect(summary.failures.some((failure) => failure.includes("SCHEDULED"))).toBe(true);
    expect(summary.assignmentsCreated).toBe(1);
  });
});
