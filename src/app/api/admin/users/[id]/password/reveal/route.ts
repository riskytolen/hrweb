import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { decryptPassword } from "@/lib/account-password-crypto";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        { status: 403 }
      );
    }

    const { id: targetUserId } = await params;

    if (!targetUserId || !UUID_RE.test(targetUserId)) {
      return NextResponse.json(
        { error: "User ID tidak valid." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Get encrypted credential
    const { data: secretRow, error: fetchErr } = await adminClient
      .from("account_password_secrets")
      .select("password_encrypted, password_iv, password_tag, key_version")
      .eq("user_id", targetUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr || !secretRow) {
      return NextResponse.json(
        { error: "Credential tidak ditemukan. Password mungkin belum pernah disimpan melalui aplikasi ini." },
        { status: 404 }
      );
    }

    // Decrypt
    const plaintext = decryptPassword(
      Buffer.from(secretRow.password_encrypted, "hex"),
      Buffer.from(secretRow.password_iv, "hex"),
      Buffer.from(secretRow.password_tag, "hex"),
      secretRow.key_version,
      targetUserId // AAD: user_id
    );

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

    return NextResponse.json({
      success: true,
      password: plaintext,
      keyVersion: secretRow.key_version,
    });
  } catch (err) {
    console.error("POST /api/admin/users/[id]/password/reveal error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
