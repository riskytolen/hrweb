"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Loader2,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Trash2,
  TriangleAlert,
  Truck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase-browser";
import { compressFile, formatFileSize } from "@/lib/file-compression";
import {
  filledEpodItems,
  formatDistance,
  haversineMeters,
  toEpodItemPayload,
  TMS_EPOD_COMPRESS_KB,
  TMS_EPOD_GEOFENCE_METERS,
  TMS_EPOD_MAX_ITEMS,
  TMS_EPOD_MAX_PHOTOS,
  validateEpodSubmission,
  type EpodAssignment,
  type EpodDeliveryResult,
  type EpodItemInput,
  type EpodStop,
  type EpodSubmission,
} from "@/lib/tms-epod";
import {
  EpodAssignmentBadge,
  EpodLoadingBadge,
  EpodResultBadge,
  EpodStopTypeBadge,
} from "./EpodStatusBadge";
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
    <label className="flex flex-col gap-1.5 text-xs">
      <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
        {role === "DRIVER" ? <User className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
        {role === "DRIVER" ? "Driver" : "Helper"}
      </span>
      <span className="flex items-center gap-2">
        <select
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
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
        {saving === role && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </span>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {renderSelect("DRIVER", driverEmployeeId, drivers)}
        {renderSelect("HELPER", helperEmployeeId, helpers)}
      </div>
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
  const [items, setItems] = useState<EpodItemInput[]>([{ name: "", quantity: "", unit: "" }]);
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
      items,
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
          items: isDelivery ? toEpodItemPayload(items) : [],
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
      setItems([{ name: "", quantity: "", unit: "" }]);
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
    items,
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

      {isDelivery && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground">
            Barang ({filledEpodItems(items).length}) <span className="font-normal">· wajib minimal 1</span>
          </p>
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
                placeholder="Nama barang"
                value={item.name}
                onChange={(event) =>
                  setItems((prev) =>
                    prev.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)),
                  )
                }
              />
              <input
                className="w-20 shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-xs tabular-nums"
                inputMode="decimal"
                placeholder="Qty"
                value={item.quantity}
                onChange={(event) =>
                  setItems((prev) =>
                    prev.map((entry, i) => (i === index ? { ...entry, quantity: event.target.value } : entry)),
                  )
                }
              />
              <input
                className="w-24 shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
                placeholder="Satuan"
                value={item.unit}
                onChange={(event) =>
                  setItems((prev) =>
                    prev.map((entry, i) => (i === index ? { ...entry, unit: event.target.value } : entry)),
                  )
                }
              />
              <button
                type="button"
                disabled={items.length <= 1}
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-danger disabled:opacity-40"
                aria-label="Hapus barang"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {items.length < TMS_EPOD_MAX_ITEMS && (
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, { name: "", quantity: "", unit: "" }])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" /> Tambah barang
            </button>
          )}
        </div>
      )}

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

/** Baris informasi ringkas pada kartu Informasi Pengiriman. */
function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto min-w-0 truncate text-right font-semibold text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Stepper 3 langkah sesuai data e-POD kita:
 * Loading -> Pengantaran -> Selesai.
 */
function EpodProgressStepper({
  loadingCompleted,
  allDelivered,
  completed,
}: {
  loadingCompleted: boolean;
  allDelivered: boolean;
  completed: boolean;
}) {
  const steps: { label: string; caption: string; state: "done" | "active" | "pending" }[] = [
    {
      label: "Loading",
      caption: "Persiapan barang",
      state: loadingCompleted ? "done" : "active",
    },
    {
      label: "Pengantaran",
      caption: "Dalam perjalanan",
      state: allDelivered ? "done" : loadingCompleted ? "active" : "pending",
    },
    {
      label: "Selesai",
      caption: "Semua bukti lengkap",
      state: completed ? "done" : "pending",
    },
  ];

  return (
    <div className="flex items-start">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className={cn("flex items-center gap-2", index < steps.length - 1 && "flex-1")}
        >
          <div className="flex w-24 shrink-0 flex-col items-center gap-1 text-center">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold",
                step.state === "done" && "bg-primary text-white",
                step.state === "active" && "bg-primary/15 text-primary ring-2 ring-primary/30",
                step.state === "pending" && "bg-muted text-muted-foreground",
              )}
            >
              {step.state === "done" ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-[11px] font-semibold",
                step.state === "pending" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {step.label}
            </span>
            <span className="text-[10px] text-muted-foreground">{step.caption}</span>
          </div>
          {index < steps.length - 1 && (
            <span
              className={cn(
                "mb-8 h-0.5 flex-1 rounded-full",
                step.state === "done" ? "bg-primary" : "bg-muted",
              )}
            />
          )}
        </div>
      ))}
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
  const allDelivered =
    assignment.deliveryTotalCount > 0 && assignment.deliveryDoneCount >= assignment.deliveryTotalCount;

  return (
    <div className="space-y-5">
      {/* Bar atas: kembali, snapshot, muat ulang */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" variant="outline" icon={ArrowLeft} onClick={onClose}>
          Kembali ke Daftar
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">Snapshot</span>
            <span className="tabular-nums">{formatDateTime(assignment.snapshotAt)}</span>
          </span>
          <Button size="sm" variant="outline" icon={RefreshCw} disabled={loading} onClick={refreshAll}>
            Muat ulang
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Package className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xl font-extrabold text-foreground">
            {assignment.taskNumber ?? assignment.taskId}
          </p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {[assignment.licensePlate, assignment.vendorDriverName].filter(Boolean).join(" • ") || "–"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <EpodAssignmentBadge status={assignment.status} />
            <EpodLoadingBadge completed={loadingCompleted} />
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold tabular-nums text-muted-foreground">
              e-POD {assignment.deliveryDoneCount}/{assignment.deliveryTotalCount}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Kolom kiri */}
        <div className="space-y-5 lg:col-span-2">
          {/* Tim Pengiriman */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Users className="h-4 w-4 text-muted-foreground" /> Tim Pengiriman
            </h2>
            <div className="mt-3">
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
            </div>
          </section>

          {/* Progres */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <RouteIcon className="h-4 w-4 text-muted-foreground" /> Progres Pengiriman
            </h2>
            <div className="mt-4">
              <EpodProgressStepper
                loadingCompleted={loadingCompleted}
                allDelivered={allDelivered}
                completed={assignment.status === "COMPLETED"}
              />
            </div>
          </section>

          {/* Daftar Titik */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <MapPin className="h-4 w-4 text-muted-foreground" /> Daftar Titik Pengiriman ({stops.length})
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Urutan pengiriman sesuai rute yang telah ditentukan
            </p>

            <ol className="mt-4 space-y-2">
              {stops.map((stop) => {
                const current = currentByStop[stop.id];
                const expanded = expandedStopId === stop.id;
                const isLockedDelivery = stop.stopType === "DELIVERY" && !loadingCompleted;
                const isLoading = stop.stopType === "LOADING";
                return (
                  <li
                    key={stop.id}
                    className={cn(
                      "overflow-hidden rounded-xl border border-border border-l-4",
                      isLoading ? "border-l-orange-400" : "border-l-sky-400",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedStopId(expanded ? null : stop.id)}
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold",
                          isLoading
                            ? "bg-orange-500/15 text-orange-600"
                            : "bg-sky-500/15 text-sky-600",
                        )}
                      >
                        {stop.sequence}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-foreground">
                            {stop.pointName ?? "Titik"}
                          </span>
                          <EpodStopTypeBadge stopType={stop.stopType} />
                          {current?.result && <EpodResultBadge result={current.result} />}
                          {isLoading && current && (
                            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                              Bukti terkirim
                            </span>
                          )}
                        </span>
                        {stop.address && (
                          <span className="mt-0.5 flex items-start gap-1 text-[11px] text-muted-foreground">
                            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="line-clamp-2">{stop.address}</span>
                          </span>
                        )}
                        {isLoading && (
                          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Package className="h-3 w-3 shrink-0" />
                            Titik awal · Proses loading barang dari gudang
                          </span>
                        )}
                      </span>
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          expanded && "rotate-90",
                        )}
                      />
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
              icon={Trash2}
              disabled={cancelling}
              onClick={() => void cancelAssignment()}
              className="border-danger/40 text-danger hover:bg-danger/5"
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

        {/* Kolom kanan */}
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Truck className="h-4 w-4 text-muted-foreground" /> Informasi Pengiriman
            </h2>
            <dl className="mt-2 divide-y divide-border text-xs">
              <InfoRow icon={Package} label="No. FO" value={assignment.taskNumber ?? assignment.taskId} />
              <InfoRow icon={Truck} label="No. Kendaraan" value={assignment.licensePlate ?? "–"} />
              <InfoRow icon={User} label="Nama Driver" value={assignment.vendorDriverName ?? "–"} />
              <InfoRow icon={MapPin} label="Total Titik" value={`${stops.length} titik`} />
              <InfoRow
                icon={RouteIcon}
                label="e-POD Selesai"
                value={`${assignment.deliveryDoneCount} dari ${assignment.deliveryTotalCount}`}
              />
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
