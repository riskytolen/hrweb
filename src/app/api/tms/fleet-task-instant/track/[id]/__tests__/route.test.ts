import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/mceasy-server", () => ({
  McEasyError: class McEasyError extends Error {
    status: number;
    constructor(message: string, status = 502) {
      super(message);
      this.status = status;
    }
  },
  fetchFleetTaskInstantTrack: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { fetchFleetTaskInstantTrack } from "@/lib/mceasy-server";
import { GET } from "@/app/api/tms/fleet-task-instant/track/[id]/route";

const createClientMock = vi.mocked(createClient);
const fetchTrackMock = vi.mocked(fetchFleetTaskInstantTrack);

function mockProfile(permissions: string[], accountType = "internal") {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              status: "Aktif",
              account_type: accountType,
              roles: { id: 1, nama: "Ops", level: 10, permissions, status: "Aktif" },
            },
            error: null,
          }),
        }),
      }),
    }),
  } as never);
}

function request(id = "abc123") {
  return new NextRequest(`http://localhost/api/tms/fleet-task-instant/track/${id}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/fleet-task-instant/track/[id]", () => {
  it("rejects unauthenticated callers with 401", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);

    const response = await GET(request(), { params: Promise.resolve({ id: "abc123" }) });
    expect(response.status).toBe(401);
    expect(fetchTrackMock).not.toHaveBeenCalled();
  });

  it("rejects users without tms permission with 403", async () => {
    mockProfile(["dashboard"]);
    const response = await GET(request(), { params: Promise.resolve({ id: "abc123" }) });
    expect(response.status).toBe(403);
    expect(fetchTrackMock).not.toHaveBeenCalled();
  });

  it("returns track data with no-store headers", async () => {
    mockProfile(["tms.view"]);
    fetchTrackMock.mockResolvedValue({ id: "abc123", status: "On Trip", points: [] });

    const response = await GET(request(), { params: Promise.resolve({ id: "abc123" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(fetchTrackMock).toHaveBeenCalledWith("abc123");
    const payload = (await response.json()) as {
      data: { id: string };
      meta: { fetchedAt: string };
    };
    expect(payload.data.id).toBe("abc123");
    expect(typeof payload.meta.fetchedAt).toBe("string");
  });
});
