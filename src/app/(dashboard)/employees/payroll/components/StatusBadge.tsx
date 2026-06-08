import { CircleDashed, FileEdit, ShieldCheck, Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type LegacyPayrollStatus = "Worksheet" | "Draft" | "Final";

const config: Record<
  LegacyPayrollStatus,
  { label: string; bg: string; text: string; border: string; icon: LucideIcon }
> = {
  Worksheet: {
    label: "Worksheet",
    bg: "bg-slate-100 dark:bg-slate-800/50",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-200 dark:border-slate-700",
    icon: CircleDashed,
  },
  Draft: {
    label: "Draft",
    bg: "bg-amber-500",
    text: "text-white",
    border: "border-amber-600",
    icon: FileEdit,
  },
  Final: {
    label: "Final",
    bg: "bg-emerald-500",
    text: "text-white",
    border: "border-emerald-600",
    icon: ShieldCheck,
  },
};

export default function StatusBadge({
  status,
  className,
}: {
  status: LegacyPayrollStatus;
  className?: string;
}) {
  const c = config[status] ?? {
    label: status,
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
    icon: Inbox,
  };
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
