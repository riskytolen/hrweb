import { describe, expect, it } from "vitest";
import {
  calculateDistance,
  parseOdometerInput,
  summarizeDistanceByDate,
  summarizeDistanceByVehicle,
  summarizeOdometerLogs,
} from "@/lib/vehicle-odometer";

const logs = [
  { vehicle_id: 1, vehicle_unit: "B 1001 AA", tanggal: "2026-08-01", odometer_awal: 100, odometer_akhir: 150, jarak_km: 50 },
  { vehicle_id: 1, vehicle_unit: "B 1001 AA", tanggal: "2026-08-02", odometer_awal: 150, odometer_akhir: 200, jarak_km: 50 },
  { vehicle_id: 2, vehicle_unit: "B 2002 BB", tanggal: "2026-08-02", odometer_awal: 500, odometer_akhir: 525.5, jarak_km: 25.5 },
];

describe("vehicle odometer helpers", () => {
  it("parses Indonesian odometer input", () => {
    expect(parseOdometerInput("1.250,5")).toBe(1250.5);
    expect(parseOdometerInput("1250.5")).toBe(1250.5);
    expect(parseOdometerInput("1.250")).toBe(1250);
    expect(parseOdometerInput("abc")).toBeNull();
  });

  it("calculates distance safely", () => {
    expect(calculateDistance(100, 150.25)).toBe(50.3);
    expect(calculateDistance(150, 100)).toBeNull();
    expect(calculateDistance(null, 100)).toBeNull();
  });

  it("summarizes report totals", () => {
    expect(summarizeOdometerLogs(logs)).toEqual({
      totalJarak: 125.5,
      totalLog: 3,
      avgJarak: 41.8,
      odometerAwal: 100,
      odometerAkhir: 525.5,
      kendaraanCount: 2,
    });
  });

  it("summarizes distance by vehicle and date", () => {
    expect(summarizeDistanceByVehicle(logs)[0]).toMatchObject({ vehicleId: 1, totalJarak: 100, totalLog: 2 });
    expect(summarizeDistanceByDate(logs)).toEqual([
      { tanggal: "2026-08-01", totalJarak: 50, totalLog: 1 },
      { tanggal: "2026-08-02", totalJarak: 75.5, totalLog: 2 },
    ]);
  });
});
