"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Banknote, TrendingUp, Clock, AlertTriangle, Search, RefreshCw, Check, CalendarDays, Users, History, Loader2, CircleCheckBig, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import { SkeletonTable } from "@/components/ui/Skeleton";
import RouteGuard from "@/components/RouteGuard";
import { useAuth } from "@/components/AuthProvider";
import { supabase, type DbGapokSetting } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { daysUntilGapok, summarizeGapokSchedule } from "@/lib/gapok";
import { logAudit } from "@/lib/audit";

type GapokEventRow = {
  id: number;
  employee_id: string;
  jabatan_id: number | null;
  milestone_no: number;
  due_date: string;
  status: "Scheduled" | "Applied" | "Skipped" | "Cancelled";
  amount: number;
  before_gapok: number | null;
  after_gapok: number | null;
  applied_at: string | null;
  source: string | null;
  pegawai?: { id: string; nama: string; tanggal_bergabung: string | null; gaji_pokok: number; jabatan_id: number | null; jabatan?: { nama: string } | null } | null;
};

const PAGE_SIZE = 10;
const SUPABASE_PAGE_SIZE = 1000;

async function fetchGapokEvents(status: "Scheduled" | "Applied"): Promise<GapokEventRow[]> {
  const rows: GapokEventRow[] = [];
  const orderColumn = status === "Scheduled" ? "due_date" : "applied_at";
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("gapok_increment_events")
      .select("*, pegawai:employee_id(id, nama, tanggal_bergabung, gaji_pokok, jabatan_id, jabatan:jabatan_id(nama))")
      .eq("status", status)
      .order(orderColumn, { ascending: status === "Scheduled" })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as GapokEventRow[]));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

function formatDays(d: number): string {
  if (d === 0) return "Hari ini";
  if (d === 1) return "Besok";
  if (d > 0) return `${d} hari lagi`;
  if (d === -1) return "Terlambat 1 hari";
  return `Terlambat ${Math.abs(d)} hari`;
}

export default function GapokIncrementsPage() {
  const { getPermissionLevel } = useAuth();
  const permLevel = getPermissionLevel("payroll");
  const canEdit = permLevel === "edit";

  const [activeTab, setActiveTab] = useState<"scheduled" | "history">("scheduled");
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<DbGapokSetting | null>(null);
  const [events, setEvents] = useState<GapokEventRow[]>([]);
  const [history, setHistory] = useState<GapokEventRow[]>([]);
  const [search, setSearch] = useState("");
  const [jabatanFilter, setJabatanFilter] = useState<"semua" | "Driver" | "Helper">("semua");
  const [statusFilter, setStatusFilter] = useState<"semua" | "overdue" | "upcoming">("semua");
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });

  const showToast = (type: "success" | "error", title: string, message: string) => {
    setToast({ show: true, title, message, type });
    setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 4000);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, scheduledRows, historyRows] = await Promise.all([
        supabase.from("gapok_settings").select("*").eq("id", 1).maybeSingle(),
        fetchGapokEvents("Scheduled"),
        fetchGapokEvents("Applied"),
      ]);
      if (sRes.error) throw sRes.error;
      if (sRes.data) setSettings(sRes.data as DbGapokSetting);
      setEvents(scheduledRows);
      setHistory(historyRows);
    } catch (error) {
      showToast("error", "Gagal Memuat", error instanceof Error ? error.message : "Data kenaikan gapok tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const metrics = useMemo(() => {
    const summary = summarizeGapokSchedule(events, settings?.notification_days ?? 90);
    return { overdue: summary.overdue, dueToday: summary.dueToday, in90: summary.upcoming, total: events.length };
  }, [events, settings]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return events.filter((e) => {
      const jab = e.pegawai?.jabatan?.nama || (e.jabatan_id === settings?.driver_jabatan_id ? "Driver" : e.jabatan_id === settings?.helper_jabatan_id ? "Helper" : "-");
      if (jabatanFilter !== "semua" && jab !== jabatanFilter) return false;
      if (statusFilter === "overdue" && daysUntilGapok(e.due_date) > 0) return false;
      if (statusFilter === "upcoming" && daysUntilGapok(e.due_date) <= 0) return false;
      if (q) {
        const hay = `${e.employee_id} ${e.pegawai?.nama || ""} ${jab}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, search, jabatanFilter, statusFilter, settings]);

  const filteredHistory = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return history;
    return history.filter((h) => `${h.employee_id} ${h.pegawai?.nama || ""}`.toLowerCase().includes(q));
  }, [history, search]);

  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);
  const pagedHistory = useMemo(() => filteredHistory.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE), [filteredHistory, historyPage]);

  const handleProcessDue = async () => {
    if (!canEdit) return;
    setProcessing(true);
    const { data, error } = await supabase.rpc("process_due_gapok_increments", { p_limit: 100 });
    setProcessing(false);
    if (error) {
      showToast("error", "Gagal Memproses", error.message);
      return;
    }
    const count = (data as number) ?? 0;
    if (count > 0) {
      await logAudit({ supabase, action: "update", entityType: "gapok_increment_events", entityLabel: `Proses gapok ${count} pegawai`, newData: { processed: count, source: "manual" } });
      showToast("success", "Berhasil Diproses", `${count} kenaikan gapok diterapkan. Jadwal berikutnya otomatis dibuat.`);
    } else {
      showToast("success", "Tidak Ada Yang Jatuh Tempo", "Tidak ada pegawai yang jadwalnya sudah lewat hari ini.");
    }
    fetchAll();
  };

  return (
    <RouteGuard permission="payroll">
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Kenaikan Gapok" description="Jadwal kenaikan berkala Driver/Helper per kelipatan masa kerja dan riwayat kenaikan yang telah diterapkan." icon={TrendingUp} />

        {toast.show && (
          <Portal>
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
              <div className={cn("flex items-start gap-3 px-5 py-4 rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]", toast.type === "error" ? "bg-card border-danger/20" : "bg-card border-success/20")}>
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
                  {toast.type === "error" ? <AlertTriangle className="w-5 h-5 text-danger" /> : <CircleCheckBig className="w-5 h-5 text-success" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">{toast.title}</p>
                  {toast.message && <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>}
                </div>
                <button onClick={() => setToast({ show: false, title: "", message: "", type: "success" })} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </Portal>
        )}

        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={cn("bg-card rounded-2xl border p-4 flex items-center gap-3", metrics.overdue > 0 ? "border-warning/30" : "border-border")}>
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", metrics.overdue > 0 ? "bg-warning/10" : "bg-muted")}>
              <AlertTriangle className={cn("w-5 h-5", metrics.overdue > 0 ? "text-warning" : "text-muted-foreground")} />
            </div>
            <div><p className="text-xs text-muted-foreground">Jatuh Tempo / Terlambat</p><p className="text-lg font-bold text-foreground">{loading ? "-" : metrics.overdue}</p></div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center"><CalendarDays className="w-5 h-5 text-primary" /></div>
            <div><p className="text-xs text-muted-foreground">Akan Datang ({settings?.notification_days ?? 90} hari)</p><p className="text-lg font-bold text-foreground">{loading ? "-" : metrics.in90}</p></div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center"><Clock className="w-5 h-5 text-success" /></div>
            <div><p className="text-xs text-muted-foreground">Total Terjadwal</p><p className="text-lg font-bold text-foreground">{loading ? "-" : metrics.total}</p></div>
          </div>
          <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center"><Banknote className="w-5 h-5 text-muted-foreground" /></div>
            <div><p className="text-xs text-muted-foreground">Kenaikan per Kelipatan</p><p className="text-sm font-bold text-foreground">{settings ? formatCurrency(settings.increment_amount) : "-"}</p><p className="text-[10px] text-muted-foreground">per {settings ? (settings.interval_months/12).toFixed(1).replace(/\.0$/,"") : "-"} tahun</p></div>
          </div>
        </div>

        {/* Config bar */}
        <div className="bg-card rounded-2xl border border-border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Banknote className="w-3.5 h-3.5" />
            <span>Kenaikan {settings ? `+${formatCurrency(settings.increment_amount)}` : "-"} per kelipatan {settings ? `${settings.interval_months} bulan` : "-"}</span>
            <span className="hidden sm:inline">· Sinkron otomatis harian 00:10 WIB</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchAll} disabled={loading}>Refresh</Button>
            {canEdit && <Button size="sm" icon={processing ? Loader2 : Check} onClick={handleProcessDue} disabled={processing || metrics.overdue === 0} className={processing ? "opacity-70" : ""}>{processing ? "Memproses..." : `Proses Jatuh Tempo (${metrics.overdue})`}</Button>}
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex items-center border-b border-border bg-muted/30">
            <button onClick={() => setActiveTab("scheduled")} className={cn("flex-1 py-3 text-xs font-bold border-b-2", activeTab==="scheduled" ? "border-primary text-primary bg-card" : "border-transparent text-muted-foreground hover:text-foreground")}>Jadwal ({filtered.length})</button>
            <button onClick={() => setActiveTab("history")} className={cn("flex-1 py-3 text-xs font-bold border-b-2", activeTab==="history" ? "border-primary text-primary bg-card" : "border-transparent text-muted-foreground hover:text-foreground")}>Riwayat Applied ({filteredHistory.length}) <History className="w-3 h-3 inline ml-1" /></button>
          </div>

          {/* Toolbar */}
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Cari ID atau nama pegawai..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); setHistoryPage(1); }} className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
            </div>
            {activeTab === "scheduled" && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Jabatan:</span>
                <select value={jabatanFilter} onChange={(e) => { setJabatanFilter(e.target.value as never); setPage(1); }} className="px-3 py-2 rounded-xl bg-muted border-none text-sm text-foreground outline-none">
                  <option value="semua">Semua</option>
                  <option value="Driver">Driver</option>
                  <option value="Helper">Helper</option>
                </select>
                <span className="text-xs font-medium text-muted-foreground">Status:</span>
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as never); setPage(1); }} className="px-3 py-2 rounded-xl bg-muted border-none text-sm text-foreground outline-none">
                  <option value="semua">Semua Jadwal</option>
                  <option value="overdue">Jatuh Tempo / Terlambat</option>
                  <option value="upcoming">Akan Datang</option>
                </select>
              </div>
            )}
          </div>

          {activeTab === "scheduled" ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5 w-12">#</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Jabatan</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Tgl Bergabung</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Gapok Saat Ini</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Ke-</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Jatuh Tempo</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Sisa</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Nominal</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Proyeksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? <SkeletonTable rows={6} cols={10} /> : paged.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-16 text-sm text-muted-foreground"><div className="flex flex-col items-center gap-2"><Users className="w-10 h-10 text-muted-foreground/20" /><p>Tidak ada jadwal ditemukan</p></div></td></tr>
                  ) : paged.map((e, idx) => {
                    const jab = e.pegawai?.jabatan?.nama || "-";
                    const d = daysUntilGapok(e.due_date);
                    const isOverdue = d <= 0;
                    const gapokNow = e.pegawai?.gaji_pokok ?? 0;
                    return (
                      <tr key={e.id} className={cn("hover:bg-muted/30", isOverdue ? "bg-warning/5" : "")}>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-semibold text-foreground">{e.pegawai?.nama || e.employee_id}</p>
                          <p className="text-xs font-mono text-muted-foreground">{e.employee_id}</p>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">{jab}</td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{e.pegawai?.tanggal_bergabung || "-"}</td>
                        <td className="px-5 py-3.5 text-right text-sm font-semibold text-foreground">{formatCurrency(gapokNow)}</td>
                        <td className="px-5 py-3.5 text-center"><Badge variant={isOverdue ? "warning" : "muted"}>{e.milestone_no}</Badge></td>
                        <td className="px-5 py-3.5 text-xs text-foreground">{e.due_date}</td>
                        <td className="px-5 py-3.5"><span className={cn("text-xs font-semibold px-2 py-1 rounded-lg", isOverdue ? "bg-warning/15 text-warning" : d <= 14 ? "bg-primary-light text-primary" : "bg-muted text-muted-foreground")}>{formatDays(d)}</span></td>
                        <td className="px-5 py-3.5 text-right text-sm text-success font-semibold">+{formatCurrency(e.amount)}</td>
                        <td className="px-5 py-3.5 text-right text-sm font-bold text-foreground">{formatCurrency(gapokNow + e.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Tanggal Terapkan</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Pegawai</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Ke-</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Jatuh Tempo</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Sebelum</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Sesudah</th>
                    <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3.5">Sumber</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {loading ? <SkeletonTable rows={6} cols={7} /> : pagedHistory.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-16 text-sm text-muted-foreground">Belum ada riwayat kenaikan.</td></tr>
                  ) : pagedHistory.map((h) => (
                    <tr key={h.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{h.applied_at ? new Date(h.applied_at).toLocaleDateString("id-ID") : "-"}</td>
                      <td className="px-5 py-3.5"><p className="text-sm font-semibold text-foreground">{h.pegawai?.nama || h.employee_id}</p><p className="text-xs font-mono text-muted-foreground">{h.employee_id} · {h.pegawai?.jabatan?.nama || "-"}</p></td>
                      <td className="px-5 py-3.5 text-center text-xs">{h.milestone_no}</td>
                      <td className="px-5 py-3.5 text-xs">{h.due_date}</td>
                      <td className="px-5 py-3.5 text-right text-xs">{h.before_gapok != null ? formatCurrency(h.before_gapok) : "-"}</td>
                      <td className="px-5 py-3.5 text-right text-xs font-bold text-success">{h.after_gapok != null ? formatCurrency(h.after_gapok) : "-"}</td>
                      <td className="px-5 py-3.5"><Badge variant="muted">{h.source}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination currentPage={activeTab==="scheduled" ? page : historyPage} totalItems={activeTab==="scheduled" ? filtered.length : filteredHistory.length} pageSize={PAGE_SIZE} onPageChange={activeTab==="scheduled" ? setPage : setHistoryPage} />
        </div>

        <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          Kenaikan otomatis menambah <span className="font-semibold text-foreground">pegawai.gaji_pokok</span> pada tanggal jatuh tempo dan membuat jadwal kelipatan berikutnya. Worksheet penggajian yang sudah terbuat tidak berubah otomatis — silakan Refresh Worksheet agar gapok terbaru terpakai di periode berjalan.
        </div>
      </div>
    </RouteGuard>
  );
}
