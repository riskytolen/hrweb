"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink, Image as ImageIcon, Loader2, X } from "lucide-react";
import Portal from "@/components/ui/Portal";
import { cn } from "@/lib/utils";
import { createAttendanceEvidenceSignedUrl } from "../lib/attendance-evidence";

type AttendanceEvidenceButtonProps = {
  path: string | null | undefined;
  fileName?: string | null;
  label?: string;
  className?: string;
};

/** Tombol kecil + modal untuk membuka foto eviden privat lewat signed URL. */
export function AttendanceEvidenceButton({
  path,
  fileName,
  label = "Lihat",
  className,
}: AttendanceEvidenceButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!path) return null;

  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    setError("");
    setUrl(null);
    try {
      const signedUrl = await createAttendanceEvidenceSignedUrl(path);
      setUrl(signedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuka foto eviden.");
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setOpen(false);
    setUrl(null);
    setError("");
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary/15",
          className,
        )}
        title={fileName ? `Lihat eviden: ${fileName}` : "Lihat eviden"}
      >
        <ImageIcon className="h-3 w-3" />
        {label}
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
            <div className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">Eviden Absensi</p>
                  {fileName && <p className="truncate text-[10px] text-muted-foreground">{fileName}</p>}
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Tutup eviden"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex min-h-[240px] items-center justify-center bg-muted/30 p-4">
                {loading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memuat foto...
                  </div>
                ) : error ? (
                  <div className="flex max-w-sm items-center gap-2 rounded-xl border border-danger/20 bg-danger-light px-3 py-2.5 text-xs text-danger">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL privat, bukan aset statis Next.
                  <img
                    src={url}
                    alt="Eviden absensi"
                    className="max-h-[70vh] max-w-full rounded-lg object-contain shadow-sm"
                  />
                ) : null}
              </div>

              {url && (
                <div className="flex justify-end border-t border-border px-4 py-2.5">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Buka di tab baru
                  </a>
                </div>
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
