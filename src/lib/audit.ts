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
  | "delivery_zones"
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
  | "leave_settings"
  | "petty_cash_transactions"
  | "petty_cash_settings"
  | "petty_cash_categories"
  | "petty_cash_bagians"
  | "petty_cash_units"
  | "ga_vehicles"
  | "ga_vehicle_documents"
  | "ga_vehicle_document_settings"
  | "backup_libur_settings"
  | "gapok_settings"
  | "gapok_increment_events"
  | "employee_gapok_history"
  | "vehicle_odometer_logs"
  | "ga_asset_categories"
  | "ga_asset_locations"
  | "ga_assets"
  | "ga_asset_assignments"
  | "finance_company_settings"
  | "finance_clients"
  | "finance_invoices"
  | "finance_invoice_payments"
  | "finance_expense_categories"
  | "finance_expenses"
  | "finance_cash_adjustments"
  | "company_legal_categories"
  | "company_legal_documents"
  | "company_legal_document_versions"
  | "company_legal_document_files";

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
    delivery_zones: "Nama Titik",
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
    petty_cash_transactions: "Transaksi Petty Cash",
    petty_cash_settings: "Pengaturan Petty Cash",
    petty_cash_categories: "Kategori Petty Cash",
    petty_cash_bagians: "Bagian Petty Cash",
    petty_cash_units: "Unit Petty Cash",
    ga_vehicles: "Data Mobil",
    ga_vehicle_documents: "Dokumen Kendaraan",
    ga_vehicle_document_settings: "Pengaturan Dokumen Kendaraan",
    backup_libur_settings: "Pengaturan Backup Libur",
    gapok_settings: "Pengaturan Gapok",
    gapok_increment_events: "Kenaikan Gapok",
    employee_gapok_history: "Histori Gapok",
    vehicle_odometer_logs: "Log Odometer Kendaraan",
    ga_asset_categories: "Kategori Aset",
    ga_asset_locations: "Lokasi Aset",
    ga_assets: "Aset",
    ga_asset_assignments: "Penempatan Aset",
    finance_company_settings: "Pengaturan Finance",
    finance_clients: "Klien Finance",
    finance_invoices: "Invoice Finance",
    finance_invoice_payments: "Pembayaran Invoice",
    finance_expense_categories: "Kategori Pengeluaran",
    finance_expenses: "Pengeluaran Finance",
    finance_cash_adjustments: "Penyesuaian Kas",
    company_legal_categories: "Kategori Legalitas",
    company_legal_documents: "Dokumen Legalitas",
    company_legal_document_versions: "Versi Dokumen Legalitas",
    company_legal_document_files: "Berkas Legalitas",
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
