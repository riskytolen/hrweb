import { authorizeEpod, epodError, epodJson } from "@/lib/tms-epod-auth";
import { listEpodPetugas } from "@/lib/tms-epod-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeEpod(true);
  if (!auth.ok) return auth.response;

  try {
    const employees = await listEpodPetugas();
    return epodJson({ data: employees });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat daftar pegawai.";
    return epodError(message, 502);
  }
}
