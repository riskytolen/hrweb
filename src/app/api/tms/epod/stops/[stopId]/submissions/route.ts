import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getStopDetail } from "@/lib/tms-epod-data";
import {
  haversineMeters,
  validateEpodSubmission,
  type EpodDeliveryResult,
} from "@/lib/tms-epod";

export const dynamic = "force-dynamic";

interface EvidenceInput {
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  originalFilename: string | null;
  sortOrder: number;
}

function parseEvidence(value: unknown): EvidenceInput[] {
  if (!Array.isArray(value)) return [];
  const result: EvidenceInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const path = typeof source.path === "string" ? source.path.trim() : "";
    if (!path) continue;
    const sizeBytes = Number(source.sizeBytes);
    result.push({
      path,
      mimeType: typeof source.mimeType === "string" ? source.mimeType : null,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
      originalFilename: typeof source.originalFilename === "string" ? source.originalFilename.slice(0, 200) : null,
      sortOrder: Number.isFinite(Number(source.sortOrder)) ? Math.trunc(Number(source.sortOrder)) : result.length,
    });
  }
  return result;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stopId: string }> },
) {
  const auth = await authorizeEpod(true);
  if (!auth.ok) return auth.response;

  const { stopId } = await params;
  if (!stopId) return epodError("ID titik tidak valid.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return epodError("Body permintaan tidak valid.", 400);
  }

  const source = (body ?? {}) as Record<string, unknown>;
  const resultRaw = source.result;
  const result: EpodDeliveryResult | null =
    resultRaw === "DELIVERED" || resultRaw === "PARTIAL" || resultRaw === "REJECTED" ? resultRaw : null;
  const recipientName = typeof source.recipientName === "string" ? source.recipientName : "";
  const note = typeof source.note === "string" ? source.note : "";
  const outOfRadiusReason = typeof source.outOfRadiusReason === "string" ? source.outOfRadiusReason : "";
  const latitude = typeof source.latitude === "number" ? source.latitude : null;
  const longitude = typeof source.longitude === "number" ? source.longitude : null;
  const accuracyRaw = Number(source.accuracyMeters);
  const accuracyMeters = Number.isFinite(accuracyRaw) && accuracyRaw > 0 ? accuracyRaw : null;
  const capturedAtDevice =
    typeof source.capturedAtDevice === "string" && !Number.isNaN(Date.parse(source.capturedAtDevice))
      ? new Date(source.capturedAtDevice).toISOString()
      : null;
  const evidence = parseEvidence(source.evidence);

  try {
    const detail = await getStopDetail(stopId);
    if (!detail) return epodError("Titik e-POD tidak ditemukan.", 404);
    if (detail.assignment.status === "CANCELLED") {
      return epodError("Assignment e-POD sudah dibatalkan.", 400);
    }

    const distanceMeters =
      latitude !== null &&
      longitude !== null &&
      detail.stop.latitude !== null &&
      detail.stop.longitude !== null
        ? haversineMeters(latitude, longitude, detail.stop.latitude, detail.stop.longitude)
        : null;

    const validationError = validateEpodSubmission({
      stopType: detail.stop.stopType,
      result,
      recipientName,
      note,
      photoCount: evidence.length,
      latitude,
      longitude,
      distanceMeters,
      outOfRadiusReason,
    });
    if (validationError) return epodError(validationError, 400);

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("tms_epod_submit", {
      p_stop_id: stopId,
      p_result: result,
      p_recipient_name: recipientName,
      p_note: note,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_meters: accuracyMeters,
      p_captured_at_device: capturedAtDevice,
      p_out_of_radius_reason: outOfRadiusReason,
      p_evidence: evidence.map((item) => ({
        path: item.path,
        mime_type: item.mimeType,
        size_bytes: item.sizeBytes,
        original_filename: item.originalFilename,
        sort_order: item.sortOrder,
      })),
      p_actor_user: auth.context.userId,
      p_actor_employee_id: null,
      p_actor_type: "WEB_ADMIN",
      p_source: "WEB",
    });

    if (error) {
      if (error.message.includes("Unauthorized")) {
        return epodError("Anda tidak memiliki akses untuk mengirim bukti e-POD.", 403);
      }
      if (error.message.includes("tidak ditemukan")) {
        return epodError(error.message, 404);
      }
      return epodError(error.message, 400);
    }

    const updated = await getStopDetail(stopId);
    return epodJson({ data: { submission: data, stop: updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mengirim bukti e-POD.";
    return epodError(message, 502);
  }
}
