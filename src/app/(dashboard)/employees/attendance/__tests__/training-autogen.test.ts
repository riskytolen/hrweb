import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAttendanceAutoGen } from "../lib/hooks/use-attendance-autogen";
import { AUTO_NOTES } from "../lib/attendance-constants";

const state = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  records: [] as { id: number; employee_id: string; status: string; is_manual: boolean; catatan: string }[],
  inserts: [] as unknown[],
  deleted: [] as number[],
  completed: 0,
}));
vi.mock("react", () => ({
  useCallback: (fn: () => Promise<void>) => async () => { await fn(); state.completed += 1; },
  useEffect: (fn: () => void) => state.effects.push(fn),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {
  from: (table: string) => {
    let deleting = false;
    const query = {
      select: () => query, eq: () => query, lte: () => query, gte: () => query,
      delete: () => { deleting = true; return query; },
      in: (_key: string, ids: number[]) => { if (deleting) state.deleted.push(...ids); return query; },
      upsert: (rows: unknown[]) => { state.inserts.push(...rows); return query; },
      then: (resolve: (value: unknown) => void) => resolve({ data: table === "attendance_records" ? state.records : [], error: null }),
    };
    return query;
  },
} }));

beforeEach(() => { state.effects = []; state.records = []; state.inserts = []; state.deleted = []; state.completed = 0; });

async function run(status: string, join: string | null, exit: string | null) {
  // React hooks are mocked above to execute and inspect the asynchronous effect.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useAttendanceAutoGen({
    dateFilter: "2026-10-08", staticLoading: false,
    employees: [{ id: "emp", nama: "Test", status, tanggal_bergabung: join, tanggal_keluar: exit }],
    penalties: [], publicHolidays: [], reloadRecords: vi.fn().mockResolvedValue(undefined),
  });
  state.effects.forEach((fn) => fn());
  await vi.waitFor(() => expect(state.completed).toBe(2));
}

describe("Training di luar absensi", () => {
  it("arsip manual lama tetap disimpan", async () => {
    state.records = [{ id: 3, employee_id: "emp", status: "Hadir", is_manual: true, catatan: "TRIAL" }];
    await run("Aktif", "2026-10-10", null);
    expect(state.deleted).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("Alpha historis yang valid tidak dihapus saat pegawai sudah nonaktif", async () => {
    state.records = [{ id: 4, employee_id: "emp", status: "Alpha", is_manual: false, catatan: AUTO_NOTES.ALPHA }];
    await run("Tidak Aktif", "2026-10-01", "2026-10-10");
    expect(state.deleted).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it.each(["Training", "Tidak Aktif"])("membersihkan Alpha %s tanpa membuat ulang", async (status) => {
    state.records = [{ id: 1, employee_id: "emp", status: "Alpha", is_manual: false, catatan: AUTO_NOTES.ALPHA }];
    await run(status, null, status === "Tidak Aktif" ? "2026-10-10" : null);
    expect(state.deleted).toEqual([1]);
    expect(state.inserts).toEqual([]);
  });

  it("membersihkan Libur Training", async () => {
    state.records = [{ id: 2, employee_id: "emp", status: "Libur", is_manual: false, catatan: AUTO_NOTES.HARI_LIBUR }];
    await run("Training", null, null);
    expect(state.deleted).toEqual([2]);
    expect(state.inserts).toEqual([]);
  });

  it("pegawai yang pernah aktif masih memperoleh Alpha sebelum tanggal keluar", async () => {
    await run("Tidak Aktif", "2026-10-01", "2026-10-10");
    expect(state.deleted).toEqual([]);
    expect(state.inserts).toEqual([expect.objectContaining({ employee_id: "emp", status: "Alpha" })]);
  });
});
