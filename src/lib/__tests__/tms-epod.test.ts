import { describe, expect, it } from "vitest";
import {
  filledEpodItems,
  formatDistance,
  haversineMeters,
  normalizeEpodAssignment,
  normalizeEpodAssignmentList,
  normalizeEpodEvidence,
  normalizeEpodStop,
  normalizeEpodSubmission,
  resolveLoadingStopSequence,
  toEpodItemPayload,
  validateEpodSubmission,
  TMS_EPOD_GEOFENCE_METERS,
  TMS_EPOD_RETENTION_MONTHS,
  type EpodSubmissionInput,
} from "@/lib/tms-epod";
import type { FleetTaskTimelinePoint } from "@/lib/fleet-task-track";

function point(overrides: Partial<FleetTaskTimelinePoint>): FleetTaskTimelinePoint {
  return {
    sequence: null,
    pointType: null,
    pointId: null,
    addressId: null,
    name: null,
    address: null,
    latitude: null,
    longitude: null,
    visitStatusRaw: null,
    visitStatusName: null,
    arrivalTarget: null,
    arrivalActual: null,
    departureTarget: null,
    departureActual: null,
    ...overrides,
  };
}

describe("retensi e-POD", () => {
  it("memakai masa retensi 3 bulan", () => {
    expect(TMS_EPOD_RETENTION_MONTHS).toBe(3);
  });
});

describe("resolveLoadingStopSequence", () => {
  it("memilih titik bertipe START", () => {
    const points = [
      point({ sequence: 1, pointType: "END" }),
      point({ sequence: 2, pointType: "START" }),
    ];
    expect(resolveLoadingStopSequence(points)).toBe(2);
  });

  it("memakai sequence terkecil bila tidak ada START", () => {
    const points = [point({ sequence: 5 }), point({ sequence: 3 })];
    expect(resolveLoadingStopSequence(points)).toBe(5);
  });

  it("memakai posisi array bila sequence kosong", () => {
    const points = [point({ sequence: null }), point({ sequence: null })];
    expect(resolveLoadingStopSequence(points)).toBe(1);
  });

  it("mengembalikan null untuk daftar kosong", () => {
    expect(resolveLoadingStopSequence([])).toBeNull();
  });
});

describe("haversineMeters", () => {
  it("nol untuk koordinat yang sama", () => {
    expect(haversineMeters(-6.2, 106.8, -6.2, 106.8)).toBe(0);
  });

  it("akurat untuk jarak pendek", () => {
    expect(haversineMeters(-6.2, 106.8, -6.199, 106.8)).toBeCloseTo(111.2, 0);
  });
});

function validInput(overrides: Partial<EpodSubmissionInput> = {}): EpodSubmissionInput {
  return {
    stopType: "DELIVERY",
    result: "DELIVERED",
    recipientName: "Budi",
    note: "",
    photoCount: 1,
    latitude: -6.2,
    longitude: 106.8,
    distanceMeters: 10,
    outOfRadiusReason: "",
    items: [{ name: "Kopi Arabika", quantity: "2", unit: "karton" }],
    ...overrides,
  };
}

describe("validateEpodSubmission", () => {
  it("menerima input pengiriman yang lengkap", () => {
    expect(validateEpodSubmission(validInput())).toBeNull();
  });

  it("menolak jumlah foto di luar 1-5", () => {
    expect(validateEpodSubmission(validInput({ photoCount: 0 }))).toContain("Jumlah foto");
    expect(validateEpodSubmission(validInput({ photoCount: 6 }))).toContain("Jumlah foto");
  });

  it("mewajibkan GPS", () => {
    expect(validateEpodSubmission(validInput({ latitude: null }))).toContain("GPS");
    expect(validateEpodSubmission(validInput({ longitude: null }))).toContain("GPS");
  });

  it("menerima titik loading tanpa hasil", () => {
    expect(
      validateEpodSubmission(validInput({ stopType: "LOADING", result: null, recipientName: "" })),
    ).toBeNull();
  });

  it("menolak hasil kosong pada pengiriman", () => {
    expect(validateEpodSubmission(validInput({ result: null }))).toContain("Hasil pengiriman");
  });

  it("mewajibkan penerima untuk terkirim dan parsial", () => {
    expect(validateEpodSubmission(validInput({ recipientName: "" }))).toContain("penerima");
    expect(validateEpodSubmission(validInput({ result: "PARTIAL", recipientName: "", note: "kurang" }))).toContain(
      "penerima",
    );
  });

  it("mewajibkan catatan untuk parsial dan ditolak", () => {
    expect(validateEpodSubmission(validInput({ result: "PARTIAL", note: "" }))).toContain("parsial");
    expect(
      validateEpodSubmission(validInput({ result: "REJECTED", recipientName: "", note: "" })),
    ).toContain("ditolak");
  });

  it("tidak mewajibkan penerima untuk ditolak", () => {
    expect(
      validateEpodSubmission(validInput({ result: "REJECTED", recipientName: "", note: "toko tutup" })),
    ).toBeNull();
  });

  it("mewajibkan alasan bila di luar radius", () => {
    const input = validInput({ distanceMeters: TMS_EPOD_GEOFENCE_METERS + 1 });
    expect(validateEpodSubmission(input)).toContain("Alasan");
    expect(validateEpodSubmission({ ...input, outOfRadiusReason: "jalan buntu" })).toBeNull();
  });

  it("mewajibkan minimal satu barang pada pengantaran", () => {
    expect(validateEpodSubmission(validInput({ items: [] }))).toContain("Minimal satu barang");
  });

  it("menolak barang tanpa nama atau kuantitas tidak valid", () => {
    expect(validateEpodSubmission(validInput({ items: [{ name: "  ", quantity: "2", unit: "" }] }))).toContain(
      "Nama barang",
    );
    expect(validateEpodSubmission(validInput({ items: [{ name: "Kopi", quantity: "0", unit: "" }] }))).toContain(
      "Kuantitas",
    );
    expect(validateEpodSubmission(validInput({ items: [{ name: "Kopi", quantity: "abc", unit: "" }] }))).toContain(
      "Kuantitas",
    );
  });

  it("tidak mewajibkan barang pada titik loading", () => {
    expect(
      validateEpodSubmission(
        validInput({ stopType: "LOADING", result: null, recipientName: "", items: [] }),
      ),
    ).toBeNull();
  });
});

describe("helper barang e-POD", () => {
  it("menyaring baris kosong", () => {
    const filled = filledEpodItems([
      { name: "Kopi", quantity: "2", unit: "" },
      { name: "", quantity: "", unit: "" },
    ]);
    expect(filled).toHaveLength(1);
  });

  it("mengubah input menjadi payload angka", () => {
    expect(
      toEpodItemPayload([
        { name: " Kopi ", quantity: "2.5", unit: " karton " },
        { name: "", quantity: "", unit: "" },
      ]),
    ).toEqual([{ name: "Kopi", quantity: 2.5, unit: "karton" }]);
  });

  it("menormalisasi daftar barang dari payload submission", () => {
    const submission = normalizeEpodSubmission({
      id: "sub1",
      stop_id: "s1",
      items: [
        { name: "Kopi", quantity: 2, unit: "karton" },
        { name: "Gula", quantity: "1.5", unit: null },
        { name: "", quantity: 3 },
        { name: "Tanpa kuantitas" },
      ],
    });
    expect(submission?.items).toEqual([
      { name: "Kopi", quantity: 2, unit: "karton" },
      { name: "Gula", quantity: 1.5, unit: null },
    ]);
  });
});

describe("normalizer baris database", () => {
  it("menormalisasi assignment", () => {
    const assignment = normalizeEpodAssignment({
      id: "a1",
      task_id: "t1",
      task_number: "FO-1",
      status: "IN_PROGRESS",
      loading_status: "LOADING_COMPLETED",
      delivery_done_count: "3",
      delivery_total_count: 6,
      snapshot_at: "2026-09-22T00:00:00Z",
    });
    expect(assignment?.taskId).toBe("t1");
    expect(assignment?.status).toBe("IN_PROGRESS");
    expect(assignment?.loadingStatus).toBe("LOADING_COMPLETED");
    expect(assignment?.deliveryDoneCount).toBe(3);
    expect(assignment?.deliveryTotalCount).toBe(6);
  });

  it("menolak assignment tanpa id atau task_id", () => {
    expect(normalizeEpodAssignment({ id: "a1" })).toBeNull();
    expect(normalizeEpodAssignment(null)).toBeNull();
  });

  it("jatuh ke OPEN untuk status tak dikenal", () => {
    expect(normalizeEpodAssignment({ id: "a1", task_id: "t1", status: "ANEh" })?.status).toBe("OPEN");
  });

  it("menormalisasi stop", () => {
    const stop = normalizeEpodStop({
      id: "s1",
      assignment_id: "a1",
      stop_sequence: 2,
      stop_type: "DELIVERY",
      vendor_point_id: "p1",
      vendor_address_id: "ad1",
    });
    expect(stop?.stopType).toBe("DELIVERY");
    expect(stop?.sequence).toBe(2);
    expect(stop?.vendorPointId).toBe("p1");
    expect(stop?.vendorAddressId).toBe("ad1");
  });

  it("menormalisasi submission termasuk status purged", () => {
    const submission = normalizeEpodSubmission({
      id: "sub1",
      stop_id: "s1",
      version: 2,
      result: "PARTIAL",
      geofence_ok: false,
      is_current: false,
      evidence_purged_at: "2026-12-01T00:00:00Z",
    });
    expect(submission?.result).toBe("PARTIAL");
    expect(submission?.geofenceOk).toBe(false);
    expect(submission?.isCurrent).toBe(false);
    expect(submission?.evidencePurgedAt).toBe("2026-12-01T00:00:00Z");
  });

  it("menormalisasi evidence dan menolak tanpa path", () => {
    expect(
      normalizeEpodEvidence({ id: "e1", submission_id: "sub1", object_path: "a/b.jpg" })?.objectPath,
    ).toBe("a/b.jpg");
    expect(normalizeEpodEvidence({ id: "e1", submission_id: "sub1" })).toBeNull();
  });

  it("menyaring daftar assignment tidak valid", () => {
    expect(normalizeEpodAssignmentList([{ id: "a1", task_id: "t1" }, null, {}])).toHaveLength(1);
    expect(normalizeEpodAssignmentList("bukan array")).toEqual([]);
  });
});

/**
 * Regresi: Route Handler mengembalikan payload yang SUDAH dinormalkan
 * (camelCase). Normalizer yang sama dipakai ulang di client, jadi ia wajib
 * menerima kedua bentuk. Sebelumnya bentuk camelCase menghasilkan array
 * kosong sehingga tabel e-POD tidak menampilkan data.
 */
describe("normalizer menerima payload API (camelCase)", () => {
  it("menormalkan item daftar beserta nama driver dan helper", () => {
    const items = normalizeEpodAssignmentList([
      {
        id: "a1",
        taskId: "t1",
        taskNumber: "FO-1",
        status: "IN_PROGRESS",
        loadingStatus: "LOADING_COMPLETED",
        deliveryDoneCount: 3,
        deliveryTotalCount: 6,
        snapshotAt: "2026-09-22T00:00:00Z",
        driverName: "Andi",
        helperName: "Budi",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].taskId).toBe("t1");
    expect(items[0].status).toBe("IN_PROGRESS");
    expect(items[0].loadingStatus).toBe("LOADING_COMPLETED");
    expect(items[0].deliveryDoneCount).toBe(3);
    expect(items[0].deliveryTotalCount).toBe(6);
    expect(items[0].driverName).toBe("Andi");
    expect(items[0].helperName).toBe("Budi");
  });

  it("menormalkan stop camelCase", () => {
    const stop = normalizeEpodStop({
      id: "s1",
      assignmentId: "a1",
      sequence: 1,
      stopType: "LOADING",
      vendorPointId: "p1",
      pointName: "Gudang",
      latitude: -6.2,
      longitude: 106.8,
    });
    expect(stop?.assignmentId).toBe("a1");
    expect(stop?.sequence).toBe(1);
    expect(stop?.stopType).toBe("LOADING");
    expect(stop?.vendorPointId).toBe("p1");
    expect(stop?.pointName).toBe("Gudang");
  });

  it("menormalkan submission camelCase", () => {
    const submission = normalizeEpodSubmission({
      id: "sub1",
      stopId: "s1",
      version: 2,
      result: "PARTIAL",
      distanceMeters: 123.4,
      geofenceOk: false,
      capturedAtServer: "2026-09-22T01:00:00Z",
      actorType: "DRIVER",
      isCurrent: true,
    });
    expect(submission?.stopId).toBe("s1");
    expect(submission?.result).toBe("PARTIAL");
    expect(submission?.distanceMeters).toBeCloseTo(123.4, 3);
    expect(submission?.geofenceOk).toBe(false);
    expect(submission?.actorType).toBe("DRIVER");
    expect(submission?.capturedAtServer).toBe("2026-09-22T01:00:00Z");
  });

  it("menormalkan evidence camelCase", () => {
    const evidence = normalizeEpodEvidence({
      id: "e1",
      submissionId: "sub1",
      bucketId: "tms-epod-evidence",
      objectPath: "assignments/a1/stops/s1/foto.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      sortOrder: 0,
    });
    expect(evidence?.submissionId).toBe("sub1");
    expect(evidence?.objectPath).toBe("assignments/a1/stops/s1/foto.jpg");
    expect(evidence?.sizeBytes).toBe(1024);
  });
});

describe("formatDistance", () => {
  it("memformat meter dan kilometer", () => {
    expect(formatDistance(250)).toBe("250 m");
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(null)).toBe("–");
  });
});
