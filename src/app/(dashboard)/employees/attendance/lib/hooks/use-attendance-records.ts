"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { AttendanceRow } from "../attendance-types";

/**
 * Fetch attendance records untuk satu tanggal (table view).
 * Reload otomatis saat `dateFilter` berubah.
 */
export function useAttendanceRecords(dateFilter: string) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!dateFilter) {
      setRecords([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("attendance_records")
      .select("*, pegawai(nama), divisions(nama, color)")
      .eq("tanggal", dateFilter)
      .order("jam_masuk", { ascending: true });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const mapped = (data || []).map((d) => ({
      ...d,
      employeeNama: d.pegawai?.nama || d.employee_id,
      divisionNama: d.divisions?.nama || "-",
      divisionColor: d.divisions?.color || "#3b82f6",
    })) as AttendanceRow[];
    setRecords(mapped);
    setLoading(false);
  }, [dateFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return { records, loading, error, reload: load };
}
