import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysLocal, isValidDateStr } from "@/lib/employee-activity";

/** Penolakan mempertahankan pegawai sebagai arsip agar payroll tidak terhapus cascade. */
export async function deactivateRejectedEmployee(
  db: Pick<SupabaseClient, "from">,
  employee: { id: string; status: string; tanggal_keluar: string | null; tanggal_bergabung?: string | null },
  date: string,
  trainingEnd?: string | null,
) {
  const neverActive = employee.status === "Training" || employee.tanggal_bergabung === null;
  const exitDate = neverActive && isValidDateStr(trainingEnd)
    ? addDaysLocal(trainingEnd, 1)
    : employee.tanggal_keluar || date;
  return db.from("pegawai").update({
    status: "Tidak Aktif",
    tanggal_keluar: exitDate,
    // Training belum pernah aktif, termasuk bila tanggal bergabung terisi keliru.
    ...(employee.status === "Training" ? { tanggal_bergabung: null } : {}),
  }).eq("id", employee.id).select("id").single();
}
