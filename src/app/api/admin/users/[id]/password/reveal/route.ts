import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonNoStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function verifySuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*, roles(id, nama, level, status)")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.status !== "Aktif" ||
    profile.account_type !== "internal" ||
    !profile.roles ||
    profile.roles.status !== "Aktif" ||
    profile.roles.level < 100
  )
    return null;

  return user;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const caller = await verifySuperAdmin();
    if (!caller) {
      return NextResponse.json(
        { error: "Unauthorized. Super Admin access required." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { id: targetUserId } = await params;

    if (!targetUserId || !UUID_RE.test(targetUserId)) {
      return jsonNoStore({ error: "User ID tidak valid." }, 400);
    }

    const adminClient = createAdminClient();

    const { data: passwordCopy, error: fetchErr } = await adminClient
      .from("account_password_copies")
      .select("password, updated_at")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (fetchErr) {
      console.error("Failed to fetch password copy:", fetchErr);
      return jsonNoStore(
        { error: "Gagal mengambil salinan password dari database." },
        500
      );
    }

    if (!passwordCopy) {
      return jsonNoStore(
        {
          error:
            "Password belum tersimpan. Reset password akun ini dulu agar bisa ditampilkan.",
        },
        404
      );
    }

    // Audit (best-effort, fail silent)
    try {
      const targetProfile = await adminClient
        .from("user_profiles")
        .select("nama")
        .eq("id", targetUserId)
        .maybeSingle();

      await logAudit({
        supabase: adminClient,
        action: "status_change",
        entityType: "user_profiles",
        entityId: targetUserId,
        entityLabel: targetProfile?.data?.nama ?? null,
        oldData: null,
        newData: null,
        metadata: {
          operation: "credential_view",
          called_by: caller.id,
        },
      });
    } catch (auditErr) {
      console.warn("[audit] Failed to log credential reveal:", auditErr);
    }

    return jsonNoStore({
      success: true,
      password: passwordCopy.password,
      passwordChangedAt: passwordCopy.updated_at,
    });
  } catch (err) {
    console.error("POST /api/admin/users/[id]/password/reveal error:", err);
    return jsonNoStore({ error: "Internal server error." }, 500);
  }
}
