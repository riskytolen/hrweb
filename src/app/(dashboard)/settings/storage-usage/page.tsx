"use client";

import { useEffect, useState } from "react";
import { HardDrive, Database, FolderOpen, RefreshCw, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";

type BucketStats = {
  bucket_id: string;
  file_count: number;
  total_size_bytes: number;
};

type StorageStats = {
  database_size_bytes: number;
  database_size_pretty: string;
  storage_total_bytes: number;
  storage_total_pretty: string;
  buckets: BucketStats[];
};

const DATABASE_QUOTA_BYTES = 500 * 1024 * 1024; // 500 MB (Free plan)
const STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GB (Free plan)

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " bytes";
}

function usagePercent(used: number, quota: number): number {
  if (quota <= 0) return 0;
  return Math.min((used / quota) * 100, 100);
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-blue-500";
}

function UsageCard({
  title,
  icon: Icon,
  usedBytes,
  usedPretty,
  quotaBytes,
  quotaPretty,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  usedBytes: number;
  usedPretty: string;
  quotaBytes: number;
  quotaPretty: string;
}) {
  const pct = usagePercent(usedBytes, quotaBytes);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{usedPretty}</p>
          <p className="text-xs text-slate-400 mt-0.5">dari {quotaPretty}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-blue-600" />
        </div>
      </div>
      <div className="mt-4">
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barColor(pct))}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-xs text-slate-500">{pct.toFixed(1)}% terpakai</span>
          {pct >= 90 && (
            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
              <AlertTriangle className="w-3 h-3" /> Hampir penuh
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function BucketIcon({ name }: { name: string }) {
  const colors: Record<string, string> = {
    "pegawai-docs": "bg-emerald-100 text-emerald-600",
    "leave-attachments": "bg-violet-100 text-violet-600",
    "recruitment-docs": "bg-orange-100 text-orange-600",
    "ga-vehicle-docs": "bg-cyan-100 text-cyan-600",
    "company-legal-documents": "bg-indigo-100 text-indigo-600",
  };
  const color = colors[name] || "bg-slate-100 text-slate-600";
  return (
    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", color)}>
      <FolderOpen className="w-4 h-4" />
    </div>
  );
}

function bucketLabel(name: string): string {
  const labels: Record<string, string> = {
    "pegawai-docs": "Dokumen Pegawai",
    "leave-attachments": "Lampiran Cuti",
    "recruitment-docs": "Dokumen Rekrutmen",
    "ga-vehicle-docs": "Dokumen Kendaraan",
    "company-legal-documents": "Legalitas Perusahaan",
  };
  return labels[name] || name;
}

export default function StorageUsagePage() {
  const { isSuperAdmin, isLoading: authLoading } = useAuth();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/storage-usage");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Gagal memuat data");
      }
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && isSuperAdmin) fetchStats();
  }, [authLoading, isSuperAdmin]);

  if (authLoading) {
    return (
      <div>
        <PageHeader title="Penyimpanan" icon={HardDrive} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl mt-6" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Penyimpanan" icon={HardDrive} />
        <div className="mt-10 text-center text-slate-400 text-sm">
          Anda tidak memiliki akses ke halaman ini.
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Penyimpanan"
        icon={HardDrive}
        actions={
          <button
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Perbarui
          </button>
        }
      />

      {error && (
        <div className="mt-6 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {loading && !stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <UsageCard
              title="Database"
              icon={Database}
              usedBytes={stats.database_size_bytes}
              usedPretty={stats.database_size_pretty}
              quotaBytes={DATABASE_QUOTA_BYTES}
              quotaPretty="500 MB"
            />
            <UsageCard
              title="Storage"
              icon={HardDrive}
              usedBytes={stats.storage_total_bytes}
              usedPretty={stats.storage_total_pretty}
              quotaBytes={STORAGE_QUOTA_BYTES}
              quotaPretty="1 GB"
            />
          </div>

          <div className="mt-6 bg-white rounded-xl border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Bucket</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {stats.buckets.map((bucket) => {
                const pct = usagePercent(bucket.total_size_bytes, STORAGE_QUOTA_BYTES);
                return (
                  <div key={bucket.bucket_id} className="flex items-center gap-4 px-5 py-4">
                    <BucketIcon name={bucket.bucket_id} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {bucketLabel(bucket.bucket_id)}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatBytes(bucket.total_size_bytes)} &middot; {bucket.file_count} file
                      </p>
                    </div>
                    <div className="w-32">
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", barColor(pct))}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 w-10 text-right">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 px-5 py-3 bg-slate-50 rounded-xl">
            <p className="text-xs text-slate-400">
              Limit berdasarkan plan <strong className="text-slate-500">Free</strong>.
              Upgrade ke <strong className="text-slate-500">Pro</strong> untuk database 8 GB dan storage 100 GB.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
