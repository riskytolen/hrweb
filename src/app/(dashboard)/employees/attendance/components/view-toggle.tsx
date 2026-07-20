"use client";

import { LayoutList, CalendarDays, BarChart3, AlertTriangle, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttendanceViewMode } from "../lib/hooks/use-attendance-filters";

type ViewToggleProps = {
  viewMode: AttendanceViewMode;
  onChange: (mode: AttendanceViewMode) => void;
};

const OPTIONS: { value: AttendanceViewMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "tabel", label: "Tabel", icon: LayoutList },
  { value: "kalender", label: "Kalender", icon: CalendarDays },
  { value: "ringkasan", label: "Ringkasan", icon: BarChart3 },
  { value: "denda", label: "Report Denda", icon: AlertTriangle },
  { value: "manual-report", label: "Report Manual", icon: UserCheck },
];

export function ViewToggle({ viewMode, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-1 bg-muted rounded-xl p-1 w-fit">
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const isActive = viewMode === opt.value;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              isActive ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="w-3.5 h-3.5" />{opt.label}
          </button>
        );
      })}
    </div>
  );
}
