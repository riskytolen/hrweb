"use client";

import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import RouteGuard from "@/components/RouteGuard";
import { localDateStr } from "./lib/attendance-helpers";
import { useAttendanceStaticData } from "./lib/hooks/use-attendance-static-data";
import { useAttendanceRecords } from "./lib/hooks/use-attendance-records";
import { useToast } from "./lib/hooks/use-toast";
import { useViewMode } from "./lib/hooks/use-attendance-filters";
import { useAttendanceTable } from "./lib/hooks/use-attendance-table";
import { useAttendanceAutoGen } from "./lib/hooks/use-attendance-autogen";
import { useAttendanceDelete } from "./lib/hooks/use-attendance-delete";
import { AttendancePageHeader } from "./components/attendance-page-header";
import { AttendanceModals } from "./components/attendance-modals";
import { CalendarView } from "./components/calendar-view";
import { SummaryView } from "./components/summary-view";
import { FineReportView } from "./components/fine-report-view";
import { ManualReportView } from "./components/manual-report-view";
import { AttendanceAnalysisView } from "./components/attendance-analysis-view";
import { AttendanceTable } from "./components/attendance-table";
import type { AttendanceFormModalHandle } from "./components/attendance-form-modal";
import type { OffDayModalHandle } from "./components/off-day-modal";
import type { HolidayDetailModalHandle } from "./components/holiday-detail-modal";
import type { DeleteConfirmHandle } from "./components/delete-confirm";
import type { AttendanceRow } from "./lib/attendance-types";

export default function AttendancePage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("attendance");
  const canInput = permLevel === "input" || permLevel === "edit";
  const canEdit = permLevel === "edit";
  const { viewMode, setViewMode } = useViewMode();

  const [dateFilter, setDateFilter] = useState(() => localDateStr());

  const {
    employees, divisions, schedules, penalties, offDays, overrides, publicHolidays,
    loading: staticLoading, reload: reloadStatic,
  } = useAttendanceStaticData();

  const { records, loading: recordsLoading, reload: reloadRecords } = useAttendanceRecords(dateFilter);
  const table = useAttendanceTable(records, dateFilter);

  useAttendanceAutoGen({
    dateFilter, employees, penalties, publicHolidays, reloadRecords, staticLoading,
  });

  const loading = staticLoading || recordsLoading;

  const formModalRef = useRef<AttendanceFormModalHandle>(null);
  const offDayModalRef = useRef<OffDayModalHandle>(null);
  const holidayDetailRef = useRef<HolidayDetailModalHandle>(null);
  const deleteConfirmRef = useRef<DeleteConfirmHandle>(null);

  const openAdd = useCallback(() => formModalRef.current?.openAdd(), []);
  const openEdit = useCallback(
    (row: AttendanceRow) => formModalRef.current?.openEdit(row),
    [],
  );
  const openOffDay = useCallback(() => offDayModalRef.current?.open(), []);

  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const handleDelete = useAttendanceDelete(records, reloadRecords, showToast);

  return (
    <RouteGuard permission="attendance">
      <div className="space-y-6 animate-fade-in">
        <AttendancePageHeader
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          canInput={canInput}
          onOpenOffDay={openOffDay}
          onAddAbsen={openAdd}
          toast={toast}
          onDismissToast={dismissToast}
        />

        {viewMode === "tabel" && (
          <AttendanceTable
            records={records}
            dateFilter={dateFilter}
            loading={loading}
            canEdit={canEdit}
            page={table.page}
            setPage={table.setPage}
            search={table.search}
            setSearch={table.setSearch}
            filterStatus={table.filterStatus}
            setFilterStatus={table.setFilterStatus}
            filtered={table.filtered}
            paged={table.paged}
            statusCounts={table.statusCounts}
            totalDenda={table.totalDenda}
            hasRecords={records.length > 0}
            exportMenu={table.exportMenu}
            onExportPDF={table.exportPDF}
            onExportCSV={table.exportCSV}
            onDateChange={setDateFilter}
            onEdit={openEdit}
            onDelete={(row) => deleteConfirmRef.current?.open({ id: row.id, nama: `${row.employeeNama} (${row.tanggal})` })}
          />
        )}

        {viewMode === "kalender" && (
          <CalendarView
            employees={employees}
            onClose={() => setViewMode("tabel")}
          />
        )}

        {viewMode === "ringkasan" && <SummaryView employees={employees} />}

        {viewMode === "denda" && <FineReportView employees={employees} canEdit={canEdit} showToast={showToast} />}

        {viewMode === "manual-report" && <ManualReportView employees={employees} />}

        {viewMode === "analisa" && <AttendanceAnalysisView employees={employees} />}

        <AttendanceModals
          formModalRef={formModalRef}
          offDayModalRef={offDayModalRef}
          holidayDetailRef={holidayDetailRef}
          deleteConfirmRef={deleteConfirmRef}
          onDelete={handleDelete}
          dateFilter={dateFilter}
          viewMode={viewMode}
          employees={employees}
          divisions={divisions}
          schedules={schedules}
          penalties={penalties}
          offDays={offDays}
          overrides={overrides}
          publicHolidays={publicHolidays}
          records={records}
          onFormSaved={async (tanggal) => {
            setDateFilter(tanggal);
            await reloadRecords();
          }}
          onOffDaySaved={async () => {
            await Promise.all([reloadStatic(), reloadRecords()]);
          }}
          onShowToast={showToast}
        />
      </div>
    </RouteGuard>
  );
}
