"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  FileDown,
  Loader2,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Route as RouteIcon,
  Trash2,
  TriangleAlert,
  Truck,
  Undo2,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Portal from "@/components/ui/Portal";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase-browser";
import { compressFile, formatFileSize } from "@/lib/file-compression";
import {
  EPOD_PETUGAS_ROLE_LABELS,
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
  type EpodPetugasRole,
  type EpodStop,
  type EpodSubmission,
} from "@/lib/tms-epod";
import {
  EpodAssignmentBadge,
  EpodLoadingBadge,
  EpodResultBadge,
  EpodSentBadge,
  EpodStopTypeBadge,
} from "./EpodStatusBadge";
import EpodEvidenceGallery from "./EpodEvidenceGallery";

interface AssignmentDetail {
  assignment: EpodAssignment;
  assignedName: string | null;
  assignedRoleLabel: string | null;
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
  role: EpodPetugasRole | null;
  mobileAllowed: boolean;
  jabatanNama: string | null;
}

function petugasOptionLabel(option: EmployeeOption): string {
  const label = option.role
    ? EPOD_PETUGAS_ROLE_LABELS[option.role]
    : (option.jabatanNama ?? "Petugas");
  return `${option.nama} - ${label}`;
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
  petugasId,
  petugasName,
  petugasRoleLabel,
  locked,
  onSaved,
}: {
  assignmentId: string;
  petugasId: string | null;
  petugasName: string | null;
  petugasRoleLabel: string | null;
  locked: boolean;
  onSaved: () => void;
}) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selected, setSelected] = useState<string>(petugasId ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/tms/epod/employees", { cache: "no-store" });
        const payload = (await response.json()) as { data?: EmployeeOption[] };
        if (!active) return;
        setEmployees(payload.data ?? []);
      } catch {
        if (active) setError("Gagal memuat daftar pegawai.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedEmployee = employees.find((item) => item.id === selected) ?? null;
  const needsReason = selected !== "" && selectedEmployee !== null && !selectedEmployee.mobileAllowed;

  const save = useCallback(async () => {
    if (needsReason && !reason.trim()) {
      setError("Penugasan untuk jabatan ini wajib menyertakan alasan.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/tms/epod/${assignmentId}/roster`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selected || null, reason: reason.trim() || null }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal menyimpan petugas.");
        return;
      }
      setReason("");
      onSaved();
    } catch {
      setError("Gagal menyimpan petugas e-POD.");
    } finally {
      setSaving(false);
    }
  }, [assignmentId, onSaved, selected, reason, needsReason]);

  const forceRelease = useCallback(async () => {
    if (!releaseReason.trim()) {
      setReleaseError("Alasan reset e-POD wajib diisi.");
      return;
    }
    setReleasing(true);
    setReleaseError(null);
    try {
      const response = await fetch(`/api/tms/epod/${assignmentId}/force-release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: releaseReason.trim() }),
      });
      const payload = (await response.json()) as { error?: string; warning?: string };
      if (!response.ok || payload.error) {
        setReleaseError(payload.error ?? "Gagal mereset e-POD.");
        return;
      }
      setReleaseReason("");
      setReleaseOpen(false);
      onSaved();
    } catch {
      setReleaseError("Gagal mereset e-POD.");
    } finally {
      setReleasing(false);
    }
  }, [assignmentId, onSaved, releaseReason]);

  const closeRelease = useCallback(() => {
    if (releasing) return;
    setReleaseOpen(false);
    setReleaseError(null);
    setReleaseReason("");
  }, [releasing]);

  useEffect(() => {
    if (!releaseOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRelease();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [releaseOpen, closeRelease]);

  if (locked) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          {petugasName ?? "Belum ditetapkan"}
          {petugasRoleLabel ? ` - ${petugasRoleLabel}` : ""}. Petugas terkunci karena bukti sudah
          dikirim.
        </p>
        <Button
          size="sm"
          variant="outline"
          icon={Trash2}
          onClick={() => setReleaseOpen(true)}
          className="border-danger/40 text-danger hover:bg-danger/5"
        >
          Reset eviden & lepas petugas
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Menghapus seluruh foto dan hasil e-POD FO ini, melepas petugas, dan membuka kunci agar bisa
          dikerjakan ulang.
        </p>

        {releaseOpen && (
          <Portal>
            <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Reset e-POD dan lepas petugas"
                className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl"
              >
                <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10">
                    <TriangleAlert className="h-5 w-5 text-danger" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-foreground">
                      Reset e-POD & lepas petugas?
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {petugasName ?? "Petugas"}
                      {petugasRoleLabel ? ` - ${petugasRoleLabel}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeRelease}
                    disabled={releasing}
                    aria-label="Tutup"
                    className="rounded-lg p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3 px-5 py-4">
                  <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-[11px] text-danger">
                    Semua foto bukti dan hasil e-POD FO ini akan <strong>dihapus permanen</strong>.
                    Petugas dilepas, kunci dibuka, dan FO harus dikerjakan ulang dari awal.
                  </div>
                  <label className="flex flex-col gap-1.5 text-xs">
                    <span className="font-semibold text-muted-foreground">Alasan reset (wajib)</span>
                    <input
                      autoFocus
                      className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                      placeholder="mis. Salah petugas, evidence perlu submit ulang"
                      value={releaseReason}
                      disabled={releasing}
                      onChange={(event) => {
                        setReleaseReason(event.target.value);
                        if (releaseError) setReleaseError(null);
                      }}
                    />
                  </label>
                  {releaseError && (
                    <p className="flex items-start gap-1.5 text-[11px] text-danger">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {releaseError}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
                  <Button size="sm" variant="outline" disabled={releasing} onClick={closeRelease}>
                    Batal
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={releasing ? Loader2 : Trash2}
                    disabled={releasing || !releaseReason.trim()}
                    onClick={() => void forceRelease()}
                  >
                    {releasing ? "Mereset…" : "Ya, reset & lepas petugas"}
                  </Button>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
          <User className="h-3.5 w-3.5" /> Petugas e-POD
        </span>
        <select
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
          value={selected}
          disabled={saving}
          onChange={(event) => {
            setSelected(event.target.value);
            if (event.target.value === "") setReason("");
          }}
        >
          <option value="">Belum ditetapkan</option>
          {employees.map((option) => (
            <option key={option.id} value={option.id}>
              {petugasOptionLabel(option)}
            </option>
          ))}
        </select>
      </label>
      {needsReason && (
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold text-muted-foreground">
            Alasan penugasan (wajib untuk jabatan {selectedEmployee?.jabatanNama ?? "ini"})
          </span>
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
            placeholder="mis. Koordinator turun lapangan menggantikan driver"
            value={reason}
            disabled={saving}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      )}
      <div>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? "Menyimpan…" : "Simpan petugas"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Satu FO hanya untuk satu petugas. Jabatan selain Driver, Helper, Koordinator, dan Wakil
        Koordinator wajib menyertakan alasan.
      </p>
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
                className="w-16 shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-xs tabular-nums"
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
                className="w-20 shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
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
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [galleryKey, setGalleryKey] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const detailCardRef = useRef<HTMLDivElement | null>(null);

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

  const revertAssignment = useCallback(async () => {
    const confirmed = window.confirm(
      "Kembalikan assignment ini? Status akan dipulihkan sesuai data terakhir.",
    );
    if (!confirmed) return;
    setReverting(true);
    try {
      const response = await fetch(`/api/tms/epod/${assignmentId}/revert`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok || payload.error) {
        setError(payload.error ?? "Gagal mengembalikan assignment.");
        return;
      }
      refreshAll();
    } catch {
      setError("Gagal mengembalikan assignment.");
    } finally {
      setReverting(false);
    }
  }, [assignmentId, refreshAll]);

  const selectStop = useCallback((stopId: string) => {
    setSelectedStopId((prev) => (prev === stopId ? null : stopId));
  }, []);

  /** Buat laporan PDF e-POD (hanya saat seluruh e-POD selesai). */
  const exportPdf = useCallback(async () => {
    const taskId = detail?.assignment.taskId;
    if (!taskId) return;
    setExportingPdf(true);
    setPdfError(null);
    try {
      const { exportEpodPdf } = await import("@/lib/tms-epod-pdf");
      await exportEpodPdf(taskId);
    } catch (caught) {
      setPdfError(caught instanceof Error ? caught.message : "Gagal membuat laporan PDF e-POD.");
    } finally {
      setExportingPdf(false);
    }
  }, [detail?.assignment.taskId]);

  /** Di layar kecil kolom kanan menumpuk di bawah, jadi gulirkan ke kartu detail. */
  useEffect(() => {
    if (!selectedStopId) return;
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) return;
    detailCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedStopId]);

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
  const { assignment, stops, currentByStop, assignedName, assignedRoleLabel } = detail;
  const petugasId = assignment.assignedEmployeeId;
  const loadingCompleted = assignment.loadingStatus === "LOADING_COMPLETED";
  const locked = assignment.frozenAt !== null;
  const allDelivered =
    assignment.deliveryTotalCount > 0 && assignment.deliveryDoneCount >= assignment.deliveryTotalCount;

  // Titik yang dipilih untuk ditampilkan di kolom kanan.
  const selectedStop = selectedStopId ? stops.find((stop) => stop.id === selectedStopId) ?? null : null;
  const selectedSubmission = selectedStop ? currentByStop[selectedStop.id] ?? null : null;
  const selectedLockedDelivery = selectedStop?.stopType === "DELIVERY" && !loadingCompleted;

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
          {assignment.status === "COMPLETED" && (
            <Button
              size="sm"
              variant="outline"
              icon={exportingPdf ? Loader2 : FileDown}
              disabled={exportingPdf}
              onClick={() => void exportPdf()}
            >
              {exportingPdf ? "Menyiapkan PDF…" : "Export PDF"}
            </Button>
          )}
          <Button size="sm" variant="outline" icon={RefreshCw} disabled={loading} onClick={refreshAll}>
            Muat ulang
          </Button>
        </div>
      </div>

      {pdfError && (
        <p className="flex items-start gap-1.5 text-[11px] text-danger">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{pdfError}</span>
        </p>
      )}

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

      <div className="grid items-start gap-5 lg:grid-cols-5">
        {/* Kolom kiri */}
        <div className="space-y-5 lg:col-span-3">
          {/* Petugas e-POD */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Users className="h-4 w-4 text-muted-foreground" /> Petugas e-POD
            </h2>
            <div className="mt-3">
              {canManage ? (
                <RosterEditor
                  assignmentId={assignment.id}
                  petugasId={petugasId}
                  petugasName={assignedName}
                  petugasRoleLabel={assignedRoleLabel}
                  locked={locked}
                  onSaved={refreshAll}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {assignedName ?? "Belum ditetapkan"}
                  {assignedRoleLabel ? ` - ${assignedRoleLabel}` : ""}
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

            <ol className="mt-4 space-y-2.5">
              {stops.map((stop) => {
                const current = currentByStop[stop.id];
                const selected = selectedStopId === stop.id;
                const isLoading = stop.stopType === "LOADING";
                return (
                  <li
                    key={stop.id}
                    className={cn(
                      "overflow-hidden rounded-2xl border bg-card transition-colors",
                      selected ? "border-primary/40 ring-1 ring-primary/30" : "border-border",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectStop(stop.id)}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center gap-3.5 p-4 text-left transition-colors",
                        selected ? "bg-primary/5" : "hover:bg-muted/40",
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                        {stop.sequence}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-foreground">
                            {stop.pointName ?? "Titik"}
                          </span>
                          <EpodStopTypeBadge stopType={stop.stopType} />
                          {current?.result && <EpodResultBadge result={current.result} />}
                          {isLoading && current && <EpodSentBadge />}
                        </span>
                        {stop.address && (
                          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate" title={stop.address}>
                              {stop.address}
                            </span>
                          </span>
                        )}
                        {isLoading && (
                          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Package className="h-3 w-3 shrink-0" />
                            Titik awal · Proses loading barang dari gudang
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <ChevronRight
                          className={cn("h-4 w-4 transition-transform", selected && "rotate-90")}
                        />
                      </span>
                    </button>
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

          {canManage && assignment.status === "CANCELLED" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              icon={reverting ? Loader2 : Undo2}
              disabled={reverting}
              onClick={() => void revertAssignment()}
              className="border-success/40 text-success hover:bg-success/5"
            >
              {reverting ? "Mengembalikan…" : "Kembalikan assignment"}
            </Button>
          )}

          {error && (
            <p className="flex items-center gap-1.5 text-[11px] text-danger">
              <TriangleAlert className="h-3.5 w-3.5" /> {error}
            </p>
          )}

          <p className="text-[10px] text-muted-foreground">
            Snapshot: {formatDateTime(assignment.snapshotAt)}
            {locked && " · Terkunci sejak bukti pertama — bisa di-reset dari kartu Petugas"}
          </p>
        </div>

        {/* Kolom kanan: detail titik terpilih + informasi pengiriman */}
        <div className="space-y-5 lg:col-span-2 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          {selectedStop && (
            <section ref={detailCardRef} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <MapPin className="h-4 w-4 text-muted-foreground" /> Detail Titik
                  </h2>
                  <p className="mt-1 truncate text-sm font-bold text-foreground">
                    {selectedStop.sequence}. {selectedStop.pointName ?? "Titik"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <EpodStopTypeBadge stopType={selectedStop.stopType} />
                    {selectedSubmission?.result && <EpodResultBadge result={selectedSubmission.result} />}
                    {selectedStop.stopType === "LOADING" && selectedSubmission && <EpodSentBadge />}
                  </div>
                  {selectedStop.address && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{selectedStop.address}</span>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStopId(null)}
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label="Tutup detail titik"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {canManage && assignment.status !== "CANCELLED" && (
                  <StopSubmissionForm
                    stop={selectedStop}
                    loadingCompleted={loadingCompleted}
                    onSubmitted={refreshAll}
                  />
                )}
                {!canManage && selectedLockedDelivery && (
                  <p className="text-[11px] text-muted-foreground">
                    Menunggu bukti loading sebelum pengantaran.
                  </p>
                )}
                <EpodEvidenceGallery stopId={selectedStop.id} refreshKey={galleryKey} />
              </div>
            </section>
          )}

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
