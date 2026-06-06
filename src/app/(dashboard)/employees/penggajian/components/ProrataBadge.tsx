import { Clock4 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProrataBadge({
  hariEfektif,
  hariTotal,
  className,
}: {
  hariEfektif: number;
  hariTotal: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold",
        "bg-orange-50 dark:bg-orange-900/20",
        "text-orange-700 dark:text-orange-300",
        "border-orange-200 dark:border-orange-800",
        className,
      )}
      title={`Prorata: ${hariEfektif}/${hariTotal} hari kalender`}
    >
      <Clock4 className="w-3 h-3" />
      {hariEfektif}/{hariTotal}
    </span>
  );
}
