"use client";

import { useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  AUTO_NOTES,
  AUTO_NOTE_PREFIXES,
  DEFAULT_DENDA_ALPHA,
} from "../attendance-constants";
import { localDateStr, computeDendaAlpha } from "../attendance-helpers";
import type { EmployeeLite, PenaltyLite, PublicHoliday } from "../attendance-types";

type AutoGenArgs = {
  dateFilter: string;
  employees: EmployeeLite[];
  penalties: PenaltyLite[];
  publicHolidays: PublicHoliday[];
  reloadRecords: () => Promise<void>;
  staticLoading: boolean;
};

/**
 * Side-effect hook: auto-generate "Libur" + "Alpha" records for the active dateFilter.
 *
 * Trigger: setiap `dateFilter` berubah, ATAU saat static data (employees) pertama loaded.
 *
 * - `autoGenerateLibur`: insert/hapus record Libur berdasarkan jadwal mingguan, override, dan public holiday
 * - `autoGenerateAlpha`: insert record Alpha (atau Izin/Sakit/Cuti dari approved leave) untuk pegawai
 *   yang seharusnya kerja tapi belum ada record di tanggal sebelum hari ini.
 *   Juga cleanup stale Alpha untuk pegawai yang sudah non-aktif (B1).
 *
 * Returns nothing — hook ini pure side effect, hasil insert/delete langsung direfresh via `reloadRecords()`.
 */
export function useAttendanceAutoGen({
  dateFilter,
  employees,
  penalties,
  publicHolidays,
  reloadRecords,
  staticLoading,
}: AutoGenArgs) {
  const autoGenerateLibur = useCallback(async () => {
    if (!dateFilter || employees.length === 0) return;

    const [y, m, d] = dateFilter.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    const { data: allOffDays } = await supabase.from("employee_off_days").select("employee_id, day_of_week");
    const { data: dayOverrides } = await supabase.from("employee_leave_overrides").select("employee_id, type").eq("tanggal", dateFilter);

    const offDayMap = new Map<string, Set<number>>();
    allOffDays?.forEach((od) => {
      if (!offDayMap.has(od.employee_id)) offDayMap.set(od.employee_id, new Set());
      offDayMap.get(od.employee_id)!.add(od.day_of_week);
    });

    const overrideMap = new Map<string, string>();
    dayOverrides?.forEach((ov) => overrideMap.set(ov.employee_id, ov.type));

    const holidaysForDate = publicHolidays.filter(
      (h) => dateFilter >= h.tanggal && (h.tanggal_selesai ? dateFilter <= h.tanggal_selesai : dateFilter === h.tanggal)
    );

    const { data: existingRecs } = await supabase
      .from("attendance_records")
      .select("id, employee_id, status, catatan")
      .eq("tanggal", dateFilter);

    const existingMap = new Map<string, { id: number; status: string; catatan: string | null }>();
    existingRecs?.forEach((r) => existingMap.set(r.employee_id, { id: r.id, status: r.status, catatan: r.catatan }));

    const liburInserts: { employee_id: string; division_id: null; tanggal: string; jam_masuk: string; schedule_jam_masuk: string; toleransi_menit: number; status: string; durasi_telat: number; denda: number; catatan: string }[] = [];
    const staleLiburIds: number[] = [];

    for (const emp of employees) {
      if (emp.tanggal_bergabung && dateFilter < emp.tanggal_bergabung) continue;
      if (emp.tanggal_keluar && dateFilter > emp.tanggal_keluar) continue;

      const override = overrideMap.get(emp.id);
      const empOffDays = offDayMap.get(emp.id);

      const applicableHoliday = holidaysForDate.find((h) =>
        h.berlaku_untuk === "semua" ||
        (h.berlaku_untuk === "pegawai" && h.pegawai_ids?.includes(emp.id))
      );

      const isMasukOverride = override === "masuk";
      const isOverrideLibur = override === "libur";
      const isPublicHoliday = !!applicableHoliday;
      const isWeeklyOff = !override && !isPublicHoliday && empOffDays?.has(dow);

      const shouldBeLibur = (isOverrideLibur || isPublicHoliday || isWeeklyOff) && !isMasukOverride;
      const holidayNama = applicableHoliday ? applicableHoliday.nama : null;

      const existing = existingMap.get(emp.id);

      if (shouldBeLibur && !existing) {
        liburInserts.push({
          employee_id: emp.id,
          division_id: null,
          tanggal: dateFilter,
          jam_masuk: "00:00",
          schedule_jam_masuk: "00:00",
          toleransi_menit: 0,
          status: "Libur",
          durasi_telat: 0,
          denda: 0,
          catatan: holidayNama ? AUTO_NOTES.LIBUR_NASIONAL(holidayNama) : AUTO_NOTES.HARI_LIBUR,
        });
      } else if (!shouldBeLibur && existing && existing.status === "Libur" && (existing.catatan === AUTO_NOTES.HARI_LIBUR || existing.catatan?.startsWith(AUTO_NOTE_PREFIXES.LIBUR_NASIONAL))) {
        staleLiburIds.push(existing.id);
      }
    }

    let changed = false;
    if (staleLiburIds.length > 0) {
      await supabase.from("attendance_records").delete().in("id", staleLiburIds);
      changed = true;
    }
    if (liburInserts.length > 0) {
      await supabase.from("attendance_records").upsert(liburInserts, {
        onConflict: "employee_id,tanggal",
        ignoreDuplicates: true,
      });
      changed = true;
    }
    if (changed) await reloadRecords();
  }, [dateFilter, employees, reloadRecords, publicHolidays]);

  const autoGenerateAlpha = useCallback(async () => {
    if (!dateFilter || employees.length === 0) return;

    const today = localDateStr();
    if (dateFilter >= today) return;

    const [y, m, d] = dateFilter.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    const { data: allOffDays } = await supabase.from("employee_off_days").select("employee_id, day_of_week");
    const { data: dayOverrides } = await supabase.from("employee_leave_overrides").select("employee_id, type").eq("tanggal", dateFilter);
    const { data: approvedLeaves } = await supabase
      .from("leave_requests")
      .select("employee_id, jenis, alasan")
      .eq("status", "Disetujui")
      .lte("tanggal_mulai", dateFilter)
      .gte("tanggal_selesai", dateFilter);

    const offDayMap = new Map<string, Set<number>>();
    allOffDays?.forEach((od) => {
      if (!offDayMap.has(od.employee_id)) offDayMap.set(od.employee_id, new Set());
      offDayMap.get(od.employee_id)!.add(od.day_of_week);
    });

    const overrideMap = new Map<string, string>();
    dayOverrides?.forEach((ov) => overrideMap.set(ov.employee_id, ov.type));

    const leaveMap = new Map<string, { jenis: string, alasan: string }[]>();
    approvedLeaves?.forEach((l) => {
      const list = leaveMap.get(l.employee_id) ?? [];
      list.push({ jenis: l.jenis, alasan: l.alasan || "" });
      leaveMap.set(l.employee_id, list);
    });

    const { data: existingRecs } = await supabase
      .from("attendance_records")
      .select("id, employee_id, status, catatan, is_manual")
      .eq("tanggal", dateFilter);
    const existingSet = new Set(existingRecs?.map((r) => r.employee_id) || []);

    const alphaInserts: { employee_id: string; division_id: null; tanggal: string; jam_masuk: string; schedule_jam_masuk: string; toleransi_menit: number; status: string; durasi_telat: number; denda: number; catatan: string }[] = [];
    const staleAlphaIds: number[] = [];

    for (const emp of employees) {
      if (emp.tanggal_bergabung && dateFilter < emp.tanggal_bergabung) continue;
      if (emp.tanggal_keluar && dateFilter > emp.tanggal_keluar) continue;

      const override = overrideMap.get(emp.id);
      const empOffDays = offDayMap.get(emp.id);
      const isLibur = override === "libur" || (!override && empOffDays?.has(dow));
      const isMasukOverride = override === "masuk";
      const shouldBeLibur = isLibur && !isMasukOverride;

      const existing = existingRecs?.find((r) => r.employee_id === emp.id);

      if (existing) {
        const isNonRelevant = emp.status === "Tidak Aktif" || (emp.tanggal_keluar && dateFilter > emp.tanggal_keluar);
        if (
          isNonRelevant &&
          !existing.is_manual &&
          existing.status === "Alpha" &&
          (existing.catatan || "").startsWith(AUTO_NOTE_PREFIXES.ALPHA)
        ) {
          staleAlphaIds.push(existing.id);
          continue;
        }
        if (existingSet.has(emp.id)) continue;
      }

      const leave = leaveMap.get(emp.id);
      const primaryLeave = leave?.[0];

      if (primaryLeave) {
        alphaInserts.push({
          employee_id: emp.id,
          division_id: null,
          tanggal: dateFilter,
          jam_masuk: "00:00",
          schedule_jam_masuk: "00:00",
          toleransi_menit: 0,
          status: primaryLeave.jenis,
          durasi_telat: 0,
          denda: 0,
          catatan: AUTO_NOTES.CUTI(primaryLeave.jenis),
        });
      } else if (!shouldBeLibur) {
        const empPenalty = penalties[0];
        const dendaAlpha = computeDendaAlpha(empPenalty, DEFAULT_DENDA_ALPHA);
        alphaInserts.push({
          employee_id: emp.id,
          division_id: null,
          tanggal: dateFilter,
          jam_masuk: "00:00",
          schedule_jam_masuk: "00:00",
          toleransi_menit: 0,
          status: "Alpha",
          durasi_telat: 0,
          denda: dendaAlpha,
          catatan: AUTO_NOTES.ALPHA,
        });
      }
    }

    let changed = false;
    if (staleAlphaIds.length > 0) {
      await supabase.from("attendance_records").delete().in("id", staleAlphaIds);
      changed = true;
    }
    if (alphaInserts.length > 0) {
      await supabase.from("attendance_records").upsert(alphaInserts, {
        onConflict: "employee_id,tanggal",
        ignoreDuplicates: true,
      });
      changed = true;
    }
    if (changed) await reloadRecords();
  }, [dateFilter, employees, penalties, reloadRecords]);

  const staticDataReady = !staticLoading && employees.length > 0;
  useEffect(() => {
    if (!staticDataReady) return;
    autoGenerateLibur().then(() => autoGenerateAlpha());
    // dateFilter & staticDataReady adalah trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticDataReady, dateFilter]);
}
