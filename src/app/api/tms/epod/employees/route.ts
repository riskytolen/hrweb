import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { listEligibleEmployees } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeEpod(true);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const roleParam = url.searchParams.get("role");
  if (roleParam !== null && roleParam !== "DRIVER" && roleParam !== "HELPER") {
    return epodError("Peran harus DRIVER atau HELPER.", 400);
  }

  try {
    const employees = await listEligibleEmployees(roleParam ?? undefined);
    return epodJson({ data: employees });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat daftar pegawai.";
    return epodError(message, 502);
  }
}
