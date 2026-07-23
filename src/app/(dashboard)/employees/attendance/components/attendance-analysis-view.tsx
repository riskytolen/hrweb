"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, Users, Clock, TrendingUp, TrendingDown, AlertTriangle,
  BarChart3, PieChart, Activity, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useAttendanceAnalysis } from "../lib/hooks/use-attendance-analysis";
import type { EmployeeLite } from "../lib/attendance-types";

const STATUS_COLORS: Record<string, string> = {
  Hadir: "#22c55e",
  Terlambat: "#eab308",
  Izin: "#3b82f6",
  Sakit: "#a855f7",
  Alpha: "#ef4444",
  Libur: "#6b7280",
  Cuti: "#06b6d4",
};

type AnalysisViewProps = {
  employees: EmployeeLite[];
};

function pctStr(val: number, total: number): string {
  if (total === 0) return "0%";
  return ((val / total) * 100).toFixed(1) + "%";
}

function deltaStr(curr: number, prev: number): { text: string; cls: string } {
  if (prev === 0) return { text: curr > 0 ? "+" + curr : "0", cls: curr > 0 ? "text-success" : "text-muted-foreground" };
  const diff = curr - prev;
  const pct = ((diff / prev) * 100).toFixed(1);
  const sign = diff > 0 ? "+" : "";
  return {
    text: `${sign}${diff} (${sign}${pct}%)`,
    cls: diff > 0 ? "text-success" : diff < 0 ? "text-danger" : "text-muted-foreground",
  };
}

function DeltaBadge({ curr, prev }: { curr: number; prev: number }) {
  const d = deltaStr(curr, prev);
  if (curr === prev) return null;
  return (
    <span className={cn("text-[10px] font-semibold", d.cls)}>
      {d.text}
    </span>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, deltaCurr, deltaPrev, iconBg,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  deltaCurr: number;
  deltaPrev: number;
  iconBg: string;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", iconBg)}>
          <Icon className="w-4.5 h-4.5 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <div className="flex items-center gap-2 mt-1">
        <p className="text-[10px] text-muted-foreground">{sub}</p>
        <DeltaBadge curr={deltaCurr} prev={deltaPrev} />
      </div>
    </div>
  );
}

export function AttendanceAnalysisView({ employees }: AnalysisViewProps) {
  const {
    loading, periodKey, setPeriodKey, currPeriod, global, globalPrev,
    divisions, individuals, dailyTrend, divisionList,
  } = useAttendanceAnalysis(employees);

  const [divisionFilter, setDivisionFilter] = useState("semua");
  const [scope, setScope] = useState<"global" | "division" | "individual">("global");
  const [search, setSearch] = useState("");

  const totalCurr = global.total;
  const totalPrev = globalPrev.total;

  const hadirEfektifCurr = totalCurr > 0 ? ((global.hadir + global.terlambat) / totalCurr * 100) : 0;
  const hadirEfektifPrev = totalPrev > 0 ? ((globalPrev.hadir + globalPrev.terlambat) / totalPrev * 100) : 0;
  const alphaRateCurr = totalCurr > 0 ? (global.alpha / totalCurr * 100) : 0;
  const alphaRatePrev = totalPrev > 0 ? (globalPrev.alpha / totalPrev * 100) : 0;
  const telatRateCurr = totalCurr > 0 ? (global.terlambat / totalCurr * 100) : 0;
  const telatRatePrev = totalPrev > 0 ? (globalPrev.terlambat / totalPrev * 100) : 0;

  const pieData = useMemo(
    () => Object.entries(STATUS_COLORS)
      .filter(([key]) => (global as Record<string, number>)[key.toLowerCase()] > 0)
      .map(([key, color]) => ({
        name: key,
        value: (global as Record<string, number>)[key.toLowerCase()] || 0,
        color,
      })),
    [global],
  );

  const filteredDivisions = useMemo(
    () => divisionFilter === "semua" ? divisions : divisions.filter((d) => d.divisionId === Number(divisionFilter)),
    [divisionFilter, divisions],
  );

  const divisionChartData = useMemo(
    () => filteredDivisions.map((d) => {
      const total = d.total;
      const hadirPct = total > 0 ? ((d.hadir + d.terlambat) / total * 100).toFixed(1) : "0";
      const alphaPct = total > 0 ? (d.alpha / total * 100).toFixed(1) : "0";
      return {
        name: d.divisionNama,
        "Hadir Efektif": Number(hadirPct),
        "Alpha Rate": Number(alphaPct),
        fill: d.divisionColor,
      };
    }),
    [filteredDivisions],
  );

  const filteredIndividuals = useMemo(() => {
    let list = individuals;
    if (divisionFilter !== "semua") list = list.filter((i) => i.divisionNama === divisions.find((d) => d.divisionId === Number(divisionFilter))?.divisionNama);
    if (search) list = list.filter((i) => i.nama.toLowerCase().includes(search.toLowerCase()));
    return list.sort((a, b) => (b.alpha + b.terlambat) - (a.alpha + a.terlambat));
  }, [individuals, divisionFilter, divisions, search]);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border border-border p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
            <button
              onClick={() => setScope("global")}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                scope === "global" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}
            ><Activity className="w-3 h-3" />Global</button>
            <button
              onClick={() => setScope("division")}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                scope === "division" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}
            ><BarChart3 className="w-3 h-3" />Divisi</button>
            <button
              onClick={() => setScope("individual")}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all",
                scope === "individual" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}
            ><Users className="w-3 h-3" />Perorangan</button>
          </div>

          <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 flex-shrink-0">
            <button onClick={() => setPeriodKey((k) => {
              const [y, m] = k.split("-").map(Number);
              const dt = new Date(y, m - 2, 1);
              return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
            })} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="px-2.5 py-1 text-center min-w-[180px]">
              <p className="text-[11px] font-bold text-foreground">{currPeriod.label}</p>
            </div>
            <button onClick={() => setPeriodKey((k) => {
              const [y, m] = k.split("-").map(Number);
              const dt = new Date(y, m, 1);
              return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
            })} className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 bg-muted rounded-xl px-2.5 py-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground">Divisi:</span>
            <select value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)}
              className="bg-transparent text-xs outline-none text-foreground font-medium">
              <option value="semua">Semua Divisi</option>
              {divisionList.map((d) => (
                <option key={d.id} value={d.id}>{d.nama}</option>
              ))}
            </select>
          </div>

          {scope === "individual" && (
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input type="text" placeholder="Cari pegawai..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Memuat data analisa...</div>
      ) : totalCurr === 0 ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          Tidak ada data absensi di periode ini
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard icon={TrendingUp} label="Kehadiran Efektif"
              value={hadirEfektifCurr.toFixed(1) + "%"}
              sub={`${global.hadir + global.terlambat}/${totalCurr} record`}
              deltaCurr={Math.round(hadirEfektifCurr)} deltaPrev={Math.round(hadirEfektifPrev)}
              iconBg="bg-gradient-to-br from-success to-success/70" />
            <KpiCard icon={AlertTriangle} label="Alpha Rate"
              value={alphaRateCurr.toFixed(1) + "%"}
              sub={`${global.alpha} alpha dari ${totalCurr} record`}
              deltaCurr={Math.round(alphaRateCurr)} deltaPrev={Math.round(alphaRatePrev)}
              iconBg="bg-gradient-to-br from-danger to-danger/70" />
            <KpiCard icon={Clock} label="Terlambat Rate"
              value={telatRateCurr.toFixed(1) + "%"}
              sub={`${global.terlambat} telat dari ${totalCurr} record`}
              deltaCurr={Math.round(telatRateCurr)} deltaPrev={Math.round(telatRatePrev)}
              iconBg="bg-gradient-to-br from-warning to-warning/70" />
            <KpiCard icon={BarChart3} label="Total Record"
              value={String(totalCurr)}
              sub={`${individuals.length} pegawai`}
              deltaCurr={totalCurr} deltaPrev={totalPrev}
              iconBg="bg-gradient-to-br from-primary to-primary/70" />
          </div>

          {scope === "global" && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-card rounded-2xl border border-border p-4">
                  <h3 className="text-xs font-bold text-foreground mb-3 flex items-center gap-2">
                    <PieChart className="w-3.5 h-3.5 text-primary" />Distribusi Status Absensi
                  </h3>
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={280}>
                      <RechartsPie>
                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                          label={({ name, value }) => `${name}: ${value}`}>
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </RechartsPie>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-3">
                    {pieData.map((s) => (
                      <div key={s.name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="font-medium">{s.name}:</span>
                        <span>{pctStr(s.value, totalCurr)}</span>
                        <span className="text-muted-foreground/60">({s.value})</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-card rounded-2xl border border-border p-4">
                  <h3 className="text-xs font-bold text-foreground mb-3 flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-primary" />Tren Harian
                  </h3>
                  {dailyTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={dailyTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {Object.entries(STATUS_COLORS).map(([key, color]) => (
                          <Line key={key} type="monotone" dataKey={key.toLowerCase()} name={key}
                            stroke={color} strokeWidth={1.5} dot={false} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-[280px] text-xs text-muted-foreground">
                      Belum ada data tren
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-card rounded-2xl border border-border p-4">
                <h3 className="text-xs font-bold text-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5 text-primary" />Perbandingan per Divisi
                </h3>
                {divisionChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={divisionChartData} layout="vertical" margin={{ left: 100, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 9 }} domain={[0, 100]} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={90} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="Hadir Efektif" fill="#22c55e" radius={[0, 4, 4, 0]} barSize={16} />
                      <Bar dataKey="Alpha Rate" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-xs text-muted-foreground">
                    Tidak ada data divisi
                  </div>
                )}
              </div>
            </>
          )}

          {scope === "division" && (
            <div className="space-y-3">
              {filteredDivisions.map((d) => {
                const total = d.total;
                const hadirPct = total > 0 ? ((d.hadir + d.terlambat) / total * 100).toFixed(1) : "0";
                const alphaPct = total > 0 ? (d.alpha / total * 100).toFixed(1) : "0";
                const telatPct = total > 0 ? (d.terlambat / total * 100).toFixed(1) : "0";
                return (
                  <div key={d.divisionId} className="bg-card rounded-2xl border border-border p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: d.divisionColor }} />
                        <h4 className="text-sm font-bold text-foreground">{d.divisionNama}</h4>
                        <span className="text-[10px] text-muted-foreground">({total} record)</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-muted/50 rounded-xl p-3 text-center">
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase">Hadir Efektif</p>
                        <p className="text-lg font-bold text-success">{hadirPct}%</p>
                        <p className="text-[9px] text-muted-foreground">{d.hadir + d.terlambat}/{total}</p>
                      </div>
                      <div className="bg-muted/50 rounded-xl p-3 text-center">
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase">Alpha</p>
                        <p className="text-lg font-bold text-danger">{alphaPct}%</p>
                        <p className="text-[9px] text-muted-foreground">{d.alpha}/{total}</p>
                      </div>
                      <div className="bg-muted/50 rounded-xl p-3 text-center">
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase">Terlambat</p>
                        <p className="text-lg font-bold text-warning">{telatPct}%</p>
                        <p className="text-[9px] text-muted-foreground">{d.terlambat}/{total}</p>
                      </div>
                      <div className="bg-muted/50 rounded-xl p-3 text-center">
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase">Izin/Sakit/Cuti</p>
                        <p className="text-lg font-bold text-blue-500">{total > 0 ? ((d.izin + d.sakit + d.cuti) / total * 100).toFixed(1) : "0"}%</p>
                        <p className="text-[9px] text-muted-foreground">{d.izin + d.sakit + d.cuti}/{total}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {scope === "individual" && (
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Divisi</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Hadir Efektif</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Telat</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Izin</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Sakit</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Alpha</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Cuti</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Libur</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Total</th>
                      <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Alpha Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {filteredIndividuals.length === 0 ? (
                      <tr><td colSpan={12} className="text-center py-12 text-sm text-muted-foreground">Tidak ada pegawai</td></tr>
                    ) : filteredIndividuals.slice(0, 50).map((row, idx) => {
                      const hadirPct = row.total > 0 ? ((row.hadir + row.terlambat) / row.total * 100) : 0;
                      const alphaPct = row.total > 0 ? (row.alpha / row.total * 100) : 0;
                      return (
                        <tr key={row.employee_id} className="hover:bg-muted/30">
                          <td className="px-5 py-3 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-5 py-3">
                            <p className="text-sm font-semibold text-foreground">{row.nama}</p>
                          </td>
                          <td className="px-5 py-3">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md"
                              style={{ backgroundColor: `${row.divisionColor}15`, color: row.divisionColor }}>
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: row.divisionColor }} />
                              {row.divisionNama}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center text-sm font-semibold text-success">{hadirPct.toFixed(1)}%</td>
                          <td className="px-5 py-3 text-center text-sm font-semibold text-warning">{row.terlambat}</td>
                          <td className="px-5 py-3 text-center text-sm font-semibold text-blue-500">{row.izin}</td>
                          <td className="px-5 py-3 text-center text-sm font-semibold text-danger">{row.sakit}</td>
                          <td className="px-5 py-3 text-center text-sm font-bold text-danger">{row.alpha}</td>
                          <td className="px-5 py-3 text-center text-sm font-semibold text-cyan-500">{row.cuti}</td>
                          <td className="px-5 py-3 text-center text-sm font-semibold text-muted-foreground">{row.libur}</td>
                          <td className="px-5 py-3 text-center text-sm font-bold text-foreground">{row.total}</td>
                          <td className="px-5 py-3 text-center">
                            <span className={cn("text-xs font-bold px-2 py-1 rounded-md",
                              alphaPct > 10 ? "bg-danger/10 text-danger" : alphaPct > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
                              {alphaPct.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredIndividuals.length > 50 && (
                <div className="px-5 py-3 text-center text-[10px] text-muted-foreground border-t border-border">
                  Menampilkan 50 pegawai teratas dari {filteredIndividuals.length}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
