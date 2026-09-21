"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase-browser";
import { compressFile, formatFileSize } from "@/lib/file-compression";
import {
  formatDistance,
  haversineMeters,
  TMS_EPOD_COMPRESS_KB,
  TMS_EPOD_GEOFENCE_METERS,
  TMS_EPOD_MAX_PHOTOS,
  validateEpodSubmission,
  type EpodAssignment,
  type EpodDeliveryResult,
  type EpodStop,
  type EpodSubmission,
} from "@/lib/tms-epod";
import { EpodAssignmentBadge, EpodResultBadge } from "./EpodStatusBadge";
import EpodEvidenceGallery from "./EpodEvidenceGallery";

interface AssignmentDetail {
  assignment: EpodAssignment;
  driverName: string | null;
  helperName: string | null;
  stops: EpodStop[];
  currentByStop: Record<string, EpodSubmission>;
}

interface DetailResponse {
  data?: AssignmentDetail;
  error?: string;
}

interface EmployeeOption {
  id: string;
  nama: string;
}

interface UploadedEvidence {
  path: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string | null;
  sortOrder: number;
}

interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "–";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "–";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed));
}

/** Ambil posisi GPS browser sekali. */
function getPosition(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Browser tidak mendukung GPS."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        }),
      () => reject(new Error("Gagal membaca lokasi. Izinkan akses lokasi pada browser.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function RosterEditor({
  assignmentId,
  driverEmployeeId,
  helperEmployeeId,
  locked,
  onSaved,
}: {
  assignmentId: string;
  driverEmployeeId: string | null;
  helperEmployeeId: string | null;
  locked: boolean;
  onSaved: () => void;
}) {
  const [drivers, setDrivers] = useState<EmployeeOption[]>([]);
  const [helpers, setHelpers] = useState<EmployeeOption[]>([]);
  const [saving, setSaving] = useState<"DRIVER" | "HELPER" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [driverResponse, helperResponse] = await Promise.all([
          fetch("/api/tms/epod/employees?role=DRIVER", { cache: "no-store" }),
          fetch("/api/tms/epod/employees?role=HELPER", { cache: "no-store" }),
        ]);
        const driverPayload = (await driverResponse.json()) as { data?: EmployeeOption[] };
        const helperPayload = (await helperResponse.json()) as { data?: EmployeeOption[] };
        if (!active) return;
        setDrivers(driverPayload.data ?? []);
        setHelpers(helperPayload.data ?? []);
      } catch {
        if (active) setError("Gagal memuat daftar pegawai.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(
    async (role: "DRIVER" | "HELPER", employeeId: string) => {
      setSaving(role);
      setError(null);
      try {
        const response = await fetch(`/api/tms/epod/${assignmentId}/roster`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, employeeId: employeeId || null }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok || payload.error) {
          setError(payload.error ?? "Gagal menyimpan tim.");
          return;
        }
        onSaved();
      } catch {
        setError("Gagal menyimpan tim e-POD.");
      } finally {
        setSaving(null);
      }
    },
    [assignmentId, onSaved],
  );

  if (locked) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Tim terkunci karena bukti sudah dikirim. Hubungi admin untuk perubahan.
      </p>
    );
  }

  const renderSelect = (role: "DRIVER" | "HELPER", value: string | null, options: EmployeeOption[]) => (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0 font-semibold text-muted-foreground">{role === "DRIVER" ? "Driver" : "Helper"}</span>
      <select
        className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground"
        value={value ?? ""}
        disabled={saving !== null}
        onChange={(event) => void save(role, event.target.value)}
      >
        <option value="">Belum ditetapkan</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.nama}
          </option>
        ))}
      </select>
      {saving === role && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </label>
  );

  return (
    <div className="space-y-2">
      {renderSelect("DRIVER", driverEmployeeId, drivers)}
      {renderSelect("HELPER", helperEmployeeId, helpers)}
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-danger">
          <TriangleAlert className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}

function StopSubmissionForm({
  stop,
  loadingCompleted,
  onSubmitted,
}: {
  stop: EpodStop;
  loadingCompleted: boolean;
  onSubmitted: () => void;
}) {
  const [result, setResult] = useState<EpodDeliveryResult>("DELIVERED");
  const [recipientName, setRecipientName] = useState("");
  const [note, setNote] = useState("");
  const [outOfRadiusReason, setOutOfRadiusReason] = useState("");
  const [evidence, setEvidence] = useState<UploadedEvidence[]>([]);
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDelivery = stop.stopType === "DELIVERY";
  const distance = useMemo(() => {
    if (!geo || stop.latitude === null || stop.longitude === null) return null;
    return haversineMeters(geo.latitude, geo.longitude, stop.latitude, stop.longitude);
  }, [geo, stop.latitude, stop.longitude]);

  const outOfRadius = distance !== null && distance > TMS_EPOD_GEOFENCE_METERS;

  const locate = useCallback(async () => {
    setLocating(true);
    setError(null);
    try {
      setGeo(await getPosition());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gagal membaca lokasi.");
    } finally {
      setLocating(false);
    }
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setError(null);
      const remaining = TMS_EPOD_MAX_PHOTOS - evidence.length;
      const selected = Array.from(files).slice(0, Math.max(0, remaining));
      try {
        const supabase = createClient();
        const uploaded: UploadedEvidence[] = [];
        for (const file of selected) {
          const compressed = await compressFile(file, TMS_EPOD_COMPRESS_KB);
          if (!compressed.success) {
            setError(compressed.error);
            continue;
          }
          const prepared = compressed.file;
          const permissionResponse = await fetch("/api/tms/epod/uploads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stopId: stop.id,
              mimeType: prepared.type,
              sizeBytes: prepared.size,
              filename: prepared.name,
            }),
          });
          const permission = (await permissionResponse.json()) as {
            data?: { bucket: string; path: string; token: string };
            error?: string;
          };
          if (!permissionResponse.ok || !permission.data) {
            setError(permission.error ?? "Gagal menyiapkan unggahan foto.");
            continue;
          }
          const { bucket, path, token } = permission.data;
          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .uploadToSignedUrl(path, token, prepared, { contentType: prepared.type });
          if (uploadError) {
            setError(`Gagal mengunggah ${prepared.name}: ${uploadError.message}`);
            continue;
          }
          uploaded.push({
            path,
            mimeType: prepared.type,
            sizeBytes: prepared.size,
            originalFilename: prepared.name,
            sortOrder: evidence.length + uploaded.length,
          });
        }
        if (uploaded.length > 0) setEvidence((prev) => [...prev, ...uploaded].slice(0, TMS_EPOD_MAX_PHOTOS));
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [evidence.length, stop.id],
  );

  const submit = useCallback(async () => {
    setError(null);
    const validationError = validateEpodSubmission({
      stopType: stop.stopType,
      result: isDelivery ? result : null,
      recipientName,
      note,
      photoCount: evidence.length,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      distanceMeters: distance,
      outOfRadiusReason,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/tms/epod/stops/${stop.id}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: isDelivery ? result : null,
          recipientName,
          note,
          latitude: geo?.latitude ?? null,
          longitude: geo?.longitude ?? null,
          accuracyMeters: geo?.accuracy ?? null,
          capturedAtDevice: new Date().toISOString(),
          outOfRadiusReason,
          evidence,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal mengirim bukti.");
        return;
      }
      setEvidence([]);
      setRecipientName("");
      setNote("");
      setOutOfRadiusReason("");
      onSubmitted();
    } catch {
      setError("Gagal mengirim bukti e-POD.");
    } finally {
      setSubmitting(false);
    }
  }, [
    distance,
    evidence,
    geo,
    isDelivery,
    note,
    onSubmitted,
    outOfRadiusReason,
    recipientName,
    result,
    stop.stopType,
    stop.id,
  ]);

  if (isDelivery && !loadingCompleted) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
        Form pengiriman terkunci. Selesaikan bukti loading terlebih dahulu.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      {isDelivery && (
        <div className="flex flex-wrap gap-1.5">
          {(["DELIVERED", "PARTIAL", "REJECTED"] as EpodDeliveryResult[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setResult(option)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                result === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {option === "DELIVERED" ? "Terkirim" : option === "PARTIAL" ? "Parsial" : "Ditolak"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {isDelivery && result !== "REJECTED" && (
          <input
            className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
            placeholder="Nama penerima"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
          />
        )}
        <input
          className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
          placeholder={isDelivery && result !== "DELIVERED" ? "Alasan / catatan (wajib)" : "Catatan (opsional)"}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => void locate()}
          disabled={locating}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 font-semibold text-muted-foreground hover:bg-muted"
        >
          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
          {geo ? "Perbarui lokasi" : "Ambil lokasi"}
        </button>
        {distance !== null && (
          <span className={cn("tabular-nums font-semibold", outOfRadius ? "text-danger" : "text-emerald-600")}>
            {formatDistance(distance)} dari titik
          </span>
        )}
      </div>

      {outOfRadius && (
        <input
          className="w-full rounded-lg border border-danger/40 bg-danger/5 px-2.5 py-2 text-xs"
          placeholder={`Alasan berada > ${TMS_EPOD_GEOFENCE_METERS} m dari titik (wajib)`}
          value={outOfRadiusReason}
          onChange={(event) => setOutOfRadiusReason(event.target.value)}
        />
      )}

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            icon={Camera}
            disabled={uploading || evidence.length >= TMS_EPOD_MAX_PHOTOS}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Mengunggah…" : "Tambah foto"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {evidence.length}/{TMS_EPOD_MAX_PHOTOS} foto
          </span>
        </div>
        {evidence.length > 0 && (
          <ul className="mt-2 space-y-1">
            {evidence.map((item) => (
              <li key={item.path} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{item.originalFilename ?? item.path}</span>
                <span className="tabular-nums">{formatFileSize(item.sizeBytes)}</span>
                <button
                  type="button"
                  className="text-danger"
                  onClick={() => setEvidence((prev) => prev.filter((entry) => entry.path !== item.path))}
                  aria-label="Hapus foto"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-danger">
          <TriangleAlert className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      <Button
        type="button"
        size="sm"
        disabled={submitting || uploading || evidence.length === 0}
        onClick={() => void submit()}
      >
        {submitting ? "Mengirim…" : stop.stopType === "LOADING" ? "Kirim bukti loading" : "Kirim e-POD"}
      </Button>
    </div>
  );
}

export default function EpodStopPanel({
  assignmentId,
  canManage,
  onChanged,
  onClose,
}: {
  assignmentId: string;
  canManage: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [galleryKey, setGalleryKey] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tms/epod/${assignmentId}`, { cache: "no-store" });
      const payload = (await response.json()) as DetailResponse;
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal memuat detail e-POD.");
        return;
      }
      setDetail(payload.data ?? null);
    } catch {
      setError("Gagal memuat detail e-POD.");
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refreshAll = useCallback(() => {
    void load();
    setGalleryKey((key) => key + 1);
    onChanged();
  }, [load, onChanged]);

  const cancelAssignment = useCallback(async () => {
    const reason = window.prompt("Alasan pembatalan assignment?");
    if (!reason || !reason.trim()) return;
    setCancelling(true);
    try {
      const response = await fetch(`/api/tms/epod/${assignmentId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal membatalkan assignment.");
        return;
      }
      refreshAll();
    } catch {
      setError("Gagal membatalkan assignment.");
    } finally {
      setCancelling(false);
    }
  }, [assignmentId, refreshAll]);

  if (loading && !detail) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat detail…
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-3 p-4">
        <p className="flex items-center gap-1.5 text-sm text-danger">
          <TriangleAlert className="h-4 w-4" /> {error}
        </p>
        <Button size="sm" variant="outline" onClick={onClose}>
          Tutup
        </Button>
      </div>
    );
  }

  if (!detail) return null;
  const { assignment, stops, currentByStop, driverName, helperName } = detail;
  const loadingCompleted = assignment.loadingStatus === "LOADING_COMPLETED";
  const locked = assignment.frozenAt !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{assignment.taskNumber ?? assignment.taskId}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[assignment.licensePlate, assignment.vendorDriverName].filter(Boolean).join(" • ") || "–"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <EpodAssignmentBadge status={assignment.status} />
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              Loading {loadingCompleted ? "selesai" : "belum"}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
              e-POD {assignment.deliveryDoneCount}/{assignment.deliveryTotalCount}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          aria-label="Tutup detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tim</p>
          {canManage ? (
            <RosterEditor
              assignmentId={assignment.id}
              driverEmployeeId={assignment.driverEmployeeId}
              helperEmployeeId={assignment.helperEmployeeId}
              locked={locked}
              onSaved={refreshAll}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Driver: {driverName ?? "Belum ditetapkan"} · Helper: {helperName ?? "Belum ditetapkan"}
            </p>
          )}
        </section>

        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Titik ({stops.length})
          </p>
          <ol className="space-y-2">
            {stops.map((stop) => {
              const current = currentByStop[stop.id];
              const expanded = expandedStopId === stop.id;
              const isLockedDelivery = stop.stopType === "DELIVERY" && !loadingCompleted;
              return (
                <li key={stop.id} className="rounded-xl border border-border">
                  <button
                    type="button"
                    onClick={() => setExpandedStopId(expanded ? null : stop.id)}
                    className="flex w-full items-center gap-2 p-3 text-left"
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-foreground">
                          {stop.sequence}. {stop.pointName ?? "Titik"}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                            stop.stopType === "LOADING"
                              ? "bg-indigo-500/10 text-indigo-600"
                              : "bg-sky-500/10 text-sky-600",
                          )}
                        >
                          {stop.stopType === "LOADING" ? "Loading" : "Pengantaran"}
                        </span>
                        {current?.result && <EpodResultBadge result={current.result} />}
                        {stop.stopType === "LOADING" && current && (
                          <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                            Bukti terkirim
                          </span>
                        )}
                      </span>
                      {stop.address && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{stop.address}</span>
                      )}
                    </span>
                  </button>

                  {expanded && (
                    <div className="space-y-3 border-t border-border p-3">
                      {canManage && assignment.status !== "CANCELLED" && (
                        <StopSubmissionForm
                          stop={stop}
                          loadingCompleted={loadingCompleted}
                          onSubmitted={refreshAll}
                        />
                      )}
                      {!canManage && isLockedDelivery && (
                        <p className="text-[11px] text-muted-foreground">
                          Menunggu bukti loading sebelum pengantaran.
                        </p>
                      )}
                      <EpodEvidenceGallery stopId={stop.id} refreshKey={galleryKey} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {canManage && assignment.status !== "CANCELLED" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cancelling}
            onClick={() => void cancelAssignment()}
          >
            {cancelling ? "Membatalkan…" : "Batalkan assignment"}
          </Button>
        )}

        {error && (
          <p className="flex items-center gap-1.5 text-[11px] text-danger">
            <TriangleAlert className="h-3.5 w-3.5" /> {error}
          </p>
        )}

        <p className="text-[10px] text-muted-foreground">
          Snapshot: {formatDateTime(assignment.snapshotAt)}
          {locked && " · Terkunci sejak bukti pertama"}
        </p>
      </div>
    </div>
  );
}
