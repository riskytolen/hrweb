"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import type { AttendanceRow } from "../attendance-types";
import type { ToastType } from "./use-toast";

type DeleteItem = { id: number; nama: string };

/**
 * Hook: handle delete untuk attendance record.
 * Encapsulate: hapus record + audit log + toast notification + reload records.
 *
 * @param records Daftar attendance records saat ini (untuk snapshot oldData di audit log)
 * @param reloadRecords Fungsi untuk refresh records setelah delete
 * @param showToast Fungsi untuk show success/error toast
 * @returns Async callback yang menerima `{ id, nama }` untuk dihapus
 */
export function useAttendanceDelete(
  records: AttendanceRow[],
  reloadRecords: () => Promise<void>,
  showToast: (type: ToastType, title: string, message?: string) => void,
) {
  return useCallback(
    async (item: DeleteItem) => {
      const oldRecord = records.find((r) => r.id === item.id);
      const { error } = await supabase.from("attendance_records").delete().eq("id", item.id);
      if (error) {
        showToast("error", "Gagal Menghapus", error.message);
        return;
      }
      await logAudit({
        supabase,
        action: "delete",
        entityType: "attendance_records",
        entityId: item.id,
        entityLabel: `Absensi ${item.nama}`,
        oldData: oldRecord ? { ...oldRecord } as unknown as Record<string, unknown> : null,
      });
      showToast("success", "Data Dihapus", "Data absen berhasil dihapus.");
      await reloadRecords();
    },
    [records, reloadRecords, showToast],
  );
}
