import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

async function verifySuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*, roles(id, nama, level)")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.roles || profile.roles.level < 100) return null;

  return user;
}

export async function GET() {
  try {
    const caller = await verifySuperAdmin();
    if (!caller) {
      return NextResponse.json(
        { error: "Unauthorized. Super Admin access required." },
        { status: 403 }
      );
    }

    const adminClient = createAdminClient();

    const { data, error } = await adminClient.rpc("get_storage_usage_stats");

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch storage stats", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
