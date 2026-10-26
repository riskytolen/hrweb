/**
 * Aturan murni eviden foto absensi manual.
 *
 * File asli dibatasi 10 MB agar kompresi browser tidak kehabisan memori.
 * Hasil kompresi wajib <= 2 MB dan hanya JPG/PNG/WebP, sesuai bucket privat
 * `attendance-evidence`.
 */

export const ATTENDANCE_EVIDENCE_BUCKET = "attendance-evidence";
export const ATTENDANCE_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;
export const ATTENDANCE_EVIDENCE_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const ATTENDANCE_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AttendanceEvidenceMime = (typeof ATTENDANCE_EVIDENCE_MIME_TYPES)[number];

export function isAttendanceEvidenceMime(value: string): value is AttendanceEvidenceMime {
  return (ATTENDANCE_EVIDENCE_MIME_TYPES as readonly string[]).includes(value);
}

export function attendanceEvidenceExtension(mimeType: string): "jpg" | "png" | "webp" | null {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return null;
}

export type EvidenceFileLike = {
  name: string;
  type: string;
  size: number;
};

export type EvidenceFileValidation =
  | { ok: true }
  | { ok: false; message: string };

/** Validasi file SUMBER sebelum dikompres. */
export function validateAttendanceEvidenceSourceFile(file: EvidenceFileLike): EvidenceFileValidation {
  if (!isAttendanceEvidenceMime(file.type)) {
    return {
      ok: false,
      message: "Foto eviden harus berformat JPG, PNG, atau WebP.",
    };
  }
  if (file.size <= 0) {
    return { ok: false, message: "File foto eviden kosong atau tidak valid." };
  }
  if (file.size > ATTENDANCE_EVIDENCE_MAX_SOURCE_BYTES) {
    return {
      ok: false,
      message: "Ukuran foto asli maksimal 10 MB.",
    };
  }
  return { ok: true };
}

/** Validasi file HASIL kompresi sebelum diunggah. */
export function validateCompressedAttendanceEvidence(file: EvidenceFileLike): EvidenceFileValidation {
  if (!isAttendanceEvidenceMime(file.type)) {
    return {
      ok: false,
      message: "Foto eviden harus berformat JPG, PNG, atau WebP.",
    };
  }
  if (file.size <= 0) {
    return { ok: false, message: "File foto eviden kosong atau tidak valid." };
  }
  if (file.size > ATTENDANCE_EVIDENCE_MAX_BYTES) {
    return {
      ok: false,
      message: "Foto eviden melebihi 2 MB setelah kompresi.",
    };
  }
  return { ok: true };
}

/** Input manual baru Hadir/Terlambat wajib foto; edit data lama tidak. */
export function requiresManualAttendanceEvidence(args: {
  isEditing: boolean;
  isSpecial: boolean;
}): boolean {
  return !args.isEditing && !args.isSpecial;
}

/** Path unik dan aman di bucket privat. */
export function buildAttendanceEvidencePath(args: {
  tanggal: string;
  employeeId: string;
  mimeType: string;
  uniqueId: string;
}): string {
  const extension = attendanceEvidenceExtension(args.mimeType);
  if (!extension) {
    throw new Error("Format foto eviden tidak didukung.");
  }
  const safeEmployeeId = args.employeeId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64) || "pegawai";
  const safeUniqueId = args.uniqueId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80) || "eviden";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(args.tanggal) ? args.tanggal : "tanggal";
  return `${safeDate}/${safeEmployeeId}/${safeUniqueId}.${extension}`;
}

/** ID unik path: timestamp + random, tanpa ketergantungan crypto API. */
export function createAttendanceEvidenceUniqueId(now = Date.now(), random = Math.random()): string {
  const suffix = Math.floor(random * 1_000_000_000).toString(36);
  return `${now}-${suffix}`;
}
