"use client";

import { useState, useCallback, useMemo } from "react";

export type AttendanceViewMode = "tabel" | "kalender" | "ringkasan" | "denda" | "manual-report";

/**
 * Filter & pagination state untuk table view.
 * Reset page ke 1 saat search/filter/viewMode berubah.
 */
export function useTableFilters() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("Semua");

  const onSearchChange = useCallback((v: string) => {
    setSearch(v);
    setPage(1);
  }, []);

  const onFilterStatusChange = useCallback((s: string) => {
    setFilterStatus(s);
    setPage(1);
  }, []);

  const reset = useCallback(() => {
    setPage(1);
    setSearch("");
    setFilterStatus("Semua");
  }, []);

  return useMemo(
    () => ({
      page,
      setPage,
      search,
      setSearch: onSearchChange,
      filterStatus,
      setFilterStatus: onFilterStatusChange,
      reset,
    }),
    [page, search, filterStatus, onSearchChange, onFilterStatusChange, reset],
  );
}

/**
 * View mode state (table/calendar/summary).
 */
export function useViewMode() {
  const [viewMode, setViewMode] = useState<AttendanceViewMode>("tabel");
  return { viewMode, setViewMode };
}

/**
 * Calendar period state.
 * `calPeriodKey` format: "YYYY-MM"
 * `calSearch` untuk filter nama/divisi
 */
export function useCalendarFilters() {
  const [calSearch, setCalSearch] = useState("");
  return { calSearch, setCalSearch };
}
