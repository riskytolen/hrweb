import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "./supabase-server";
import {
  canManageLiveTrackConfig,
  canViewLiveTrackConfig,
  parsePermissions,
  type AccountType,
} from "./permissions";
import { authorizeTmsScope, type ClientScope } from "./tms-tenant-auth";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export interface LiveTrackConfigAuthContext {
  userId: string;
  permissions: string[];
  canManage: boolean;
  accountType: AccountType;
  allowedClientIds: ClientScope;
}

export type LiveTrackConfigAuthResult =
  | { ok: true; context: LiveTrackConfigAuthContext }
  | { ok: false; response: NextResponse };

export function liveTrackConfigJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export function liveTrackConfigError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

/**
 * Verifikasi sesi + permission Pengaturan Live Track untuk Route Handler.
 *
 * Route Handler adalah satu-satunya batas keamanan: RouteGuard hanya UI.
 * `requireManage` membedakan endpoint baca dan endpoint tulis. Kelola butuh
 * permission manage eksplisit; `tms` biasa tidak cukup.
 */
export async function authorizeLiveTrackConfig(
  requireManage: boolean,
): Promise<LiveTrackConfigAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: liveTrackConfigError("Sesi login telah berakhir. Silakan masuk kembali.", 401),
    };
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("status, account_type, roles(id, nama, level, permissions, status)")
    .eq("id", user.id)
    .single();

  const roleRelation = profile?.roles;
  const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;
  const permissions = parsePermissions(role?.permissions);
  const accountType: AccountType = profile?.account_type === "external" ? "external" : "internal";

  const active = profile?.status === "Aktif" && role?.status !== "Tidak Aktif";
  const allowed =
    active &&
    (requireManage
      ? canManageLiveTrackConfig(permissions, accountType)
      : canViewLiveTrackConfig(permissions, accountType));

  if (!allowed) {
    return {
      ok: false,
      response: liveTrackConfigError(
        requireManage
          ? "Anda tidak memiliki akses untuk mengelola Pengaturan Live Track."
          : "Anda tidak memiliki akses ke Pengaturan Live Track.",
        403,
      ),
    };
  }

  const scope = await authorizeTmsScope({
    userId: user.id,
    accountType,
    permissions,
    roleLevel: typeof role?.level === "number" ? role.level : 0,
  });
  if (!scope.ok) return scope;

  return {
    ok: true,
    context: {
      userId: user.id,
      permissions,
      canManage: canManageLiveTrackConfig(permissions, accountType),
      accountType,
      allowedClientIds: scope.scope.allowedClientIds,
    },
  };
}
