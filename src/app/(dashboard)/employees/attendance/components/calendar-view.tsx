"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import Portal from "@/components/ui/Portal";
import { cn } from "@/lib/utils";
import { getCalPeriod, getSummaryCurrentPeriodKey, isEmployeeActiveInPeriod, localDateStr } from "../lib/attendance-helpers";
import { STATUS_OPTIONS } from "../lib/attendance-status";
import { useCalendarData } from "../lib/hooks/use-calendar-data";
import type { EmployeeLite } from "../lib/attendance-types";

const DOW_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

type CalendarViewProps = {
  employees: EmployeeLite[];
  onClose: () => void;
};

function shiftMonth(periodKey: string, dir: -1 | 1): string {
  const [y, m] = periodKey.split("-").map(Number);
  const next = new Date(y, m - 1 + dir, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export function CalendarView({ employees, onClose }: CalendarViewProps) {
  const [periodKey, setPeriodKey] = useState(getSummaryCurrentPeriodKey);
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const { records, loading } = useCalendarData(periodKey);

  const period = useMemo(() => getCalPeriod(periodKey), [periodKey]);

  const dates = useMemo(() => {
    const [sy, sm, sd] = period.start.split("-").map(Number);
    const [ey, em, ed] = period.end.split("-").map(Number);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    const out: { dateStr: string; day: number; dow: number; monthLabel: string }[] = [];
    for (let ms = startMs; ms <= endMs; ms += 86400000) {
      const dt = new Date(ms);
      out.push({
        dateStr: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
        day: dt.getUTCDate(),
        dow: dt.getUTCDay(),
        monthLabel: new Date(dt.getUTCFullYear(), dt.getUTCMonth()).toLocaleDateString("id-ID", { month: "short" }),
      });
    }
    return out;
  }, [period]);

  const emps = useMemo(
    () => employees
      .filter((e) => isEmployeeActiveInPeriod(period, e))
      .map((e) => ({ id: e.id, nama: e.nama }))
      .filter((e) => !search || e.nama.toLowerCase().includes(search.toLowerCase())),
    [employees, period, search],
  );

  const visibleEmployeeIds = useMemo(() => new Set(emps.map((e) => e.id)), [emps]);

  const visibleRecords = useMemo(
    () => records.filter((r) => visibleEmployeeIds.has(r.employee_id)),
    [records, visibleEmployeeIds],
  );

  const statusByEmp = useMemo(() => {
    const m = new Map<string, Map<string, { status: string; color: string; is_manual: boolean; alasan_manual: string | null }>>();
    visibleRecords.forEach((r) => {
      if (!m.has(r.employee_id)) m.set(r.employee_id, new Map());
      const sc = STATUS_OPTIONS.find((s) => s.value === r.status);
      m.get(r.employee_id)!.set(r.tanggal, { status: r.status, color: sc?.color || "#6b7280", is_manual: r.is_manual, alasan_manual: r.alasan_manual });
    });
    return m;
  }, [visibleRecords]);

  const todayStr = localDateStr();
  const statusBreakdown = useMemo(() => {
    const m = new Map<string, { count: number; color: string }>();
    visibleRecords.forEach((r) => {
      const sc = STATUS_OPTIONS.find((s) => s.value === r.status);
      const existing = m.get(r.status);
      if (existing) existing.count++;
      else m.set(r.status, { count: 1, color: sc?.color || "#6b7280" });
    });
    return m;
  }, [visibleRecords]);

  const manualCount = useMemo(
    () => visibleRecords.filter((r) => r.is_manual).length,
    [visibleRecords],
  );

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-gradient-to-r from-card via-card to-primary/[0.03]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20 flex-shrink-0">
              <CalendarDays className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-foreground">Kalender Absensi</h2>
              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                <span><strong className="text-foreground">{emps.length}</strong> pegawai</span>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span><strong className="text-foreground">{visibleRecords.length}</strong> entri</span>
                {manualCount > 0 && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                      <strong className="text-warning">{manualCount}</strong> manual
                    </span>
                  </>
                )}
                {Array.from(statusBreakdown.entries()).map(([nama, { count, color }]) => (
                  <span key={nama} className="inline-flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                    <strong style={{ color }}>{count}</strong> {nama.toLowerCase()}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 w-56">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input type="text" placeholder="Cari pegawai..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
            </div>
            <div className="flex items-center bg-muted rounded-xl p-1">
              <button onClick={() => setPeriodKey((k) => shiftMonth(k, -1))} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-xs font-bold text-foreground px-3 min-w-[220px] text-center">{period.label}</span>
              <button onClick={() => setPeriodKey((k) => shiftMonth(k, 1))} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <button onClick={onClose} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />Tutup
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-background">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Memuat data...</div>
          ) : emps.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Tidak ada pegawai sesuai pencarian.</div>
          ) : (
            <table className="border-collapse w-max min-w-full">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 bg-card border-b-2 border-r-2 border-border px-4 py-3 text-left min-w-[180px] shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)]">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Pegawai</span>
                  </th>
                  {dates.map((d, i) => {
                    const isWeekend = d.dow === 0 || d.dow === 6;
                    const isToday = d.dateStr === todayStr;
                    const isNewMonth = i === 0 || d.day === 1;
                    return (
                      <th key={d.dateStr} className={cn(
                        "border-b-2 border-r border-border px-1 py-2 text-center min-w-[44px]",
                        isNewMonth && "border-l-2 border-l-primary/30",
                        isToday ? "bg-primary text-white" : isWeekend ? "bg-danger-light text-danger" : "bg-card text-muted-foreground"
                      )}>
                        {isNewMonth && (
                          <div className={cn("text-[8px] font-bold uppercase tracking-wider mb-0.5", isToday ? "text-white/70" : "text-primary/60")}>
                            {d.monthLabel}
                          </div>
                        )}
                        <div className="text-xs font-bold">{d.day}</div>
                        <div className={cn("text-[9px] font-normal mt-0.5", isToday ? "text-white/80" : "")}>
                          {DOW_LABELS[d.dow]}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {emps.map((emp, idx) => {
                  const empMap = statusByEmp.get(emp.id);
                  const isOdd = idx % 2 === 1;
                  return (
                    <tr key={emp.id} className="group">
                      <td className={cn("sticky left-0 z-10 px-4 py-2.5 text-xs font-semibold text-foreground border-r-2 border-b border-border truncate max-w-[180px] shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)] group-hover:brightness-95",
                        isOdd ? "bg-muted" : "bg-card")}>
                        {emp.nama}
                      </td>
                      {dates.map((d) => {
                        const entry = empMap?.get(d.dateStr);
                        const isWeekend = d.dow === 0 || d.dow === 6;
                        const isToday = d.dateStr === todayStr;
                        const isNewMonth = d.day === 1;
                        return (
                          <td key={d.dateStr} className={cn("border-b border-r border-border px-1 py-2 text-center align-middle",
                            isNewMonth && "border-l-2 border-l-primary/30",
                            isToday ? "bg-primary-light" : isWeekend ? "bg-danger-light" : isOdd ? "bg-muted" : "bg-card",
                            "group-hover:brightness-95")}>
                            {entry ? (
                              <span className="relative inline-flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold text-white"
                                style={{ backgroundColor: entry.color }}
                                title={`${emp.nama} — ${entry.status}${entry.is_manual ? ` (Manual${entry.alasan_manual ? `: ${entry.alasan_manual}` : ""})` : ""} (${d.dateStr})`}>
                                {entry.status.charAt(0)}
                                {entry.is_manual && (
                                  <span className="absolute -top-1 -right-1 w-3 h-3 flex items-center justify-center rounded-full bg-warning text-white text-[7px] font-bold leading-none shadow-sm">
                                    M
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="inline-block w-7 h-7 rounded-md text-[10px] text-muted-foreground/30 leading-7">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-4 px-5 py-2.5 border-t border-border bg-card flex-wrap">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Legenda:</span>
          {STATUS_OPTIONS.map((s) => (
            <div key={s.value} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md text-[9px] font-bold text-white" style={{ backgroundColor: s.color }}>{s.label.charAt(0)}</span>
              <span>{s.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="relative inline-flex items-center justify-center w-5 h-5 rounded-md text-[9px] font-bold text-white bg-gray-500">
              S
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 flex items-center justify-center rounded-full bg-warning text-white text-[6px] font-bold leading-none shadow-sm">M</span>
            </span>
            <span>= Input Manual Admin</span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
