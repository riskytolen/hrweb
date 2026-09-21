"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageIcon, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDistance,
  EPOD_RESULT_LABEL,
  type EpodEvidence,
  type EpodStop,
  type EpodSubmission,
} from "@/lib/tms-epod";

interface EvidenceWithUrl extends EpodEvidence {
  signedUrl: string | null;
}

interface StopDetailResponse {
  data?: {
    stop: EpodStop;
    submissions: EpodSubmission[];
    evidenceBySubmission?: Record<string, EvidenceWithUrl[]>;
  };
  error?: string;
}

function formatDateTime(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

const ACTOR_LABEL: Record<string, string> = {
  WEB_ADMIN: "Admin Web",
  DRIVER: "Driver",
  HELPER: "Helper",
};

export default function EpodEvidenceGallery({
  stopId,
  refreshKey,
}: {
  stopId: string;
  refreshKey: number;
}) {
  const [detail, setDetail] = useState<StopDetailResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tms/epod/stops/${stopId}`, { cache: "no-store" });
      const payload = (await response.json()) as StopDetailResponse;
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal memuat bukti.");
        setDetail(null);
        return;
      }
      setDetail(payload.data ?? null);
    } catch {
      setError("Gagal memuat bukti e-POD.");
    } finally {
      setLoading(false);
    }
  }, [stopId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  if (loading && !detail) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat bukti…
      </div>
    );
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 py-3 text-xs text-danger">
        <TriangleAlert className="h-3.5 w-3.5" /> {error}
      </p>
    );
  }

  const submissions = detail?.submissions ?? [];
  if (submissions.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">Belum ada bukti untuk titik ini.</p>;
  }

  return (
    <div className="space-y-3">
      {submissions.map((submission) => {
        const evidence = detail?.evidenceBySubmission?.[submission.id] ?? [];
        return (
          <div
            key={submission.id}
            className={cn(
              "rounded-xl border p-3",
              submission.isCurrent ? "border-border bg-card" : "border-dashed border-border bg-muted/30",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary">
                Versi {submission.version}
              </span>
              {submission.isCurrent && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-600">
                  Aktif
                </span>
              )}
              {submission.result && (
                <span className="font-semibold text-foreground">{EPOD_RESULT_LABEL[submission.result]}</span>
              )}
              {submission.actorType && (
                <span className="text-muted-foreground">{ACTOR_LABEL[submission.actorType] ?? submission.actorType}</span>
              )}
              {submission.distanceMeters !== null && (
                <span className={cn("tabular-nums", submission.geofenceOk === false ? "text-danger" : "text-muted-foreground")}>
                  {formatDistance(submission.distanceMeters)} dari titik
                </span>
              )}
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {submission.recipientName && (
                <>
                  <dt className="font-semibold">Penerima</dt>
                  <dd className="text-foreground">{submission.recipientName}</dd>
                </>
              )}
              {submission.note && (
                <>
                  <dt className="font-semibold">Catatan</dt>
                  <dd className="text-foreground">{submission.note}</dd>
                </>
              )}
              {submission.outOfRadiusReason && (
                <>
                  <dt className="font-semibold text-danger">Alasan luar radius</dt>
                  <dd className="text-foreground">{submission.outOfRadiusReason}</dd>
                </>
              )}
              <dt className="font-semibold">Waktu server</dt>
              <dd className="tabular-nums text-foreground">{formatDateTime(submission.capturedAtServer)}</dd>
              {submission.capturedAtDevice && (
                <>
                  <dt className="font-semibold">Waktu perangkat</dt>
                  <dd className="tabular-nums text-foreground">{formatDateTime(submission.capturedAtDevice)}</dd>
                </>
              )}
            </dl>

            {evidence.length > 0 ? (
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {evidence.map((item) => (
                  <a
                    key={item.id}
                    href={item.signedUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative block aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                  >
                    {item.signedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.signedUrl}
                        alt={item.originalFilename ?? "Foto bukti"}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-5 w-5" />
                      </span>
                    )}
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5" />
                {submission.evidencePurgedAt ? "Foto sudah dibersihkan (masa retensi)." : "Foto tidak tersedia."}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
