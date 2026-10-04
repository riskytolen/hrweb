import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/tms-epod-server", () => ({
  syncActiveEpodAssignments: vi.fn(),
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

import { syncActiveEpodAssignments } from "@/lib/tms-epod-server";
import { POST } from "@/app/api/cron/tms-epod-sync/route";

const syncMock = vi.mocked(syncActiveEpodAssignments);

function authedRequest(secret: string | null) {
  return new NextRequest("http://localhost/api/cron/tms-epod-sync", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TMS_EPOD_SYNC_SECRET = "cron-secret-untuk-test";
});

describe("POST /api/cron/tms-epod-sync", () => {
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
  });
});
