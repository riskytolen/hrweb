"use client";

import { ClipboardCheck, Plus, CalendarOff } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { ToastUI } from "./toast-ui";
import { ViewToggle } from "./view-toggle";
import { ExportMenuButton } from "./export-menu-button";
import type { AttendanceViewMode } from "../lib/hooks/use-attendance-filters";
import type { ToastState } from "../lib/hooks/use-toast";

type ExportMenuState = {
  open: boolean;
  ref: React.RefObject<HTMLDivElement | null>;
  toggle: () => void;
};

type Props = {
  viewMode: AttendanceViewMode;
  onViewModeChange: (mode: AttendanceViewMode) => void;
  canInput: boolean;
  hasRecords: boolean;
  exportMenu: ExportMenuState;
  onExportPDF: () => void;
  onExportCSV: () => void;
  onOpenOffDay: () => void;
  onAddAbsen: () => void;
  toast: ToastState;
  onDismissToast: () => void;
};

export function AttendancePageHeader({
  viewMode,
  onViewModeChange,
  canInput,
  hasRecords,
  exportMenu,
  onExportPDF,
  onExportCSV,
  onOpenOffDay,
  onAddAbsen,
  toast,
  onDismissToast,
}: Props) {
  return (
    <>
      <PageHeader
        title="Absensi Pegawai"
        description="Pantau kehadiran harian pegawai"
        icon={ClipboardCheck}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon={CalendarOff} onClick={onOpenOffDay}>Atur Libur</Button>
            <ExportMenuButton
              menuRef={exportMenu.ref}
              open={exportMenu.open}
              onToggle={exportMenu.toggle}
              onExportPDF={onExportPDF}
              onExportCSV={onExportCSV}
              disabled={!hasRecords}
            />
            {canInput && <Button icon={Plus} size="sm" onClick={onAddAbsen}>Input Absen</Button>}
          </div>
        }
      />
      <ToastUI toast={toast} onDismiss={onDismissToast} />
      <ViewToggle viewMode={viewMode} onChange={onViewModeChange} />
    </>
  );
}
