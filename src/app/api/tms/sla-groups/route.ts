import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeSlaConfig, slaConfigError, slaConfigJson } from "@/lib/tms-sla-auth";

export const dynamic = "force-dynamic";

/**
 * Daftar kelompok kendaraan dalam scope client user beserta pemiliknya.
 * Dipakai filter + form profil pada Pengaturan SLA.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeSlaConfig(false);
  if (!auth.ok) return auth.response;

  const clientRef = request.nextUrl.searchParams.get("client")?.trim() ?? "";
  const scopeIds = auth.context.allowedClientIds;
  const admin = createAdminClient();

  let clientId: string | null = null;
  if (clientRef) {
    const { data: clientRow } = await admin
      .from("tms_clients")
      .select("id")
      .or(`code.ilike.${clientRef},slug.ilike.${clientRef}`)
      .maybeSingle();
    const client = clientRow as { id?: string } | null;
    if (!client?.id) return slaConfigJson({ data: [] });
    if (scopeIds !== "all" && !scopeIds.includes(client.id)) {
      return slaConfigError("Client di luar cakupan akses Anda.", 403);
    }
    clientId = client.id;
  }

  let query = admin
    .from("tms_live_track_groups")
    .select("id, name, status, client_id")
    .eq("status", "Aktif")
    .order("name", { ascending: true });
  if (scopeIds !== "all") query = query.in("client_id", scopeIds);
  if (clientId) query = query.eq("client_id", clientId);

  const { data: groups, error: groupsError } = await query;
  if (groupsError) return slaConfigError("Gagal memuat kelompok.", 502);
  const list = (Array.isArray(groups) ? groups : []) as unknown as {
    id: string;
    name: string;
    status: string;
    client_id: string | null;
  }[];

  const clientIds = [...new Set(list.map((g) => g.client_id).filter((id): id is string => !!id))];
  const clientNames = new Map<string, { code: string; name: string }>();
  if (clientIds.length > 0) {
    const { data: clientRows } = await admin.from("tms_clients").select("id, code, name").in("id", clientIds);
    for (const row of (Array.isArray(clientRows) ? clientRows : []) as unknown as {
      id: string;
      code: string;
      name: string;
    }[]) {
      if (row?.id) clientNames.set(row.id, { code: row.code, name: row.name });
    }
  }

  return slaConfigJson({
    data: list
      .filter((g) => g.client_id && clientNames.has(g.client_id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        clientId: g.client_id,
        clientCode: clientNames.get(g.client_id as string)?.code ?? null,
        clientName: clientNames.get(g.client_id as string)?.name ?? null,
      })),
    meta: { canManage: auth.context.canManage },
  });
}
