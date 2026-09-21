import { describe, expect, it } from "vitest";
import {
  decodePolyline,
  normalizeFleetTaskInstantDetail,
  normalizeFleetTaskInstantItem,
  normalizeTripDetailTrail,
} from "@/lib/fleet-task-track";

describe("decodePolyline", () => {
  it("decodes a known encoded polyline", () => {
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toHaveLength(3);
    expect(points[0].latitude).toBeCloseTo(38.5, 5);
    expect(points[0].longitude).toBeCloseTo(-120.2, 5);
    expect(points[2].latitude).toBeCloseTo(43.252, 5);
    expect(points[2].longitude).toBeCloseTo(-126.453, 5);
  });

  it("returns empty array for invalid input", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

const LIST_FIXTURE = {
  id: "ef4d48bb-9de8-4db5-8abb-7712582059e5",
  number: "FO-9262",
  vehicle: { id: 11418, license_plate: "B 1234 TES" },
  driver: { id: 22433, name: "ASEP SURAHMAN" },
  status: { raw_type: "ENDED", name: "Selesai", color: "#429677" },
  estimated_arrival_on: "2026-09-09T10:33:40.002479+07:00",
  actual_arrival_on: null,
  timeline_route: [],
  current_point_location: {
    status: { raw_type: "WILL_VISITED", name: "Akan Dikunjungi" },
    address: { name: "Gudang Tuku Sawangan", full_name: "Jalan Raya Cinangka, Depok" },
  },
  total_point: 3,
  total_current_point: 0,
  track_link: "https://contoh.mceasy.com/fleet-task-instant/track/TOKENCONTOH",
  created_on: "2026-09-15T19:06:27.044342+07:00",
};

describe("normalizeFleetTaskInstantItem", () => {
  it("extracts summary fields from the real index shape", () => {
    const item = normalizeFleetTaskInstantItem(LIST_FIXTURE);
    expect(item).toMatchObject({
      id: "ef4d48bb-9de8-4db5-8abb-7712582059e5",
      number: "FO-9262",
      statusRaw: "ENDED",
      statusName: "Selesai",
      statusColor: "#429677",
      vehicleId: 11418,
      licensePlate: "B 1234 TES",
      driverName: "ASEP SURAHMAN",
      totalPoint: 3,
      currentPoint: 0,
      currentPointName: "Gudang Tuku Sawangan",
      currentPointStatus: "Akan Dikunjungi",
      trackId: "TOKENCONTOH",
    });
    expect(item?.trackLink).toContain("/track/");
  });

  it("returns null for invalid rows", () => {
    expect(normalizeFleetTaskInstantItem(null)).toBeNull();
    expect(normalizeFleetTaskInstantItem({ number: "FO-1" })).toBeNull();
  });

  it("keeps timeline_route from the index response", () => {
    const item = normalizeFleetTaskInstantItem({
      ...LIST_FIXTURE,
      timeline_route: [
        {
          plan_sequence: 2,
          address: { name: "Titik 2", full_name: "Jl. Dua" },
          visit_status: { raw_type: "WILL_VISITED", name: "Akan Dikunjungi" },
        },
        {
          plan_sequence: 1,
          address: { name: "Titik 1", full_name: "Jl. Satu" },
          visit_status: { raw_type: "WILL_VISITED", name: "Akan Dikunjungi" },
        },
      ],
    });
    expect(item?.timeline).toHaveLength(2);
    expect(item?.timeline[0].name).toBe("Titik 1");
    expect(item?.timeline[1].name).toBe("Titik 2");
  });

  it("keeps vendor point and address ids for epod identity", () => {
    const item = normalizeFleetTaskInstantItem({
      ...LIST_FIXTURE,
      timeline_route: [
        {
          id: "point-abc",
          plan_sequence: 1,
          point_type: "START",
          address: { id: "addr-xyz", name: "Gudang", full_name: "Jl. Gudang" },
          visit_status: { raw_type: "VISITED", name: "Dikunjungi" },
        },
      ],
    });
    expect(item?.timeline[0].pointId).toBe("point-abc");
    expect(item?.timeline[0].addressId).toBe("addr-xyz");
  });

  it("leaves vendor ids null when upstream omits them", () => {
    const item = normalizeFleetTaskInstantItem({
      ...LIST_FIXTURE,
      timeline_route: [
        {
          plan_sequence: 1,
          address: { name: "Gudang", full_name: "Jl. Gudang" },
        },
      ],
    });
    expect(item?.timeline[0].pointId).toBeNull();
    expect(item?.timeline[0].addressId).toBeNull();
  });
});

describe("normalizeFleetTaskInstantDetail", () => {
  it("decodes trips and sorts the timeline", () => {
    const detail = normalizeFleetTaskInstantDetail({
      ...LIST_FIXTURE,
      planned_trip: ["_p~iF~ps|U_ulLnnqC_mqNvxq`@"],
      actual_trip: ["_p~iF~ps|U"],
      timeline_route: [
        {
          point_type: "END",
          plan_sequence: 2,
          address: { name: "Tujuan", full_name: "Jl. Tujuan" },
          visit_status: { raw_type: "WILL_VISITED", name: "Akan Dikunjungi" },
          arrival_time: { target: null, actual: null },
          departure_time: { target: null, actual: null },
        },
        {
          point_type: "START",
          plan_sequence: 1,
          address: {
            name: "Awal",
            full_name: "Jl. Awal",
            geolocation: { coordinate: { latitude: -6.37, longitude: 106.74 } },
          },
          visit_status: { raw_type: "VISITED", name: "Dikunjungi" },
          arrival_time: { target: null, actual: "2026-09-09T10:00:00+07:00" },
          departure_time: { target: null, actual: null },
        },
      ],
    });

    expect(detail?.plannedRoutes).toHaveLength(1);
    expect(detail?.plannedRoutes[0]).toHaveLength(3);
    expect(detail?.actualRoutes).toHaveLength(1);
    expect(detail?.timeline).toHaveLength(2);
    expect(detail?.timeline[0].pointType).toBe("START");
    expect(detail?.timeline[0].latitude).toBeCloseTo(-6.37, 5);
    expect(detail?.timeline[0].arrivalActual).toBe("2026-09-09T10:00:00+07:00");
  });
});

describe("normalizeTripDetailTrail", () => {
  it("maps valid GPS points and sorts them by time", () => {
    const trail = normalizeTripDetailTrail({
      message: "ok",
      data: [
        { latitude: -6.3, longitude: 106.8, sentOn: "2026-09-09T10:05:00Z" },
        { latitude: -6.2, longitude: 106.7, sentOn: "2026-09-09T10:00:00Z" },
      ],
    });
    expect(trail).toEqual([
      { latitude: -6.2, longitude: 106.7 },
      { latitude: -6.3, longitude: 106.8 },
    ]);
  });

  it("drops invalid and zero coordinates", () => {
    const trail = normalizeTripDetailTrail({
      data: [
        { latitude: 0, longitude: 0 },
        { latitude: null, longitude: 106 },
        { latitude: -6.2, longitude: 106.7 },
      ],
    });
    expect(trail).toEqual([{ latitude: -6.2, longitude: 106.7 }]);
  });

  it("returns an empty array for unrecognized payloads", () => {
    expect(normalizeTripDetailTrail(null)).toEqual([]);
    expect(normalizeTripDetailTrail({ message: "ok" })).toEqual([]);
  });

  it("reads nested array wrappers and nested coordinate objects", () => {
    const trail = normalizeTripDetailTrail({
      message: "ok",
      data: {
        locations: [
          { location: { lat: "-6.2", lng: "106.7" }, timestamp: "2026-09-09T10:00:00Z" },
          { location: { lat: "-6.3", lng: "106.8" }, timestamp: "2026-09-09T10:05:00Z" },
        ],
      },
    });
    expect(trail).toEqual([
      { latitude: -6.2, longitude: 106.7 },
      { latitude: -6.3, longitude: 106.8 },
    ]);
  });
});
