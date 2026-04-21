"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function DatePicker({ value, onChange, placeholder = "Pilih tanggal", className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"days" | "months" | "years">("days");
  const ref = useRef<HTMLDivElement>(null);

  const parsed = value ? new Date(value) : null;
  const today = new Date();

  const [viewYear, setViewYear] = useState(parsed?.getFullYear() || today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() || today.getMonth());
  const [yearRangeStart, setYearRangeStart] = useState(Math.floor((parsed?.getFullYear() || today.getFullYear()) / 12) * 12);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setViewMode("days");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectDate = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onChange(`${viewYear}-${m}-${d}`);
    setOpen(false);
    setViewMode("days");
  };

  const selectMonth = (month: number) => {
    setViewMonth(month);
    setViewMode("days");
  };

  const selectYear = (year: number) => {
    setViewYear(year);
    setViewMode("months");
  };

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  const isToday = (day: number) =>
    today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;

  const isSelected = (day: number) =>
    parsed?.getDate() === day && parsed?.getMonth() === viewMonth && parsed?.getFullYear() === viewYear;

  const displayValue = parsed
    ? `${parsed.getDate()} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`
    : "";

  return (
    <div ref={ref} className="relative">
      {/* Input trigger */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setViewMode("days"); }}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-muted/30 text-sm outline-none text-left",
          "focus:border-primary focus:ring-2 focus:ring-primary/10",
          displayValue ? "text-foreground" : "text-muted-foreground/50",
          className
        )}
      >
        <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="flex-1 truncate">{displayValue || placeholder}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-card rounded-xl shadow-2xl border border-border p-3 w-[280px] animate-scale-in">

          {/* ── DAYS VIEW ── */}
          {viewMode === "days" && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <button type="button" onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ChevronLeft className="w-4 h-4" /></button>
                <button type="button" onClick={() => setViewMode("months")}
                  className="text-sm font-bold text-foreground hover:text-primary px-2 py-1 rounded-lg hover:bg-primary-light/50">
                  {MONTHS[viewMonth]} {viewYear}
                </button>
                <button type="button" onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ChevronRight className="w-4 h-4" /></button>
              </div>

              {/* Day names */}
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map((d) => (
                  <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => selectDate(day)}
                    className={cn(
                      "w-full aspect-square rounded-lg text-xs font-medium flex items-center justify-center relative",
                      isSelected(day)
                        ? "bg-primary text-white shadow-md shadow-primary/25"
                        : isToday(day)
                          ? "bg-primary/10 text-primary font-bold"
                          : "text-foreground hover:bg-muted"
                    )}
                  >
                    {day}
                    {isToday(day) && !isSelected(day) && (
                      <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                    )}
                  </button>
                ))}
              </div>

              {/* Today shortcut */}
              <div className="mt-2 pt-2 border-t border-border flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    const m = String(today.getMonth() + 1).padStart(2, "0");
                    const d = String(today.getDate()).padStart(2, "0");
                    onChange(`${today.getFullYear()}-${m}-${d}`);
                    setViewYear(today.getFullYear());
                    setViewMonth(today.getMonth());
                    setOpen(false);
                  }}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Hari ini
                </button>
              </div>
            </>
          )}

          {/* ── MONTHS VIEW ── */}
          {viewMode === "months" && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setViewYear(viewYear - 1)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ChevronLeft className="w-4 h-4" /></button>
                <button type="button" onClick={() => { setYearRangeStart(Math.floor(viewYear / 12) * 12); setViewMode("years"); }}
                  className="text-sm font-bold text-foreground hover:text-primary px-2 py-1 rounded-lg hover:bg-primary-light/50">
                  {viewYear}
                </button>
                <button type="button" onClick={() => setViewYear(viewYear + 1)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ChevronRight className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MONTHS.map((m, i) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => selectMonth(i)}
                    className={cn(
                      "py-2 rounded-lg text-xs font-medium",
                      parsed && parsed.getMonth() === i && parsed.getFullYear() === viewYear
                        ? "bg-primary text-white shadow-md shadow-primary/25"
                        : today.getMonth() === i && today.getFullYear() === viewYear
                          ? "bg-primary/10 text-primary font-bold"
                          : "text-foreground hover:bg-muted"
                    )}
                  >
                    {m.slice(0, 3)}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── YEARS VIEW ── */}
          {viewMode === "years" && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setYearRangeStart(yearRangeStart - 12)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ChevronsLeft className="w-4 h-4" /></button>
                <span className="text-sm font-bold text-foreground">
                  {yearRangeStart} - {yearRangeStart + 11}
                </span>
                <button type="button" onClick={() => setYearRangeStart(yearRangeStart + 12)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><ChevronsRight className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 12 }, (_, i) => yearRangeStart + i).map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => selectYear(y)}
                    className={cn(
                      "py-2 rounded-lg text-xs font-medium",
                      parsed && parsed.getFullYear() === y
                        ? "bg-primary text-white shadow-md shadow-primary/25"
                        : today.getFullYear() === y
                          ? "bg-primary/10 text-primary font-bold"
                          : "text-foreground hover:bg-muted"
                    )}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
