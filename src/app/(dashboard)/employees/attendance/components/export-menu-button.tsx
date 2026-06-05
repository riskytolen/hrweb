"use client";

import { Download, FileText, ChevronDown } from "lucide-react";
import Button from "@/components/ui/Button";

type ExportMenuButtonProps = {
  menuRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  onToggle: () => void;
  onExportPDF: () => void;
  onExportCSV: () => void;
  disabled?: boolean;
};

export function ExportMenuButton({
  menuRef,
  open,
  onToggle,
  onExportPDF,
  onExportCSV,
  disabled,
}: ExportMenuButtonProps) {
  return (
    <div ref={menuRef} className="relative">
      <Button variant="outline" size="sm" icon={Download} onClick={onToggle} disabled={disabled}>
        Export <ChevronDown className="w-3 h-3 ml-0.5" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-card rounded-xl border border-border shadow-xl z-10 overflow-hidden animate-scale-in">
          <button onClick={onExportPDF} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
            <FileText className="w-3.5 h-3.5 text-danger" />Export PDF
          </button>
          <button onClick={onExportCSV} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors border-t border-border">
            <FileText className="w-3.5 h-3.5 text-success" />Export CSV
          </button>
        </div>
      )}
    </div>
  );
}
