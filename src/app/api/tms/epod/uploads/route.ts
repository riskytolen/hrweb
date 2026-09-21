import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getStopDetail } from "@/lib/tms-epod-data";
import {
  TMS_EPOD_ALLOWED_MIME,
  TMS_EPOD_BUCKET,
  TMS_EPOD_MAX_PHOTO_BYTES,
} from "@/lib/tms-epod";

export const dynamic = "force-dynamic";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  const auth = await authorizeEpod(true);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return epodError("Body permintaan tidak valid.", 400);
  }

  const source = (body ?? {}) as Record<string, unknown>;
  const stopId = typeof source.stopId === "string" ? source.stopId.trim() : "";
  const mimeType = typeof source.mimeType === "string" ? source.mimeType.trim().toLowerCase() : "";
  const sizeBytes = typeof source.sizeBytes === "number" ? source.sizeBytes : Number(source.sizeBytes);
  const filename = typeof source.filename === "string" ? source.filename.slice(0, 200) : null;

  if (!stopId) return epodError("ID titik tidak valid.", 400);
  if (!TMS_EPOD_ALLOWED_MIME.includes(mimeType as (typeof TMS_EPOD_ALLOWED_MIME)[number])) {
    return epodError("Format foto harus JPEG, PNG, atau WebP.", 400);
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > TMS_EPOD_MAX_PHOTO_BYTES) {
    return epodError("Ukuran foto melebihi 5 MB.", 400);
  }

  try {
    const detail = await getStopDetail(stopId);
    if (!detail) return epodError("Titik e-POD tidak ditemukan.", 404);
    if (detail.assignment.status === "CANCELLED") {
      return epodError("Assignment e-POD sudah dibatalkan.", 400);
    }

    const extension = EXTENSION_BY_MIME[mimeType] ?? "jpg";
    const objectPath = `assignments/${detail.assignment.id}/stops/${stopId}/${crypto.randomUUID()}.${extension}`;

    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from(TMS_EPOD_BUCKET)
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (error || !data) {
      return epodError(error?.message ?? "Gagal membuat izin unggah.", 502);
    }

    return epodJson({
      data: {
        bucket: TMS_EPOD_BUCKET,
        path: data.path,
        token: data.token,
        mimeType,
        sizeBytes,
        filename,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal membuat izin unggah.";
    return epodError(message, 502);
  }
}
