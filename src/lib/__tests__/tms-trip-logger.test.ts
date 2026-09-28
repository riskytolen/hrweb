import { describe, expect, it } from "vitest";
import {
  computeTripVisitDurationSeconds,
  formatTripVisitDuration,
  normalizeRawTaskTripVisits,
  normalizeTaskTripVisits,
  ongoingTripVisitDurationSeconds,
  resolveTripVisitState,
  tripVisitStateLabel,
} from "@/lib/tms-trip-logger";
import { normalizeFleetTaskInstantItem } from "@/lib/fleet-task-track";

const BASE_TASK = {
  id: "task-1",
  number: "FO-1001",
  vehicle: { id: 11418, license_plate: "B 1234 TES" },
  driver: { name: "ASEP SURAHMAN" },
  status: { raw_type: "STARTED", name: "Berjalan" },
};

function point(overrides: Record<string, unknown> = {}) {
  return {
    plan_sequence: 1,
    address: { name: "Toko A", full_name: "Jl. A No. 1" },
    visit_status: { raw_type: "VISITED", name: "Dikunjungi" },
    ...overrides,
  };
}

describe("resolveTripVisitState", () => {
  it("marks arrival without departure as ongoing", () => {
    expect(resolveTripVisitState("2026-09-22T06:12:00+07:00", null)).toBe("ONGOING");
  });

  it("marks complete arrivals and departures as completed", () => {
    expect(
      resolveTripVisitState("2026-09-22T06:12:00+07:00", "2026-09-22T06:58:00+07:00"),
    ).toBe("COMPLETED");
  });

  it("marks departure without arrival as incomplete", () => {
    expect(resolveTripVisitState(null, "2026-09-22T06:58:00+07:00")).toBe("INCOMPLETE");
  });

  it("marks negative durations as incomplete", () => {
    expect(
      resolveTripVisitState("2026-09-22T07:00:00+07:00", "2026-09-22T06:00:00+07:00"),
    ).toBe("INCOMPLETE");
  });

  it("marks empty times as pending", () => {
    expect(resolveTripVisitState(null, null)).toBe("PENDING");
  });
});

describe("computeTripVisitDurationSeconds", () => {
  it("computes the gap between arrival and departure", () => {
    expect(
      computeTripVisitDurationSeconds("2026-09-22T06:12:00+07:00", "2026-09-22T06:58:00+07:00"),
    ).toBe(46 * 60);
  });

  it("returns null for incomplete or invalid pairs", () => {
    expect(computeTripVisitDurationSeconds("2026-09-22T06:12:00+07:00", null)).toBeNull();
    expect(computeTripVisitDurationSeconds(null, "2026-09-22T06:58:00+07:00")).toBeNull();
    expect(
      computeTripVisitDurationSeconds("2026-09-22T07:00:00+07:00", "2026-09-22T06:00:00+07:00"),
    ).toBeNull();
    expect(computeTripVisitDurationSeconds("bukan-tanggal", "2026-09-22T06:00:00+07:00")).toBeNull();
  });
});

describe("normalizeTaskTripVisits", () => {
  it("keeps every route point including the loading point", () => {
    const task = normalizeFleetTaskInstantItem({
      ...BASE_TASK,
      timeline_route: [
        {
          ...point({
            plan_sequence: 1,
            point_type: "START",
            address: { name: "Gudang", full_name: "Jl. Gudang" },
            arrival_time: { actual: "2026-09-22T05:00:00+07:00" },
            departure_time: { actual: "2026-09-22T05:30:00+07:00" },
          }),
        },
        {
          ...point({
            plan_sequence: 2,
            point_type: "END",
            arrival_time: { actual: "2026-09-22T06:12:00+07:00" },
            departure_time: { actual: null },
          }),
        },
        { ...point({ plan_sequence: 3 }) },
      ],
    });
    expect(task).not.toBeNull();
    const visits = normalizeTaskTripVisits(task!);
    expect(visits).toHaveLength(3);
    expect(visits[0]).toMatchObject({
      id: "task-1:1",
      taskNumber: "FO-1001",
      unit: "B 1234 TES",
      driverName: "ASEP SURAHMAN",
      locationName: "Gudang",
      visitState: "COMPLETED",
      durationSeconds: 30 * 60,
    });
    expect(visits[1].visitState).toBe("ONGOING");
    expect(visits[1].durationSeconds).toBeNull();
    expect(visits[2].visitState).toBe("PENDING");
  });

  it("returns empty visits for invalid tasks", () => {
    expect(normalizeRawTaskTripVisits(null)).toEqual([]);
    expect(normalizeRawTaskTripVisits({ number: "FO-1" })).toEqual([]);
  });
});

describe("labels and formatting", () => {
  it("labels every visit state in Indonesian", () => {
    expect(tripVisitStateLabel("ONGOING")).toBe("Sedang di lokasi");
    expect(tripVisitStateLabel("COMPLETED")).toBe("Selesai");
    expect(tripVisitStateLabel("INCOMPLETE")).toBe("Waktu tidak lengkap");
    expect(tripVisitStateLabel("PENDING")).toBe("Belum dikunjungi");
  });

  it("formats durations", () => {
    expect(formatTripVisitDuration(null)).toBe("–");
    expect(formatTripVisitDuration(45)).toBe("45 dtk");
    expect(formatTripVisitDuration(46 * 60)).toBe("46 mnt");
    expect(formatTripVisitDuration(90 * 60)).toBe("1 jam 30 mnt");
    expect(formatTripVisitDuration(120 * 60)).toBe("2 jam");
  });

  it("computes ongoing durations from arrival until now", () => {
    const arrival = "2026-09-22T06:00:00+07:00";
    const now = Date.parse("2026-09-22T06:30:00+07:00");
    expect(ongoingTripVisitDurationSeconds(arrival, now)).toBe(30 * 60);
    expect(ongoingTripVisitDurationSeconds(null, now)).toBeNull();
    expect(ongoingTripVisitDurationSeconds(arrival, Date.parse("2026-09-22T05:00:00+07:00"))).toBeNull();
  });
});
