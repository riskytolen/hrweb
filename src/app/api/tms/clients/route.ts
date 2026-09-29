import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { parsePermissions } from "@/lib/permissions";
import { resolveClientScope } from "@/lib/tms-tenant-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

/**
 * GET /api/tms/clients — daftar client yang terlihat oleh pemanggil.
 * Dipakai client selector dan manajemen membership. Super Admin dan
 * pemegang `tms.clients.all` melihat semua; selain itu hanya membership.
 */
export async function GET() {
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
  if (!profile || profile.status !== "Aktif" || !role || role.status === "Tidak Aktif") {
    return NextResponse.json(
      { error: "Akun tidak aktif." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const accountType = profile.account_type === "external" ? "external" : "internal";
  const permissions = parsePermissions(role.permissions);
  const roleLevel = typeof role?.level === "number" ? role.level : 0;

  const admin = createAdminClient();
  const { data: memberships } = await admin
    .from("tms_client_memberships")
    .select("client_id")
    .eq("user_id", user.id)
    .eq("status", "Aktif");
  const membershipIds = (
    Array.isArray(memberships) ? memberships : []
  ).map((row) => String((row as { client_id: string }).client_id));

  const scope = resolveClientScope({ accountType, permissions, roleLevel, membershipClientIds: membershipIds });

  let query = admin
    .from("tms_clients")
    .select("id, code, slug, name, logo_url, timezone, status")
    .eq("status", "Aktif")
    .order("name", { ascending: true });
  if (scope.allowedClientIds !== "all") {
    if (scope.allowedClientIds.length === 0) {
      return NextResponse.json(
        {
          data: [],
          meta: { total: 0, allAllowed: false, fetchedAt: new Date().toISOString() },
        },
        { headers: NO_STORE_HEADERS },
      );
    }
    query = query.in("id", scope.allowedClientIds);
  }

  const { data: clients, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Gagal memuat daftar client." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      data: (Array.isArray(clients) ? clients : []).map((row) => {
        const record = row as {
          id: string;
          code: string;
          slug: string;
          name: string;
          logo_url: string | null;
          timezone: string;
          status: string;
        };
        return {
          id: record.id,
          code: record.code,
          slug: record.slug,
          name: record.name,
          logoUrl: record.logo_url,
          timezone: record.timezone,
          status: record.status,
        };
      }),
      meta: {
        total: Array.isArray(clients) ? clients.length : 0,
        allAllowed: scope.canAccessAllClients,
        fetchedAt: new Date().toISOString(),
      },
    },
    { headers: NO_STORE_HEADERS },
  );
}
