"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Shield,
  Truck,
  UserCheck,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { useAuth } from "@/components/AuthProvider";
import { cn } from "@/lib/utils";
import { canManageTmsEpod, canViewTmsEpod } from "@/lib/permissions";
import {
  normalizeEpodAssignmentList,
  type EpodAssignmentListItem,
  type EpodAssignmentStatus,
} from "@/lib/tms-epod";
import { EpodAssignmentBadge } from "./EpodStatusBadge";
import EpodStopPanel from "./EpodStopPanel";

interface StatusCounts {
  open: number;
  claimed: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  total: number;
}

interface ListResponse {
  data?: unknown;
  error?: string;
  meta?: { total?: number; counts?: StatusCounts | null };
}

type StatusFilter = "ALL" | EpodAssignmentStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "OPEN", label: "Belum diklaim" },
  { key: "CLAIMED", label: "Sudah diklaim" },
  { key: "IN_PROGRESS", label: "Berjalan" },
  { key: "COMPLETED", label: "Selesai" },
  { key: "CANCELLED", label: "Dibatalkan" },
];

const PAGE_SIZE = 15;

function formatDateTime(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed));
}

function KpiCard({
  icon: Icon,
  tileClass,
  label,
  value,
}: {
  icon: typeof Truck;
  tileClass: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white", tileClass)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block text-2xl font-extrabold tabular-nums text-foreground">{value}</span>
      </span>
    </div>
  );
}

function EpodMonitoringInner({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<EpodAssignmentListItem[]>([]);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (status !== "ALL") params.set("status", status);
      if (appliedSearch) params.set("search", appliedSearch);

      const response = await fetch(`/api/tms/epod?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as ListResponse;
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal memuat data e-POD.");
        setItems([]);
        return;
      }
      setItems(normalizeEpodAssignmentList(payload.data));
      setCounts(payload.meta?.counts ?? null);
      setTotal(payload.meta?.total ?? 0);
    } catch {
      setError("Gagal memuat data e-POD.");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page, status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const handleSearch = useCallback(() => {
    setPage(1);
    setAppliedSearch(search.trim());
  }, [search]);

  if (selectedId) {
    return (
      <div className="h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-border bg-card">
        <EpodStopPanel
          assignmentId={selectedId}
          canManage={canManage}
          onChanged={() => void load()}
          onClose={() => setSelectedId(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Truck} tileClass="bg-slate-500" label="Belum diklaim" value={counts?.open ?? 0} />
        <KpiCard icon={Loader2} tileClass="bg-amber-500" label="Berjalan" value={counts?.inProgress ?? 0} />
        <KpiCard icon={CheckCircle2} tileClass="bg-emerald-500" label="Selesai" value={counts?.completed ?? 0} />
        <KpiCard icon={UserCheck} tileClass="bg-sky-500" label="Sudah diklaim" value={counts?.claimed ?? 0} />
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-xs"
                placeholder="Cari nomor FO atau nopol"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSearch();
                }}
              />
            </div>
            <Button size="sm" variant="outline" onClick={handleSearch}>
              Cari
            </Button>
          </div>
          <Button size="sm" variant="outline" icon={RefreshCw} disabled={loading} onClick={() => void load()}>
            Muat ulang
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => {
                setStatus(filter.key);
                setPage(1);
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                status === filter.key ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="px-4 py-10 text-center text-sm text-danger">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Belum ada FO di pool e-POD. Sinkronisasi berjalan setiap 2 menit.
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">FO</th>
                    <th className="px-4 py-2.5 font-semibold">Unit</th>
                    <th className="px-4 py-2.5 font-semibold">Loading</th>
                    <th className="px-4 py-2.5 font-semibold">e-POD</th>
                    <th className="px-4 py-2.5 font-semibold">Driver</th>
                    <th className="px-4 py-2.5 font-semibold">Helper</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className="cursor-pointer transition-colors hover:bg-muted/60"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="block font-bold text-foreground">{item.taskNumber ?? item.taskId.slice(0, 8)}</span>
                        <span className="block text-[11px] text-muted-foreground">{formatDateTime(item.snapshotAt)}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-foreground">
                        {item.licensePlate ?? "–"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            item.loadingStatus === "LOADING_COMPLETED" ? "text-emerald-600" : "text-muted-foreground",
                          )}
                        >
                          {item.loadingStatus === "LOADING_COMPLETED" ? "Selesai" : "Belum"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-bold tabular-nums text-foreground">
                        {item.deliveryDoneCount}/{item.deliveryTotalCount}
                      </td>
                      <td className="max-w-40 truncate px-4 py-3 text-muted-foreground">
                        {item.driverName ?? "–"}
                      </td>
                      <td className="max-w-40 truncate px-4 py-3 text-muted-foreground">
                        {item.helperName ?? "–"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <EpodAssignmentBadge status={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ol className="divide-y divide-border lg:hidden">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-foreground">
                          {item.taskNumber ?? item.taskId.slice(0, 8)}
                        </span>
                        <EpodAssignmentBadge status={item.status} />
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {[item.licensePlate, item.driverName, item.helperName].filter(Boolean).join(" • ") || "–"}
                      </p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        Loading {item.loadingStatus === "LOADING_COMPLETED" ? "selesai" : "belum"} · e-POD{" "}
                        {item.deliveryDoneCount}/{item.deliveryTotalCount}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}

        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              Halaman {page} dari {totalPages} · {total.toLocaleString("id-ID")} FO
            </span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Sebelumnya
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Berikutnya
              </Button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EpodMonitoring() {
  const { profile, isLoading } = useAuth();

  const permissions = profile?.roles?.permissions ?? [];
  const accountType = profile?.account_type ?? "internal";
  const allowed = canViewTmsEpod(permissions, accountType);
  const canManage = canManageTmsEpod(permissions, accountType);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <Shield className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Akses Ditolak</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Anda tidak memiliki izin untuk mengakses Monitoring e-POD. Hubungi Super Admin untuk mendapatkan akses.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <PackageCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-bold text-foreground">Monitoring e-POD</h1>
          <p className="text-xs text-muted-foreground">
            Bukti pengiriman per titik toko. Titik pertama adalah loading barang.
          </p>
        </div>
        {!canManage && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            <ClipboardCheck className="h-3.5 w-3.5" /> Hanya lihat
          </span>
        )}
      </div>

      <EpodMonitoringInner canManage={canManage} />
    </div>
  );
}
