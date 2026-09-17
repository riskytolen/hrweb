import { describe, expect, it } from "vitest";
import {
  classifyVehicleStatus,
  collectVehicleGroups,
  filterFleet,
  formatRelativeTime,
  formatSignalLabel,
  formatSpeedKmh,
  formatTemperature,
  formatVehicleTemperatures,
  normalizeMcEasyVehicleStatus,
  normalizeMcEasyVehicleStatusList,
  sortFleet,
  summarizeFleet,
  TMS_OFFLINE_THRESHOLD_MS,
  type TmsVehicleStatus,
} from "@/lib/tms-status";

const NOW = Date.parse("2026-09-15T10:00:00.000Z");
const FRESH = "2026-09-15T09:55:00.000Z";
const STALE = new Date(NOW - TMS_OFFLINE_THRESHOLD_MS - 60_000).toISOString();

function makeVehicle(overrides: Partial<TmsVehicleStatus> = {}): TmsVehicleStatus {
  return {
    vehicleId: 1,
    licensePlate: "B 9123 ABC",
    latitude: -7.268,
    longitude: 112.75,
    altitude: 0,
    speed: 0,
    calculatedSpeed: 0,
    direction: 90,
    engineOn: false,
    motionStatus: null,
    calculatedMotionStatus: null,
    lastPacket: FRESH,
    lastReceive: FRESH,
    lastMotion: FRESH,
    address: "Surabaya",
    province: "",
    city: "Surabaya",
    district: "",
    vehicleGroups: ["Group 1"],
    driverName: null,
    temperatures: [],
    signalStrength: null,
    status: "parked",
    hasValidLocation: true,
    ...overrides,
  };
}

describe("tms status helpers", () => {
  it("classifies moving, idle, parked, and offline", () => {
    expect(
      classifyVehicleStatus({ speed: 42, engineOn: true, lastReceive: FRESH, now: NOW }),
    ).toBe("moving");
    expect(
      classifyVehicleStatus({ speed: 0, engineOn: true, lastReceive: FRESH, now: NOW }),
    ).toBe("idle");
    expect(
      classifyVehicleStatus({ speed: 0, engineOn: false, lastReceive: FRESH, now: NOW }),
    ).toBe("parked");
    expect(
      classifyVehicleStatus({ speed: 42, engineOn: true, lastReceive: STALE, now: NOW }),
    ).toBe("offline");
    expect(classifyVehicleStatus({ speed: 0, engineOn: true, lastReceive: null, now: NOW })).toBe(
      "offline",
    );
    // Sinyal offline eksplisit dari McEasy harus menang atas data yang terlihat segar.
    expect(
      classifyVehicleStatus({
        speed: 0,
        engineOn: false,
        calculatedMotionStatus: "O",
        lastReceive: FRESH,
        now: NOW,
      }),
    ).toBe("offline");
  });

  it("normalizes raw McEasy payloads and drops invalid rows", () => {
    const normalized = normalizeMcEasyVehicleStatus(
      {
        vehicleId: 123,
        licensePlate: "l 123 tes",
        latitude: -7.2688883,
        longitude: 112.7502666,
        speed: 8,
        calculatedSpeed: 8,
        direction: 328,
        engineOn: true,
        motionStatus: "M",
        calculatedMotionStatus: "M",
        lastReceive: FRESH,
        address: "Surabaya",
        vehicleGroups: ["Group 1", "Group 2"],
        driver1: { fullname: "Joko" },
        temperature: [0, null, "4.55", "invalid"],
      },
      NOW,
    );
    expect(normalized).toMatchObject({
      vehicleId: 123,
      licensePlate: "L 123 TES",
      status: "moving",
      driverName: "Joko",
      temperatures: [0, null, 4.55, null],
      hasValidLocation: true,
    });

    expect(normalizeMcEasyVehicleStatus({ vehicleId: 1 }, NOW)).toBeNull();
    expect(normalizeMcEasyVehicleStatus({ licensePlate: "B 1 A" }, NOW)).toBeNull();

    const list = normalizeMcEasyVehicleStatusList(
      [{ vehicleId: 1, licensePlate: "B 1 A", lastReceive: FRESH }, null, "invalid"],
      NOW,
    );
    expect(list).toHaveLength(1);
  });

  it("marks vehicles without valid coordinates as not mappable", () => {
    const normalized = normalizeMcEasyVehicleStatus(
      { vehicleId: 9, licensePlate: "B 9 Z", latitude: 0, longitude: 0, lastReceive: FRESH },
      NOW,
    );
    expect(normalized?.hasValidLocation).toBe(false);
  });

  it("summarizes, filters, and sorts the fleet", () => {
    const vehicles = [
      makeVehicle({ vehicleId: 1, licensePlate: "B 1 A", status: "moving", speed: 40 }),
      makeVehicle({ vehicleId: 2, licensePlate: "B 2 B", status: "offline", hasValidLocation: false }),
      makeVehicle({
        vehicleId: 3,
        licensePlate: "L 3 C",
        status: "idle",
        vehicleGroups: ["Group 2"],
        driverName: "Joko",
      }),
    ];

    expect(summarizeFleet(vehicles)).toMatchObject({
      total: 3,
      moving: 1,
      idle: 1,
      offline: 1,
      withLocation: 2,
    });
    expect(collectVehicleGroups(vehicles)).toEqual(["Group 1", "Group 2"]);
    expect(filterFleet(vehicles, { query: "joko", status: "all", group: "all" })).toHaveLength(1);
    expect(filterFleet(vehicles, { query: "", status: "moving", group: "all" })).toHaveLength(1);
    expect(filterFleet(vehicles, { query: "", status: "all", group: "Group 2" })).toHaveLength(1);

    const sorted = sortFleet(vehicles, "status");
    expect(sorted.map((v) => v.vehicleId)).toEqual([1, 3, 2]);
    expect(sortFleet(vehicles, "speed")[0].vehicleId).toBe(1);
  });

  it("formats speed and relative time for Indonesian UI", () => {
    expect(formatSpeedKmh({ speed: 42, calculatedSpeed: 40 })).toBe("42 km/jam");
    expect(formatRelativeTime(FRESH, NOW)).toBe("5 mnt lalu");
    expect(formatRelativeTime(null, NOW)).toBe("Tidak diketahui");
  });

  it("labels GPS signal strength", () => {
    expect(formatSignalLabel(5)).toBe("Kuat");
    expect(formatSignalLabel(3)).toBe("Sedang");
    expect(formatSignalLabel(1)).toBe("Lemah");
    expect(formatSignalLabel(null)).toBe("-");
  });

  it("formats vehicle temperature sensors", () => {
    expect(formatTemperature(4.55)).toBe("4,6°C");
    expect(formatVehicleTemperatures([])).toBe("-");
    expect(formatVehicleTemperatures([null])).toBe("-");
    expect(formatVehicleTemperatures([0])).toBe("0°C");
    expect(formatVehicleTemperatures([0, null, 4.5])).toBe("S1 0°C • S3 4,5°C");
  });
});
