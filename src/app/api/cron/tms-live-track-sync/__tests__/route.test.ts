import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/tms-live-track-sync-server", () => ({
  syncLiveTrack: vi.fn(),
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

import { syncLiveTrack } from "@/lib/tms-live-track-sync-server";
import { POST } from "@/app/api/cron/tms-live-track-sync/route";

const syncMock = vi.mocked(syncLiveTrack);

function authedRequest(secret: string | null) {
  return new NextRequest("http://localhost/api/cron/tms-live-track-sync", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TMS_LIVE_TRACK_SYNC_SECRET = "cron-secret-untuk-test";
});

describe("POST /api/cron/tms-live-track-sync", () => {
  it("rejects requests without the sync secret", async () => {
    const response = await POST(authedRequest("salah"));
    expect(response.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("runs the sync for authorized cron calls", async () => {
    syncMock.mockResolvedValue({
      requestedAt: "2026-10-04T00:00:00.000Z",
      vehiclesSeen: 2,
      vehiclesCataloged: 2,
      groupsActive: 0,
      relationsActive: 0,
      tasksChecked: 0,
      snapshotsUpserted: 0,
      occurrencesUpserted: 0,
      tasksFrozen: 0,
      reconciledTasks: 0,
      truncated: false,
      failures: [],
    });

    const response = await POST(authedRequest("cron-secret-untuk-test"));
    const payload = (await response.json()) as {
      data: { vehiclesCataloged: number; failures: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(payload.data.vehiclesCataloged).toBe(2);
    expect(payload.data.failures).toEqual([]);
  });
});
