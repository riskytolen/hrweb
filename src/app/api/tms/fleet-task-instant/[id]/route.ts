import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { fetchFleetTaskInstantDetail, McEasyError } from "@/lib/mceasy-server";

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
  const allowed =
    profile?.status === "Aktif" &&
    profile.account_type === "internal" &&
    role?.status !== "Tidak Aktif" &&
    (permissions.includes("all") ||
      permissions.includes("tms") ||
      permissions.includes("tms.view") ||
      permissions.includes("tms.input"));

  if (!allowed) {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses ke menu TMS." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const { id } = await params;
  try {
    // Next sudah men-decode param route; teruskan apa adanya agar UUID
    // tidak rusak oleh decode ganda.
    const data = await fetchFleetTaskInstantDetail(id);
    if (data === null || data === undefined) {
      return NextResponse.json(
        { error: "Data Fleet Task tidak ditemukan pada layanan tracking." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { data, meta: { fetchedAt: new Date().toISOString() } },
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
