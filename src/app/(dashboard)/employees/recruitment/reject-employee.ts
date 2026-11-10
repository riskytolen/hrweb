import type { SupabaseClient } from "@supabase/supabase-js";

/** Penolakan mempertahankan pegawai sebagai arsip agar payroll tidak terhapus cascade. */
export async function deactivateRejectedEmployee(
  db: Pick<SupabaseClient, "from">,
  employee: { id: string; status: string; tanggal_keluar: string | null },
  date: string,
) {
  return db.from("pegawai").update({
    status: "Tidak Aktif",
    tanggal_keluar: employee.tanggal_keluar || date,
    // Training belum pernah aktif, termasuk bila tanggal bergabung terisi keliru.
    ...(employee.status === "Training" ? { tanggal_bergabung: null } : {}),
  }).eq("id", employee.id).select("id").single();
}
