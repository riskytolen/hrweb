import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PLANNING_BASE_URL = "https://envoy-api.mceasy.com/fleet-planning/api/web/v1";
const VSMS_BASE_URL = "https://vsms-v2-public.mceasy.com/v1";

async function loadModule() {
  process.env.MCEASY_API_TOKEN = "test-token-tidak-asli";
  process.env.MCEASY_VSMS_V2_BASE_URL = "https://vsms-v2-public.mceasy.com/v1";
  process.env.MCEASY_FLEET_PLANNING_BASE_URL = PLANNING_BASE_URL;
  vi.resetModules();
  return import("@/lib/mceasy-server");
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchFleetTaskInstantTrack", () => {
  it("calls the fleet planning endpoint without an authorization header", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({ data: { id: "abc123", status: "On Trip", points: [] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchFleetTaskInstantTrack } = await loadModule();
    const result = await fetchFleetTaskInstantTrack("abc123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PLANNING_BASE_URL}/fleet-task-instant/track/abc123`);
    expect(init?.headers as Record<string, string>).not.toHaveProperty("Authorization");
    expect(result).toMatchObject({ id: "abc123" });
  });

  it("maps a missing track id to a 404 error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not Found", { status: 404 })));

    const { fetchFleetTaskInstantTrack, McEasyError } = await loadModule();
    const error = await fetchFleetTaskInstantTrack("tidak-ada").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(McEasyError);
    expect((error as { status: number }).status).toBe(404);
    expect((error as { code?: string }).code).toBe("TRACK_NOT_FOUND");
  });

  it("rejects blank ids without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { fetchFleetTaskInstantTrack } = await loadModule();
    const error = await fetchFleetTaskInstantTrack("   ").catch((err: unknown) => err);
    expect((error as { code?: string }).code).toBe("TRACK_INVALID_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the fleet planning base url is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.MCEASY_FLEET_PLANNING_BASE_URL = "";
    vi.resetModules();

    const { fetchFleetTaskInstantTrack } = await import("@/lib/mceasy-server");
    await expect(fetchFleetTaskInstantTrack("abc123")).rejects.toThrow(
      "MCEASY_FLEET_PLANNING_BASE_URL",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchFleetTaskInstantList", () => {
  it("sends bearer auth with limit/page/search/sort and parses the envelope", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({
        metadata: {
          count: 1,
          page: 2,
          total_count: 7714,
          total_count_draft: 16,
          total_count_scheduled: 11,
          total_count_started: 0,
          total_count_ended: 7673,
          total_count_canceled: 14,
        },
        data: {
          paginated_result: [{ id: "uuid-1", number: "FO-9262" }],
          ids: ["uuid-1"],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchFleetTaskInstantList } = await loadModule();
    const result = await fetchFleetTaskInstantList({
      limit: 20,
      page: 2,
      search: "FO-9262",
      sort: "created_on desc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`${PLANNING_BASE_URL}/fleet-task-instant?`);
    expect(url).toContain("limit=20");
    expect(url).toContain("page=2");
    expect(url).toContain("search=FO-9262");
    expect(url).toContain("sort=created_on+desc");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token-tidak-asli",
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(7714);
    expect(result.page).toBe(2);
    expect(result.counts).toMatchObject({ draft: 16, ended: 7673 });
  });

  it("maps unauthorized list responses to a sanitized error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Unauthenticated" }, 401)));

    const { fetchFleetTaskInstantList, McEasyError } = await loadModule();
    const error = await fetchFleetTaskInstantList().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(McEasyError);
    expect((error as { code?: string }).code).toBe("MCEASY_UNAUTHORIZED");
  });

  it("requires the vendor token for the authed list endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.MCEASY_API_TOKEN = "";
    process.env.MCEASY_FLEET_PLANNING_BASE_URL = PLANNING_BASE_URL;
    vi.resetModules();

    const { fetchFleetTaskInstantList } = await import("@/lib/mceasy-server");
    await expect(fetchFleetTaskInstantList()).rejects.toThrow("MCEASY_API_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchFleetTaskInstantDetail", () => {
  it("calls the show endpoint and unwraps the data envelope", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({ data: { id: "uuid-1", number: "FO-9262", planned_trip: [] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchFleetTaskInstantDetail } = await loadModule();
    const result = (await fetchFleetTaskInstantDetail("uuid-1")) as { number: string };

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PLANNING_BASE_URL}/fleet-task-instant/uuid-1`);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token-tidak-asli",
    );
    expect(result.number).toBe("FO-9262");
  });

  it("maps missing tasks to a 404 error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Not found" }, 404)));

    const { fetchFleetTaskInstantDetail, McEasyError } = await loadModule();
    const error = await fetchFleetTaskInstantDetail("uuid-hilang").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(McEasyError);
    expect((error as { status: number }).status).toBe(404);
    expect((error as { code?: string }).code).toBe("FLEET_TASK_NOT_FOUND");
  });
});

describe("fetchMcEasyTripDetail", () => {
  it("calls the trips detail endpoint with range query and bearer auth", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({ message: "ok", data: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMcEasyTripDetail } = await loadModule();
    await fetchMcEasyTripDetail("11418", {
      startDate: "2026-09-09T00:00:00.000Z",
      endDate: "2026-09-09T12:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.startsWith(`${VSMS_BASE_URL}/trips/11418/detail?`)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("startDate")).toBe("2026-09-09T00:00:00.000Z");
    expect(parsed.searchParams.get("endDate")).toBe("2026-09-09T12:00:00.000Z");
    expect(parsed.searchParams.get("speedLimit")).toBe("120");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token-tidak-asli",
    );
  });

  it("rejects a blank id or missing range without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMcEasyTripDetail } = await loadModule();
    const blankId = await fetchMcEasyTripDetail("   ", {
      startDate: "2026-09-09T00:00:00.000Z",
      endDate: "2026-09-09T12:00:00.000Z",
    }).catch((err: unknown) => err);
    expect((blankId as { code?: string }).code).toBe("MCEASY_INVALID_ID");

    const noRange = await fetchMcEasyTripDetail("11418", {
      startDate: "",
      endDate: "",
    }).catch((err: unknown) => err);
    expect((noRange as { code?: string }).code).toBe("MCEASY_INVALID_RANGE");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
