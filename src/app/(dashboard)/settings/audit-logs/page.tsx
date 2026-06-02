"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ShieldCheck, Search, Filter, RefreshCw, X, ChevronDown,
  CircleCheckBig, AlertTriangle, User as UserIcon,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Pagination from "@/components/ui/Pagination";
import Portal from "@/components/ui/Portal";
import DatePicker from "@/components/ui/DatePicker";
import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { supabase, type DbAuditLog } from "@/lib/supabase";
import { actionLabel, actionColor, entityLabel } from "@/lib/audit";
import { useAuth } from "@/components/AuthProvider";

const PAGE_SIZE = 20;

const ACTION_FILTER_OPTIONS = [
  "Semua",
  "create", "update", "delete",
  "approve", "reject",
  "generate", "manual_input", "status_change",
  "import", "export", "finalisasi",
];

export default function AuditLogsPage() {
  const { isSuperAdmin, isLoading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<DbAuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("Semua");
  const [filterEntity, setFilterEntity] = useState("Semua");
  const [filterUser, setFilterUser] = useState("Semua");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");

  const [detailLog, setDetailLog] = useState<DbAuditLog | null>(null);
  const [toast, setToast] = useState<{ show: boolean; title: string; message: string; type: "success" | "error" }>({ show: false, title: "", message: "", type: "success" });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((type: "success" | "error", title: string, message?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, title, message: message || "", type });
    toastTimer.current = setTimeout(() => setToast({ show: false, title: "", message: "", type: "success" }), 3500);
  }, []);
  useEffect(() => { return () => { if (toastTimer.current) clearTimeout(toastTimer.current); }; }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000); // Limit untuk performa, filter client-side untuk fleksibilitas

    if (dateStart) query = query.gte("created_at", `${dateStart}T00:00:00`);
    if (dateEnd) query = query.lte("created_at", `${dateEnd}T23:59:59`);

    const { data, error } = await query;
    if (error) {
      showToast("error", "Gagal Memuat Log", error.message);
      setLogs([]);
    } else {
      setLogs((data ?? []) as DbAuditLog[]);
    }
    setLoading(false);
  }, [dateStart, dateEnd, showToast]);

  useEffect(() => {
    if (!authLoading && isSuperAdmin) fetchLogs();
  }, [authLoading, isSuperAdmin, fetchLogs]);

  // Unique users untuk filter
  const uniqueUsers = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; nama: string }[] = [];
    for (const log of logs) {
      const key = log.user_email || log.user_id || "";
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ id: key, nama: log.user_nama || log.user_email || "Unknown" });
      }
    }
    return out.sort((a, b) => a.nama.localeCompare(b.nama));
  }, [logs]);

  const uniqueEntities = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => set.add(l.entity_type));
    return Array.from(set).sort();
  }, [logs]);

  // Filter
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter((l) => {
      if (filterAction !== "Semua" && l.action !== filterAction) return false;
      if (filterEntity !== "Semua" && l.entity_type !== filterEntity) return false;
      if (filterUser !== "Semua") {
        const userKey = l.user_email || l.user_id || "";
        if (userKey !== filterUser) return false;
      }
      if (q) {
        const hay =
          (l.user_nama ?? "") + " " +
          (l.user_email ?? "") + " " +
          (l.entity_label ?? "") + " " +
          l.entity_type + " " +
          l.action + " " +
          (l.entity_id ?? "");
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, filterAction, filterEntity, filterUser]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function formatDateTime(ts: string): string {
    const dt = new Date(ts);
    return dt.toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  // Guard: hanya super admin
  if (authLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-12 w-72" />
        <SkeletonList rows={5} cols={5} />
      </div>
    );
  }
  if (!isSuperAdmin) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Riwayat Aksi" description="Audit log seluruh aksi user di sistem" icon={ShieldCheck} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-sm">
            <div className="w-14 h-14 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-warning" />
            </div>
            <h3 className="text-base font-bold text-foreground">Akses Terbatas</h3>
            <p className="text-sm text-muted-foreground mt-2">Halaman audit log hanya dapat diakses oleh super administrator.</p>
          </div>
        </div>
      </div>
    );
  }

  const colorMap: Record<string, string> = {
    primary: "bg-primary-light text-primary",
    success: "bg-success-light text-success",
    danger: "bg-danger-light text-danger",
    warning: "bg-warning-light text-warning",
    muted: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Riwayat Aksi"
        description="Audit log seluruh aksi user di sistem (immutable)"
        icon={ShieldCheck}
        actions={
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchLogs} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {/* Toast */}
      {toast.show && (
        <Portal>
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
            <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]",
              toast.type === "error" ? "border-danger/20" : "border-success/20")}>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
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

      {/* Filter bar */}
      <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Cari user, entity, atau action..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            autoComplete="off" className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <_SelectFilter label="Aksi" value={filterAction} options={ACTION_FILTER_OPTIONS}
            onChange={(v) => { setFilterAction(v); setPage(1); }}
            renderOption={(v) => v === "Semua" ? "Semua Aksi" : actionLabel(v)} />
          <_SelectFilter label="Entity" value={filterEntity} options={["Semua", ...uniqueEntities]}
            onChange={(v) => { setFilterEntity(v); setPage(1); }}
            renderOption={(v) => v === "Semua" ? "Semua Entity" : entityLabel(v)} />
          <_SelectFilter label="User" value={filterUser}
            options={["Semua", ...uniqueUsers.map((u) => u.id)]}
            onChange={(v) => { setFilterUser(v); setPage(1); }}
            renderOption={(v) => v === "Semua" ? "Semua User" : (uniqueUsers.find((u) => u.id === v)?.nama || v)} />
          <div className="grid grid-cols-2 gap-1.5">
            <DatePicker value={dateStart} onChange={(v) => { setDateStart(v); setPage(1); }} placeholder="Dari" />
            <DatePicker value={dateEnd} onChange={(v) => { setDateEnd(v); setPage(1); }} placeholder="Sampai" />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Menampilkan {filtered.length} dari {logs.length} log {logs.length >= 2000 && <span className="text-warning">(limit 2000 terbaru)</span>}
        </p>
      </div>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Waktu</th>
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">User</th>
                <th className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Aksi</th>
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Entity</th>
                <th className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-5 py-3">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Memuat data...</td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-sm text-muted-foreground">Tidak ada log yang cocok dengan filter.</td></tr>
              ) : paged.map((log) => {
                const colorKey = actionColor(log.action);
                return (
                  <tr key={log.id} onClick={() => setDetailLog(log)}
                    className="hover:bg-muted/20 cursor-pointer transition-colors">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="text-xs font-medium text-foreground tabular-nums">{formatDateTime(log.created_at)}</p>
                      <p className="text-[10px] text-muted-foreground">#{log.id}</p>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <UserIcon className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{log.user_nama ?? "-"}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{log.user_role ?? log.user_email ?? "-"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn("text-[10px] font-bold px-2 py-1 rounded-md", colorMap[colorKey])}>
                        {actionLabel(log.action)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-xs font-medium text-foreground">{entityLabel(log.entity_type)}</p>
                      {log.entity_id && <p className="text-[10px] text-muted-foreground font-mono">ID: {log.entity_id}</p>}
                    </td>
                    <td className="px-5 py-3 max-w-[300px]">
                      <p className="text-xs text-foreground truncate">{log.entity_label ?? "-"}</p>
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {Object.entries(log.metadata as Record<string, unknown>)
                            .filter(([, v]) => v != null && v !== "")
                            .map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`)
                            .join(" • ")}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {/* Detail modal */}
      {detailLog && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDetailLog(null)} />
            <div className="relative w-full max-w-3xl bg-card rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Detail Aksi #{detailLog.id}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{formatDateTime(detailLog.created_at)}</p>
                </div>
                <button onClick={() => setDetailLog(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>

              <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                {/* User info */}
                <div className="grid grid-cols-2 gap-3">
                  <_DetailField label="User" value={detailLog.user_nama ?? "-"} sub={detailLog.user_email ?? ""} />
                  <_DetailField label="Role" value={detailLog.user_role ?? "-"} />
                  <_DetailField label="Aksi" value={actionLabel(detailLog.action)} />
                  <_DetailField label="Entity" value={entityLabel(detailLog.entity_type)} sub={detailLog.entity_id ? `ID: ${detailLog.entity_id}` : ""} />
                </div>

                {detailLog.entity_label && (
                  <_DetailField label="Target" value={detailLog.entity_label} />
                )}

                {/* Metadata */}
                {detailLog.metadata && Object.keys(detailLog.metadata).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Konteks</p>
                    <div className="bg-muted/40 rounded-xl p-3 space-y-1.5">
                      {Object.entries(detailLog.metadata as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="flex items-start gap-3 text-xs">
                          <span className="text-muted-foreground min-w-[120px] font-medium">{k}</span>
                          <span className="text-foreground flex-1 break-all">{v == null || v === "" ? <span className="italic text-muted-foreground">-</span> : String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Diff old vs new */}
                {(detailLog.old_data || detailLog.new_data) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Perubahan Data</p>
                    <_DiffView oldData={detailLog.old_data} newData={detailLog.new_data} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

// ─── Subcomponents ───

function _SelectFilter({
  label,
  value,
  options,
  onChange,
  renderOption,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  renderOption: (v: string) => string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-1">
        <Filter className="w-2.5 h-2.5" />{label}
      </span>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full text-xs px-3 py-2 pr-8 rounded-xl border border-border bg-muted/30 outline-none appearance-none cursor-pointer focus:border-primary focus:ring-2 focus:ring-primary/10 text-foreground">
          {options.map((opt) => (
            <option key={opt} value={opt}>{renderOption(opt)}</option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      </div>
    </label>
  );
}

function _DetailField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function _DiffView({ oldData, newData }: { oldData: Record<string, unknown> | null; newData: Record<string, unknown> | null }) {
  const allKeys = new Set<string>();
  if (oldData) Object.keys(oldData).forEach((k) => allKeys.add(k));
  if (newData) Object.keys(newData).forEach((k) => allKeys.add(k));
  // Skip noisy fields
  const skipFields = new Set(["created_at", "updated_at", "approved_at"]);

  const rows: { key: string; oldVal: unknown; newVal: unknown; changed: boolean }[] = [];
  for (const key of Array.from(allKeys).sort()) {
    if (skipFields.has(key)) continue;
    const oldVal = oldData?.[key];
    const newVal = newData?.[key];
    const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
    rows.push({ key, oldVal, newVal, changed });
  }

  // Untuk delete (newData null), tampilkan semua field oldData
  // Untuk create (oldData null), tampilkan semua field newData

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Tidak ada data perubahan.</p>;
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px] w-[140px]">Field</th>
            <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Sebelum</th>
            <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Sesudah</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((r) => (
            <tr key={r.key} className={r.changed ? "bg-warning/[0.04]" : ""}>
              <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground align-top">{r.key}</td>
              <td className="px-3 py-1.5 align-top break-all">
                <_Value v={r.oldVal} muted={!r.changed} />
              </td>
              <td className="px-3 py-1.5 align-top break-all">
                <_Value v={r.newVal} muted={!r.changed} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function _Value({ v, muted }: { v: unknown; muted: boolean }) {
  if (v == null) return <span className="italic text-muted-foreground/60">null</span>;
  if (v === "") return <span className="italic text-muted-foreground/60">empty</span>;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return (
    <span className={cn(muted ? "text-muted-foreground" : "text-foreground")}>
      {s.length > 200 ? s.slice(0, 200) + "..." : s}
    </span>
  );
}
