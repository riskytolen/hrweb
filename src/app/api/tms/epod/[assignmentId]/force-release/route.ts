import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getAssignmentDetail } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

const STORAGE_DELETE_BATCH = 100;

/**
 * Reset e-POD & lepas petugas walau evidence sudah dikirim.
 *
 * Urutan: baca path evidence → RPC (hapus metadata DB + reset assignment) →
 * hapus file Storage. Bila Storage gagal, route tetap sukses dengan warning
 * agar admin tahu masih ada file yang perlu dicek.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await authorizeEpod(true);
  if (!auth.ok) return auth.response;

  const { assignmentId } = await params;
  if (!assignmentId) return epodError("ID assignment tidak valid.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return epodError("Body permintaan tidak valid.", 400);
  }

  const reason =
    typeof (body as Record<string, unknown>)?.reason === "string"
      ? ((body as Record<string, unknown>).reason as string).trim()
      : "";
  if (!reason) return epodError("Alasan reset e-POD wajib diisi.", 400);

  try {
    const admin = createAdminClient();

    const { data: stopRows, error: stopError } = await admin
      .from("tms_epod_stops")
      .select("id")
      .eq("assignment_id", assignmentId);
    if (stopError) return epodError(stopError.message, 502);

    const stopIds = (stopRows ?? []).map((row) => String((row as { id: string }).id));
    let paths: { bucket_id: string; object_path: string }[] = [];

    if (stopIds.length > 0) {
      const { data: submissionRows, error: submissionError } = await admin
        .from("tms_epod_submissions")
        .select("id")
        .in("stop_id", stopIds);
      if (submissionError) return epodError(submissionError.message, 502);

      const submissionIds = (submissionRows ?? []).map((row) =>
        String((row as { id: string }).id),
      );
      if (submissionIds.length > 0) {
        const { data, error } = await admin
          .from("tms_epod_evidence")
          .select("bucket_id,object_path")
          .in("submission_id", submissionIds);
        if (error) return epodError(error.message, 502);
        paths = (data ?? []) as { bucket_id: string; object_path: string }[];
      }
    }

    const { error } = await admin.rpc("tms_epod_force_release", {
      p_assignment_id: assignmentId,
      p_reason: reason,
      p_actor_user: auth.context.userId,
    });
    if (error) {
      if (error.message.includes("Unauthorized")) {
        return epodError("Anda tidak memiliki akses untuk mereset e-POD.", 403);
      }
      if (error.message.includes("tidak ditemukan")) {
        return epodError(error.message, 404);
      }
      return epodError(error.message, 400);
    }

    const storageFailures: string[] = [];
    const byBucket = new Map<string, string[]>();
    for (const row of paths) {
      const list = byBucket.get(row.bucket_id) ?? [];
      list.push(row.object_path);
      byBucket.set(row.bucket_id, list);
    }
    for (const [bucket, objects] of byBucket) {
      for (let index = 0; index < objects.length; index += STORAGE_DELETE_BATCH) {
        const batch = objects.slice(index, index + STORAGE_DELETE_BATCH);
        const { error: removeError } = await admin.storage.from(bucket).remove(batch);
        if (removeError) storageFailures.push(removeError.message);
      }
    }

    const detail = await getAssignmentDetail(assignmentId);
    if (storageFailures.length > 0) {
      return epodJson({
        data: detail,
        warning: `Reset selesai, tetapi sebagian file bukti gagal dihapus: ${storageFailures.join("; ")}`,
      });
    }
    return epodJson({ data: detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mereset assignment e-POD.";
    return epodError(message, 502);
  }
}
