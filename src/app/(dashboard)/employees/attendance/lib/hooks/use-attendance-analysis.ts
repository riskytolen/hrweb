"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { SUMMARY_FETCH_PAGE_SIZE } from "../attendance-constants";
import {
  getSummaryPeriodRange,
  getSummaryCurrentPeriodKey,
  isCountableManualRecord,
  pickDominantDivisionLabel,
  computeAvgJamMasuk,
  compareRankingEntries,
  computeWeeklyChallenge,
  getJakartaToday,
  listPeriodWeeks,
} from "../attendance-helpers";
import type { ChallengeRecordInput } from "../attendance-helpers";
import type {
  EmployeeLite,
  AnalysisMetrics,
  AnalysisDivisiItem,
  AnalysisIndividuItem,
  AnalysisRankingItem,
  DailyTrend,
  ChallengeWeek,
} from "../attendance-types";

function shiftPeriodKey(key: string, dir: -1 | 1): string {
  const [y, m] = key.split("-").map(Number);
  const dt = new Date(y, m - 1 + dir, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function emptyMetrics(): AnalysisMetrics {
  return { hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpha: 0, libur: 0, cuti: 0, manual: 0, total: 0 };
}

async function fetchPeriodRecords(start: string, end: string) {
  type RawRow = {
    employee_id: string;
    division_id: number;
    status: string;
    tanggal: string;
    is_manual: boolean;
    jam_masuk: string;
    divisions: { nama: string; color: string } | { nama: string; color: string }[] | null;
  };
  let all: RawRow[] = [];
  let from = 0;
  let more = true;
  while (more) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("employee_id, division_id, status, tanggal, is_manual, jam_masuk, divisions(nama, color)")
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

  // Rentang data challenge: minggu-minggu Senin–Minggu yang memotong periode
  // (bisa melewati batas periode payroll 8–7, mis. minggu terakhir sampai hari Minggu).
  const challengeRange = useMemo(() => {
    const weeks = listPeriodWeeks(currPeriod.start, currPeriod.end);
    if (weeks.length === 0) return null;
    return { start: weeks[0].weekStart, end: weeks[weeks.length - 1].weekEnd };
  }, [currPeriod]);

  const [currRecords, setCurrRecords] = useState<ReturnType<typeof fetchPeriodRecords> extends Promise<infer T> ? T : never>([]);
  const [prevRecords, setPrevRecords] = useState<ReturnType<typeof fetchPeriodRecords> extends Promise<infer T> ? T : never>([]);
  const [challengeRecords, setChallengeRecords] = useState<ChallengeRecordInput[]>([]);

  const empMap = useMemo(() => {
    const m = new Map<string, EmployeeLite>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const load = useCallback(async () => {
    setLoading(true);
    const [curr, prev, chalRaw] = await Promise.all([
      fetchPeriodRecords(currPeriod.start, currPeriod.end),
      fetchPeriodRecords(prevPeriod.start, prevPeriod.end),
      challengeRange ? fetchPeriodRecords(challengeRange.start, challengeRange.end) : Promise.resolve([]),
    ]);
    setCurrRecords(curr);
    setPrevRecords(prev);
    // Challenge minta bentuk input murni: nama divisi ditempel dari join divisions.
    setChallengeRecords(chalRaw.map((row) => ({
      employee_id: row.employee_id,
      division_id: row.division_id,
      status: row.status,
      tanggal: row.tanggal,
      is_manual: row.is_manual,
      jam_masuk: row.jam_masuk,
      divisionNama: getDiv(row)?.nama ?? null,
      divisionColor: getDiv(row)?.color ?? null,
    })));
    setLoading(false);
  }, [currPeriod, prevPeriod, challengeRange]);

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

  /** Divisi yang absen manualnya tidak dihitung (Back Office), konsisten dengan Report Manual. */
  const manualDivIds = useMemo(() => {
    const ids = new Set<number>();
    [...currRecords, ...prevRecords].forEach((r) => {
      if (!r.is_manual || ids.has(r.division_id)) return;
      if (!isCountableManualRecord(r.is_manual, getDiv(r)?.nama)) ids.add(r.division_id);
    });
    return ids;
  }, [currRecords, prevRecords]);

  const buildMetrics = useCallback(
    (records: typeof currRecords, manualDivIds: Set<number>): { global: AnalysisMetrics; divisions: Map<number, AnalysisMetrics>; individuals: Map<string, AnalysisMetrics>; daily: Map<string, AnalysisMetrics> } => {
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

        // Absen manual admin dihitung terpisah, tidak menambah total/status.
        if (r.is_manual && !manualDivIds.has(r.division_id)) {
          global.manual++;
          divisions.get(r.division_id)!.manual++;
          individuals.get(r.employee_id)!.manual++;
        }
      });

      return { global, divisions, individuals, daily };
    },
    [],
  );

  const curr = useMemo(() => buildMetrics(currRecords, manualDivIds), [currRecords, manualDivIds, buildMetrics]);
  const prev = useMemo(() => buildMetrics(prevRecords, manualDivIds), [prevRecords, manualDivIds, buildMetrics]);

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
    () => {
      // Label divisi = divisi tempat pegawai paling sering absen pada periode ini.
      // Murni identitas — angka absensi tetap gabungan semua divisi.
      const recordsByEmp = new Map<string, { division_id: number; tanggal: string; nama: string | null; color: string | null }[]>();
      for (const r of currRecords) {
        const div = getDiv(r);
        const lean = { division_id: r.division_id, tanggal: r.tanggal, nama: div?.nama ?? null, color: div?.color ?? null };
        const list = recordsByEmp.get(r.employee_id);
        if (list) list.push(lean);
        else recordsByEmp.set(r.employee_id, [lean]);
      }
      return Array.from(curr.individuals.entries()).map(([eid, m]) => {
        const emp = empMap.get(eid);
        const dominant = pickDominantDivisionLabel(recordsByEmp.get(eid) ?? []);
        return {
          ...m,
          employee_id: eid,
          nama: emp?.nama || eid,
          divisionNama: dominant?.nama || "-",
          divisionColor: dominant?.color || "#6b7280",
        };
      }).sort((a, b) => a.nama.localeCompare(b.nama));
    },
    [curr.individuals, empMap, currRecords],
  );

  /**
   * Peringkat perorangan per divisi dominan (Top 1 → bawah):
   * 1. Hadir efektif tertinggi (angka gabungan semua divisi).
   * 2. Absen manual tersedikit (angka gabungan, di luar Back Office).
   * 3. Rata-rata jam masuk paling awal pada divisi dominan.
   * Tie-break terakhir nama A-Z hanya untuk urutan render — dua pegawai
   * dengan nilai identik tetap nominalnya setara.
   */
  const ranking: AnalysisRankingItem[] = useMemo(
    () => {
      const recordsByEmp = new Map<string, typeof currRecords>();
      for (const r of currRecords) {
        const list = recordsByEmp.get(r.employee_id);
        if (list) list.push(r);
        else recordsByEmp.set(r.employee_id, [r]);
      }
      const perDiv = new Map<number, AnalysisRankingItem[]>();
      for (const row of individuals) {
        const recs = recordsByEmp.get(row.employee_id) ?? [];
        const dominantDiv = pickDominantDivisionLabel(
          recs.map((r) => {
            const div = getDiv(r);
            return { division_id: r.division_id, tanggal: r.tanggal, nama: div?.nama ?? null, color: div?.color ?? null };
          }),
        );
        const total = row.total;
        const hadirEfektifPct = total > 0 ? ((row.hadir + row.terlambat) / total) * 100 : 0;
        const divisionId = dominantDiv?.id ?? 0;
        const item: AnalysisRankingItem = {
          ...row,
          hadirEfektifPct,
          avgJamMasuk: computeAvgJamMasuk(recs, divisionId),
          rank: 0,
        };
        const list = perDiv.get(divisionId);
        if (list) list.push(item);
        else perDiv.set(divisionId, [item]);
      }
      const out: AnalysisRankingItem[] = [];
      for (const list of perDiv.values()) {
        list.sort((a, b) => compareRankingEntries(
          { hadirEfektifPct: a.hadirEfektifPct, manual: a.manual, avgJam: a.avgJamMasuk, nama: a.nama },
          { hadirEfektifPct: b.hadirEfektifPct, manual: b.manual, avgJam: b.avgJamMasuk, nama: b.nama },
        ));
        list.forEach((item, i) => { item.rank = i + 1; });
        out.push(...list);
      }
      // Grup divisi berurut alfabetis untuk tampilan per divisi.
      return out.sort((a, b) => a.divisionNama.localeCompare(b.divisionNama) || a.rank - b.rank);
    },
    [individuals, currRecords],
  );

  const dailyTrend: DailyTrend[] = useMemo(
    () => Array.from(curr.daily.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => ({
      date, ...m,
    })),
    [curr.daily],
  );

  /**
   * Challenge Mingguan CP Suka per minggu Senin–Minggu melintasi periode.
   * Hari mendatang pada minggu berjalan belum dinilai (status sementara).
   */
  const jakartaToday = useMemo(() => getJakartaToday(), []);
  const empNamaMap = useMemo(() => new Map(employees.map((e) => [e.id, e.nama])), [employees]);
  const challengeWeeks: ChallengeWeek[] = useMemo(
    () => listPeriodWeeks(currPeriod.start, currPeriod.end).map((w) =>
      computeWeeklyChallenge(challengeRecords, w.weekStart, jakartaToday, empNamaMap),
    ),
    [currPeriod, challengeRecords, jakartaToday, empNamaMap],
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
    ranking,
    dailyTrend,
    challengeWeeks,
    divisionList,
  };
}
