"use client";

import { cn } from "@/lib/utils";

interface TaskStatusBadgeProps {
  color: string | null;
  label: string;
  className?: string;
}

/** Badge status task memakai warna asli dari upstream (fallback abu-abu). */
export default function TaskStatusBadge({ color, label, className }: TaskStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? "#99a1b1" }}
        aria-hidden
      />
      {label}
    </span>
  );
}
