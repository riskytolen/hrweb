import { Calculator, FileCheck, BarChart3, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepperStep = "draft" | "review" | "report";

const STEPS: Array<{
  key: StepperStep;
  label: string;
  icon: React.ElementType;
  description: string;
}> = [
  { key: "draft", label: "Hitung", icon: Calculator, description: "Worksheet & hitung gaji" },
  { key: "review", label: "Review", icon: FileCheck, description: "Periksa & finalkan slip" },
  { key: "report", label: "Laporan", icon: BarChart3, description: "Rekap & export" },
];

export default function PayrollStepper({
  current,
  counts,
  onChange,
}: {
  current: StepperStep;
  counts?: { draft?: number; review?: number; report?: number };
  onChange?: (s: StepperStep) => void;
}) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <div className="bg-card rounded-2xl border border-border p-4 mb-4">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === currentIdx;
          const isCompleted = idx < currentIdx;
          const isClickable = !!onChange;
          const countKey = step.key === "draft" ? "draft" : step.key === "review" ? "review" : "report";
          const count = counts?.[countKey];

          return (
            <div key={step.key} className="flex-1 flex items-center">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => onChange?.(step.key)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl transition-all",
                  isClickable && "hover:bg-muted/50 cursor-pointer",
                  !isClickable && "cursor-default",
                )}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors flex-shrink-0",
                    isActive && "bg-primary text-white border-primary shadow-md",
                    isCompleted && "bg-success text-white border-success",
                    !isActive && !isCompleted && "bg-muted text-muted-foreground border-border",
                  )}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <div className="text-left hidden sm:block">
                  <p
                    className={cn(
                      "text-sm font-bold leading-tight",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {idx + 1}. {step.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {step.description}
                    {count != null && count > 0 && (
                      <span className="ml-1 font-semibold text-primary">· {count}</span>
                    )}
                  </p>
                </div>
              </button>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 rounded-full",
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
