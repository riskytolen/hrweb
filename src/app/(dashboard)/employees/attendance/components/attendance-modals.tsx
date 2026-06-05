"use client";

import type { RefObject } from "react";
import { AttendanceFormModal, type AttendanceFormModalHandle } from "./attendance-form-modal";
import { OffDayModal, type OffDayModalHandle } from "./off-day-modal";
import { HolidayDetailModal, type HolidayDetailModalHandle } from "./holiday-detail-modal";
import { DeleteConfirm, type DeleteConfirmHandle } from "./delete-confirm";
import type {
  EmployeeLite,
  DivisionLite,
  ScheduleLite,
  PenaltyLite,
  OffDayEntry,
  OverrideEntry,
  PublicHoliday,
  AttendanceRow,
} from "../lib/attendance-types";
import type { AttendanceViewMode } from "../lib/hooks/use-attendance-filters";

type DeleteItem = { id: number; nama: string };

type Props = {
  formModalRef: RefObject<AttendanceFormModalHandle | null>;
  offDayModalRef: RefObject<OffDayModalHandle | null>;
  holidayDetailRef: RefObject<HolidayDetailModalHandle | null>;
  deleteConfirmRef: RefObject<DeleteConfirmHandle | null>;
  onDelete: (item: DeleteItem) => Promise<void> | void;
  dateFilter: string;
  viewMode: AttendanceViewMode;
  employees: EmployeeLite[];
  divisions: DivisionLite[];
  schedules: ScheduleLite[];
  penalties: PenaltyLite[];
  offDays: OffDayEntry[];
  overrides: OverrideEntry[];
  publicHolidays: PublicHoliday[];
  records: AttendanceRow[];
  onFormSaved: (tanggal: string) => Promise<void>;
  onOffDaySaved: () => Promise<void>;
  onShowToast: (type: "success" | "error", title: string, message?: string) => void;
};

export function AttendanceModals({
  formModalRef,
  offDayModalRef,
  holidayDetailRef,
  deleteConfirmRef,
  onDelete,
  dateFilter,
  viewMode,
  employees,
  divisions,
  schedules,
  penalties,
  offDays,
  overrides,
  publicHolidays,
  records,
  onFormSaved,
  onOffDaySaved,
  onShowToast,
}: Props) {
  return (
    <>
      <AttendanceFormModal
        ref={formModalRef}
        dateFilter={dateFilter}
        employees={employees}
        divisions={divisions}
        schedules={schedules}
        penalties={penalties}
        offDays={offDays}
        overrides={overrides}
        records={records}
        viewMode={viewMode}
        onSaved={onFormSaved}
        onShowToast={onShowToast}
      />
      <DeleteConfirm ref={deleteConfirmRef} onConfirm={onDelete} />
      <OffDayModal
        ref={offDayModalRef}
        employees={employees}
        offDays={offDays}
        overrides={overrides}
        publicHolidays={publicHolidays}
        onShowToast={onShowToast}
        onSaved={onOffDaySaved}
        detailRef={holidayDetailRef}
      />
      <HolidayDetailModal ref={holidayDetailRef} employees={employees} />
    </>
  );
}
