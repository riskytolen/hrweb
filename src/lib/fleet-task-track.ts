/**
 * Normalisasi defensif untuk respons Fleet Task Instant Live Track.
 *
 * Schema upstream tidak sepenuhnya terdokumentasi di sisi kita, jadi modul
 * ini mengekstrak field umum dengan toleransi alias camelCase/snake_case
 * dan tidak pernah melempar — data yang tidak dikenali diabaikan.
 */

export interface FleetTaskTrackPoint {
  latitude: number;
  longitude: number;
  recordedAt: string | null;
  speed: number | null;
  label: string | null;
}

export interface FleetTaskTrackHistory {
  status: string;
  at: string | null;
  note: string | null;
}

export interface FleetTaskTrackDetail {
  id: string;
  title: string | null;
  statusText: string | null;
  licensePlate: string | null;
  driverName: string | null;
  originText: string | null;
  destinationText: string | null;
  points: FleetTaskTrackPoint[];
  history: FleetTaskTrackHistory[];
}

/**
 * Menerima ID mentah atau full tracking link, kembalikan encoded ID.
 * Contoh: "https://.../track/abc123?x=1" -> "abc123".
 */
export function extractTrackIdFromInput(rawInput: string): string {
  const trimmed = (rawInput ?? "").trim();
  if (!trimmed) return "";

  const withoutQuery = trimmed.split(/[?#]/, 1)[0].trim();
  if (!withoutQuery) return "";

  try {
    if (/^https?:\/\//i.test(withoutQuery)) {
      const url = new URL(withoutQuery);
      const segments = url.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) return decodeURIComponent(last);
      return "";
    }
  } catch {
    // Bukan URL valid — perlakukan sebagai ID biasa di bawah.
  }

  const segments = withoutQuery.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  try {
    return decodeURIComponent(last).trim();
  } catch {
    return last.trim();
  }
}

function toTrimmedString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickFirst(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function isValidCoordinate(latitude: number, longitude: number): boolean {
  if (latitude === 0 && longitude === 0) return false;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function normalizePoint(item: unknown): FleetTaskTrackPoint | null {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const latitude = toFiniteNumber(pickFirst(source, ["latitude", "lat"]));
  const longitude = toFiniteNumber(
    pickFirst(source, ["longitude", "lng", "lon", "long"]),
  );
  if (latitude === null || longitude === null) return null;
  if (!isValidCoordinate(latitude, longitude)) return null;
  return {
    latitude,
    longitude,
    recordedAt: toTrimmedString(
      pickFirst(source, ["recordedAt", "recorded_at", "timestamp", "createdAt", "created_at", "time"]),
      60,
    ),
    speed: toFiniteNumber(pickFirst(source, ["speed", "calculatedSpeed", "calculated_speed"])),
    label: toTrimmedString(pickFirst(source, ["label", "name", "address"]), 200),
  };
}

function normalizeHistory(item: unknown): FleetTaskTrackHistory | null {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const status = toTrimmedString(
    pickFirst(source, ["status", "statusText", "status_text", "title", "name", "event"]),
    120,
  );
  if (!status) return null;
  return {
    status,
    at: toTrimmedString(
      pickFirst(source, ["at", "createdAt", "created_at", "timestamp", "time", "date"]),
      60,
    ),
    note: toTrimmedString(
      pickFirst(source, ["note", "description", "remark", "address", "detail"]),
      300,
    ),
  };
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeFleetTaskTrack(raw: unknown, fallbackId: string): FleetTaskTrackDetail {
  const source: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const pointsRaw = toArray(
    pickFirst(source, [
      "points",
      "pointList",
      "point_list",
      "trackPoints",
      "track_points",
      "locations",
      "routePoints",
      "route_points",
      "coordinates",
    ]),
  );
  const historyRaw = toArray(
    pickFirst(source, [
      "statusHistory",
      "status_history",
      "statusHistories",
      "status_histories",
      "histories",
      "history",
      "events",
      "statusLogs",
      "status_logs",
    ]),
  );

  const nestedVehicle = pickFirst(source, ["vehicle", "vehicleDetail", "vehicle_detail"]);
  const vehicleSource: Record<string, unknown> =
    nestedVehicle && typeof nestedVehicle === "object"
      ? (nestedVehicle as Record<string, unknown>)
      : {};
  const nestedDriver = pickFirst(source, ["driver", "driverDetail", "driver_detail"]);
  const driverSource: Record<string, unknown> =
    nestedDriver && typeof nestedDriver === "object"
      ? (nestedDriver as Record<string, unknown>)
      : {};

  const points: FleetTaskTrackPoint[] = [];
  for (const item of pointsRaw) {
    const point = normalizePoint(item);
    if (point) points.push(point);
  }

  const history: FleetTaskTrackHistory[] = [];
  for (const item of historyRaw) {
    const event = normalizeHistory(item);
    if (event) history.push(event);
  }

  const id =
    toTrimmedString(pickFirst(source, ["id", "trackId", "track_id", "encodeId", "encodedId", "encoded_id"]), 200) ??
    fallbackId;

  return {
    id,
    title: toTrimmedString(
      pickFirst(source, ["title", "name", "taskName", "task_name", "fleetTaskName", "fleet_task_name"]),
      200,
    ),
    statusText: toTrimmedString(
      pickFirst(source, ["status", "statusText", "status_text", "currentStatus", "current_status", "state"]),
      120,
    ),
    licensePlate:
      toTrimmedString(pickFirst(source, ["licensePlate", "license_plate", "plate", "plateNumber", "plate_number"]), 40) ??
      toTrimmedString(
        pickFirst(vehicleSource, ["licensePlate", "license_plate", "plate", "plateNumber", "plate_number"]),
        40,
      ),
    driverName:
      toTrimmedString(pickFirst(source, ["driverName", "driver_name", "driver"]), 120) ??
      toTrimmedString(pickFirst(driverSource, ["fullname", "full_name", "name"]), 120),
    originText: toTrimmedString(pickFirst(source, ["origin", "originAddress", "origin_address", "from"]), 300),
    destinationText: toTrimmedString(
      pickFirst(source, ["destination", "destinationAddress", "destination_address", "to"]),
      300,
    ),
    points,
    history,
  };
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Decode Google Encoded Polyline menjadi daftar koordinat.
 * Format ini dipakai field `planned_trip` / `actual_trip` pada
 * Show Fleet Task Instant. Tidak pernah melempar — input rusak
 * menghasilkan array kosong.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  if (!encoded) return points;
  let index = 0;
  let lat = 0;
  let lng = 0;
  try {
    while (index < encoded.length) {
      let shift = 0;
      let result = 0;
      let byte = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += deltaLat;

      shift = 0;
      result = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += deltaLng;

      const latitude = lat / 1e5;
      const longitude = lng / 1e5;
      if (!isValidCoordinate(latitude, longitude)) continue;
      points.push({ latitude, longitude });
    }
  } catch {
    // Abaikan sisa input yang rusak, kembalikan titik yang valid.
  }
  return points;
}

export interface TripDetailPoint {
  latitude: number;
  longitude: number;
  recordedAt: string | null;
  speed: number | null;
  direction: number | null;
  address: string | null;
  licensePlate: string | null;
  driverName: string | null;
}

/**
 * Normalisasi respons "Detail Trip History" (`GET /trips/:id/detail`).
 *
 * Bentuk upstream: `{ message, data: [ { latitude, longitude, sentOn, ... } ] }`.
 * Titik tanpa koordinat valid (termasuk 0,0) dibuang. Bila seluruh titik
 * memiliki timestamp valid, urutkan naik berdasarkan waktu.
 */
function pickTripCoordinate(row: Record<string, unknown>): {
  latitude: number | null;
  longitude: number | null;
} {
  const latitude = toFiniteNumber(pickFirst(row, ["latitude", "lat"]));
  const longitude = toFiniteNumber(pickFirst(row, ["longitude", "lng", "lon", "long"]));
  if (latitude !== null && longitude !== null) return { latitude, longitude };
  const nestedRaw = pickFirst(row, ["location", "coordinate", "position", "geolocation", "geo"]);
  if (nestedRaw && typeof nestedRaw === "object") {
    const nested = nestedRaw as Record<string, unknown>;
    return {
      latitude: toFiniteNumber(pickFirst(nested, ["latitude", "lat"])),
      longitude: toFiniteNumber(pickFirst(nested, ["longitude", "lng", "lon", "long"])),
    };
  }
  return { latitude, longitude };
}

export function normalizeTripDetailPoints(raw: unknown): TripDetailPoint[] {
  const source: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const candidate =
    source.data !== undefined ? source.data : source.DATA !== undefined ? source.DATA : raw;
  let list = toArray(candidate);
  // Toleransi wrapper lain, mis. `{ data: { locations: [...] } }`.
  if (list.length === 0 && candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    for (const value of Object.values(candidate as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0) {
        list = value;
        break;
      }
    }
  }

  const points: TripDetailPoint[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const { latitude, longitude } = pickTripCoordinate(row);
    if (latitude === null || longitude === null) continue;
    if (!isValidCoordinate(latitude, longitude)) continue;

    const driverRaw = pickFirst(row, ["driver"]);
    const driverSource: Record<string, unknown> =
      driverRaw && typeof driverRaw === "object" ? (driverRaw as Record<string, unknown>) : {};

    points.push({
      latitude,
      longitude,
      recordedAt: toDateString(
        pickFirst(row, [
          "sentOn",
          "sent_on",
          "lastPacket",
          "last_packet",
          "lastReceive",
          "last_receive",
          "recordedAt",
          "recorded_at",
          "timestamp",
          "time",
          "createdAt",
          "created_at",
          "gpsTime",
          "gps_time",
        ]),
      ),
      speed: toFiniteNumber(pickFirst(row, ["speed"])),
      direction: toFiniteNumber(pickFirst(row, ["direction"])),
      address: toTrimmedString(pickFirst(row, ["address"]), 300),
      licensePlate: toTrimmedString(pickFirst(row, ["licensePlate", "license_plate"]), 40),
      driverName: toTrimmedString(pickFirst(driverSource, ["fullName", "full_name", "name"]), 120),
    });
  }

  const allTimestamped =
    points.length > 1 &&
    points.every((p) => p.recordedAt !== null && !Number.isNaN(Date.parse(p.recordedAt)));
  if (allTimestamped) {
    points.sort(
      (a, b) => Date.parse(a.recordedAt as string) - Date.parse(b.recordedAt as string),
    );
  }
  return points;
}

/** Ambil hanya koordinat jejak dari respons Detail Trip History. */
export function normalizeTripDetailTrail(raw: unknown): LatLng[] {
  return normalizeTripDetailPoints(raw).map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  }));
}

function toDateString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return toTrimmedString(
      pickFirst(source, ["date", "datetime", "value", "iso", "time", "timestamp"]),
      60,
    );
  }
  return null;
}

export interface FleetTaskInstantItem {
  id: string;
  number: string | null;
  statusRaw: string | null;
  statusName: string | null;
  statusColor: string | null;
  vehicleId: number | null;
  licensePlate: string | null;
  driverName: string | null;
  expectedStartedOn: string | null;
  expectedArrivalOn: string | null;
  estimatedArrivalOn: string | null;
  actualStartedOn: string | null;
  actualArrivalOn: string | null;
  totalPoint: number | null;
  currentPoint: number | null;
  currentPointName: string | null;
  currentPointStatus: string | null;
  trackLink: string | null;
  trackId: string | null;
  createdOn: string | null;
  /**
   * Titik rute dari `timeline_route`. Endpoint Index mengirimkannya,
   * sedangkan endpoint Show tidak — jadi field ini penting sebagai
   * fallback saat membuka detail task terjadwal.
   */
  timeline: FleetTaskTimelinePoint[];
}

function toStatusColor(value: unknown): string | null {
  const color = toTrimmedString(value, 20);
  if (!color || !/^#[0-9a-fA-F]{3,8}$/.test(color)) return null;
  return color;
}

export function normalizeFleetTaskInstantItem(raw: unknown): FleetTaskInstantItem | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  const id = toTrimmedString(pickFirst(source, ["id", "uuid"]), 100);
  if (!id) return null;

  const statusRaw = pickFirst(source, ["status"]);
  const statusSource: Record<string, unknown> =
    statusRaw && typeof statusRaw === "object" ? (statusRaw as Record<string, unknown>) : {};
  const vehicleRaw = pickFirst(source, ["vehicle"]);
  const vehicleSource: Record<string, unknown> =
    vehicleRaw && typeof vehicleRaw === "object" ? (vehicleRaw as Record<string, unknown>) : {};
  const driverRaw = pickFirst(source, ["driver", "driver_user", "driverUser"]);
  const driverSource: Record<string, unknown> =
    driverRaw && typeof driverRaw === "object" ? (driverRaw as Record<string, unknown>) : {};
  const currentPointRaw = pickFirst(source, ["current_point_location", "currentPointLocation", "current_point"]);
  const currentPointSource: Record<string, unknown> =
    currentPointRaw && typeof currentPointRaw === "object"
      ? (currentPointRaw as Record<string, unknown>)
      : {};
  const currentPointAddressRaw = pickFirst(currentPointSource, ["address"]);
  const currentPointAddress: Record<string, unknown> =
    currentPointAddressRaw && typeof currentPointAddressRaw === "object"
      ? (currentPointAddressRaw as Record<string, unknown>)
      : {};
  const currentPointStatusRaw = pickFirst(currentPointSource, ["status"]);
  const currentPointStatus: Record<string, unknown> =
    currentPointStatusRaw && typeof currentPointStatusRaw === "object"
      ? (currentPointStatusRaw as Record<string, unknown>)
      : {};

  const trackLink = toTrimmedString(pickFirst(source, ["track_link", "trackLink", "trackUrl", "track_url"]), 2000);
  const trackId = trackLink ? extractTrackIdFromInput(trackLink) || null : null;

  return {
    id,
    number: toTrimmedString(pickFirst(source, ["number", "taskNumber", "task_number", "code"]), 60),
    statusRaw: toTrimmedString(pickFirst(statusSource, ["raw_type", "rawType", "code", "key"]), 40),
    statusName: toTrimmedString(pickFirst(statusSource, ["name", "label", "title"]), 60),
    statusColor: toStatusColor(pickFirst(statusSource, ["color", "background_color", "backgroundColor"])),
    vehicleId: toFiniteNumber(pickFirst(vehicleSource, ["id"])),
    licensePlate: toTrimmedString(
      pickFirst(source, ["licensePlate", "license_plate", "plate"]),
      40,
    ) ?? toTrimmedString(pickFirst(vehicleSource, ["license_plate", "licensePlate", "plate"]), 40),
    driverName:
      toTrimmedString(pickFirst(source, ["driverName", "driver_name"]), 120) ??
      toTrimmedString(pickFirst(driverSource, ["name", "fullname", "full_name"]), 120),
    expectedStartedOn: toDateString(pickFirst(source, ["expected_started_on", "expectedStartedOn", "expected_departure_on", "expectedDepartureOn"])),
    expectedArrivalOn: toDateString(pickFirst(source, ["expected_arrival_on", "expectedArrivalOn"])),
    estimatedArrivalOn: toDateString(pickFirst(source, ["estimated_arrival_on", "estimatedArrivalOn"])),
    actualStartedOn: toDateString(pickFirst(source, ["actual_started_on", "actualStartedOn", "actual_departure_on", "actualDepartureOn"])),
    actualArrivalOn: toDateString(pickFirst(source, ["actual_arrival_on", "actualArrivalOn"])),
    totalPoint: toFiniteNumber(pickFirst(source, ["total_point", "totalPoint", "total_points"])),
    currentPoint: toFiniteNumber(pickFirst(source, ["total_current_point", "totalCurrentPoint", "current_point", "currentPoint"])),
    currentPointName:
      toTrimmedString(pickFirst(currentPointAddress, ["name", "full_name", "fullName"]), 200),
    currentPointStatus:
      toTrimmedString(pickFirst(currentPointStatus, ["name", "label"]), 60),
    trackLink,
    trackId,
    createdOn: toDateString(pickFirst(source, ["created_on", "createdOn", "created_at", "createdAt"])),
    timeline: normalizeTimelineList(
      pickFirst(source, ["timeline_route", "timelineRoute", "timeline", "route_points", "routePoints"]),
    ),
  };
}

export interface FleetTaskTimelinePoint {
  sequence: number | null;
  pointType: string | null;
  /** ID titik dari vendor (`timeline_route[].id`); dipakai sebagai identitas e-POD. */
  pointId: string | null;
  /** ID alamat vendor (`address.id`); bagian dari snapshot e-POD. */
  addressId: string | null;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  visitStatusRaw: string | null;
  visitStatusName: string | null;
  arrivalTarget: string | null;
  arrivalActual: string | null;
  departureTarget: string | null;
  departureActual: string | null;
}

export interface FleetTaskInstantDetail extends FleetTaskInstantItem {
  plannedRoutes: LatLng[][];
  actualRoutes: LatLng[][];
  timeline: FleetTaskTimelinePoint[];
}

function normalizeTimelinePoint(item: unknown): FleetTaskTimelinePoint | null {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;

  const addressRaw = pickFirst(source, ["address", "location"]);
  const addressSource: Record<string, unknown> =
    addressRaw && typeof addressRaw === "object" ? (addressRaw as Record<string, unknown>) : {};
  const geoRaw = pickFirst(addressSource, ["geolocation", "geo", "coordinate"]);
  const geoSource: Record<string, unknown> =
    geoRaw && typeof geoRaw === "object" ? (geoRaw as Record<string, unknown>) : {};
  const coordRaw = pickFirst(geoSource, ["coordinate", "latLng", "latlng"]);
  const coordSource: Record<string, unknown> =
    coordRaw && typeof coordRaw === "object" ? (coordRaw as Record<string, unknown>) : geoSource;

  const latitude = toFiniteNumber(pickFirst(coordSource, ["latitude", "lat"]));
  const longitude = toFiniteNumber(pickFirst(coordSource, ["longitude", "lng", "lon", "long"]));

  const visitRaw = pickFirst(source, ["visit_status", "visitStatus", "status"]);
  const visitSource: Record<string, unknown> =
    visitRaw && typeof visitRaw === "object" ? (visitRaw as Record<string, unknown>) : {};
  const arrivalRaw = pickFirst(source, ["arrival_time", "arrivalTime", "arrival"]);
  const arrivalSource: Record<string, unknown> =
    arrivalRaw && typeof arrivalRaw === "object" ? (arrivalRaw as Record<string, unknown>) : {};
  const departureRaw = pickFirst(source, ["departure_time", "departureTime", "departure"]);
  const departureSource: Record<string, unknown> =
    departureRaw && typeof departureRaw === "object" ? (departureRaw as Record<string, unknown>) : {};

  const name = toTrimmedString(pickFirst(addressSource, ["name"]), 200);
  const address = toTrimmedString(pickFirst(addressSource, ["full_name", "fullName", "address"]), 300);
  if (!name && !address && latitude === null) return null;

  return {
    sequence: toFiniteNumber(pickFirst(source, ["plan_sequence", "planSequence", "sequence", "order"])),
    pointType: toTrimmedString(pickFirst(source, ["point_type", "pointType", "type"]), 40),
    pointId: toTrimmedString(pickFirst(source, ["id", "point_id", "pointId"]), 100),
    addressId: toTrimmedString(pickFirst(addressSource, ["id", "address_id", "addressId"]), 100),
    name,
    address,
    latitude: latitude !== null && longitude !== null && isValidCoordinate(latitude, longitude) ? latitude : null,
    longitude: latitude !== null && longitude !== null && isValidCoordinate(latitude, longitude) ? longitude : null,
    visitStatusRaw: toTrimmedString(pickFirst(visitSource, ["raw_type", "rawType", "code"]), 40),
    visitStatusName: toTrimmedString(pickFirst(visitSource, ["name", "label"]), 60),
    arrivalTarget: toDateString(pickFirst(arrivalSource, ["target"])),
    arrivalActual: toDateString(pickFirst(arrivalSource, ["actual"])),
    departureTarget: toDateString(pickFirst(departureSource, ["target"])),
    departureActual: toDateString(pickFirst(departureSource, ["actual"])),
  };
}

/** Normalisasi daftar titik rute dan urutkan berdasarkan `plan_sequence`. */
function normalizeTimelineList(value: unknown): FleetTaskTimelinePoint[] {
  const timeline: FleetTaskTimelinePoint[] = [];
  for (const item of toArray(value)) {
    const point = normalizeTimelinePoint(item);
    if (point) timeline.push(point);
  }
  timeline.sort(
    (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER),
  );
  return timeline;
}

function decodeRouteList(value: unknown): LatLng[][] {
  const routes: LatLng[][] = [];
  const list = Array.isArray(value) ? value : [];
  for (const entry of list) {
    if (typeof entry !== "string" || !entry) continue;
    const points = decodePolyline(entry);
    if (points.length > 0) routes.push(points);
  }
  return routes;
}

export function normalizeFleetTaskInstantDetail(raw: unknown): FleetTaskInstantDetail | null {
  const base = normalizeFleetTaskInstantItem(raw);
  if (!base) return null;
  const source = raw as Record<string, unknown>;

  const timelineRaw = pickFirst(source, [
    "timeline_route",
    "timelineRoute",
    "timeline",
    "points",
    "route_points",
    "routePoints",
  ]);
  // Endpoint Show tidak mengirim timeline_route; pakai hasil dari Index.
  const timeline = normalizeTimelineList(timelineRaw);
  const effectiveTimeline = timeline.length > 0 ? timeline : base.timeline;

  return {
    ...base,
    plannedRoutes: decodeRouteList(pickFirst(source, ["planned_trip", "plannedTrip", "planned_routes", "plannedRoutes"])),
    actualRoutes: decodeRouteList(pickFirst(source, ["actual_trip", "actualTrip", "actual_routes", "actualRoutes"])),
    timeline: effectiveTimeline,
  };
}
