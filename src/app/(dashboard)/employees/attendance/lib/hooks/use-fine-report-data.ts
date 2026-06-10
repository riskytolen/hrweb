"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { EmployeeLite } from "../attendance-types";

export type FineReportItem = {
  id: number;
  employee_id: string;
  employeeNama: string;
  divisionNama: string;
  divisionColor: string;
  tanggal: string;
  status: string;
  durasi_telat: number;
  denda: number;
  catatan: string | null;
  is_manual: boolean;
};

export type FineReportSummary = {
  totalDenda: number;
  totalDendaTelat: number;
  totalDendaAlpha: number;
  totalKejadian: number;
  kejadianTelat: number;
  kejadianAlpha: number;
};

export function useFineReportData(
  period: { start: string; end: string },
  employees: EmployeeLite[],
) {
  const [items, setItems] = useState<FineReportItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!period.start || !period.end) {
      setItems([]);
      return;
    }
    setLoading(true);

    const PAGE = 1000;
    type RawRow = {
      id: number;
      employee_id: string;
      tanggal: string;
      status: string;
      durasi_telat: number;
      denda: number;
      catatan: string | null;
      is_manual: boolean;
      division_id: number | null;
      pegawai: { nama: string } | null;
      divisions: { nama: string; color: string } | { nama: string; color: string }[] | null;
    };
    let all: RawRow[] = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("id, employee_id, tanggal, status, durasi_telat, denda, catatan, is_manual, division_id, pegawai(nama), divisions(nama, color)")
        .gte("tanggal", period.start)
        .lte("tanggal", period.end)
        .gt("denda", 0)
        .order("tanggal", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      all = all.concat(data as unknown as RawRow[]);
      hasMore = data.length === PAGE;
      from += PAGE;
    }

    const empMap = new Map(employees.map((e) => [e.id, e]));
    const mapped: FineReportItem[] = all.map((r) => {
      const emp = empMap.get(r.employee_id);
      const div = Array.isArray(r.divisions) ? r.divisions[0] : r.divisions;
      return {
        id: r.id,
        employee_id: r.employee_id,
        employeeNama: r.pegawai?.nama || emp?.nama || r.employee_id,
        divisionNama: div?.nama || "-",
        divisionColor: div?.color || "#6b7280",
        tanggal: r.tanggal,
        status: r.status,
        durasi_telat: r.durasi_telat,
        denda: r.denda,
        catatan: r.catatan,
        is_manual: r.is_manual,
      };
    });
    setItems(mapped);
    setLoading(false);
  }, [period.start, period.end, employees]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, reload: load };
}

export function computeFineReportSummary(items: FineReportItem[]): FineReportSummary {
  let totalDenda = 0;
  let totalDendaTelat = 0;
  let totalDendaAlpha = 0;
  let kejadianTelat = 0;
  let kejadianAlpha = 0;
  for (const it of items) {
    totalDenda += it.denda;
    if (it.status === "Terlambat" || it.status === "Telat") {
      totalDendaTelat += it.denda;
      kejadianTelat++;
    } else if (it.status === "Alpha") {
      totalDendaAlpha += it.denda;
      kejadianAlpha++;
    }
  }
  return {
    totalDenda,
    totalDendaTelat,
    totalDendaAlpha,
    totalKejadian: items.length,
    kejadianTelat,
    kejadianAlpha,
  };
}
