import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getAssignmentDetail } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

/**
 * Kembalikan assignment e-POD yang sudah dibatalkan.
 *
 * Status dipulihkan server-side (`tms_epod_revert_cancellation`) berdasarkan
 * data roster/submission/loading, bukan dari input klien.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await authorizeEpod(true);
  if (!auth.ok) return auth.response;

  const { assignmentId } = await params;
  if (!assignmentId) return epodError("ID assignment tidak valid.", 400);

  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("tms_epod_revert_cancellation", {
      p_assignment_id: assignmentId,
      p_actor_user: auth.context.userId,
    });
    if (error) {
      if (error.message.includes("Unauthorized")) {
        return epodError("Anda tidak memiliki akses untuk mengembalikan e-POD.", 403);
      }
      if (error.message.includes("tidak ditemukan")) {
        return epodError(error.message, 404);
      }
      return epodError(error.message, 400);
    }

    const detail = await getAssignmentDetail(assignmentId);
    return epodJson({ data: detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mengembalikan assignment e-POD.";
    return epodError(message, 502);
  }
}
