"use client";

import { useEffect, type ReactNode } from "react";
import { Shield } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import {
  canManageOdometerClientUnits,
  canViewLiveTrackConfig,
  canViewOdometerDashboard,
  canViewOdometerReport,
  canViewTmsEpod,
  canViewTmsLiveTask,
  canViewTmsLiveView,
  canViewTmsLoggerTrips,
} from "@/lib/permissions";

interface RouteGuardProps {
  /** Permission key modul, misal "employees", "payroll" */
  permission: string;
  children: ReactNode;
}

// Skeleton loading component
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-muted animate-pulse" />
        <div className="h-6 w-48 rounded-lg bg-muted animate-pulse" />
      </div>
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="h-10 w-72 rounded-xl bg-muted animate-pulse" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="px-4 py-3.5 border-b border-border/50 flex items-center gap-4"
            style={{ opacity: 1 - i * 0.15 }}
          >
            <div className="h-4 w-6 rounded bg-muted animate-pulse" />
            <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
            <div className="h-4 w-32 rounded bg-muted animate-pulse" />
            <div className="h-4 w-40 rounded bg-muted animate-pulse flex-1" />
            <div className="h-6 w-20 rounded-full bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * RouteGuard — blokir akses halaman jika user tidak punya permission.
 * Menerima "modul" key, lalu cek apakah user punya "modul" atau "modul.view".
 * Jika tidak punya keduanya → tampilkan "Akses Ditolak".
 */
export default function RouteGuard({ permission, children }: RouteGuardProps) {
  const { hasPermission, isLoading, profile, user } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      window.location.assign("/login");
    }
  }, [isLoading, user]);

  // Saat auth masih loading, tampilkan skeleton
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Jika user null (belum login), redirect ke /login
  if (!user) {
    return <LoadingSkeleton />;
  }

  // Cek: punya permission penuh ATAU input-only ATAU view-only?
  // Submenu TMS granular memakai helper warisan agar role lama (`tms`,
  // `vehicle-odometer` dkk) tetap lolos tanpa migrasi data.
  const submenuAccess: Record<string, boolean> = {
    "tms.epod": canViewTmsEpod(profile?.roles?.permissions ?? [], profile?.account_type),
    "tms.live-track-config": canViewLiveTrackConfig(profile?.roles?.permissions ?? [], profile?.account_type),
    "tms.live-view": canViewTmsLiveView(profile?.roles?.permissions ?? [], profile?.account_type),
    "tms.live-track-task": canViewTmsLiveTask(profile?.roles?.permissions ?? [], profile?.account_type),
    "tms.logger-trips": canViewTmsLoggerTrips(profile?.roles?.permissions ?? [], profile?.account_type),
    "vehicle-odometer.dashboard": canViewOdometerDashboard(profile?.roles?.permissions ?? [], profile?.account_type),
    "vehicle-odometer.report": canViewOdometerReport(profile?.roles?.permissions ?? [], profile?.account_type),
    "vehicle-odometer.client-unit-config": canManageOdometerClientUnits(
      profile?.roles?.permissions ?? [],
      profile?.account_type,
    ),
  };
  const hasAccess =
    permission in submenuAccess
      ? submenuAccess[permission]
      : hasPermission(permission) || hasPermission(permission + ".input") || hasPermission(permission + ".view");

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">
            Akses Ditolak
          </h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Anda tidak memiliki izin untuk mengakses halaman ini. Hubungi Super
            Admin untuk mendapatkan akses.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
