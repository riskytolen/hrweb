import Button from "@/components/ui/Button";
import { X, Trash2, FileCheck, RotateCcw, ShieldCheck, type LucideIcon } from "lucide-react";

export type BatchAction = "review" | "finalkan" | "batalkan" | "hapus";

export default function BatchActionBar({
  count,
  onClear,
  actions,
}: {
  count: number;
  onClear: () => void;
  actions: Array<{
    type: BatchAction;
    onClick: () => void;
  }>;
}) {
  if (count === 0) return null;

  const variants: Record<BatchAction, { icon: LucideIcon; label: (n: number) => string; className: string }> = {
    review: {
      icon: FileCheck,
      label: (n) => `Review ${n} Slip`,
      className:
        "bg-primary text-white hover:bg-primary/90 border-primary",
    },
    finalkan: {
      icon: ShieldCheck,
      label: (n) => `Finalkan ${n} Slip`,
      className:
        "bg-success text-white hover:bg-success/90 border-success",
    },
    batalkan: {
      icon: RotateCcw,
      label: (n) => `Batalkan ${n} Slip`,
      className:
        "text-warning border-warning/30 hover:bg-warning/10 hover:text-warning bg-transparent",
    },
    hapus: {
      icon: Trash2,
      label: (n) => `Hapus ${n} Slip`,
      className:
        "bg-danger text-white hover:bg-danger/90 border-danger",
    },
  };

  return (
    <div className="sticky bottom-0 z-10 bg-primary/10 border-t border-primary/20 px-5 py-3 flex items-center justify-between animate-fade-in shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
          {count}
        </div>
        <p className="text-sm font-semibold text-primary">Slip dipilih</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" icon={X} onClick={onClear}>
          Batal
        </Button>
        {actions.map((a) => {
          const v = variants[a.type];
          const Icon = v.icon;
          return (
            <Button
              key={a.type}
              size="sm"
              icon={Icon}
              onClick={a.onClick}
              className={v.className}
            >
              {v.label(count)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
