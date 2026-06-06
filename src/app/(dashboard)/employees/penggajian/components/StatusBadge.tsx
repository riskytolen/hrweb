import { CircleDashed, Eye, ShieldCheck } from "lucide-react";
import type { PayrollStatus } from "@/lib/payroll-v2/types";
import { cn } from "@/lib/utils";

const config: Record<
  PayrollStatus,
  { label: string; bg: string; text: string; border: string; icon: React.ElementType }
> = {
  DRAFT: {
    label: "Draft",
    bg: "bg-slate-100 dark:bg-slate-800/50",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-200 dark:border-slate-700",
    icon: CircleDashed,
  },
  REVIEWED: {
    label: "Reviewed",
    bg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800",
    icon: Eye,
  },
  FINAL: {
    label: "Final",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800",
    icon: ShieldCheck,
  },
};

export default function StatusBadge({
  status,
  className,
}: {
  status: PayrollStatus;
  className?: string;
}) {
  const c = config[status];
  const Icon = c.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold",
        c.bg,
        c.text,
        c.border,
        className,
      )}
    >
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
}
