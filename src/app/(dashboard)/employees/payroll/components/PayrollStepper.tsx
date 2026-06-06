import { Calculator, FileEdit, ShieldCheck, BarChart3, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepperStep = "worksheet" | "draft" | "final" | "laporan";

interface StepConfig {
  key: StepperStep;
  label: string;
  description: string;
  icon: LucideIcon;
}

const STEPS: StepConfig[] = [
  { key: "worksheet", label: "Worksheet", description: "Hitung gaji", icon: Calculator },
  { key: "draft", label: "Draft", description: "Siap direview", icon: FileEdit },
  { key: "final", label: "Final", description: "Dikunci", icon: ShieldCheck },
  { key: "laporan", label: "Laporan", description: "Rekap & export", icon: BarChart3 },
];

export default function PayrollStepper({
  current,
  counts,
  onChange,
}: {
  current: StepperStep;
  counts?: { worksheet?: number; draft?: number; final?: number; laporan?: number };
  onChange?: (s: StepperStep) => void;
}) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <div className="bg-card rounded-2xl border border-border p-3 mb-4">
      <div className="flex items-center justify-between gap-1">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === currentIdx;
          const isCompleted = idx < currentIdx;
          const isClickable = !!onChange;
          const count = counts?.[step.key];

          return (
            <div key={step.key} className="flex-1 flex items-center min-w-0">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => onChange?.(step.key)}
                className={cn(
                  "flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all min-w-0",
                  isClickable && "hover:bg-muted/50 cursor-pointer",
                  !isClickable && "cursor-default",
                )}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors flex-shrink-0",
                    isActive && "bg-primary text-white border-primary shadow-md",
                    isCompleted && "bg-success text-white border-success",
                    !isActive && !isCompleted && "bg-muted text-muted-foreground border-border",
                  )}
                >
                  {isCompleted ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <div className="text-left min-w-0 hidden sm:block">
                  <p
                    className={cn(
                      "text-xs font-bold leading-tight truncate",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {idx + 1}. {step.label}
                    {count != null && count > 0 && (
                      <span
                        className={cn(
                          "ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                          isActive
                            ? "bg-white/20 text-white"
                            : step.key === "worksheet"
                              ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                              : step.key === "draft"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                : step.key === "final"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                  : "bg-primary/15 text-primary",
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight truncate">
                    {step.description}
                  </p>
                </div>
              </button>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-1 rounded-full min-w-[12px]",
                    idx < currentIdx ? "bg-success" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
