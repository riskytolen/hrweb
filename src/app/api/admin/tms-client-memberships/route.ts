import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

/**
 * Manajemen membership client TMS — khusus Super Admin.
 * GET ?userId=... -> daftar client_id aktif milik user.
 * PATCH { userId, clientIds } -> ganti membership (replace set).
 */
async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json(
      { error: "Sesi login telah berakhir. Silakan masuk kembali." },
      { status: 401, headers: NO_STORE_HEADERS },
    ) };
  }
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("status, account_type, roles(id, nama, level, permissions, status)")
    .eq("id", user.id)
    .single();
  const roleRelation = profile?.roles;
  const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;
  const permissions = Array.isArray(role?.permissions) ? role.permissions : [];
  const isSuperAdmin =
    profile?.status === "Aktif" &&
    profile?.account_type === "internal" &&
    role?.status !== "Tidak Aktif" &&
    (Number(role?.level ?? 0) >= 100 || permissions.includes("all"));
  if (!isSuperAdmin) {
    return { ok: false as const, response: NextResponse.json(
      { error: "Hanya Super Admin yang dapat mengelola membership client." },
      { status: 403, headers: NO_STORE_HEADERS },
    ) };
  }
  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const userId = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Parameter userId wajib diisi." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tms_client_memberships")
    .select("client_id")
    .eq("user_id", userId)
    .eq("status", "Aktif");
  if (error) {
    return NextResponse.json({ error: "Gagal memuat membership client." }, { status: 502, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json(
    {
      data: (Array.isArray(data) ? data : []).map((row) => String((row as { client_id: string }).client_id)),
      meta: { fetchedAt: new Date().toISOString() },
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body permintaan tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const { userId, clientIds } = (body ?? {}) as { userId?: unknown; clientIds?: unknown };
  if (typeof userId !== "string" || !userId) {
    return NextResponse.json({ error: "userId wajib diisi." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!Array.isArray(clientIds) || !clientIds.every((v): v is string => typeof v === "string")) {
    return NextResponse.json({ error: "clientIds harus array string." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const admin = createAdminClient();
  // Validasi client aktif.
  const uniqueIds = [...new Set(clientIds)];
  if (uniqueIds.length > 0) {
    const { data: clients, error: clientError } = await admin
      .from("tms_clients")
      .select("id")
      .eq("status", "Aktif")
      .in("id", uniqueIds);
    if (clientError) {
      return NextResponse.json({ error: "Gagal memvalidasi client." }, { status: 502, headers: NO_STORE_HEADERS });
    }
    const valid = new Set((Array.isArray(clients) ? clients : []).map((row) => String((row as { id: string }).id)));
    const invalid = uniqueIds.filter((id) => !valid.has(id));
    if (invalid.length > 0) {
      return NextResponse.json({ error: "Terdapat client yang tidak valid/tidak aktif." }, { status: 400, headers: NO_STORE_HEADERS });
    }
  }

  const { error: deleteError } = await admin.from("tms_client_memberships").delete().eq("user_id", userId);
  if (deleteError) {
    return NextResponse.json({ error: "Gagal memperbarui membership client." }, { status: 502, headers: NO_STORE_HEADERS });
  }
  if (uniqueIds.length > 0) {
    const { error: insertError } = await admin.from("tms_client_memberships").insert(
      uniqueIds.map((client_id) => ({ client_id, user_id: userId, status: "Aktif" })),
    );
    if (insertError) {
      return NextResponse.json({ error: "Gagal menyimpan membership client." }, { status: 502, headers: NO_STORE_HEADERS });
    }
  }
  return NextResponse.json(
    { data: { userId, clientIds: uniqueIds }, meta: { fetchedAt: new Date().toISOString() } },
    { headers: NO_STORE_HEADERS },
  );
}
