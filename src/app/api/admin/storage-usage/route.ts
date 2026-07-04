import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

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
      .select("*, roles(id, nama, level)")
      .eq("id", user.id)
      .single();

    if (!profile || !profile.roles || profile.roles.level < 100) {
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
