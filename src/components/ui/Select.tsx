"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  hasError?: boolean;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Pilih...",
  searchable,
  className,
  hasError,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-enable search when options > 5
  const isSearchable = searchable ?? options.length > 5;

  const selected = options.find((o) => o.value === value);

  const filtered = isSearchable && search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search on open
  useEffect(() => {
    if (open && isSearchable) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
    if (open) {
      // Highlight current value
      const idx = filtered.findIndex((o) => o.value === value);
      setHighlightIdx(idx >= 0 ? idx : 0);
    }
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current && highlightIdx >= 0) {
      const items = listRef.current.querySelectorAll("[data-option]");
      items[highlightIdx]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIdx, open]);

  const handleSelect = useCallback((val: string) => {
    onChange(val);
    setOpen(false);
    setSearch("");
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIdx((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIdx((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightIdx >= 0 && filtered[highlightIdx]) {
          handleSelect(filtered[highlightIdx].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setSearch("");
        break;
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-sm outline-none transition-all duration-200",
          "bg-muted/30 text-foreground",
          open
            ? "border-primary ring-2 ring-primary/10"
            : hasError
              ? "border-danger ring-2 ring-danger/10"
              : "border-border hover:border-primary/40",
        )}
      >
        <span className={cn(
          "truncate text-left",
          !selected && "text-muted-foreground/50"
        )}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={cn(
          "w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200",
          open && "rotate-180 text-primary"
        )} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={cn(
          "absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-card shadow-xl shadow-black/8",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150",
          "overflow-hidden"
        )}>
          {/* Search */}
          {isSearchable && (
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/30">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setHighlightIdx(0); }}
                placeholder="Cari..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 text-foreground"
              />
            </div>
          )}

          {/* Options list */}
          <div ref={listRef} className="max-h-52 overflow-y-auto overscroll-contain py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Tidak ditemukan
              </div>
            ) : (
              filtered.map((option, idx) => {
                const isSelected = option.value === value;
                const isHighlighted = idx === highlightIdx;
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-option
                    onClick={() => handleSelect(option.value)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-100",
                      isHighlighted && "bg-primary/8",
                      isSelected
                        ? "text-primary font-semibold"
                        : "text-foreground",
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
