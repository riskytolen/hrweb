import { describe, expect, it } from "vitest";
import {
  extractTrackIdFromInput,
  normalizeFleetTaskInstantItem,
  normalizeFleetTaskTrack,
  normalizeRouteList,
} from "@/lib/fleet-task-track";

describe("extractTrackIdFromInput", () => {
  it("returns bare ids unchanged", () => {
    expect(extractTrackIdFromInput("abc123")).toBe("abc123");
    expect(extractTrackIdFromInput("  abc123  ")).toBe("abc123");
  });

  it("extracts the token segment from full tracking links", () => {
    expect(
      extractTrackIdFromInput("https://envoy-api.mceasy.com/fleet-planning/api/web/v1/fleet-task-instant/track/abc123"),
    ).toBe("abc123");
    expect(extractTrackIdFromInput("https://contoh.test/track/abc123?x=1#bagian")).toBe("abc123");
    expect(extractTrackIdFromInput("https://contoh.test/track/abc123/")).toBe("abc123");
  });

  it("returns empty string for blank input", () => {
    expect(extractTrackIdFromInput("")).toBe("");
    expect(extractTrackIdFromInput("   ")).toBe("");
  });
});

describe("normalizeFleetTaskTrack", () => {
  it("extracts summary, points, and history with alias tolerance", () => {
    const detail = normalizeFleetTaskTrack(
      {
        trackId: "abc123",
        status: "On Trip",
        license_plate: "B 1234 TES",
        driver: { full_name: "Budi" },
        origin_address: "Jakarta",
        destination_address: "Surabaya",
        points: [
          { lat: -6.2, lng: 106.8, timestamp: "2026-09-15T10:00:00Z", speed: 40 },
          { latitude: -6.3, longitude: 106.9, recorded_at: "2026-09-15T11:00:00Z" },
          { latitude: 0, longitude: 0 },
          "bukan-titik",
        ],
        status_history: [
          { status: "Berangkat", created_at: "2026-09-15T10:00:00Z", note: "Start" },
          { status: "", created_at: "2026-09-15T11:00:00Z" },
        ],
      },
      "fallback",
    );

    expect(detail.id).toBe("abc123");
    expect(detail.statusText).toBe("On Trip");
    expect(detail.licensePlate).toBe("B 1234 TES");
    expect(detail.driverName).toBe("Budi");
    expect(detail.originText).toBe("Jakarta");
    expect(detail.destinationText).toBe("Surabaya");
    expect(detail.points).toHaveLength(2);
    expect(detail.points[0]).toMatchObject({ latitude: -6.2, longitude: 106.8, speed: 40 });
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({ status: "Berangkat", note: "Start" });
  });

  it("never throws and falls back to the requested id", () => {
    expect(normalizeFleetTaskTrack(null, "fallback").id).toBe("fallback");
    expect(normalizeFleetTaskTrack("rusak", "fallback").points).toEqual([]);
    expect(normalizeFleetTaskTrack({}, "fallback").history).toEqual([]);
  });
});

describe("normalizeRouteList", () => {
  it("keeps stored coordinate arrays and drops invalid entries", () => {
    expect(
      normalizeRouteList([
        [
          { latitude: -6.2, longitude: 106.8 },
          { latitude: -6.3, longitude: 106.9 },
        ],
        [{ latitude: 0, longitude: 0 }],
        "bukan-rute",
      ]),
    ).toEqual([[
      { latitude: -6.2, longitude: 106.8 },
      { latitude: -6.3, longitude: 106.9 },
    ]]);
    expect(normalizeRouteList(null)).toEqual([]);
    expect(normalizeRouteList("rusak")).toEqual([]);
  });
});

describe("normalizeFleetTaskInstantItem", () => {
  it("carries frozen snapshot routes and terminal time when present", () => {
    const item = normalizeFleetTaskInstantItem({
      id: "task-1",
      number: "FO-9445",
      plannedRoutes: [[{ latitude: -6.2, longitude: 106.8 }]],
      actual_routes: [[{ latitude: -6.3, longitude: 106.9 }]],
      terminal_at: "2026-09-28T08:58:58.000Z",
    });
    expect(item).toMatchObject({
      id: "task-1",
      terminalAt: "2026-09-28T08:58:58.000Z",
    });
    expect(item?.plannedRoutes).toEqual([[{ latitude: -6.2, longitude: 106.8 }]]);
    expect(item?.actualRoutes).toEqual([[{ latitude: -6.3, longitude: 106.9 }]]);
  });
});
