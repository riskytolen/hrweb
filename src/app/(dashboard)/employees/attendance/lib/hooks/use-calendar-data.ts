"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { CALENDAR_FETCH_PAGE_SIZE } from "../attendance-constants";
import { getCalPeriod } from "../attendance-helpers";
import type { AttendanceRow } from "../attendance-types";

/**
 * Fetch attendance records untuk periode kalender (1 bulan, cutoff 8-7).
 * Pakai pagination untuk handle range > 1000 records.
 */
export function useCalendarData(calPeriodKey: string) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = getCalPeriod(calPeriodKey);

    let allData: AttendanceRow[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*, pegawai(nama), divisions(nama, color)")
        .gte("tanggal", start)
        .lte("tanggal", end)
        .order("tanggal", { ascending: true })
        .range(from, from + CALENDAR_FETCH_PAGE_SIZE - 1);

      if (error || !data) break;
      const mapped = data.map((d) => ({
        ...d,
        employeeNama: d.pegawai?.nama || d.employee_id,
        divisionNama: d.divisions?.nama || "-",
        divisionColor: d.divisions?.color || "#3b82f6",
      })) as AttendanceRow[];
      allData = allData.concat(mapped);
      hasMore = data.length === CALENDAR_FETCH_PAGE_SIZE;
      from += CALENDAR_FETCH_PAGE_SIZE;
    }

    setRecords(allData);
    setLoading(false);
  }, [calPeriodKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { records, loading, reload: load };
}
