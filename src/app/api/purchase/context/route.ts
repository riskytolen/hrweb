import { NextResponse } from "next/server";
import { getPurchaseActor, NO_STORE_HEADERS } from "../_auth";

export const dynamic = "force-dynamic";

// ─── GET /api/purchase/context — identitas & hak akses pemanggil ───
export async function GET() {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  return NextResponse.json(
    {
      canRequest: actor.canRequest,
      canManage: actor.canManage,
      isSuperAdmin: actor.isSuperAdmin,
      hasAccess: actor.canRequest || actor.canManage,
      employeeId: actor.employeeId,
      employeeName: actor.employeeName,
      jabatanId: actor.jabatanId,
      jabatanNama: actor.jabatanNama,
    },
    { headers: NO_STORE_HEADERS },
  );
}
