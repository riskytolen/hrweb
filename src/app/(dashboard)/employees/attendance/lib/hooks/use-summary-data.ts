"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { SUMMARY_FETCH_PAGE_SIZE } from "../attendance-constants";
import type { SummaryRow, EmployeeLite } from "../attendance-types";

/**
 * Fetch & aggregate attendance records untuk periode summary payroll.
 * Hitung per-employee counts (hadir/telat/izin/sakit/alpha/libur/cuti).
 */
export function useSummaryData(period: { start: string; end: string }, employees: EmployeeLite[]) {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!period.start || !period.end) {
      setRows([]);
      return;
    }
    setLoading(true);
    type SummaryFetchRow = {
      employee_id: string;
      status: string;
      division_id: number;
      divisions: { nama: string; color: string } | { nama: string; color: string }[] | null;
    };
    let allData: SummaryFetchRow[] = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("employee_id, status, division_id, divisions(nama, color)")
        .gte("tanggal", period.start)
        .lte("tanggal", period.end)
        .range(from, from + SUMMARY_FETCH_PAGE_SIZE - 1);
      if (error || !data) break;
      allData = allData.concat(data as SummaryFetchRow[]);
      hasMore = data.length === SUMMARY_FETCH_PAGE_SIZE;
      from += SUMMARY_FETCH_PAGE_SIZE;
    }

    const getDivision = (d: SummaryFetchRow) => Array.isArray(d.divisions) ? d.divisions[0] : d.divisions;

    const map = new Map<string, SummaryRow>();
    allData.forEach((d) => {
      let row = map.get(d.employee_id);
      if (!row) {
        const emp = employees.find((e) => e.id === d.employee_id);
        const div = getDivision(d);
        row = {
          employee_id: d.employee_id,
          nama: emp?.nama || d.employee_id,
          status: emp?.status || "Aktif",
          divisionId: d.division_id || 0,
          divisionNama: div?.nama || "-",
          divisionColor: div?.color || "#6b7280",
          hadir: 0, telat: 0, izin: 0, sakit: 0, alpha: 0, libur: 0, cuti: 0, total: 0,
        };
        map.set(d.employee_id, row);
      }
      switch (d.status) {
        case "Hadir": row.hadir++; break;
        case "Terlambat": row.telat++; row.hadir++; break;
        case "Izin": row.izin++; break;
        case "Sakit": row.sakit++; break;
        case "Alpha": row.alpha++; break;
        case "Libur": row.libur++; break;
        case "Cuti": row.cuti++; break;
      }
    });

    const result = Array.from(map.values()).map((r) => ({
      ...r,
      total: r.hadir + r.izin + r.sakit + r.alpha + r.libur + r.cuti,
    }));
    setRows(result);
    setLoading(false);
  }, [period.start, period.end, employees]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, loading, reload: load };
}
