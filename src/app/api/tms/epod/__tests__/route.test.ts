import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/tms-epod-data", () => ({
  listAssignments: vi.fn(),
  countAssignmentsByStatus: vi.fn(),
  getStopDetail: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { countAssignmentsByStatus, getStopDetail, listAssignments } from "@/lib/tms-epod-data";
import { GET as listEpod } from "@/app/api/tms/epod/route";
import { POST as createUpload } from "@/app/api/tms/epod/uploads/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);
const listAssignmentsMock = vi.mocked(listAssignments);
const countMock = vi.mocked(countAssignmentsByStatus);
const getStopDetailMock = vi.mocked(getStopDetail);

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

function mockUnauthenticated() {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  countMock.mockResolvedValue({
    open: 1,
    claimed: 0,
    inProgress: 2,
    completed: 3,
    cancelled: 0,
    total: 6,
  });
});

describe("GET /api/tms/epod", () => {
  it("menolak pemanggil tanpa sesi dengan 401", async () => {
    mockUnauthenticated();
    const response = await listEpod(new NextRequest("http://localhost/api/tms/epod"));
    expect(response.status).toBe(401);
    expect(listAssignmentsMock).not.toHaveBeenCalled();
  });

  it("menolak akun eksternal dengan 403", async () => {
    mockProfile(["tms.view"], "external");
    const response = await listEpod(new NextRequest("http://localhost/api/tms/epod"));
    expect(response.status).toBe(403);
    expect(listAssignmentsMock).not.toHaveBeenCalled();
  });

  it("menolak user tanpa permission e-POD dengan 403", async () => {
    mockProfile(["dashboard"]);
    const response = await listEpod(new NextRequest("http://localhost/api/tms/epod"));
    expect(response.status).toBe(403);
  });

  it("mengizinkan tms.view membaca daftar dengan no-store", async () => {
    mockProfile(["tms.view"]);
    listAssignmentsMock.mockResolvedValue({
      items: [
        {
          id: "a1",
          taskId: "t1",
          taskNumber: "FO-1",
          status: "OPEN",
          taskStatusRaw: "STARTED",
          vehicleId: 1,
          licensePlate: "B 1",
          vendorDriverName: null,
          driverEmployeeId: null,
          helperEmployeeId: null,
          loadingStatus: "PENDING_LOADING",
          loadingCompletedAt: null,
          deliveryDoneCount: 0,
          deliveryTotalCount: 3,
          snapshotAt: "2026-09-22T00:00:00Z",
          frozenAt: null,
          lastSyncedAt: null,
          driverName: null,
          helperName: null,
        },
      ],
      total: 1,
    });

    const response = await listEpod(new NextRequest("http://localhost/api/tms/epod?page=1&limit=15"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(listAssignmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 15, status: undefined }),
    );
    const payload = (await response.json()) as { data: unknown[]; meta: { total: number; counts: { completed: number } } };
    expect(payload.data).toHaveLength(1);
    expect(payload.meta.total).toBe(1);
    expect(payload.meta.counts.completed).toBe(3);
  });

  it("mengabaikan status filter yang tidak dikenal", async () => {
    mockProfile(["tms.epod.view"]);
    listAssignmentsMock.mockResolvedValue({ items: [], total: 0 });
    const response = await listEpod(new NextRequest("http://localhost/api/tms/epod?status=ngawur"));
    expect(response.status).toBe(200);
    expect(listAssignmentsMock).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });
});

describe("POST /api/tms/epod/uploads", () => {
  function uploadRequest(body: unknown) {
    return new NextRequest("http://localhost/api/tms/epod/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("menolak user view-only dengan 403", async () => {
    mockProfile(["tms.epod.view"]);
    const response = await createUpload(
      uploadRequest({ stopId: "s1", mimeType: "image/jpeg", sizeBytes: 1000 }),
    );
    expect(response.status).toBe(403);
    expect(createAdminMock).not.toHaveBeenCalled();
  });

  it("menolak format file yang tidak diizinkan", async () => {
    mockProfile(["tms.epod.manage"]);
    const response = await createUpload(
      uploadRequest({ stopId: "s1", mimeType: "application/pdf", sizeBytes: 1000 }),
    );
    expect(response.status).toBe(400);
  });

  it("membuat signed upload url untuk pengelola", async () => {
    mockProfile(["tms.epod.manage"]);
    getStopDetailMock.mockResolvedValue({
      stop: {
        id: "s1",
        assignmentId: "a1",
        sequence: 1,
        stopType: "LOADING",
        vendorPointId: null,
        vendorAddressId: null,
        pointName: null,
        address: null,
        latitude: null,
        longitude: null,
        arrivalActual: null,
        departureActual: null,
        visitStatusRaw: null,
      },
      assignment: { id: "a1", status: "OPEN" },
      submissions: [],
    } as never);

    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { path: "assignments/a1/stops/s1/foto.jpg", token: "tok" },
      error: null,
    });
    createAdminMock.mockReturnValue({
      storage: { from: () => ({ createSignedUploadUrl }) },
    } as never);

    const response = await createUpload(
      uploadRequest({ stopId: "s1", mimeType: "image/jpeg", sizeBytes: 1000, filename: "foto.jpg" }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { bucket: string; path: string; token: string } };
    expect(payload.data.bucket).toBe("tms-epod-evidence");
    expect(payload.data.token).toBe("tok");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^assignments\/a1\/stops\/s1\/.+\.jpg$/),
      { upsert: false },
    );
  });
});
