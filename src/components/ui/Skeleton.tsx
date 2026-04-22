import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn("animate-pulse rounded-lg bg-muted", className)} />
  );
}

/** Skeleton row for a table - renders N cells with shimmer bars */
export function SkeletonTableRow({ cols, className }: { cols: number; className?: string }) {
  return (
    <tr className={className}>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-5 py-4">
          <Skeleton className={cn("h-4 rounded-md", i === 0 ? "w-16" : i === 1 ? "w-32" : "w-20")} />
        </td>
      ))}
    </tr>
  );
}

/** Multiple skeleton rows */
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} cols={cols} />
      ))}
    </>
  );
}
