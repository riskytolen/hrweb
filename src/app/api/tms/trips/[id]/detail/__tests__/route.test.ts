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
  fetchMcEasyTripDetail: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { fetchMcEasyTripDetail } from "@/lib/mceasy-server";
import { GET } from "@/app/api/tms/trips/[id]/detail/route";

const createClientMock = vi.mocked(createClient);
const fetchTripDetailMock = vi.mocked(fetchMcEasyTripDetail);

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

function request(id = "11418", query = "?startDate=2026-09-09T00:00:00.000Z&endDate=2026-09-09T12:00:00.000Z") {
  return new NextRequest(`http://localhost/api/tms/trips/${id}/detail${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/trips/[id]/detail", () => {
  it("rejects unauthenticated callers with 401", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);

    const response = await GET(request(), { params: Promise.resolve({ id: "11418" }) });
    expect(response.status).toBe(401);
    expect(fetchTripDetailMock).not.toHaveBeenCalled();
  });

  it("rejects users without tms permission with 403", async () => {
    mockProfile(["dashboard"]);
    const response = await GET(request(), { params: Promise.resolve({ id: "11418" }) });
    expect(response.status).toBe(403);
    expect(fetchTripDetailMock).not.toHaveBeenCalled();
  });

  it("requires startDate and endDate", async () => {
    mockProfile(["tms.view"]);
    const response = await GET(request("11418", ""), { params: Promise.resolve({ id: "11418" }) });
    expect(response.status).toBe(400);
    expect(fetchTripDetailMock).not.toHaveBeenCalled();
  });

  it("returns a normalized trail with no-store headers", async () => {
    mockProfile(["tms.view"]);
    fetchTripDetailMock.mockResolvedValue({
      message: "ok",
      data: [
        { latitude: 0, longitude: 0 },
        { latitude: -6.2, longitude: 106.7, sentOn: "2026-09-09T10:00:00Z" },
        { latitude: -6.3, longitude: 106.8, sentOn: "2026-09-09T10:05:00Z" },
      ],
    });

    const response = await GET(request(), { params: Promise.resolve({ id: "11418" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(fetchTripDetailMock).toHaveBeenCalledWith("11418", {
      startDate: "2026-09-09T00:00:00.000Z",
      endDate: "2026-09-09T12:00:00.000Z",
    });

    const payload = (await response.json()) as {
      data: { trail: { latitude: number; longitude: number }[] };
      meta: { total: number; fetchedAt: string };
    };
    expect(payload.data.trail).toEqual([
      { latitude: -6.2, longitude: 106.7 },
      { latitude: -6.3, longitude: 106.8 },
    ]);
    expect(payload.meta.total).toBe(2);
    expect(typeof payload.meta.fetchedAt).toBe("string");
  });
});
