import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { authorizeTmsScope, fetchScopedVehicleMap } from "@/lib/tms-tenant-auth";
import { canAccessTmsData, type AccountType } from "@/lib/permissions";
import {
  fetchFleetTaskInstantList,
  McEasyError,
  normalizeFleetTaskInstantStatus,
} from "@/lib/mceasy-server";

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

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const page = Number(url.searchParams.get("page") ?? "1");

  const scope = await authorizeTmsScope({
    userId: user.id,
    accountType,
    permissions,
    roleLevel: typeof role?.level === "number" ? role.level : 0,
  });
  if (!scope.ok) return scope.response;

  try {
    const result = await fetchFleetTaskInstantList({
      limit: Number.isFinite(limit) ? limit : 20,
      page: Number.isFinite(page) ? page : 1,
      search: url.searchParams.get("search") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      status: normalizeFleetTaskInstantStatus(url.searchParams.get("status")) ?? undefined,
    });
    // Data vendor live tidak punya client_id: saring berdasarkan mapping
    // unit aktif dalam scope. Meta upstream mencerminkan pool vendor.
    const vehicleMap = await fetchScopedVehicleMap(scope.scope.allowedClientIds);
    const items =
      vehicleMap === "all"
        ? result.items
        : result.items.filter((item) => {
            const vehicleId = (item as { vehicleId?: unknown }).vehicleId;
            return typeof vehicleId === "number" && vehicleMap.byMceasyId.has(vehicleId);
          });
    return NextResponse.json(
      {
        data: items,
        meta: {
          total: vehicleMap === "all" ? result.total : items.length,
          page: result.page,
          counts: result.counts,
          fetchedAt: new Date().toISOString(),
        },
      },
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
