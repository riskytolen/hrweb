import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getAssignmentDetail } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

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

  const reason = typeof (body as Record<string, unknown>)?.reason === "string"
    ? ((body as Record<string, unknown>).reason as string).trim()
    : "";
  if (!reason) return epodError("Alasan pembatalan wajib diisi.", 400);

  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("tms_epod_cancel_assignment", {
      p_assignment_id: assignmentId,
      p_reason: reason,
      p_actor_user: auth.context.userId,
    });
    if (error) {
      if (error.message.includes("Unauthorized")) {
        return epodError("Anda tidak memiliki akses untuk membatalkan e-POD.", 403);
      }
      if (error.message.includes("tidak ditemukan")) {
        return epodError(error.message, 404);
      }
      return epodError(error.message, 400);
    }

    const detail = await getAssignmentDetail(assignmentId);
    return epodJson({ data: detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal membatalkan assignment e-POD.";
    return epodError(message, 502);
  }
}
