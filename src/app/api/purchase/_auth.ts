import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export interface PurchaseActor {
  userId: string;
  email: string | null;
  isSuperAdmin: boolean;
  /** Boleh mengajukan PO (jabatan terdaftar sebagai pengaju + pegawai aktif). */
  canRequest: boolean;
  /** Boleh mengelola seluruh PO (Purchasing). */
  canManage: boolean;
  employeeId: string | null;
  employeeName: string;
  jabatanId: number | null;
  jabatanNama: string;
}

interface RoleRelation {
  level?: number | null;
  permissions?: string[] | string | null;
  status?: string | null;
}

function rolePermissions(role: RoleRelation | RoleRelation[] | null | undefined): string[] {
  const r = Array.isArray(role) ? role[0] : role;
  if (!r || typeof r.permissions === "undefined" || r.permissions === null) return [];
  if (Array.isArray(r.permissions)) return r.permissions.filter((p): p is string => typeof p === "string");
  try {
    const parsed: unknown = JSON.parse(r.permissions);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Verifikasi sesi + bangun identitas Purchase berbasis jabatan pegawai.
 * Gagal → { ok: false, response } untuk langsung dikembalikan.
 */
export async function getPurchaseActor(): Promise<
  { ok: true; actor: PurchaseActor } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sesi login telah berakhir. Silakan masuk kembali." },
        { status: 401, headers: NO_STORE_HEADERS },
      ),
    };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("nama, status, account_type, employee_id, roles(level, permissions, status)")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.status !== "Aktif" || profile.account_type !== "internal") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Akun tidak aktif atau bukan akun internal." },
        { status: 403, headers: NO_STORE_HEADERS },
      ),
    };
  }

  const perms = rolePermissions(profile.roles as RoleRelation | RoleRelation[] | null);
  const role = (Array.isArray(profile.roles) ? profile.roles[0] : profile.roles) as RoleRelation | null;
  const isSuperAdmin =
    (Number(role?.level ?? 0) >= 100 || perms.includes("all")) && role?.status !== "Tidak Aktif";

  let employeeId: string | null = (profile.employee_id as string | null) ?? null;
  let employeeName = (profile.nama as string) || user.email || "Pengaju";
  let jabatanId: number | null = null;
  let jabatanNama = "";

  if (employeeId) {
    const { data: pegawai } = await admin
      .from("pegawai")
      .select("id, nama, status, jabatan_id, jabatan:jabatan_id(id, nama, status)")
      .eq("id", employeeId)
      .maybeSingle();
    if (!pegawai || pegawai.status !== "Aktif") {
      employeeId = null;
    } else {
      employeeName = (pegawai.nama as string) || employeeName;
      const jab = pegawai.jabatan as { id?: number; nama?: string; status?: string } | { id?: number; nama?: string; status?: string }[] | null;
      const job = Array.isArray(jab) ? jab[0] : jab;
      if (job && job.status !== "Tidak Aktif") {
        jabatanId = typeof job.id === "number" ? job.id : null;
        jabatanNama = job.nama || "";
      }
    }
  }

  let canRequest = false;
  let canManage = false;
  if (isSuperAdmin) {
    canRequest = true;
    canManage = true;
  } else if (jabatanId !== null) {
    const { data: rule } = await admin
      .from("purchase_jabatan_rules")
      .select("can_request, can_manage")
      .eq("jabatan_id", jabatanId)
      .maybeSingle();
    canRequest = Boolean(rule?.can_request);
    canManage = Boolean(rule?.can_manage);
  }

  return {
    ok: true,
    actor: {
      userId: user.id,
      email: user.email ?? null,
      isSuperAdmin,
      canRequest,
      canManage,
      employeeId,
      employeeName,
      jabatanId,
      jabatanNama,
    },
  };
}

/** 403 generik untuk aksi Purchasing. */
export function manageForbidden(): NextResponse {
  return NextResponse.json(
    { error: "Hanya Purchasing yang dapat melakukan aksi ini." },
    { status: 403, headers: NO_STORE_HEADERS },
  );
}

/** 403 generik untuk pengajuan. */
export function requestForbidden(): NextResponse {
  return NextResponse.json(
    { error: "Jabatan Anda belum diizinkan mengajukan PO. Hubungi Super Admin." },
    { status: 403, headers: NO_STORE_HEADERS },
  );
}
