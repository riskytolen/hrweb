import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { canAccessTmsData, type AccountType } from "@/lib/permissions";
import { fetchMcEasyVehicleStatus, McEasyError } from "@/lib/mceasy-server";
import {
  authorizeTmsScope,
  fetchScopedVehicleMap,
  isVehicleInScopedMap,
} from "@/lib/tms-tenant-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function parsePermissions(permissions: unknown): string[] {
  if (Array.isArray(permissions)) return permissions.filter((p): p is string => typeof p === "string");
  if (typeof permissions === "string") {
    try {
      const parsed: unknown = JSON.parse(permissions);
      if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
    } catch {
      return [];
    }
  }
  return [];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sesi login telah berakhir. Silakan masuk kembali." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
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
  const allowed =
    profile?.status === "Aktif" &&
    (profile.account_type === "internal" || profile.account_type === "external") &&
    role?.status !== "Tidak Aktif" &&
    canAccessTmsData(permissions, accountType);

  if (!allowed) {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses ke menu TMS." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const { id } = await params;
  const scope = await authorizeTmsScope({
    userId: user.id,
    accountType,
    permissions,
    roleLevel: typeof role?.level === "number" ? role.level : 0,
  });
  if (!scope.ok) return scope.response;
  // ID milik client lain tidak boleh diambil langsung.
  if (scope.scope.allowedClientIds !== "all") {
    const vehicleMap = await fetchScopedVehicleMap(scope.scope.allowedClientIds);
    const numericId = Number(id);
    if (!isVehicleInScopedMap(vehicleMap, Number.isFinite(numericId) ? numericId : null, id)) {
      return NextResponse.json(
        { error: "Data kendaraan tidak ditemukan pada layanan tracking." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
  }
  try {
    const data = await fetchMcEasyVehicleStatus(id);
    if (!data) {
      return NextResponse.json(
        { error: "Data kendaraan tidak ditemukan pada layanan tracking." },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json({ data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof McEasyError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      { error: "Koneksi ke layanan tracking sedang bermasalah. Coba lagi." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
