import { NextResponse, type NextRequest } from "next/server";
import { authorizeTmsScope, fetchScopedVehicleMap } from "@/lib/tms-tenant-auth";
import { createClient } from "@/lib/supabase-server";
import { canAccessTmsData, type AccountType } from "@/lib/permissions";
import { fetchMcEasyVehicleStatuses, McEasyError } from "@/lib/mceasy-server";

// Data live tidak boleh di-cache di edge maupun browser.
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

function canAccessTms(permissions: string[], accountType: AccountType): boolean {
  return canAccessTmsData(permissions, accountType);
}

interface TmsAccessContext {
  userId: string;
  permissions: string[];
  roleLevel: number;
  accountType: AccountType;
}

async function verifyTmsAccess(): Promise<
  | { ok: true; context: TmsAccessContext }
  | { ok: false; status: 401 | 403 }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, status: 401 };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("status, account_type, roles(id, nama, level, permissions, status)")
    .eq("id", user.id)
    .single();

  const roleRelation = profile?.roles;
  const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;

  const accountType: AccountType = profile?.account_type === "external" ? "external" : "internal";
  if (
    !profile ||
    profile.status !== "Aktif" ||
    (profile.account_type !== "internal" && profile.account_type !== "external") ||
    !role ||
    role.status === "Tidak Aktif"
  ) {
    return { ok: false, status: 403 };
  }

  if (!canAccessTms(parsePermissions(role.permissions), accountType)) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    context: {
      userId: user.id,
      permissions: parsePermissions(role.permissions),
      roleLevel: typeof role?.level === "number" ? role.level : 0,
      accountType,
    },
  };
}

function parseBooleanParam(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

export async function GET(request: NextRequest) {
  const access = await verifyTmsAccess();
  if (!access.ok) {
    return NextResponse.json(
      {
        error:
          access.status === 401
            ? "Sesi login telah berakhir. Silakan masuk kembali."
            : "Anda tidak memiliki akses ke menu TMS.",
      },
      { status: access.status, headers: NO_STORE_HEADERS },
    );
  }

  const withAddress = parseBooleanParam(request.nextUrl.searchParams.get("withAddress"), true);
  const filteredParam = request.nextUrl.searchParams.get("withFilteredAddress");
  const withFilteredAddress = filteredParam === null ? undefined : parseBooleanParam(filteredParam, false);

  const scope = await authorizeTmsScope({
    userId: access.context.userId,
    accountType: access.context.accountType,
    permissions: access.context.permissions,
    roleLevel: access.context.roleLevel,
    requestedClientRef: request.nextUrl.searchParams.get("client"),
  });
  if (!scope.ok) return scope.response;

  try {
    const data = await fetchMcEasyVehicleStatuses({ withAddress, withFilteredAddress });
    const vehicleMap = await fetchScopedVehicleMap(scope.scope.allowedClientIds);
    const filtered =
      vehicleMap === "all"
        ? data
        : data.filter((vehicle) => vehicleMap.byMceasyId.has(vehicle.vehicleId));
    return NextResponse.json(
      { data: filtered, meta: { total: filtered.length, fetchedAt: new Date().toISOString(), withAddress } },
      { headers: NO_STORE_HEADERS },
    );
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
