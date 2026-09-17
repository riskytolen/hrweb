import { describe, expect, it } from "vitest";
import {
  formatTemperature,
  matchTemperaturesToPoints,
  normalizeTemperatureWebhook,
  pointTemperatureLabel,
} from "@/lib/tms-temperature";

describe("normalizeTemperatureWebhook", () => {
  it("parses the documented DVC-DU/T1 payload shape", () => {
    expect(
      normalizeTemperatureWebhook({
        license_plate: "B 9402 BCU",
        imei: "864567234",
        driver: "ASEP SURAHMAN",
        latitude: -6.37,
        longitude: 106.74,
        temperature_num: 1,
        temperature: 4.5,
        engine_on: true,
      }),
    ).toMatchObject({
      licensePlate: "B 9402 BCU",
      imei: "864567234",
      driverName: "ASEP SURAHMAN",
      latitude: -6.37,
      longitude: 106.74,
      temperatureNum: 1,
      temperature: 4.5,
      engineOn: true,
    });
  });

  it("accepts imei-only payloads with camelCase aliases", () => {
    expect(
      normalizeTemperatureWebhook({ deviceImei: "999", temp: "-18", engineOn: 1 }),
    ).toMatchObject({ licensePlate: null, imei: "999", temperature: -18, engineOn: true });
  });

  it("accepts coolant temperature data update aliases", () => {
    expect(
      normalizeTemperatureWebhook({ licensePlate: "B 9448 BRO", coolantTemperature: "82.5" }),
    ).toMatchObject({ licensePlate: "B 9448 BRO", temperature: 82.5 });
  });

  it("rejects payloads without temperature or vehicle identity", () => {
    expect(normalizeTemperatureWebhook(null)).toBeNull();
    expect(normalizeTemperatureWebhook({ license_plate: "B 1" })).toBeNull();
    expect(normalizeTemperatureWebhook({ temperature: 4.5 })).toBeNull();
    expect(normalizeTemperatureWebhook({ license_plate: "B 1", temperature: "rusak" })).toBeNull();
  });
});

describe("matchTemperaturesToPoints", () => {
  const points = [
    { sequence: 1, arrivalActual: "2026-09-16T10:00:00+07:00", departureActual: null },
    { sequence: 2, arrivalActual: "2026-09-16T12:00:00+07:00", departureActual: null },
    { sequence: 3, arrivalActual: null, departureActual: null },
  ];

  it("matches the nearest reading within the window and skips pending points", () => {
    const matched = matchTemperaturesToPoints(
      points,
      [
        { temperature: 4.5, temperatureNum: 1, recordedAt: "2026-09-16T10:05:00+07:00" },
        { temperature: -18, temperatureNum: 2, recordedAt: "2026-09-16T11:58:00+07:00" },
      ],
      30,
    );
    expect(matched).toHaveLength(2);
    expect(matched[0]).toMatchObject({ sequence: 1, temperature: 4.5, temperatureNum: 1 });
    expect(matched[1]).toMatchObject({ sequence: 2, temperature: -18, temperatureNum: 2 });
  });

  it("excludes readings outside the window", () => {
    const matched = matchTemperaturesToPoints(points.slice(0, 1), [
      { temperature: 4.5, temperatureNum: null, recordedAt: "2026-09-16T11:00:00+07:00" },
    ]);
    expect(matched).toEqual([]);
  });
});

describe("temperature labels", () => {
  it("formats values and sensor labels", () => {
    expect(formatTemperature(4)).toBe("4°C");
    expect(formatTemperature(4.55)).toBe("4.6°C");
    expect(pointTemperatureLabel(1, 4.5)).toBe("Sensor 1 · 4.5°C");
    expect(pointTemperatureLabel(null, -18)).toBe("Suhu -18°C");
  });
});
