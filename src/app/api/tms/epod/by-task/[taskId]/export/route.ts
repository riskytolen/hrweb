import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getAssignmentByTask, getAssignmentExportData } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

/**
 * Data laporan PDF e-POD untuk satu FO.
 *
 * Hanya tersedia setelah seluruh e-POD selesai (assignment COMPLETED),
 * karena saat itulah bukti loading dan semua titik pengantaran lengkap.
 */
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
    if (!summary) {
      return epodError("Data e-POD belum tersedia untuk FO ini.", 404);
    }
    if (summary.assignment.status !== "COMPLETED") {
      return epodError("Laporan PDF hanya tersedia setelah seluruh e-POD selesai.", 409);
    }

    const data = await getAssignmentExportData(summary.assignment.id);
    if (!data) {
      return epodError("Data e-POD belum tersedia untuk FO ini.", 404);
    }
    return epodJson({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyiapkan data laporan e-POD.";
    return epodError(message, 502);
  }
}
