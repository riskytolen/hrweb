"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Calculator, FileCheck, BarChart3 } from "lucide-react";

const TABS = [
  { key: "draft", label: "Hitung", path: "/employees/penggajian/draft", icon: Calculator },
  { key: "review", label: "Review", path: "/employees/penggajian/review", icon: FileCheck },
  { key: "report", label: "Laporan", path: "/employees/penggajian/report", icon: BarChart3 },
] as const;

export default function PenggajianLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div>
      <div className="bg-card border-b border-border mb-4">
        <div className="px-6 pt-4 pb-0 flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname.startsWith(tab.path);
            return (
              <button
                key={tab.key}
                onClick={() => router.push(tab.path)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}
