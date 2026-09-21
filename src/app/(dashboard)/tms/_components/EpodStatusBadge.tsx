"use client";

import { cn } from "@/lib/utils";
import {
  EPOD_ASSIGNMENT_STATUS_LABEL,
  EPOD_RESULT_LABEL,
  type EpodAssignmentStatus,
  type EpodDeliveryResult,
} from "@/lib/tms-epod";

const ASSIGNMENT_TONE: Record<EpodAssignmentStatus, string> = {
  OPEN: "bg-muted text-muted-foreground",
  CLAIMED: "bg-sky-500/10 text-sky-600",
  IN_PROGRESS: "bg-amber-500/10 text-amber-600",
  COMPLETED: "bg-emerald-500/10 text-emerald-600",
  CANCELLED: "bg-rose-500/10 text-rose-600",
};

export function EpodAssignmentBadge({
  status,
  className,
}: {
  status: EpodAssignmentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap",
        ASSIGNMENT_TONE[status],
        className,
      )}
    >
      {EPOD_ASSIGNMENT_STATUS_LABEL[status]}
    </span>
  );
}

const RESULT_TONE: Record<EpodDeliveryResult, string> = {
  DELIVERED: "bg-emerald-500/10 text-emerald-600",
  PARTIAL: "bg-amber-500/10 text-amber-600",
  REJECTED: "bg-rose-500/10 text-rose-600",
};

export function EpodResultBadge({
  result,
  className,
}: {
  result: EpodDeliveryResult;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        RESULT_TONE[result],
        className,
      )}
    >
      {EPOD_RESULT_LABEL[result]}
    </span>
  );
}

export function EpodLoadingBadge({ completed, className }: { completed: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap",
        completed ? "bg-emerald-500/10 text-emerald-600" : "bg-slate-500/10 text-slate-600",
        className,
      )}
    >
      {completed ? "Loading selesai" : "Loading belum"}
    </span>
  );
}
