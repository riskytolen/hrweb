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
  getAssignmentByTask: vi.fn(),
  getAssignmentExportData: vi.fn(),
  getAssignmentDetail: vi.fn(),
}));

import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  countAssignmentsByStatus,
  getAssignmentByTask,
  getAssignmentDetail,
  getAssignmentExportData,
  getStopDetail,
  listAssignments,
} from "@/lib/tms-epod-data";
import { GET as listEpod } from "@/app/api/tms/epod/route";
import { POST as createUpload } from "@/app/api/tms/epod/uploads/route";
import { POST as submitStop } from "@/app/api/tms/epod/stops/[stopId]/submissions/route";
import { GET as exportEpod } from "@/app/api/tms/epod/by-task/[taskId]/export/route";
import { POST as revertAssignment } from "@/app/api/tms/epod/[assignmentId]/revert/route";
import { PATCH as patchRoster } from "@/app/api/tms/epod/[assignmentId]/roster/route";

const createClientMock = vi.mocked(createClient);
const createAdminMock = vi.mocked(createAdminClient);
const listAssignmentsMock = vi.mocked(listAssignments);
const countMock = vi.mocked(countAssignmentsByStatus);
const getStopDetailMock = vi.mocked(getStopDetail);
const getAssignmentDetailMock = vi.mocked(getAssignmentDetail);
const getAssignmentByTaskMock = vi.mocked(getAssignmentByTask);
const getAssignmentExportDataMock = vi.mocked(getAssignmentExportData);

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
          assignedEmployeeId: null,
          assignedRole: null,
          assignedSource: null,
          assignedReason: null,
          assignedAt: null,
          assignedJabatanId: null,
          loadingStatus: "PENDING_LOADING",
          loadingCompletedAt: null,
          deliveryDoneCount: 0,
          deliveryTotalCount: 3,
          snapshotAt: "2026-09-22T00:00:00Z",
          frozenAt: null,
          lastSyncedAt: null,
          assignedName: null,
          assignedRoleLabel: null,
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

describe("POST /api/tms/epod/stops/[stopId]/submissions", () => {
  const deliveryStop = {
    stop: {
      id: "s1",
      assignmentId: "a1",
      sequence: 2,
      stopType: "DELIVERY",
      vendorPointId: null,
      vendorAddressId: null,
      pointName: "Toko A",
      address: null,
      latitude: -6.2,
      longitude: 106.8,
      arrivalActual: null,
      departureActual: null,
      visitStatusRaw: null,
    },
    assignment: { id: "a1", status: "IN_PROGRESS" },
    submissions: [],
  };

  function submitRequest(body: unknown) {
    return new NextRequest("http://localhost/api/tms/epod/stops/s1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const context = { params: Promise.resolve({ stopId: "s1" }) };

  it("menolak pengantaran tanpa barang", async () => {
    mockProfile(["tms.epod.manage"]);
    getStopDetailMock.mockResolvedValue(deliveryStop as never);

    const response = await submitStop(
      submitRequest({
        result: "DELIVERED",
        recipientName: "Budi",
        latitude: -6.2,
        longitude: 106.8,
        evidence: [{ path: "a/b.jpg" }],
        items: [],
      }),
      context,
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("Minimal satu barang");
  });

  it("meneruskan daftar barang ke RPC sebagai p_items", async () => {
    mockProfile(["tms.epod.manage"]);
    getStopDetailMock.mockResolvedValue(deliveryStop as never);
    const rpc = vi.fn().mockResolvedValue({ data: { id: "sub1" }, error: null });
    createAdminMock.mockReturnValue({ rpc } as never);

    const response = await submitStop(
      submitRequest({
        result: "DELIVERED",
        recipientName: "Budi",
        latitude: -6.2,
        longitude: 106.8,
        evidence: [{ path: "a/b.jpg" }],
        items: [
          { name: "Kopi", quantity: "2", unit: "karton" },
          { name: "Gula", quantity: "1.5", unit: "" },
        ],
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "tms_epod_submit",
      expect.objectContaining({
        p_items: [
          { name: "Kopi", quantity: 2, unit: "karton" },
          { name: "Gula", quantity: 1.5, unit: null },
        ],
      }),
    );
  });
});

describe("POST /api/tms/epod/[assignmentId]/revert", () => {
  const context = { params: Promise.resolve({ assignmentId: "a1" }) };

  function revertRequest() {
    return new NextRequest("http://localhost/api/tms/epod/a1/revert", { method: "POST" });
  }

  it("menolak user view-only dengan 403", async () => {
    mockProfile(["tms.epod.view"]);
    const response = await revertAssignment(revertRequest(), context);
    expect(response.status).toBe(403);
    expect(createAdminMock).not.toHaveBeenCalled();
  });

  it("mengembalikan 404 bila assignment tidak ditemukan", async () => {
    mockProfile(["tms.epod.manage"]);
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Assignment e-POD tidak ditemukan." },
    });
    createAdminMock.mockReturnValue({ rpc } as never);

    const response = await revertAssignment(revertRequest(), context);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("tidak ditemukan");
  });

  it("memulihkan assignment dan mengembalikan detail", async () => {
    mockProfile(["tms.epod.manage"]);
    const rpc = vi.fn().mockResolvedValue({ data: { id: "a1", status: "CLAIMED" }, error: null });
    createAdminMock.mockReturnValue({ rpc } as never);
    getAssignmentDetailMock.mockResolvedValue({
      assignment: { id: "a1", status: "CLAIMED" },
    } as never);

    const response = await revertAssignment(revertRequest(), context);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("tms_epod_revert_cancellation", {
      p_assignment_id: "a1",
      p_actor_user: "user-1",
    });
    const payload = (await response.json()) as {
      data: { assignment: { status: string } };
    };
    expect(payload.data.assignment.status).toBe("CLAIMED");
  });
});

describe("PATCH /api/tms/epod/[assignmentId]/roster", () => {
  const context = { params: Promise.resolve({ assignmentId: "a1" }) };

  function rosterRequest(body: unknown) {
    return new NextRequest("http://localhost/api/tms/epod/a1/roster", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("menolak user view-only dengan 403", async () => {
    mockProfile(["tms.epod.view"]);
    const response = await patchRoster(rosterRequest({ employeeId: "e1" }), context);
    expect(response.status).toBe(403);
    expect(createAdminMock).not.toHaveBeenCalled();
  });

  it("menetapkan petugas lewat RPC set_petugas", async () => {
    mockProfile(["tms.epod.manage"]);
    const rpc = vi.fn().mockResolvedValue({ data: { id: "a1", status: "CLAIMED" }, error: null });
    createAdminMock.mockReturnValue({ rpc } as never);
    getAssignmentDetailMock.mockResolvedValue({ assignment: { id: "a1", status: "CLAIMED" } } as never);

    const response = await patchRoster(rosterRequest({ employeeId: "e1" }), context);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("tms_epod_set_petugas", {
      p_assignment_id: "a1",
      p_employee_id: "e1",
      p_reason: null,
      p_actor_user: "user-1",
    });
    const payload = (await response.json()) as { data: { assignment: { status: string } } };
    expect(payload.data.assignment.status).toBe("CLAIMED");
  });

  it("meneruskan alasan penugasan ke RPC set_petugas", async () => {
    mockProfile(["tms.epod.manage"]);
    const rpc = vi.fn().mockResolvedValue({ data: { id: "a1", status: "CLAIMED" }, error: null });
    createAdminMock.mockReturnValue({ rpc } as never);
    getAssignmentDetailMock.mockResolvedValue({ assignment: { id: "a1", status: "CLAIMED" } } as never);

    const response = await patchRoster(
      rosterRequest({ employeeId: "e1", reason: "Koordinator turun lapangan" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("tms_epod_set_petugas", {
      p_assignment_id: "a1",
      p_employee_id: "e1",
      p_reason: "Koordinator turun lapangan",
      p_actor_user: "user-1",
    });
  });

  it("mengosongkan petugas saat employeeId null", async () => {
    mockProfile(["tms.epod.manage"]);
    const rpc = vi.fn().mockResolvedValue({ data: { id: "a1", status: "OPEN" }, error: null });
    createAdminMock.mockReturnValue({ rpc } as never);
    getAssignmentDetailMock.mockResolvedValue({ assignment: { id: "a1", status: "OPEN" } } as never);

    const response = await patchRoster(rosterRequest({ employeeId: null }), context);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "tms_epod_set_petugas",
      expect.objectContaining({ p_employee_id: null }),
    );
  });

  it("mengembalikan 404 bila assignment tidak ditemukan", async () => {
    mockProfile(["tms.epod.manage"]);
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Assignment e-POD tidak ditemukan." },
    });
    createAdminMock.mockReturnValue({ rpc } as never);

    const response = await patchRoster(rosterRequest({ employeeId: "e1" }), context);
    expect(response.status).toBe(404);
  });
});

describe("GET /api/tms/epod/by-task/[taskId]/export", () => {
  const context = { params: Promise.resolve({ taskId: "t1" }) };

  it("menolak akun tanpa akses e-POD", async () => {
    mockProfile(["dashboard"]);
    const response = await exportEpod(new NextRequest("http://localhost/api/tms/epod/by-task/t1/export"), context);
    expect(response.status).toBe(403);
    expect(getAssignmentByTaskMock).not.toHaveBeenCalled();
  });

  it("mengembalikan 404 bila FO tidak punya e-POD", async () => {
    mockProfile(["tms.epod.view"]);
    getAssignmentByTaskMock.mockResolvedValue(null);
    const response = await exportEpod(new NextRequest("http://localhost/api/tms/epod/by-task/t1/export"), context);
    expect(response.status).toBe(404);
  });

  it("mengembalikan 409 bila e-POD belum selesai", async () => {
    mockProfile(["tms.epod.view"]);
    getAssignmentByTaskMock.mockResolvedValue({
      assignment: { id: "a1", status: "IN_PROGRESS" },
      stops: [],
      currentByStop: {},
    } as never);
    const response = await exportEpod(new NextRequest("http://localhost/api/tms/epod/by-task/t1/export"), context);
    expect(response.status).toBe(409);
    expect(getAssignmentExportDataMock).not.toHaveBeenCalled();
  });

  it("mengembalikan data ekspor tanpa cache saat e-POD selesai", async () => {
    mockProfile(["tms.epod.view"]);
    getAssignmentByTaskMock.mockResolvedValue({
      assignment: { id: "a1", status: "COMPLETED" },
      stops: [],
      currentByStop: {},
    } as never);
    getAssignmentExportDataMock.mockResolvedValue({
      assignment: { id: "a1", status: "COMPLETED" },
      assignedName: "Andi",
      assignedRoleLabel: "Driver",
      stops: [],
      currentByStop: {},
      evidenceBySubmission: {},
      pointTemperatures: [
        {
          taskId: "t1",
          routeSequence: 2,
          pointName: "Toko A",
          temperatures: [18.9],
          measuredAt: "2026-09-22T03:15:00Z",
          arrivalActual: null,
          distanceMeters: 12.4,
          capturedAt: "2026-09-22T03:15:01Z",
        },
      ],
    } as never);

    const response = await exportEpod(new NextRequest("http://localhost/api/tms/epod/by-task/t1/export"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getAssignmentExportDataMock).toHaveBeenCalledWith("a1");
    const payload = (await response.json()) as {
      data: { assignedName: string | null; pointTemperatures: unknown[] };
    };
    expect(payload.data.assignedName).toBe("Andi");
    expect(payload.data.pointTemperatures).toHaveLength(1);
  });
});