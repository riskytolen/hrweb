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

/** Multiple skeleton rows - HARUS digunakan di dalam <table><tbody> */
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} cols={cols} />
      ))}
    </>
  );
}

/** Skeleton block untuk loading state di luar konteks <table> (mis. halaman kosong yang sedang loading) */
export function SkeletonList({ rows = 5, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-3 flex-1", c === 0 ? "max-w-[80px]" : c === cols - 1 ? "max-w-[60px]" : "")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
