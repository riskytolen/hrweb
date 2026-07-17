"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  selectedLabel?: string;
  color?: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  hasError?: boolean;
  portal?: boolean;
  portalMinWidth?: number;
  compact?: boolean;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Pilih...",
  searchable,
  className,
  hasError,
  portal = false,
  portalMinWidth = 240,
  compact = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({});
  const [portalListHeight, setPortalListHeight] = useState(208);

  // Auto-enable search when options > 5
  const isSearchable = searchable ?? options.length > 5;

  const selected = options.find((o) => o.value === value);

  const filtered = isSearchable && search
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase()) ||
        (o.selectedLabel && o.selectedLabel.toLowerCase().includes(search.toLowerCase()))
      )
    : options;

  const updatePortalPosition = useCallback(() => {
    if (!portal || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const width = Math.min(Math.max(rect.width, portalMinWidth), viewportWidth - 16);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    const below = viewportHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const openAbove = below < 220 && above > below;
    const available = openAbove ? above : below;
    const searchHeight = isSearchable ? 50 : 0;

    setPortalListHeight(Math.max(96, Math.min(208, available - searchHeight - 12)));
    setPortalStyle({
      position: "fixed",
      left,
      width,
      zIndex: 100,
      ...(openAbove
        ? { bottom: viewportHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    });
  }, [isSearchable, portal, portalMinWidth]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open || !portal) return;

    updatePortalPosition();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updatePortalPosition);
    window.addEventListener("scroll", updatePortalPosition, true);
    visualViewport?.addEventListener("resize", updatePortalPosition);
    visualViewport?.addEventListener("scroll", updatePortalPosition);

    return () => {
      window.removeEventListener("resize", updatePortalPosition);
      window.removeEventListener("scroll", updatePortalPosition, true);
      visualViewport?.removeEventListener("resize", updatePortalPosition);
      visualViewport?.removeEventListener("scroll", updatePortalPosition);
    };
  }, [open, portal, updatePortalPosition]);

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

  const dropdown = (
    <div
      ref={dropdownRef}
      style={portal ? portalStyle : undefined}
      className={cn(
        portal ? "fixed z-[100]" : "absolute z-50 mt-1.5 w-full",
        "rounded-xl border border-border bg-card shadow-xl shadow-black/8",
        "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150",
        "overflow-hidden"
      )}
    >
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

      <div
        ref={listRef}
        style={portal ? { maxHeight: portalListHeight } : undefined}
        className={cn(!portal && "max-h-52", "overflow-y-auto overscroll-contain py-1")}
      >
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
                <div className="flex items-center gap-2 min-w-0">
                  {option.color && (
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: option.color }} />
                  )}
                  <span className="truncate">{option.label}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {option.selectedLabel && (
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {option.selectedLabel}
                    </span>
                  )}
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 shrink-0 text-primary" />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className={cn("relative", className)} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open && portal) updatePortalPosition();
          setOpen(!open);
          setSearch("");
        }}
        className={cn(
          "w-full flex items-center justify-between outline-none transition-all duration-200",
          "bg-muted/30 text-foreground border",
          compact
            ? "gap-1 px-1.5 py-1.5 rounded-lg text-[11px]"
            : "gap-2 px-3 py-2.5 rounded-xl text-sm",
          open
            ? "border-primary ring-2 ring-primary/10"
            : hasError
              ? "border-danger ring-2 ring-danger/10"
              : "border-border hover:border-primary/40",
        )}
      >
        <span className={cn(
          "text-left flex items-center",
          compact ? "gap-1 overflow-visible" : "truncate gap-1.5",
          !selected && "text-muted-foreground/50"
        )}>
          {selected ? (
            <>
              {selected.color && (
                <span className={cn("rounded-full flex-shrink-0", compact ? "w-1.5 h-1.5" : "w-2 h-2")} style={{ backgroundColor: selected.color }} />
              )}
              <span className={cn(compact ? "overflow-visible whitespace-nowrap" : "truncate")}>{selected.selectedLabel || selected.label}</span>
            </>
          ) : placeholder}
        </span>
        <ChevronDown className={cn(
          "shrink-0 text-muted-foreground transition-transform duration-200",
          compact ? "w-3 h-3" : "w-4 h-4",
          open && "rotate-180 text-primary"
        )} />
      </button>

      {/* Dropdown */}
      {open && (portal ? createPortal(dropdown, document.body) : dropdown)}
    </div>
  );
}
