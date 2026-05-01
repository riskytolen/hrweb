"use client";

import { type ReactNode } from "react";
import { Shield } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface RouteGuardProps {
  /** Permission key modul, misal "employees", "payroll" */
  permission: string;
  children: ReactNode;
}

/**
 * RouteGuard — blokir akses halaman jika user tidak punya permission.
 * Menerima "modul" key, lalu cek apakah user punya "modul" atau "modul.view".
 * Jika tidak punya keduanya → tampilkan "Akses Ditolak".
 */
export default function RouteGuard({ permission, children }: RouteGuardProps) {
  const { hasPermission, isLoading } = useAuth();

  // Saat auth masih loading, tampilkan skeleton
  if (isLoading) {
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

  // Cek: punya permission penuh ATAU view-only?
  const hasAccess =
    hasPermission(permission) || hasPermission(permission + ".view");

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
