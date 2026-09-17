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
  fetchFleetTaskInstantList: vi.fn(),
  normalizeFleetTaskInstantStatus: (value: unknown) => {
    const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
    return ["DRAFT", "SCHEDULED", "STARTED", "ENDED", "CANCELED"].includes(upper) ? upper : null;
  },
}));

import { createClient } from "@/lib/supabase-server";
import { fetchFleetTaskInstantList } from "@/lib/mceasy-server";
import { GET } from "@/app/api/tms/fleet-task-instant/route";

const createClientMock = vi.mocked(createClient);
const fetchListMock = vi.mocked(fetchFleetTaskInstantList);

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tms/fleet-task-instant", () => {
  it("rejects unauthenticated callers with 401", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);

    const response = await GET(new NextRequest("http://localhost/api/tms/fleet-task-instant"));
    expect(response.status).toBe(401);
    expect(fetchListMock).not.toHaveBeenCalled();
  });

  it("rejects users without tms permission with 403", async () => {
    mockProfile(["dashboard"]);
    const response = await GET(new NextRequest("http://localhost/api/tms/fleet-task-instant"));
    expect(response.status).toBe(403);
    expect(fetchListMock).not.toHaveBeenCalled();
  });

  it("passes query params through and returns items with no-store headers", async () => {
    mockProfile(["tms"]);
    fetchListMock.mockResolvedValue({
      items: [{ id: "uuid-1", number: "FO-9262" }],
      total: 7714,
      page: 1,
      counts: { draft: 16, scheduled: 11, started: 0, ended: 7673, canceled: 14 },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/tms/fleet-task-instant?limit=20&page=1&search=FO-92"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(fetchListMock).toHaveBeenCalledWith({
      limit: 20,
      page: 1,
      search: "FO-92",
      sort: undefined,
      status: undefined,
    });
    const payload = (await response.json()) as {
      data: unknown[];
      meta: { total: number; counts: { ended: number } };
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.meta.total).toBe(7714);
    expect(payload.meta.counts.ended).toBe(7673);
  });

  it("forwards a valid status filter to the list fetcher", async () => {
    mockProfile(["tms"]);
    fetchListMock.mockResolvedValue({
      items: [{ id: "uuid-2", number: "FO-9263" }],
      total: 7673,
      page: 1,
      counts: { draft: 16, scheduled: 11, started: 0, ended: 7673, canceled: 14 },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/tms/fleet-task-instant?limit=10&page=1&status=ended"),
    );
    expect(response.status).toBe(200);
    expect(fetchListMock).toHaveBeenCalledWith({
      limit: 10,
      page: 1,
      search: undefined,
      sort: undefined,
      status: "ENDED",
    });
    const payload = (await response.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.meta.total).toBe(7673);
  });

  it("drops an unknown status filter", async () => {
    mockProfile(["tms"]);
    fetchListMock.mockResolvedValue({ items: [], total: 0, page: 1, counts: null });

    const response = await GET(
      new NextRequest("http://localhost/api/tms/fleet-task-instant?status=ngawur"),
    );
    expect(response.status).toBe(200);
    expect(fetchListMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined }),
    );
  });
});
