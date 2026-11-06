"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Layers, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type DivisionFilterProps = {
  value: string;
  onChange: (value: string) => void;
  divisions: { id: number; nama: string; color: string }[];
};

export function DivisionFilter({ value, onChange, divisions }: DivisionFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const options = [
    { value: "semua", label: "Semua Divisi", color: null },
    ...divisions.map((d) => ({ value: String(d.id), label: d.nama, color: d.color })),
  ];
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) => option.label.toLocaleLowerCase("id").includes(query.trim().toLocaleLowerCase("id")));

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div ref={root} className="relative w-full sm:w-60" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
        onClick={() => {
          setQuery("");
          setActive(Math.max(0, options.findIndex((option) => option.value === value)));
          setOpen(!open);
        }}
        className={cn("flex w-full items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", open ? "border-primary shadow-sm" : "border-border hover:border-primary/40")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Layers className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Filter Divisi</span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            {selected?.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: selected.color }} />}
            <span className="truncate">{selected?.label ?? (value === "1" ? "CP Suka" : "Pilih divisi")}</span>
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border p-2">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input ref={input} role="combobox" aria-label="Cari divisi" aria-expanded={open} aria-controls={`${id}-list`}
                aria-autocomplete="list" aria-activedescendant={filtered[active] ? `${id}-option-${active}` : undefined}
                value={query} placeholder="Cari divisi..."
                onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) => Math.max(0, Math.min(filtered.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
                  }
                  if (event.key === "Enter" && filtered[active]) { event.preventDefault(); choose(filtered[active].value); }
                }}
                className="min-w-0 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" />
            </div>
          </div>
          <div id={`${id}-list`} role="listbox" aria-label="Divisi" className="max-h-64 overflow-y-auto overscroll-contain p-1.5">
            {filtered.map((option, index) => (
              <button key={option.value} id={`${id}-option-${index}`} type="button" role="option" aria-selected={option.value === value} tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option.value)}
                className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-xs transition-colors hover:bg-muted", option.value === value ? "bg-primary/10 font-semibold text-primary" : "text-foreground", index === active && "ring-1 ring-inset ring-primary/30")}>
                {option.color ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} /> : <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === value && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
            {!filtered.length && <p role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">Divisi tidak ditemukan</p>}
          </div>
        </div>
      )}
    </div>
  );
}
