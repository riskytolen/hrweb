"use client";

import { useCallback, useMemo } from "react";
import { PAGE_SIZE } from "../attendance-constants";
import { NO_JAM_STATUSES, STATUS_OPTIONS } from "../attendance-status";
import { useTableFilters } from "./use-attendance-filters";
import { useDropdown } from "./use-click-outside";
import { formatCurrency } from "@/lib/utils";
import type { AttendanceRow } from "../attendance-types";

/**
 * State, derived data, dan export logic untuk AttendanceTable view.
 * Centralized di hook ini supaya page.tsx tidak perlu tahu detail filter/sort/export.
 *
 * @param records Raw attendance records (sudah di-load per tanggal)
 * @param dateFilter Tanggal aktif (untuk filename export + label tanggal)
 */
export function useAttendanceTable(records: AttendanceRow[], dateFilter: string) {
  const filters = useTableFilters();
  const exportMenu = useDropdown();

  const filtered = useMemo(() => {
    const q = filters.search.toLowerCase();
    return records.filter((r) => {
      const matchSearch = (r.employeeNama || "").toLowerCase().includes(q) || (r.divisionNama || "").toLowerCase().includes(q);
      const matchStatus = filters.filterStatus === "Semua" || r.status === filters.filterStatus;
      return matchSearch && matchStatus;
    });
  }, [records, filters.search, filters.filterStatus]);

  const paged = useMemo(
    () => filtered.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE),
    [filtered, filters.page]
  );

  const statusCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = { Hadir: 0, Terlambat: 0, Izin: 0, Sakit: 0, Alpha: 0, Libur: 0, Cuti: 0 };
    records.forEach((r) => { if (r.status in counts) counts[r.status]++; });
    return counts;
  }, [records]);

  const totalDenda = useMemo(
    () => records.reduce((s, r) => s + r.denda, 0),
    [records]
  );

  const exportCSV = useCallback(() => {
    const headers = ["Tanggal", "Pegawai", "Divisi", "Jam Masuk", "Jadwal", "Status", "Telat (menit)", "Denda", "Catatan"];
    const csvRows = [headers.join(",")];
    filtered.forEach((r) => {
      const showJam = !NO_JAM_STATUSES.includes(r.status);
      csvRows.push([
        r.tanggal, `"${r.employeeNama}"`, `"${r.divisionNama}"`,
        showJam ? r.jam_masuk.slice(0, 5) : "-", showJam ? r.schedule_jam_masuk.slice(0, 5) : "-", r.status,
        r.durasi_telat, r.denda, `"${r.catatan || ""}"`,
      ].join(","));
    });
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Absensi_${dateFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    exportMenu.close();
  }, [filtered, dateFilter, exportMenu]);

  const exportPDF = useCallback(async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Absensi Pegawai", pw / 2, 15, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Tanggal: ${dateFilter}`, pw / 2, 21, { align: "center" });
    const tableData = filtered.map((r, i) => {
      const showJam = !NO_JAM_STATUSES.includes(r.status);
      return [
        i + 1, r.employeeNama || "-", r.divisionNama || "-",
        showJam ? r.jam_masuk.slice(0, 5) : "-", showJam ? r.schedule_jam_masuk.slice(0, 5) : "-",
        r.status, r.durasi_telat > 0 ? `${r.durasi_telat} mnt` : "-",
        r.denda > 0 ? formatCurrency(r.denda) : "-", r.catatan || "-",
      ];
    });
    autoTable(doc, {
      startY: 28,
      head: [["#", "Pegawai", "Divisi", "Masuk", "Jadwal", "Status", "Telat", "Denda", "Catatan"]],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: "bold", halign: "center" },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { halign: "center", cellWidth: 8 }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center" }, 6: { halign: "center" }, 7: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });
    doc.save(`Absensi_${dateFilter}.pdf`);
    exportMenu.close();
  }, [filtered, dateFilter, exportMenu]);

  return {
    ...filters,
    filtered,
    paged,
    statusCounts,
    totalDenda,
    exportMenu,
    exportCSV,
    exportPDF,
    statusOptions: STATUS_OPTIONS,
  };
}
