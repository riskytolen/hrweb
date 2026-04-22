"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const from = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalItems);

  // Generate page numbers to show
  const getPages = (): (number | "...")[] => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "...")[] = [];
    pages.push(1);
    if (currentPage > 3) pages.push("...");
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-border bg-muted/30">
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Menampilkan <span className="font-semibold text-foreground">{from}-{to}</span> dari <span className="font-semibold text-foreground">{totalItems}</span>
        </p>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Per halaman</span>
            <select
              value={pageSize}
              onChange={(e) => { onPageSizeChange(parseInt(e.target.value)); onPageChange(1); }}
              className="text-xs px-2 py-1 rounded-lg border border-border bg-card text-foreground outline-none focus:border-primary"
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className={cn(
              "p-1.5 rounded-lg text-muted-foreground transition-colors",
              currentPage <= 1 ? "opacity-30 cursor-not-allowed" : "hover:bg-muted hover:text-foreground"
            )}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {getPages().map((page, i) =>
            page === "..." ? (
              <span key={`dot-${i}`} className="px-1 text-xs text-muted-foreground">...</span>
            ) : (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={cn(
                  "min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors",
                  page === currentPage
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {page}
              </button>
            )
          )}

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className={cn(
              "p-1.5 rounded-lg text-muted-foreground transition-colors",
              currentPage >= totalPages ? "opacity-30 cursor-not-allowed" : "hover:bg-muted hover:text-foreground"
            )}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
