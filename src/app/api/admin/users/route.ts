import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

// ─── Helper: verify caller is Super Admin ───
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
    const { email, password, nama, role_id, employee_id, status } = body;

    if (!email || !password || !nama || !role_id) {
      return NextResponse.json(
        { error: "Email, password, nama, dan role_id wajib diisi." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password minimal 6 karakter." },
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
          employee_id: employee_id || null,
          status: status || "Aktif",
        })
        .eq("id", authData.user.id);

      if (profileError) {
        console.error("Failed to update profile:", profileError);
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

    const body = await request.json();
    const { userId, password } = body;

    if (!userId || !password) {
      return NextResponse.json(
        { error: "User ID dan password wajib diisi." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password minimal 6 karakter." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      password,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/admin/users error:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
