import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_EVIDENCE_MAX_BYTES,
  ATTENDANCE_EVIDENCE_MAX_SOURCE_BYTES,
  attendanceEvidenceExtension,
  buildAttendanceEvidencePath,
  createAttendanceEvidenceUniqueId,
  isAttendanceEvidenceMime,
  requiresManualAttendanceEvidence,
  validateAttendanceEvidenceSourceFile,
  validateCompressedAttendanceEvidence,
} from "@/app/(dashboard)/employees/attendance/lib/attendance-evidence-spec";

describe("attendance evidence spec", () => {
  it("hanya menerima JPG/PNG/WebP", () => {
    expect(isAttendanceEvidenceMime("image/jpeg")).toBe(true);
    expect(isAttendanceEvidenceMime("image/png")).toBe(true);
    expect(isAttendanceEvidenceMime("image/webp")).toBe(true);
    expect(isAttendanceEvidenceMime("application/pdf")).toBe(false);
    expect(attendanceEvidenceExtension("image/jpeg")).toBe("jpg");
    expect(attendanceEvidenceExtension("image/png")).toBe("png");
    expect(attendanceEvidenceExtension("image/webp")).toBe("webp");
    expect(attendanceEvidenceExtension("image/gif")).toBeNull();
  });

  it("menolak file sumber yang tidak didukung, kosong, atau >10 MB", () => {
    expect(validateAttendanceEvidenceSourceFile({ name: "a.pdf", type: "application/pdf", size: 1000 })).toMatchObject({ ok: false });
    expect(validateAttendanceEvidenceSourceFile({ name: "a.jpg", type: "image/jpeg", size: 0 })).toMatchObject({ ok: false });
    expect(validateAttendanceEvidenceSourceFile({
      name: "besar.jpg",
      type: "image/jpeg",
      size: ATTENDANCE_EVIDENCE_MAX_SOURCE_BYTES + 1,
    })).toMatchObject({ ok: false });
    expect(validateAttendanceEvidenceSourceFile({ name: "ok.jpg", type: "image/jpeg", size: 1000 })).toEqual({ ok: true });
  });

  it("menolak hasil kompresi yang masih >2 MB", () => {
    expect(validateCompressedAttendanceEvidence({
      name: "a.jpg",
      type: "image/jpeg",
      size: ATTENDANCE_EVIDENCE_MAX_BYTES + 1,
    })).toMatchObject({ ok: false });
    expect(validateCompressedAttendanceEvidence({
      name: "a.jpg",
      type: "image/jpeg",
      size: ATTENDANCE_EVIDENCE_MAX_BYTES,
    })).toEqual({ ok: true });
  });

  it("mewajibkan eviden hanya untuk input manual baru non-Alpha", () => {
    expect(requiresManualAttendanceEvidence({ isEditing: false, isSpecial: false })).toBe(true);
    expect(requiresManualAttendanceEvidence({ isEditing: true, isSpecial: false })).toBe(false);
    expect(requiresManualAttendanceEvidence({ isEditing: false, isSpecial: true })).toBe(false);
  });

  it("membuat path aman dan unik", () => {
    const path = buildAttendanceEvidencePath({
      tanggal: "2026-10-26",
      employeeId: "ID/123 ?",
      mimeType: "image/png",
      uniqueId: "abc/def ?",
    });
    expect(path).toBe("2026-10-26/ID_123_/abc_def_.png");
    expect(path).not.toContain("..");
    expect(() => buildAttendanceEvidencePath({
      tanggal: "2026-10-26",
      employeeId: "ID123",
      mimeType: "application/pdf",
      uniqueId: "x",
    })).toThrow();
    expect(createAttendanceEvidenceUniqueId(1700000000000, 0.5)).toBe("1700000000000-89oqgw");
  });
});
