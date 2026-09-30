import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateSlaForTasks } from "@/lib/tms-sla-server";

interface Stub {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function tableStub(result: unknown): Stub {
  const chain: Stub = {};
  chain.select = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.upsert = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (resolve: (value: unknown) => void) => resolve(result);
  return chain;
}

const OCCURRENCES = [
  {
    task_id: "task-1",
    group_id: "group-cp",
    window_started_at: "2026-09-29T19:30:00Z",
    group: { client_id: "client-tuku" },
  },
];

const VISITS = [
  { id: "v-gudang", task_id: "task-1", route_sequence: 1, address_id: "154634", arrival_actual: "2026-09-30T03:30:00Z", departure_actual: "2026-09-29T21:40:00Z" },
  { id: "v-ontime", task_id: "task-1", route_sequence: 2, address_id: "43690", arrival_actual: "2026-09-29T22:02:00Z", departure_actual: null },
  { id: "v-late", task_id: "task-1", route_sequence: 3, address_id: "300611", arrival_actual: "2026-09-29T23:10:00Z", departure_actual: null },
  { id: "v-unknown", task_id: "task-1", route_sequence: 4, address_id: "999999", arrival_actual: "2026-09-29T23:20:00Z", departure_actual: null },
  { id: "v-pending", task_id: "task-1", route_sequence: 5, address_id: "284", arrival_actual: null, departure_actual: null },
];

const PROFILES = [
  {
    id: "profile-van9",
    code: "VAN 9",
    group_id: "group-cp",
    departure_target_time: "04:15",
    departure_day_offset: 0,
    effective_from: "2026-09-29",
    effective_until: null,
    stops: [
      { id: "stop-1", target_time: "05:05:00", target_day_offset: 0, addresses: [{ vendor_address_id: "43690", is_primary: true }] },
      { id: "stop-2", target_time: "05:54:00", target_day_offset: 0, addresses: [{ vendor_address_id: "300611", is_primary: true }] },
      { id: "stop-3", target_time: "06:14:00", target_day_offset: 0, addresses: [{ vendor_address_id: "284", is_primary: true }] },
    ],
  },
];

function mockAdmin(options: { occurrences?: unknown[]; visits?: unknown[]; profiles?: unknown[] }) {
  const occurrenceStub = tableStub({ data: options.occurrences ?? [], error: null });
  const visitStub = tableStub({ data: options.visits ?? [], error: null });
  const profileStub = tableStub({ data: options.profiles ?? [], error: null });
  const assignmentStub = tableStub({ data: null, error: null });
  const from = vi.fn((table: string) => {
    if (table === "tms_live_track_task_occurrences") return occurrenceStub;
    if (table === "tms_trip_visit_logs") return visitStub;
    if (table === "tms_sla_route_profiles") return profileStub;
    if (table === "tms_sla_task_assignments") return assignmentStub;
    return tableStub({ data: [], error: null });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from } as any, stubs: { visitStub, assignmentStub } };
}

describe("evaluateSlaForTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mengikat profil, menilai baris, dan menyimpan snapshot", async () => {
    const { admin, stubs } = mockAdmin({ occurrences: OCCURRENCES, visits: VISITS, profiles: PROFILES });
    const summary = await evaluateSlaForTasks(admin, ["task-1"]);

    expect(summary).toMatchObject({ tasksChecked: 1, assigned: 1, visitsUpdated: 5 });

    const assignments = stubs.assignmentStub.upsert.mock.calls[0][0] as Record<string, unknown>[];
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      task_id: "task-1",
      client_id: "client-tuku",
      group_id: "group-cp",
      profile_id: "profile-van9",
      service_date: "2026-09-30",
      match_method: "store_set_overlap",
    });

    const updates = stubs.visitStub.upsert.mock.calls[0][0] as Record<string, unknown>[];
    expect(updates).toHaveLength(5);
    const byId = Object.fromEntries(updates.map((u) => [u.id, u]));
    // Gudang: target berangkat 30 Sep 04:15 WIB (= 29 Sep 21:15 UTC), aktual 21:40 -> terlambat.
    expect(byId["v-gudang"]).toMatchObject({ sla_kind: "DEPARTURE", sla_status: "LATE" });
    // Dukuh Atas: target 05:05 WIB (= 22:05 UTC), tiba 22:02 -> tepat waktu.
    expect(byId["v-ontime"]).toMatchObject({
      sla_kind: "ARRIVAL",
      sla_status: "ON_TIME",
      sla_target_at: "2026-09-29T22:05:00.000Z",
      sla_delta_seconds: -180,
    });
    // Karbela: target 05:54 WIB (= 22:54 UTC), tiba 23:10 -> terlambat 16 mnt.
    expect(byId["v-late"]).toMatchObject({ sla_status: "LATE", sla_delta_seconds: 960 });
    // Toko tak dikenal -> SLA belum diatur.
    expect(byId["v-unknown"]).toMatchObject({ sla_status: "UNSET", sla_target_at: null });
    // Belum tiba -> bukan terlambat.
    expect(byId["v-pending"]).toMatchObject({ sla_status: "PENDING" });
  });

  it("tidak menyentuh task tanpa occurrence atau tanpa profil cocok", async () => {
    const { admin, stubs } = mockAdmin({ occurrences: [], visits: VISITS, profiles: PROFILES });
    const summary = await evaluateSlaForTasks(admin, ["task-1"]);
    expect(summary).toMatchObject({ tasksChecked: 0, assigned: 0, visitsUpdated: 0 });
    expect(stubs.assignmentStub.upsert).not.toHaveBeenCalled();
    expect(stubs.visitStub.upsert).not.toHaveBeenCalled();

    const { admin: admin2, stubs: stubs2 } = mockAdmin({
      occurrences: OCCURRENCES,
      visits: [{ ...VISITS[1], address_id: "000000" }],
      profiles: PROFILES,
    });
    const summary2 = await evaluateSlaForTasks(admin2, ["task-1"]);
    expect(summary2.assigned).toBe(0);
    expect(stubs2.assignmentStub.upsert).not.toHaveBeenCalled();
  });

  it("mengembalikan kosong untuk daftar task kosong", async () => {
    const { admin } = mockAdmin({});
    await expect(evaluateSlaForTasks(admin, [])).resolves.toEqual({
      tasksChecked: 0,
      assigned: 0,
      visitsUpdated: 0,
    });
  });
});
