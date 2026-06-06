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
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold",
        "bg-orange-50 dark:bg-orange-900/20",
        "text-orange-700 dark:text-orange-300",
        "border-orange-200 dark:border-orange-800",
        className,
      )}
      title={`Prorata: ${hariEfektif}/${hariTotal} hari kalender`}
    >
      <Clock4 className="w-2.5 h-2.5" />
      {hariEfektif}/{hariTotal}
    </span>
  );
}
