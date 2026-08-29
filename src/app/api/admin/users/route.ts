import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";

// ─── Helper: verify caller is Super Admin ───
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
  ) return null;

  return user;
}

// ═══════════════════════════════════════════════════════
// POST /api/admin/users — Create new user
// ═══════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const caller = await verifySuperAdmin();
    if (!caller) {
      return NextResponse.json(
        { error: "Unauthorized. Super Admin access required." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, password, nama, role_id, employee_id, status, account_type } = body;

    if (!email || !password || !nama || !role_id) {
      return NextResponse.json(
        { error: "Email, password, nama, dan role_id wajib diisi." },
        { status: 400 }
      );
    }

    if (password.length < 10) {
      return NextResponse.json(
        { error: "Password minimal 10 karakter." },
        { status: 400 }
      );
    }

    const accountType = account_type === "external" ? "external" : "internal";
    if (status && status !== "Aktif" && status !== "Tidak Aktif") {
      return NextResponse.json(
        { error: "Status akun tidak valid." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // 1. Create user via Admin API (tidak mengganti session caller)
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // langsung confirmed
        user_metadata: { nama },
      });

    if (authError) {
      // Handle duplicate email
      if (authError.message.includes("already been registered")) {
        return NextResponse.json(
          { error: "Email sudah terdaftar." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    // 2. Update profile yang auto-created oleh trigger
    if (authData.user) {
      const { error: profileError } = await adminClient
        .from("user_profiles")
        .update({
          nama,
          role_id,
          employee_id: accountType === "external" ? null : employee_id || null,
          status: status || "Aktif",
          account_type: accountType,
        })
        .eq("id", authData.user.id);

      if (profileError) {
        console.error("Failed to update profile:", profileError);
        await adminClient.auth.admin.deleteUser(authData.user.id);
        return NextResponse.json(
          { error: "Gagal mengatur profil akun baru. Akun dibatalkan." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      user: { id: authData.user?.id, email },
    });
  } catch (err) {
    console.error("POST /api/admin/users error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════════════════════
// DELETE /api/admin/users — Delete user (auth + profile)
// ═══════════════════════════════════════════════════════
export async function DELETE(request: NextRequest) {
  try {
    const caller = await verifySuperAdmin();
    if (!caller) {
      return NextResponse.json(
        { error: "Unauthorized. Super Admin access required." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("id");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID wajib diisi." },
        { status: 400 }
      );
    }

    // Prevent self-delete
    if (userId === caller.id) {
      return NextResponse.json(
        { error: "Tidak bisa menghapus akun sendiri." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Delete from auth.users (cascade will delete user_profiles too)
    const { error } = await adminClient.auth.admin.deleteUser(userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/admin/users error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

// ═══════════════════════════════════════════════════════
// PATCH /api/admin/users — Update user password
// ═══════════════════════════════════════════════════════
export async function PATCH(request: NextRequest) {
  try {
    const caller = await verifySuperAdmin();
    if (!caller) {
      return NextResponse.json(
        { error: "Unauthorized. Super Admin access required." },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body tidak valid." },
        { status: 400 }
      );
    }

    const { userId, password } = body as Record<string, unknown>;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "User ID wajib diisi." },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Password wajib diisi." },
        { status: 400 }
      );
    }

    if (password.length < 10) {
      return NextResponse.json(
        { error: "Password minimal 10 karakter." },
        { status: 400 }
      );
    }

    // UUID format check
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(userId)) {
      return NextResponse.json(
        { error: "Format User ID tidak valid." },
        { status: 400 }
      );
    }

    // Prevent self-reset (would invalidate own session)
    if (userId === caller.id) {
      return NextResponse.json(
        { error: "Tidak bisa mereset password akun sendiri." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();
    const serviceClient = createAdminClient();

    // 1. Update password in Supabase Auth
    const { error: authError } =
      await adminClient.auth.admin.updateUserById(userId, {
        password,
      });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    // 2. Record password change timestamp via RPC
    let passwordChangedAt: string | null = null;
    let rpcFailed = false;
    try {
      const { data: ts, error: rpcErr } = await serviceClient.rpc(
        "mark_password_changed",
        { target_user_id: userId }
      );
      if (rpcErr) {
        console.error("RPC mark_password_changed failed:", rpcErr);
        rpcFailed = true;
      } else {
        passwordChangedAt = ts as string;
      }
    } catch (rpcEx) {
      console.error("RPC mark_password_changed exception:", rpcEx);
      rpcFailed = true;
    }

    // 3. Audit log (best-effort, never blocks response)
    try {
      const targetProfile = await serviceClient
        .from("user_profiles")
        .select("nama")
        .eq("id", userId)
        .maybeSingle();

      await logAudit({
        supabase: serviceClient,
        action: "status_change",
        entityType: "user_profiles",
        entityId: userId,
        entityLabel: targetProfile?.data?.nama ?? null,
        oldData: { password_changed_at: null },
        newData: { password_changed_at: passwordChangedAt },
        metadata: {
          operation: "password_reset",
          called_by: caller.id,
          rpc_failed: rpcFailed,
        },
      });
    } catch (auditErr) {
      console.warn("[audit] Failed to log password reset:", auditErr);
    }

    if (rpcFailed) {
      return NextResponse.json(
        {
          success: true,
          userId,
          passwordChangedAt: null,
          warning:
            "Password berhasil diubah, tetapi pencatatan waktu terjadi kesalahan. Silakan refresh halaman.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      userId,
      passwordChangedAt,
    });
  } catch (err) {
    console.error("PATCH /api/admin/users error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
