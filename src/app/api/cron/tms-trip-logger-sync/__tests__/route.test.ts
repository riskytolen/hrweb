import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/tms-trip-logger-server", () => ({
  syncTripVisitLogs: vi.fn(),
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

import { syncTripVisitLogs } from "@/lib/tms-trip-logger-server";
import { POST } from "@/app/api/cron/tms-trip-logger-sync/route";

const syncMock = vi.mocked(syncTripVisitLogs);

function authedRequest(secret: string | null, body?: unknown) {
  return new NextRequest("http://localhost/api/cron/tms-trip-logger-sync", {
    method: "POST",
    headers: {
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      "Content-Type": "application/json",
    },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TMS_TRIP_LOGGER_SYNC_SECRET = "cron-secret-untuk-test";
});

describe("POST /api/cron/tms-trip-logger-sync", () => {
  it("rejects requests without the sync secret", async () => {
    const response = await POST(authedRequest("salah"));
    expect(response.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("runs the sync for authorized cron calls", async () => {
    syncMock.mockResolvedValue({ failures: [] } as never);

    const response = await POST(authedRequest("cron-secret-untuk-test"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledWith({ mode: "incremental", days: 7, maxPages: undefined });
  });
});
