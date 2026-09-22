"use client";

import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CircleCheckBig,
  Package,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  EPOD_ASSIGNMENT_STATUS_LABEL,
  EPOD_RESULT_LABEL,
  type EpodAssignmentStatus,
  type EpodDeliveryResult,
  type EpodStopType,
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

const RESULT_ICON: Record<EpodDeliveryResult, LucideIcon> = {
  DELIVERED: CircleCheckBig,
  PARTIAL: AlertTriangle,
  REJECTED: X,
};

export function EpodResultBadge({
  result,
  className,
}: {
  result: EpodDeliveryResult;
  className?: string;
}) {
  const Icon = RESULT_ICON[result];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        RESULT_TONE[result],
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {EPOD_RESULT_LABEL[result]}
    </span>
  );
}

/** Badge hijau untuk bukti yang sudah dikirim (khusus titik loading). */
export function EpodSentBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-emerald-600",
        className,
      )}
    >
      <CircleCheckBig className="h-3 w-3 shrink-0" />
      Bukti terkirim
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

const STOP_TYPE_LABEL: Record<EpodStopType, string> = {
  LOADING: "Loading",
  DELIVERY: "Pengantaran",
};

const STOP_TYPE_TONE: Record<EpodStopType, string> = {
  LOADING: "bg-orange-500/10 text-orange-600",
  DELIVERY: "bg-sky-500/10 text-sky-600",
};

const STOP_TYPE_ICON: Record<EpodStopType, LucideIcon> = {
  LOADING: Package,
  DELIVERY: Truck,
};

export function EpodStopTypeBadge({
  stopType,
  className,
}: {
  stopType: EpodStopType;
  className?: string;
}) {
  const Icon = STOP_TYPE_ICON[stopType];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        STOP_TYPE_TONE[stopType],
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {STOP_TYPE_LABEL[stopType]}
    </span>
  );
}
