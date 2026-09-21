import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getStopDetail } from "@/lib/tms-epod-data";
import { normalizeEpodEvidence, type EpodEvidence } from "@/lib/tms-epod";

export const dynamic = "force-dynamic";

/** Masa berlaku signed URL foto bukti. */
const SIGNED_URL_TTL_SECONDS = 300;

interface EvidenceWithUrl extends EpodEvidence {
  signedUrl: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ stopId: string }> },
) {
  const auth = await authorizeEpod(false);
  if (!auth.ok) return auth.response;

  const { stopId } = await params;
  if (!stopId) return epodError("ID titik tidak valid.", 400);

  try {
    const detail = await getStopDetail(stopId);
    if (!detail) return epodError("Titik e-POD tidak ditemukan.", 404);

    const admin = createAdminClient();
    const submissionIds = detail.submissions.map((submission) => submission.id);
    const evidenceBySubmission: Record<string, EvidenceWithUrl[]> = {};

    if (submissionIds.length > 0) {
      const { data: evidenceRows, error } = await admin
        .from("tms_epod_evidence")
        .select("*")
        .in("submission_id", submissionIds)
        .order("sort_order", { ascending: true });
      if (error) return epodError(error.message, 502);

      const rows = (evidenceRows ?? [])
        .map(normalizeEpodEvidence)
        .filter((item): item is EpodEvidence => item !== null);

      for (const row of rows) {
        const { data: signed } = await admin.storage
          .from(row.bucketId)
          .createSignedUrl(row.objectPath, SIGNED_URL_TTL_SECONDS);
        const withUrl: EvidenceWithUrl = { ...row, signedUrl: signed?.signedUrl ?? null };
        const list = evidenceBySubmission[row.submissionId] ?? [];
        list.push(withUrl);
        evidenceBySubmission[row.submissionId] = list;
      }
    }

    return epodJson({
      data: {
        ...detail,
        evidenceBySubmission,
        signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat bukti e-POD.";
    return epodError(message, 502);
  }
}
