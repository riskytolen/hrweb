import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { canAccessTmsData } from "@/lib/permissions";
import { authorizeTmsScope } from "@/lib/tms-tenant-auth";
import { normalizePointTemperatureList } from "@/lib/tms-point-temperature";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const TABLE = "tms_route_point_temperatures";

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

function canAccessTms(permissions: string[]): boolean {
  return canAccessTmsData(permissions);
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
  if (
    !profile ||
    profile.status !== "Aktif" ||
    profile.account_type !== "internal" ||
    !role ||
    role.status === "Tidak Aktif" ||
    !canAccessTms(parsePermissions(role.permissions))
  ) {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses ke menu TMS." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const { id } = await params;
  const taskId = id.trim();
  if (!taskId) {
    return NextResponse.json({ error: "ID Fleet Task tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const scope = await authorizeTmsScope({
    userId: user.id,
    accountType: "internal",
    permissions: parsePermissions(role.permissions),
    roleLevel: typeof role?.level === "number" ? role.level : 0,
  });
  if (!scope.ok) return scope.response;

  let tempQuery = supabase
    .from(TABLE)
    .select(
      "task_id,task_number,vehicle_id,license_plate,route_sequence,point_name,temperatures,measured_at,arrival_actual,distance_meters,captured_at",
    )
    .eq("task_id", taskId);
  if (scope.scope.allowedClientIds !== "all") {
    tempQuery = tempQuery.in("client_id", scope.scope.allowedClientIds);
  }
  const { data, error } = await tempQuery.order("route_sequence", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Gagal memuat suhu titik rute." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  const snapshots = normalizePointTemperatureList(data);
  return NextResponse.json(
    { data: snapshots, meta: { total: snapshots.length, fetchedAt: new Date().toISOString() } },
    { headers: NO_STORE_HEADERS },
  );
}
