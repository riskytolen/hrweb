import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { getAssignmentDetail } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

function mapRpcError(message: string): { status: number; message: string } {
  if (message.includes("Unauthorized")) {
    return { status: 403, message: "Anda tidak memiliki akses untuk mengubah tim e-POD." };
  }
  if (message.includes("tidak ditemukan")) {
    return { status: 404, message };
  }
  return { status: 400, message };
}

export async function PATCH(
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

  const source = (body ?? {}) as Record<string, unknown>;
  const role = source.role === "DRIVER" || source.role === "HELPER" ? source.role : null;
  if (!role) return epodError("Peran harus DRIVER atau HELPER.", 400);

  const employeeId =
    source.employeeId === null || source.employeeId === undefined
      ? null
      : typeof source.employeeId === "string"
        ? source.employeeId.trim() || null
        : undefined;
  if (employeeId === undefined) return epodError("ID pegawai tidak valid.", 400);

  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("tms_epod_set_roster", {
      p_assignment_id: assignmentId,
      p_role: role,
      p_employee_id: employeeId,
      p_actor_user: auth.context.userId,
    });
    if (error) {
      const mapped = mapRpcError(error.message);
      return epodError(mapped.message, mapped.status);
    }

    const detail = await getAssignmentDetail(assignmentId);
    return epodJson({ data: detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyimpan tim e-POD.";
    return epodError(message, 502);
  }
}
