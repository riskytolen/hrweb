import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "./supabase-server";
import {
  canManageTmsEpod,
  canViewTmsEpod,
  parsePermissions,
  type AccountType,
} from "./permissions";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export interface EpodAuthContext {
  userId: string;
  permissions: string[];
  canManage: boolean;
}

export type EpodAuthResult =
  | { ok: true; context: EpodAuthContext }
  | { ok: false; response: NextResponse };

export function epodJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export function epodError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

/**
 * Verifikasi sesi + permission e-POD untuk Route Handler.
 *
 * Route Handler adalah satu-satunya batas keamanan: RouteGuard hanya UI.
 * `requireManage` membedakan endpoint baca dan endpoint tulis.
 */
export async function authorizeEpod(requireManage: boolean): Promise<EpodAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: epodError("Sesi login telah berakhir. Silakan masuk kembali.", 401) };
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
  const allowed = active && (requireManage ? canManageTmsEpod(permissions, accountType) : canViewTmsEpod(permissions, accountType));

  if (!allowed) {
    return {
      ok: false,
      response: epodError(
        requireManage
          ? "Anda tidak memiliki akses untuk mengelola e-POD."
          : "Anda tidak memiliki akses ke Monitoring e-POD.",
        403,
      ),
    };
  }

  return {
    ok: true,
    context: {
      userId: user.id,
      permissions,
      canManage: canManageTmsEpod(permissions, accountType),
    },
  };
}
