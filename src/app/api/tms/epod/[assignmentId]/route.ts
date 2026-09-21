import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getAssignmentDetail } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const auth = await authorizeEpod(false);
  if (!auth.ok) return auth.response;

  const { assignmentId } = await params;
  if (!assignmentId) return epodError("ID assignment tidak valid.", 400);

  try {
    const detail = await getAssignmentDetail(assignmentId);
    if (!detail) return epodError("Assignment e-POD tidak ditemukan.", 404);
    return epodJson({ data: detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat detail e-POD.";
    return epodError(message, 502);
  }
}
