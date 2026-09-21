"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { getTmsDefaultRoute } from "@/lib/navigation";

/**
 * Redirect `/tms` yang sadar-permission.
 *
 * Role TMS lama tetap diarahkan ke Live View, sedangkan role yang hanya
 * punya akses e-POD diarahkan ke Monitoring e-POD agar tidak mendarat di
 * halaman yang ditolak.
 */
export default function TmsPage() {
  const router = useRouter();
  const { profile, isLoading, user } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    const permissions = profile?.roles?.permissions ?? [];
    const accountType = profile?.account_type ?? "internal";
    router.replace(getTmsDefaultRoute(permissions, accountType));
  }, [isLoading, user, profile, router]);

  return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
