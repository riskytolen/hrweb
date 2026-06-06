import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PeriodSwitcher({
  label,
  onPrev,
  onNext,
  className,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 bg-muted rounded-xl p-1 border border-border",
        className,
      )}
    >
      <button
        type="button"
        onClick={onPrev}
        className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Periode sebelumnya"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="px-3 py-1 flex items-center gap-2 min-w-[140px] justify-center">
        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
        <p className="text-sm font-bold text-foreground">{label}</p>
      </div>
      <button
        type="button"
        onClick={onNext}
        className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Periode berikutnya"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
