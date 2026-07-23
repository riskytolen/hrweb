"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { SUMMARY_FETCH_PAGE_SIZE } from "../attendance-constants";
import { getSummaryPeriodRange, getSummaryCurrentPeriodKey } from "../attendance-helpers";
import type { EmployeeLite, AnalysisMetrics, AnalysisDivisiItem, AnalysisIndividuItem, DailyTrend } from "../attendance-types";

function shiftPeriodKey(key: string, dir: -1 | 1): string {
  const [y, m] = key.split("-").map(Number);
  const dt = new Date(y, m - 1 + dir, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function emptyMetrics(): AnalysisMetrics {
  return { hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpha: 0, libur: 0, cuti: 0, total: 0 };
}

async function fetchPeriodRecords(start: string, end: string) {
  type RawRow = {
    employee_id: string;
    division_id: number;
    status: string;
    tanggal: string;
    divisions: { nama: string; color: string } | { nama: string; color: string }[] | null;
  };
  let all: RawRow[] = [];
  let from = 0;
  let more = true;
  while (more) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("employee_id, division_id, status, tanggal, divisions(nama, color)")
      .gte("tanggal", start)
      .lte("tanggal", end)
      .range(from, from + SUMMARY_FETCH_PAGE_SIZE - 1);
    if (error || !data) break;
    all = all.concat(data as RawRow[]);
    more = data.length === SUMMARY_FETCH_PAGE_SIZE;
    from += SUMMARY_FETCH_PAGE_SIZE;
  }
  return all;
}

function getDiv(d: { divisions: { nama: string; color: string } | { nama: string; color: string }[] | null }) {
  return Array.isArray(d.divisions) ? d.divisions[0] : d.divisions;
}

function combineMetrics(base: AnalysisMetrics, status: string) {
  base.total++;
  switch (status) {
    case "Hadir": base.hadir++; break;
    case "Terlambat": base.terlambat++; break;
    case "Izin": base.izin++; break;
    case "Sakit": base.sakit++; break;
    case "Alpha": base.alpha++; break;
    case "Libur": base.libur++; break;
    case "Cuti": base.cuti++; break;
  }
}

export function useAttendanceAnalysis(employees: EmployeeLite[]) {
  const [periodKey, setPeriodKey] = useState(getSummaryCurrentPeriodKey);
  const [loading, setLoading] = useState(false);

  const currPeriod = useMemo(() => getSummaryPeriodRange(periodKey), [periodKey]);
  const prevPeriod = useMemo(() => getSummaryPeriodRange(shiftPeriodKey(periodKey, -1)), [periodKey]);

  const [currRecords, setCurrRecords] = useState<ReturnType<typeof fetchPeriodRecords> extends Promise<infer T> ? T : never>([]);
  const [prevRecords, setPrevRecords] = useState<ReturnType<typeof fetchPeriodRecords> extends Promise<infer T> ? T : never>([]);

  const empMap = useMemo(() => {
    const m = new Map<string, EmployeeLite>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const load = useCallback(async () => {
    setLoading(true);
    const [curr, prev] = await Promise.all([
      fetchPeriodRecords(currPeriod.start, currPeriod.end),
      fetchPeriodRecords(prevPeriod.start, prevPeriod.end),
    ]);
    setCurrRecords(curr);
    setPrevRecords(prev);
    setLoading(false);
  }, [currPeriod, prevPeriod]);

  useEffect(() => { load(); }, [load]);

  const divisionList = useMemo(() => {
    const seen = new Set<number>();
    const out: { id: number; nama: string; color: string }[] = [];
    [...currRecords, ...prevRecords].forEach((r) => {
      const div = getDiv(r);
      if (!seen.has(r.division_id) && div) {
        seen.add(r.division_id);
        out.push({ id: r.division_id, nama: div.nama, color: div.color });
      }
    });
    return out.sort((a, b) => a.nama.localeCompare(b.nama));
  }, [currRecords, prevRecords]);

  const buildMetrics = useCallback(
    (records: typeof currRecords): { global: AnalysisMetrics; divisions: Map<number, AnalysisMetrics>; individuals: Map<string, AnalysisMetrics>; daily: Map<string, AnalysisMetrics> } => {
      const global = emptyMetrics();
      const divisions = new Map<number, AnalysisMetrics>();
      const individuals = new Map<string, AnalysisMetrics>();
      const daily = new Map<string, AnalysisMetrics>();

      records.forEach((r) => {
        combineMetrics(global, r.status);

        if (!divisions.has(r.division_id)) divisions.set(r.division_id, emptyMetrics());
        combineMetrics(divisions.get(r.division_id)!, r.status);

        if (!individuals.has(r.employee_id)) individuals.set(r.employee_id, emptyMetrics());
        combineMetrics(individuals.get(r.employee_id)!, r.status);

        if (!daily.has(r.tanggal)) daily.set(r.tanggal, emptyMetrics());
        combineMetrics(daily.get(r.tanggal)!, r.status);
      });

      return { global, divisions, individuals, daily };
    },
    [],
  );

  const curr = useMemo(() => buildMetrics(currRecords), [currRecords, buildMetrics]);
  const prev = useMemo(() => buildMetrics(prevRecords), [prevRecords, buildMetrics]);

  const global = useMemo(() => curr.global, [curr]);
  const globalPrev = useMemo(() => prev.global, [prev]);

  const divisions: AnalysisDivisiItem[] = useMemo(
    () => divisionList.map((d) => {
      const m = curr.divisions.get(d.id) || emptyMetrics();
      return { ...m, divisionId: d.id, divisionNama: d.nama, divisionColor: d.color };
    }),
    [divisionList, curr.divisions],
  );

  const individuals: AnalysisIndividuItem[] = useMemo(
    () => Array.from(curr.individuals.entries()).map(([eid, m]) => {
      const emp = empMap.get(eid);
      const rec = currRecords.find((r) => r.employee_id === eid);
      const div = rec ? getDiv(rec) : null;
      return {
        ...m,
        employee_id: eid,
        nama: emp?.nama || eid,
        divisionNama: div?.nama || "-",
        divisionColor: div?.color || "#6b7280",
      };
    }).sort((a, b) => a.nama.localeCompare(b.nama)),
    [curr.individuals, empMap, currRecords],
  );

  const dailyTrend: DailyTrend[] = useMemo(
    () => Array.from(curr.daily.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => ({
      date, ...m,
    })),
    [curr.daily],
  );

  return {
    loading,
    periodKey,
    setPeriodKey,
    currPeriod,
    prevPeriod,
    global,
    globalPrev,
    divisions,
    individuals,
    dailyTrend,
    divisionList,
  };
}
