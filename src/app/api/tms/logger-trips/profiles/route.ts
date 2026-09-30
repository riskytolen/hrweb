import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  canViewTmsLoggerTrips,
  parsePermissions,
  type AccountType,
} from "@/lib/permissions";
import { compareSlaProfileCode } from "@/lib/tms-sla";
import { authorizeTmsScope } from "@/lib/tms-tenant-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function errorJson(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

/**
 * Daftar profil rute SLA untuk pemilih Logger Trips (chip VAN).
 *
 * Berbeda dari `/api/tms/sla-profiles` yang khusus menu Pengaturan SLA
 * internal: endpoint ini memakai permission Logger Trips sehingga akun
 * client (external) dengan `tms.logger-trips.view` tetap bisa memilih rute.
 * Hanya profil Aktif dalam scope client user yang dikembalikan.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return errorJson("Sesi login telah berakhir. Silakan masuk kembali.", 401);
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("status, account_type, roles(id, nama, level, permissions, status)")
    .eq("id", user.id)
    .single();

  const roleRelation = profile?.roles;
  const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;
  const accountType: AccountType = profile?.account_type === "external" ? "external" : "internal";
  const permissions = parsePermissions(role?.permissions);

  if (
    !profile ||
    profile.status !== "Aktif" ||
    (profile.account_type !== "internal" && profile.account_type !== "external") ||
    !role ||
    role.status === "Tidak Aktif" ||
    !canViewTmsLoggerTrips(permissions, accountType)
  ) {
    return errorJson("Anda tidak memiliki akses ke Logger Trips.", 403);
  }

  const params = request.nextUrl.searchParams;
  const scope = await authorizeTmsScope({
    userId: user.id,
    accountType,
    permissions,
    roleLevel: typeof role?.level === "number" ? role.level : 0,
    requestedClientRef: params.get("client"),
  });
  if (!scope.ok) return scope.response;
  const scopeIds = scope.scope.allowedClientIds;

  // Tabel SLA di-REVOKE dari authenticated; baca via admin setelah scope lolos.
  const admin = createAdminClient();
  let query = admin
    .from("tms_sla_route_profiles")
    .select("id, code, group_id")
    .eq("status", "Aktif");
  if (scopeIds !== "all") query = query.in("client_id", scopeIds);
  const { data: profileRows, error: profilesError } = await query;
  if (profilesError) {
    return errorJson("Gagal memuat profil SLA.", 502);
  }
  const profiles = (Array.isArray(profileRows) ? profileRows : []) as unknown as {
    id: string;
    code: string;
    group_id: string;
  }[];

  const groupNames = new Map<string, string>();
  const groupIds = [...new Set(profiles.map((p) => p.group_id).filter(Boolean))];
  if (groupIds.length > 0) {
    const { data: groupRows } = await admin
      .from("tms_live_track_groups")
      .select("id, name")
      .in("id", groupIds);
    for (const row of (Array.isArray(groupRows) ? groupRows : []) as unknown as {
      id: string;
      name: string;
    }[]) {
      if (row?.id) groupNames.set(row.id, row.name);
    }
  }

  const ordered = profiles
    .filter((p) => p?.id && groupNames.has(p.group_id))
    .sort((a, b) => compareSlaProfileCode(a.code, b.code));

  return NextResponse.json(
    {
      data: ordered.map((p) => ({
        id: p.id,
        code: p.code,
        groupName: groupNames.get(p.group_id) ?? null,
      })),
    },
    { headers: NO_STORE_HEADERS },
  );
}
