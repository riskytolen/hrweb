"use client";

import { X, CircleCheckBig, AlertTriangle } from "lucide-react";
import Portal from "@/components/ui/Portal";
import { cn } from "@/lib/utils";
import type { ToastState } from "../lib/hooks/use-toast";

type ToastUIProps = {
  toast: ToastState;
  onDismiss: () => void;
};

export function ToastUI({ toast, onDismiss }: ToastUIProps) {
  if (!toast.show) return null;
  return (
    <Portal>
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
        <div className={cn("flex items-start gap-3 px-5 py-4 bg-card rounded-2xl shadow-2xl border min-w-[360px] max-w-[480px]", toast.type === "error" ? "border-danger/20" : "border-success/20")}>
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", toast.type === "error" ? "bg-danger/10" : "bg-success/10")}>
            {toast.type === "error" ? <AlertTriangle className="w-5 h-5 text-danger" /> : <CircleCheckBig className="w-5 h-5 text-success" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">{toast.title}</p>
            {toast.message && <p className="text-xs text-muted-foreground mt-0.5">{toast.message}</p>}
          </div>
          <button onClick={onDismiss} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </Portal>
  );
}
