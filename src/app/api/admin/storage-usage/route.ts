import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

function hasAllPermission(permissions: unknown): boolean {
  if (Array.isArray(permissions)) return permissions.includes("all");
  if (typeof permissions === "string") {
    try {
      const parsed = JSON.parse(permissions) as unknown;
      return Array.isArray(parsed) && parsed.includes("all");
    } catch {
      return false;
    }
  }
  return false;
}

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Tidak terautentikasi." },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("status, account_type, roles(id, nama, level, permissions, status)")
      .eq("id", user.id)
      .single();

    const roleRelation = profile?.roles;
    const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;
    const isSuperAdmin =
      profile?.status === "Aktif" &&
      profile.account_type === "internal" &&
      role?.status !== "Tidak Aktif" &&
      ((role?.level ?? 0) >= 100 || hasAllPermission(role?.permissions));

    if (!isSuperAdmin) {
      return NextResponse.json(
        { error: "Unauthorized. Super Admin access required." },
        { status: 403 }
      );
    }

    const { data, error } = await supabase.rpc("get_storage_usage_stats");

    if (error) {
      return NextResponse.json(
        { error: "Gagal mengambil data penyimpanan", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
