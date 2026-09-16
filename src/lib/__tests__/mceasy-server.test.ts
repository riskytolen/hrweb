import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const TOKEN = "test-token-tidak-asli";
const BASE_URL = "https://vsms-v2-public.mceasy.com/v1";

async function loadModule() {
  process.env.MCEASY_API_TOKEN = TOKEN;
  process.env.MCEASY_VSMS_V2_BASE_URL = BASE_URL;
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

describe("mceasy server adapter", () => {
  it("sends bearer auth and normalizes the status list", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({
        message: "Success",
        data: [
          {
            vehicleId: 123,
            licensePlate: "L 123 TES",
            latitude: -7.26,
            longitude: 112.75,
            speed: 8,
            engineOn: true,
            motionStatus: "M",
            lastReceive: new Date().toISOString(),
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMcEasyVehicleStatuses } = await loadModule();
    const result = await fetchMcEasyVehicleStatuses();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/vehicles/statuses?withAddress=true`);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ vehicleId: 123, licensePlate: "L 123 TES" });
  });

  it("maps unauthorized upstream responses to a sanitized error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "E-V1/1-03", detail: "Context creation failed: jwt expired" }, 401)),
    );

    const { fetchMcEasyVehicleStatuses, McEasyError } = await loadModule();
    const error = await fetchMcEasyVehicleStatuses().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(McEasyError);
    expect((error as Error).message).toContain("Token integrasi tracking");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("fails closed when the token is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.MCEASY_API_TOKEN = "";
    process.env.MCEASY_VSMS_V2_BASE_URL = BASE_URL;
    vi.resetModules();

    const { fetchMcEasyVehicleStatuses } = await import("@/lib/mceasy-server");
    await expect(fetchMcEasyVehicleStatuses()).rejects.toThrow("MCEASY_API_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
