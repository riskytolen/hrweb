"use client";

import { AlertTriangle } from "lucide-react";
import Portal from "@/components/ui/Portal";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export type ConfirmVariant = "default" | "danger" | "success" | "warning";

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  const variantClass: Record<ConfirmVariant, { wrap: string; icon: string }> = {
    default: { wrap: "", icon: "bg-warning-light text-warning" },
    warning: { wrap: "", icon: "bg-warning-light text-warning" },
    danger: { wrap: "bg-danger text-white hover:bg-danger/90 border-danger", icon: "bg-danger-light text-danger" },
    success: { wrap: "bg-success text-white hover:bg-success/90 border-success", icon: "bg-success-light text-success" },
  };

  const v = variantClass[variant];

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={loading ? undefined : onCancel}
        />
        <div className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md mx-4 animate-fade-in">
          <div className="px-6 pt-6 pb-2 flex items-start gap-3">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", v.icon)}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-foreground mb-1">{title}</h3>
              <div className="text-xs text-muted-foreground">{description}</div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border mt-3">
            <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button size="sm" onClick={onConfirm} disabled={loading} className={v.wrap}>
              {loading ? "Memproses..." : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
