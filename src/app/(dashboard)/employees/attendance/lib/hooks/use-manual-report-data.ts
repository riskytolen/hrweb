"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { SUMMARY_FETCH_PAGE_SIZE } from "../attendance-constants";
import type { EmployeeLite } from "../attendance-types";

export type ManualReportItem = {
  id: number;
  employee_id: string;
  employeeNama: string;
  divisionNama: string;
  divisionColor: string;
  tanggal: string;
  status: string;
  jam_masuk: string;
  durasi_telat: number;
  denda: number;
  catatan: string | null;
  alasan_manual: string | null;
};

export type ManualReportGroup = {
  employee_id: string;
  employeeNama: string;
  divisionNama: string;
  divisionColor: string;
  total: number;
  hadir: number;
  telat: number;
  izin: number;
  sakit: number;
  alpha: number;
  cuti: number;
  libur: number;
  totalDenda: number;
  items: ManualReportItem[];
};

export function useManualReportData(
  period: { start: string; end: string },
  employees: EmployeeLite[],
) {
  const [items, setItems] = useState<ManualReportItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!period.start || !period.end) {
      setItems([]);
      return;
    }
    setLoading(true);
    type RawRow = {
      id: number;
      employee_id: string;
      tanggal: string;
      status: string;
      jam_masuk: string;
      durasi_telat: number;
      denda: number;
      catatan: string | null;
      alasan_manual: string | null;
      pegawai?: { nama: string } | null;
      divisions?: { nama: string; color: string } | null;
    };
    let allData: RawRow[] = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("id, employee_id, tanggal, status, jam_masuk, durasi_telat, denda, catatan, alasan_manual, pegawai(nama), divisions(nama, color)")
        .eq("is_manual", true)
        .gte("tanggal", period.start)
        .lte("tanggal", period.end)
        .order("tanggal", { ascending: true })
        .range(from, from + SUMMARY_FETCH_PAGE_SIZE - 1);
      if (error || !data) break;
      allData = allData.concat(data as unknown as RawRow[]);
      hasMore = data.length === SUMMARY_FETCH_PAGE_SIZE;
      from += SUMMARY_FETCH_PAGE_SIZE;
    }
    const mapped: ManualReportItem[] = allData.map((r) => ({
      id: r.id,
      employee_id: r.employee_id,
      employeeNama: r.pegawai?.nama || r.employee_id,
      divisionNama: r.divisions?.nama || "-",
      divisionColor: r.divisions?.color || "#6b7280",
      tanggal: r.tanggal,
      status: r.status,
      jam_masuk: r.jam_masuk,
      durasi_telat: r.durasi_telat,
      denda: r.denda,
      catatan: r.catatan,
      alasan_manual: r.alasan_manual,
    }));
    setItems(mapped);
    setLoading(false);
  }, [period.start, period.end]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, ManualReportGroup>();
    for (const it of items) {
      let g = map.get(it.employee_id);
      if (!g) {
        g = {
          employee_id: it.employee_id,
          employeeNama: it.employeeNama,
          divisionNama: it.divisionNama,
          divisionColor: it.divisionColor,
          total: 0, hadir: 0, telat: 0, izin: 0, sakit: 0, alpha: 0, cuti: 0, libur: 0,
          totalDenda: 0,
          items: [],
        };
        map.set(it.employee_id, g);
      }
      g.total++;
      g.totalDenda += it.denda;
      switch (it.status) {
        case "Hadir": g.hadir++; break;
        case "Terlambat": g.telat++; break;
        case "Izin": g.izin++; break;
        case "Sakit": g.sakit++; break;
        case "Alpha": g.alpha++; break;
        case "Cuti": g.cuti++; break;
        case "Libur": g.libur++; break;
      }
      g.items.push(it);
    }
    return Array.from(map.values());
  }, [items]);

  return { items, groups, loading, reload: load };
}
