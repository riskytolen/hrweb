import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/tms-point-temperature-server", () => ({
  captureActiveRoutePointTemperatures: vi.fn(),
}));

vi.mock("@/lib/mceasy-server", () => ({
  McEasyError: class McEasyError extends Error {
    status: number;
    constructor(message: string, status = 502) {
      super(message);
      this.status = status;
    }
  },
}));

import { captureActiveRoutePointTemperatures } from "@/lib/tms-point-temperature-server";
import { POST } from "@/app/api/cron/tms-point-temperatures/route";

const captureMock = vi.mocked(captureActiveRoutePointTemperatures);

function authedRequest(secret: string | null) {
  return new NextRequest("http://localhost/api/cron/tms-point-temperatures", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TMS_POINT_CAPTURE_SECRET = "cron-secret-untuk-test";
});

describe("POST /api/cron/tms-point-temperatures", () => {
  it("rejects requests without the capture secret", async () => {
    const response = await POST(authedRequest("salah"));
    expect(response.status).toBe(401);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("captures active point temperatures for authorized cron calls", async () => {
    captureMock.mockResolvedValue({
      requestedAt: "2026-09-18T00:00:00.000Z",
      activeTasksFound: 1,
      activeTasksProcessed: 1,
      truncatedActiveTasks: false,
      vehiclesChecked: 1,
      snapshotsUpserted: 1,
      pointsSkipped: 0,
      failures: [],
    });

    const response = await POST(authedRequest("cron-secret-untuk-test"));
    const payload = (await response.json()) as {
      data: { snapshotsUpserted: number; failures: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload.data.snapshotsUpserted).toBe(1);
    expect(payload.data.failures).toEqual([]);
  });
});
