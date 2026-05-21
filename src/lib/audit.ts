/**
 * Audit log helper.
 *
 * Pakai untuk catat aksi penting di web admin (approve, delete, edit, generate, dll).
 * Otomatis tarik info user dari Supabase session + role/nama dari user_profiles.
 *
 * Best practice:
 * - Panggil SETELAH operasi DB berhasil (jangan log kalau aksi gagal)
 * - Pass entity_label yang human-readable (untuk display di tabel audit)
 * - Pakai metadata untuk konteks bisnis (catatan approval, alasan input manual, dll)
 * - Old/new data adalah snapshot row, bukan diff (lebih simple)
 *
 * Helper fail silent: kalau log gagal, tidak throw — supaya operasi utama tidak ter-rollback.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "generate"
  | "manual_input"
  | "status_change"
  | "import"
  | "export"
  | "finalisasi";

export type AuditEntityType =
  | "pegawai"
  | "attendance_records"
  | "leave_requests"
  | "overtime_requests"
  | "recruitments"
  | "payrolls"
  | "delivery_points"
  | "divisions"
  | "jabatan"
  | "division_schedules"
  | "attendance_locations"
  | "attendance_penalty_rates"
  | "point_rates"
  | "delivery_statuses"
  | "banks"
  | "levels"
  | "user_profiles"
  | "roles"
  | "announcements"
  | "legal_documents"
  | "company_settings"
  | "leave_settings";

export interface AuditLogParams {
  supabase: SupabaseClient;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | number | null;
  entityLabel?: string | null;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Catat audit log. Fail silent kalau gagal (tidak throw).
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    const {
      supabase,
      action,
      entityType,
      entityId,
      entityLabel,
      oldData,
      newData,
      metadata,
    } = params;

    // 1. Ambil current user
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    let userEmail: string | null = null;
    let userNama: string | null = null;
    let userRole: string | null = null;

    if (user) {
      userEmail = user.email ?? null;
      // Ambil profile + role nama
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("nama, roles(nama)")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        userNama = (profile.nama as string | null) ?? null;
        const rolesField = profile.roles as { nama?: string } | null | undefined;
        userRole = rolesField?.nama ?? null;
      }
    }

    // 2. Insert log
    await supabase.from("audit_logs").insert({
      user_id: user?.id ?? null,
      user_email: userEmail,
      user_nama: userNama,
      user_role: userRole,
      action,
      entity_type: entityType,
      entity_id: entityId != null ? String(entityId) : null,
      entity_label: entityLabel ?? null,
      old_data: oldData ?? null,
      new_data: newData ?? null,
      metadata: metadata ?? null,
    });
  } catch (err) {
    // Fail silent: log error ke console saja, jangan throw.
    if (typeof window !== "undefined") {
      console.warn("[audit] gagal mencatat log:", err);
    }
  }
}

/**
 * Helper bahasa Indonesia untuk action label di UI tabel audit.
 */
export function actionLabel(action: string): string {
  switch (action) {
    case "create":
      return "Buat";
    case "update":
      return "Ubah";
    case "delete":
      return "Hapus";
    case "approve":
      return "Setujui";
    case "reject":
      return "Tolak";
    case "generate":
      return "Generate";
    case "manual_input":
      return "Input Manual";
    case "status_change":
      return "Ubah Status";
    case "import":
      return "Import";
    case "export":
      return "Export";
    case "finalisasi":
      return "Finalisasi";
    default:
      return action;
  }
}

/**
 * Warna semantik untuk action badge di UI.
 */
export function actionColor(action: string): "primary" | "success" | "danger" | "warning" | "muted" {
  switch (action) {
    case "approve":
    case "generate":
    case "create":
    case "finalisasi":
      return "success";
    case "reject":
    case "delete":
      return "danger";
    case "update":
    case "manual_input":
    case "status_change":
      return "primary";
    case "import":
    case "export":
      return "warning";
    default:
      return "muted";
  }
}

/**
 * Helper bahasa Indonesia untuk entity label di UI tabel audit.
 */
export function entityLabel(entityType: string): string {
  const labels: Record<string, string> = {
    pegawai: "Pegawai",
    attendance_records: "Absensi",
    leave_requests: "Cuti & Izin",
    overtime_requests: "Lembur",
    recruitments: "Rekrutmen",
    payrolls: "Penggajian",
    delivery_points: "Rekap Titik",
    divisions: "Divisi",
    jabatan: "Jabatan",
    division_schedules: "Waktu Kerja",
    attendance_locations: "Lokasi Absen",
    attendance_penalty_rates: "Denda Absensi",
    point_rates: "Harga Titik",
    delivery_statuses: "Status Pengantaran",
    banks: "Bank",
    levels: "Level Jabatan",
    user_profiles: "Akun User",
    roles: "Role",
    announcements: "Pengumuman",
    legal_documents: "Dokumen Legal",
    company_settings: "Pengaturan Perusahaan",
    leave_settings: "Pengaturan Cuti",
  };
  return labels[entityType] ?? entityType;
}

/**
 * Ambil info user yang sedang login untuk dipakai sebagai approver.
 *
 * Pakai untuk handler approval:
 * ```ts
 * const approver = await getCurrentApprover(supabase);
 * await supabase.from("leave_requests").update({
 *   ...,
 *   approved_by_user_id: approver.userId,
 *   approved_by_nama: approver.nama,
 * });
 * ```
 *
 * Returns { userId, nama }. Fallback nama "Sistem" kalau gagal.
 */
export async function getCurrentApprover(supabase: SupabaseClient): Promise<{ userId: string | null; nama: string }> {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return { userId: null, nama: "Sistem" };

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("nama")
      .eq("id", user.id)
      .maybeSingle();

    const nama = (profile?.nama as string | null) || user.email || "Sistem";
    return { userId: user.id, nama };
  } catch {
    return { userId: null, nama: "Sistem" };
  }
}
