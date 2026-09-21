import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getAssignmentByTask } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const auth = await authorizeEpod(false);
  if (!auth.ok) return auth.response;

  const { taskId } = await params;
  if (!taskId) return epodError("ID task tidak valid.", 400);

  try {
    const summary = await getAssignmentByTask(taskId);
    return epodJson({ data: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat ringkasan e-POD.";
    return epodError(message, 502);
  }
}
