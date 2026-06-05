"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { MIN_DATE } from "../attendance-constants";
import type {
  EmployeeLite,
  DivisionLite,
  ScheduleLite,
  PenaltyLite,
  OffDayEntry,
  OverrideEntry,
  PublicHoliday,
} from "../attendance-types";

type StaticData = {
  employees: EmployeeLite[];
  divisions: DivisionLite[];
  schedules: ScheduleLite[];
  penalties: PenaltyLite[];
  offDays: OffDayEntry[];
  overrides: OverrideEntry[];
  publicHolidays: PublicHoliday[];
};

const EMPTY: StaticData = {
  employees: [],
  divisions: [],
  schedules: [],
  penalties: [],
  offDays: [],
  overrides: [],
  publicHolidays: [],
};

/**
 * Fetch static reference data (employees, divisions, schedules, penalties,
 * off days, overrides, public holidays) sekali pada mount.
 *
 * Semua data ini jarang berubah — tidak perlu di-reload saat user navigasi
 * atau filter berubah. Pakai `reload()` untuk force refresh (mis. setelah
 * save perubahan master data).
 */
export function useAttendanceStaticData() {
  const [data, setData] = useState<StaticData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [empRes, divRes, schRes, penRes, offRes, ovrRes, holRes] = await Promise.all([
      supabase
        .from("pegawai")
        .select("id, nama, status, tanggal_bergabung, tanggal_keluar")
        .or(`status.eq.Aktif,and(status.eq.Tidak Aktif,tanggal_keluar.gte.${MIN_DATE})`)
        .order("nama"),
      supabase.from("divisions").select("id, nama, color").eq("status", "Aktif").order("nama"),
      supabase
        .from("division_schedules")
        .select("division_id, jam_masuk, toleransi_menit, awal_absen_menit")
        .eq("status", "Aktif"),
      supabase
        .from("attendance_penalty_rates")
        .select("division_id, denda_per_menit, batas_menit, denda_maksimum, denda_alpha")
        .eq("status", "Aktif"),
      supabase.from("employee_off_days").select("employee_id, day_of_week"),
      supabase.from("employee_leave_overrides").select("*").order("tanggal", { ascending: false }),
      supabase.from("public_holidays").select("*").order("tanggal", { ascending: true }),
    ]);

    setData({
      employees: empRes.data || [],
      divisions: divRes.data || [],
      schedules: schRes.data || [],
      penalties: penRes.data || [],
      offDays: offRes.data || [],
      overrides: ovrRes.data || [],
      publicHolidays: holRes.data || [],
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...data, loading, reload: load };
}
