import { describe, expect, it } from "vitest";
import {
  formatCapturedPointTemperature,
  haversineDistanceMeters,
  normalizeCapturedSequence,
  indexPointTemperaturesBySequence,
  normalizePointTemperature,
  normalizePointTemperatureList,
  resolveRoutePointSequence,
  selectCapturableRoutePoint,
  type TmsRoutePointTemperature,
} from "@/lib/tms-point-temperature";

const SNAPSHOT: TmsRoutePointTemperature = {
  taskId: "task-1",
  routeSequence: 2,
  pointName: "Titik 2",
  temperatures: [18.9, null],
  measuredAt: "2026-09-18T06:00:00.000Z",
  arrivalActual: "2026-09-18T06:01:00.000Z",
  distanceMeters: 42.5,
  capturedAt: "2026-09-18T06:02:00.000Z",
};

describe("tms point temperature helpers", () => {
  it("resolves a stable sequence when upstream omits it", () => {
    expect(resolveRoutePointSequence({ sequence: 4 }, 0)).toBe(4);
    expect(resolveRoutePointSequence({ sequence: null }, 1)).toBe(2);
  });

  it("normalizes captured sequences from partial database rows", () => {
    expect(normalizeCapturedSequence({ task_id: "task-1", route_sequence: 2 })).toEqual({
      taskId: "task-1",
      routeSequence: 2,
    });
    expect(normalizeCapturedSequence({ task_id: "task-1" })).toBeNull();
  });

  it("normalizes one snapshot per task sequence", () => {
    expect(
      normalizePointTemperature({
        task_id: "task-1",
        route_sequence: 2,
        point_name: "Titik 2",
        temperatures: [18.9, null],
        measured_at: SNAPSHOT.measuredAt,
        arrival_actual: SNAPSHOT.arrivalActual,
        distance_meters: 42.5,
        captured_at: SNAPSHOT.capturedAt,
      }),
    ).toEqual(SNAPSHOT);
    expect(normalizePointTemperature({ task_id: "task-1" })).toBeNull();
    expect(
      normalizePointTemperatureList([
        {
          task_id: "task-1",
          route_sequence: 2,
          temperatures: [null],
          measured_at: SNAPSHOT.measuredAt,
          distance_meters: 1,
          captured_at: SNAPSHOT.capturedAt,
        },
      ]),
    ).toEqual([]);
  });

  it("indexes snapshots by sequence and formats captured temperatures", () => {
    const indexed = indexPointTemperaturesBySequence([SNAPSHOT]);
    expect(indexed.get(2)).toEqual(SNAPSHOT);
    expect(formatCapturedPointTemperature(SNAPSHOT)).toBe("18,9°C");
    expect(formatCapturedPointTemperature(undefined)).toBeNull();
  });

  it("measures short distances accurately enough for a geofence", () => {
    expect(haversineDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(0);
    expect(
      haversineDistanceMeters({ latitude: -6.2, longitude: 106.8 }, { latitude: -6.199, longitude: 106.8 }),
    ).toBeCloseTo(111.2, 0);
  });

  it("selects the nearest uncaptured point inside the radius", () => {
    const selected = selectCapturableRoutePoint(
      [
        {
          sequence: 1,
          pointType: null,
          pointId: null,
          addressId: null,
          name: "Titik 1",
          address: null,
          latitude: -6.2,
          longitude: 106.8,
          visitStatusRaw: null,
          visitStatusName: null,
          arrivalTarget: null,
          arrivalActual: null,
          departureTarget: null,
          departureActual: null,
        },
        {
          sequence: 2,
          pointType: null,
          pointId: null,
          addressId: null,
          name: "Titik 2",
          address: null,
          latitude: -6.2005,
          longitude: 106.8,
          visitStatusRaw: null,
          visitStatusName: null,
          arrivalTarget: null,
          arrivalActual: null,
          departureTarget: null,
          departureActual: null,
        },
      ],
      { latitude: -6.20055, longitude: 106.8 },
      { radiusMeters: 150, excludeSequences: new Set([2]) },
    );

    expect(selected?.sequence).toBe(1);
    expect(selected?.distanceMeters ?? 0).toBeLessThanOrEqual(150);
    expect(
      selectCapturableRoutePoint(
        [
          {
            sequence: 1,
            pointType: null,
            pointId: null,
            addressId: null,
            name: "Titik 1",
            address: null,
            latitude: null,
            longitude: null,
            visitStatusRaw: null,
            visitStatusName: null,
            arrivalTarget: null,
            arrivalActual: null,
            departureTarget: null,
            departureActual: null,
          },
        ],
        { latitude: -6.2, longitude: 106.8 },
      ),
    ).toBeNull();
  });
});
