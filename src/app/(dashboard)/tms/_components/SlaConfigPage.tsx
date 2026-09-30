"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClockCheck,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import RouteGuard from "@/components/RouteGuard";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import TmsClientSelector, { TMS_CLIENT_CHANGED_EVENT, readTmsClientParam } from "./TmsClientSelector";
import {
  buildSlaStandardTemplate,
  isSlaStandardGrid,
  parseSlaMatrixGrid,
  parseSlaStandardGrid,
  type ParsedSlaImportProfile,
} from "@/lib/tms-sla-import";

/* ─── Tipe ─── */

interface SlaGroup {
  id: string;
  name: string;
  clientCode: string | null;
  clientName: string | null;
}

interface SlaProfile {
  id: string;
  code: string;
  name: string;
  groupId: string;
  groupName: string | null;
  departureTargetTime: string | null;
  departureDayOffset: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: string;
  sourceFile: string | null;
  stopCount: number;
  unresolvedCount: number;
}

interface SlaAddress {
  id: string;
  vendorAddressId: string;
  storeNameSnapshot: string | null;
  isPrimary: boolean;
}

interface SlaStop {
  id: string;
  order: number;
  storeName: string;
  targetTime: string;
  targetDayOffset: number;
  unresolved: boolean;
  addresses: SlaAddress[];
}

interface SlaDetail extends SlaProfile {
  stops: SlaStop[];
}

interface ImportPreview {
  code: string;
  stopCount: number;
  unresolvedCount: number;
}

interface ImportIssue {
  profileCode: string;
  order: number | null;
  type: string;
  message: string;
}

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? "Permintaan gagal.");
  }
  return payload.data as T;
}

function withClient(path: string): string {
  const clientParam = readTmsClientParam();
  if (!clientParam) return path;
  return `${path}${path.includes("?") ? "&" : "?"}client=${encodeURIComponent(clientParam)}`;
}

/* ─── Halaman ─── */

export default function SlaConfigPage() {
  const [groups, setGroups] = useState<SlaGroup[]>([]);
  const [profiles, setProfiles] = useState<SlaProfile[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [groupFilter, setGroupFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("Aktif");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SlaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clientTick, setClientTick] = useState(0);

  const [profileForm, setProfileForm] = useState<null | {
    id: string | null;
    groupId: string;
    code: string;
    name: string;
    depart: string;
    departDay: string;
    effectiveFrom: string;
    effectiveUntil: string;
  }>(null);

  const [stopForm, setStopForm] = useState<null | {
    id: string | null;
    storeName: string;
    targetTime: string;
    dayOffset: string;
    order: string;
    addressIds: string;
  }>(null);

  const [mapInputs, setMapInputs] = useState<Record<string, string>>({});

  const [importState, setImportState] = useState<null | {
    fileName: string;
    parsed: ParsedSlaImportProfile[];
    clientIssues: string[];
    groupId: string;
    effectiveFrom: string;
    replace: boolean;
    preview: ImportPreview[] | null;
    serverIssues: ImportIssue[];
    done: string | null;
  }>(null);

  useEffect(() => {
    const onClientChanged = () => {
      setGroupFilter("");
      setSelectedId(null);
      setDetail(null);
      setClientTick((tick) => tick + 1);
    };
    window.addEventListener(TMS_CLIENT_CHANGED_EVENT, onClientChanged);
    return () => window.removeEventListener(TMS_CLIENT_CHANGED_EVENT, onClientChanged);
  }, []);

  const loadGroups = useCallback(async () => {
    const data = await api<SlaGroup[]>(withClient("/api/tms/sla-groups"));
    return Array.isArray(data) ? data : [];
  }, []);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      if (groupFilter) params.set("groupId", groupFilter);
      const clientParam = readTmsClientParam();
      if (clientParam) params.set("client", clientParam);
      const response = await fetch(`/api/tms/sla-profiles?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        data?: SlaProfile[];
        error?: string;
        meta?: { canManage?: boolean };
      };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Gagal memuat profil SLA.");
      setProfiles(Array.isArray(payload.data) ? payload.data : []);
      setCanManage(Boolean(payload.meta?.canManage));
      const groupsPayload = await loadGroups();
      setGroups(groupsPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat profil SLA.");
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, [groupFilter, loadGroups, statusFilter]);

  useEffect(() => {
    // clientTick memicu muat ulang saat pilihan client berubah.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfiles();
  }, [loadProfiles, clientTick]);

  const loadDetail = useCallback(async (profileId: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/tms/sla-profiles/${profileId}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        data?: SlaDetail;
        error?: string;
        meta?: { canManage?: boolean };
      };
      if (!response.ok || payload.error || !payload.data) {
        throw new Error(payload.error ?? "Gagal memuat detail profil.");
      }
      setDetail(payload.data);
      setCanManage(Boolean(payload.meta?.canManage));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat detail profil.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const refreshAll = useCallback(async () => {
    await loadProfiles();
    if (selectedId) await loadDetail(selectedId);
  }, [loadProfiles, loadDetail, selectedId]);

  const filteredProfiles = useMemo(() => profiles, [profiles]);

  /* ─── Aksi profil ─── */

  const submitProfile = useCallback(async () => {
    if (!profileForm) return;
    setBusy("profile");
    setError(null);
    try {
      if (profileForm.id) {
        await api(`/api/tms/sla-profiles/${profileForm.id}`, "PATCH", {
          name: profileForm.name,
          departureTargetTime: profileForm.depart || null,
          departureDayOffset: Number(profileForm.departDay) || 0,
          effectiveFrom: profileForm.effectiveFrom,
          effectiveUntil: profileForm.effectiveUntil || null,
        });
      } else {
        await api("/api/tms/sla-profiles", "POST", {
          groupId: profileForm.groupId,
          code: profileForm.code,
          name: profileForm.name || profileForm.code,
          departureTargetTime: profileForm.depart || null,
          departureDayOffset: Number(profileForm.departDay) || 0,
          effectiveFrom: profileForm.effectiveFrom,
          effectiveUntil: profileForm.effectiveUntil || null,
        });
      }
      setProfileForm(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan profil.");
    } finally {
      setBusy(null);
    }
  }, [profileForm, refreshAll]);

  const toggleProfileStatus = useCallback(
    async (profile: SlaProfile) => {
      const next = profile.status === "Aktif" ? "Tidak Aktif" : "Aktif";
      if (!window.confirm(`${next === "Aktif" ? "Aktifkan" : "Nonaktifkan"} profil ${profile.code}?`)) return;
      setBusy(`status-${profile.id}`);
      try {
        await api(`/api/tms/sla-profiles/${profile.id}`, "PATCH", { status: next });
        await refreshAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengubah status profil.");
      } finally {
        setBusy(null);
      }
    },
    [refreshAll],
  );

  /* ─── Aksi titik ─── */

  const submitStop = useCallback(async () => {
    if (!stopForm || !selectedId) return;
    setBusy("stop");
    setError(null);
    try {
      const addressIds = stopForm.addressIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (stopForm.id) {
        await api(`/api/tms/sla-profiles/${selectedId}/stops/${stopForm.id}`, "PATCH", {
          storeName: stopForm.storeName,
          targetTime: stopForm.targetTime,
          targetDayOffset: Number(stopForm.dayOffset) || 0,
          routeOrder: stopForm.order ? Number(stopForm.order) : undefined,
        });
      } else {
        await api(`/api/tms/sla-profiles/${selectedId}/stops`, "POST", {
          storeName: stopForm.storeName,
          targetTime: stopForm.targetTime,
          targetDayOffset: Number(stopForm.dayOffset) || 0,
          routeOrder: stopForm.order ? Number(stopForm.order) : undefined,
          addressIds,
        });
      }
      setStopForm(null);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan titik.");
    } finally {
      setBusy(null);
    }
  }, [stopForm, selectedId, loadDetail]);

  const deleteStop = useCallback(
    async (stop: SlaStop) => {
      if (!selectedId) return;
      if (!window.confirm(`Hapus titik "${stop.storeName}" beserta mapping-nya?`)) return;
      setBusy(`del-stop-${stop.id}`);
      try {
        await api(`/api/tms/sla-profiles/${selectedId}/stops/${stop.id}`, "DELETE");
        await loadDetail(selectedId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menghapus titik.");
      } finally {
        setBusy(null);
      }
    },
    [selectedId, loadDetail],
  );

  const addMapping = useCallback(
    async (stopId: string) => {
      if (!selectedId) return;
      const vendorAddressId = (mapInputs[stopId] ?? "").trim();
      if (!vendorAddressId) return;
      setBusy(`map-${stopId}`);
      try {
        await api(`/api/tms/sla-profiles/${selectedId}/stops/${stopId}/addresses`, "POST", {
          vendorAddressId,
        });
        setMapInputs((prev) => ({ ...prev, [stopId]: "" }));
        await loadDetail(selectedId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal memetakan address.");
      } finally {
        setBusy(null);
      }
    },
    [mapInputs, selectedId, loadDetail],
  );

  const removeMapping = useCallback(
    async (addressId: string) => {
      if (!selectedId) return;
      setBusy(`unmap-${addressId}`);
      try {
        await api(`/api/tms/sla-profiles/${selectedId}/addresses/${addressId}`, "DELETE");
        await loadDetail(selectedId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal melepas mapping.");
      } finally {
        setBusy(null);
      }
    },
    [selectedId, loadDetail],
  );

  /* ─── Import ─── */

  const downloadTemplate = useCallback(async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(buildSlaStandardTemplate());
    sheet["!cols"] = [
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 8 },
      { wch: 30 },
      { wch: 10 },
      { wch: 8 },
      { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, "Template SLA");
    XLSX.writeFile(workbook, "template-sla.xlsx");
  }, []);

  const handleImportFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1, raw: false, defval: "" }) as unknown as string[][];
      const parsed = isSlaStandardGrid(grid) ? parseSlaStandardGrid(grid) : parseSlaMatrixGrid(grid);
      if (parsed.profiles.length === 0) {
        throw new Error("Tidak ada profil valid pada file. Periksa format matrix/standar.");
      }
      setImportState({
        fileName: file.name,
        parsed: parsed.profiles,
        clientIssues: parsed.issues,
        groupId: "",
        effectiveFrom: jakartaToday(),
        replace: false,
        preview: null,
        serverIssues: [],
        done: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membaca file Excel.");
    }
  }, []);

  const runImportPreview = useCallback(async () => {
    if (!importState || !importState.groupId) {
      setError("Pilih kelompok tujuan import.");
      return;
    }
    setBusy("import-preview");
    setError(null);
    try {
      const payload = await api<{
        profiles: ImportPreview[];
        issues: ImportIssue[];
        wrote: boolean;
      }>("/api/tms/sla-profiles/import", "POST", {
        groupId: importState.groupId,
        effectiveFrom: importState.effectiveFrom,
        replace: importState.replace,
        sourceFile: importState.fileName,
        dryRun: true,
        profiles: importState.parsed.map((p) => ({
          code: p.code,
          departureTargetTime: p.depart,
          stops: p.stops.map((s) => ({
            order: s.order,
            storeName: s.storeName,
            targetTime: s.targetTime,
            targetDayOffset: s.dayOffset,
            addressIds: s.addressIds,
          })),
        })),
      });
      setImportState((prev) =>
        prev ? { ...prev, preview: payload.profiles, serverIssues: payload.issues, done: null } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memvalidasi import.");
    } finally {
      setBusy(null);
    }
  }, [importState]);

  const commitImport = useCallback(async () => {
    if (!importState || !importState.groupId) return;
    if (!window.confirm(`Simpan ${importState.parsed.length} profil ke kelompok terpilih?`)) return;
    setBusy("import-commit");
    setError(null);
    try {
      const payload = await api<{ profiles: ImportPreview[]; issues: ImportIssue[] }>(
        "/api/tms/sla-profiles/import",
        "POST",
        {
          groupId: importState.groupId,
          effectiveFrom: importState.effectiveFrom,
          replace: importState.replace,
          sourceFile: importState.fileName,
          dryRun: false,
          profiles: importState.parsed.map((p) => ({
            code: p.code,
            departureTargetTime: p.depart,
            stops: p.stops.map((s) => ({
              order: s.order,
              storeName: s.storeName,
              targetTime: s.targetTime,
              targetDayOffset: s.dayOffset,
              addressIds: s.addressIds,
            })),
          })),
        },
      );
      setImportState((prev) =>
        prev
          ? {
              ...prev,
              preview: payload.profiles,
              serverIssues: payload.issues,
              done: `${payload.profiles.length} profil tersimpan.`,
            }
          : prev,
      );
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan import.");
    } finally {
      setBusy(null);
    }
  }, [importState, refreshAll]);

  /* ─── Render ─── */

  return (
    <RouteGuard permission="tms.sla-config">
      <div className="space-y-5">
        <PageHeader
          title="Pengaturan SLA"
          description="Profil rute dan jam kedatangan standar per client dan kelompok kendaraan"
          icon={AlarmClockCheck}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <TmsClientSelector compact />
              {canManage && (
                <>
                  <Button size="sm" variant="outline" icon={Download} onClick={() => void downloadTemplate()}>
                    Template
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Upload}
                    onClick={() => document.getElementById("sla-import-file")?.click()}
                  >
                    Import Excel
                  </Button>
                  <input
                    id="sla-import-file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void handleImportFile(file);
                    }}
                  />
                  <Button
                    size="sm"
                    icon={Plus}
                    onClick={() =>
                      setProfileForm({
                        id: null,
                        groupId: groupFilter,
                        code: "",
                        name: "",
                        depart: "",
                        departDay: "0",
                        effectiveFrom: jakartaToday(),
                        effectiveUntil: "",
                      })
                    }
                  >
                    Profil Baru
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" icon={RefreshCw} disabled={loading} onClick={() => void refreshAll()}>
                Muat ulang
              </Button>
            </div>
          }
        />

        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">{error}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3">
          <select
            aria-label="Filter kelompok"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
            value={groupFilter}
            onChange={(event) => {
              setGroupFilter(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value="">Semua kelompok</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.clientName ? `${group.clientName} · ${group.name}` : group.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter status"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value="Aktif">Aktif</option>
            <option value="Tidak Aktif">Tidak Aktif</option>
            <option value="ALL">Semua status</option>
          </select>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {filteredProfiles.length} profil
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Profil</th>
                  <th className="px-4 py-3 font-semibold">Kelompok</th>
                  <th className="px-4 py-3 font-semibold">Berangkat</th>
                  <th className="px-4 py-3 font-semibold">Berlaku</th>
                  <th className="px-4 py-3 font-semibold">Titik</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  {canManage && <th className="px-4 py-3 text-right font-semibold">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <tr key={index} className="animate-pulse border-b border-border/60">
                      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-muted" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 rounded bg-muted" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-14 rounded bg-muted" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-28 rounded bg-muted" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-10 rounded bg-muted" /></td>
                      <td className="px-4 py-3"><div className="h-5 w-16 rounded-full bg-muted" /></td>
                    </tr>
                  ))
                ) : filteredProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 7 : 6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      Belum ada profil SLA. {canManage ? "Buat profil baru atau import dari Excel." : ""}
                    </td>
                  </tr>
                ) : (
                  filteredProfiles.map((profile) => (
                    <tr
                      key={profile.id}
                      className={cn(
                        "cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40",
                        selectedId === profile.id && "bg-muted/40",
                      )}
                      onClick={() => setSelectedId((prev) => (prev === profile.id ? null : profile.id))}
                    >
                      <td className="px-4 py-3">
                        <p className="text-xs font-bold tabular-nums text-foreground">{profile.code}</p>
                        <p className="text-[11px] text-muted-foreground">{profile.name}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground">{profile.groupName ?? "–"}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-foreground">
                        {profile.departureTargetTime ?? "–"}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                        {profile.effectiveFrom}
                        {profile.effectiveUntil ? ` s/d ${profile.effectiveUntil}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold tabular-nums text-foreground">{profile.stopCount}</span>
                        {profile.unresolvedCount > 0 && (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                            <TriangleAlert className="h-3 w-3" />
                            {profile.unresolvedCount} tanpa ID
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={profile.status === "Aktif" ? "success" : "muted"}>{profile.status}</Badge>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                          <span className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              title="Ubah profil"
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() =>
                                setProfileForm({
                                  id: profile.id,
                                  groupId: profile.groupId,
                                  code: profile.code,
                                  name: profile.name,
                                  depart: profile.departureTargetTime ?? "",
                                  departDay: String(profile.departureDayOffset ?? 0),
                                  effectiveFrom: profile.effectiveFrom,
                                  effectiveUntil: profile.effectiveUntil ?? "",
                                })
                              }
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title={profile.status === "Aktif" ? "Nonaktifkan" : "Aktifkan"}
                              disabled={busy === `status-${profile.id}`}
                              className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                              onClick={() => void toggleProfileStatus(profile)}
                            >
                              {profile.status === "Aktif" ? "Nonaktifkan" : "Aktifkan"}
                            </button>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Kartu mobile */}
          <div className="space-y-2.5 p-4 lg:hidden">
            {filteredProfiles.map((profile) => (
              <article
                key={profile.id}
                className="rounded-xl border border-border bg-background p-3.5"
                onClick={() => setSelectedId((prev) => (prev === profile.id ? null : profile.id))}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold tabular-nums text-foreground">{profile.code}</p>
                    <p className="text-[11px] text-muted-foreground">{profile.groupName ?? "–"}</p>
                  </div>
                  <Badge variant={profile.status === "Aktif" ? "success" : "muted"}>{profile.status}</Badge>
                </div>
                <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                  {profile.stopCount} titik
                  {profile.unresolvedCount > 0 ? ` · ${profile.unresolvedCount} tanpa ID` : ""}
                  {profile.departureTargetTime ? ` · berangkat ${profile.departureTargetTime}` : ""}
                </p>
              </article>
            ))}
            {filteredProfiles.length === 0 && !loading && (
              <p className="py-6 text-center text-sm text-muted-foreground">Belum ada profil SLA.</p>
            )}
          </div>
        </div>

        {/* Detail profil */}
        {selectedId && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-foreground">
                {detail ? `${detail.code} · ${detail.groupName ?? ""}` : "Memuat…"}
              </p>
              {detail?.unresolvedCount !== undefined && detail.unresolvedCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                  <TriangleAlert className="h-3 w-3" />
                  {detail.unresolvedCount} titik belum terhubung ke McEasy
                </span>
              )}
              <span className="ml-auto flex items-center gap-2">
                {canManage && detail && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Plus}
                    onClick={() =>
                      setStopForm({ id: null, storeName: "", targetTime: "", dayOffset: "0", order: "", addressIds: "" })
                    }
                  >
                    Tambah Titik
                  </Button>
                )}
                <button
                  type="button"
                  aria-label="Tutup detail"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </div>
            {detailLoading || !detail ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded-xl bg-muted" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="w-14 px-4 py-3 font-semibold">No</th>
                      <th className="px-4 py-3 font-semibold">Nama Toko</th>
                      <th className="px-4 py-3 font-semibold">Jam SLA</th>
                      <th className="px-4 py-3 font-semibold">Address McEasy</th>
                      {canManage && <th className="px-4 py-3 text-right font-semibold">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.stops.map((stop) => (
                      <tr key={stop.id} className="border-b border-border/60 align-top last:border-0">
                        <td className="px-4 py-3 text-xs font-bold tabular-nums text-foreground">{stop.order}</td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold text-foreground">{stop.storeName}</p>
                          {stop.unresolved && (
                            <p className="mt-0.5 text-[11px] font-semibold text-amber-600">
                              Belum terhubung — status SLA Belum Diatur
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs tabular-nums text-foreground">
                          {stop.targetTime}
                          {stop.targetDayOffset > 0 ? ` (+${stop.targetDayOffset} hari)` : ""}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-72 flex-wrap gap-1">
                            {stop.addresses.map((address) => (
                              <span
                                key={address.id}
                                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-foreground"
                                title={address.storeNameSnapshot ?? undefined}
                              >
                                {address.vendorAddressId}
                                {address.isPrimary && <span className="font-sans font-bold text-primary">·</span>}
                                {canManage && (
                                  <button
                                    type="button"
                                    aria-label={`Lepas ${address.vendorAddressId}`}
                                    disabled={busy === `unmap-${address.id}`}
                                    className="text-muted-foreground hover:text-danger disabled:opacity-50"
                                    onClick={() => void removeMapping(address.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </span>
                            ))}
                            {canManage && (
                              <span className="inline-flex items-center gap-1">
                                <input
                                  className="w-24 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]"
                                  placeholder="ID baru"
                                  value={mapInputs[stop.id] ?? ""}
                                  onChange={(event) =>
                                    setMapInputs((prev) => ({ ...prev, [stop.id]: event.target.value }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") void addMapping(stop.id);
                                  }}
                                />
                                <button
                                  type="button"
                                  aria-label={`Petakan ke ${stop.storeName}`}
                                  disabled={busy === `map-${stop.id}` || !(mapInputs[stop.id] ?? "").trim()}
                                  className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-bold text-foreground hover:bg-muted/70 disabled:opacity-50"
                                  onClick={() => void addMapping(stop.id)}
                                >
                                  +
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                        {canManage && (
                          <td className="px-4 py-3">
                            <span className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                title="Ubah titik"
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                onClick={() =>
                                  setStopForm({
                                    id: stop.id,
                                    storeName: stop.storeName,
                                    targetTime: stop.targetTime,
                                    dayOffset: String(stop.targetDayOffset),
                                    order: String(stop.order),
                                    addressIds: "",
                                  })
                                }
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Hapus titik"
                                disabled={busy === `del-stop-${stop.id}`}
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-danger disabled:opacity-50"
                                onClick={() => void deleteStop(stop)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          SLA dihitung dari jadwal internal client per kelompok; perubahan jadwal tidak mengubah hasil perjalanan yang
          sudah tersnapshot. Titik tanpa address McEasy berstatus “SLA Belum Diatur” hingga dipetakan.
        </p>
      </div>

      {/* Modal profil */}
      {profileForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-foreground">{profileForm.id ? "Ubah Profil" : "Profil Baru"}</p>
              <button type="button" aria-label="Tutup" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setProfileForm(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs">
              {!profileForm.id && (
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Kelompok</span>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2"
                    value={profileForm.groupId}
                    onChange={(event) => setProfileForm({ ...profileForm, groupId: event.target.value })}
                  >
                    <option value="">Pilih kelompok</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.clientName ? `${group.clientName} · ${group.name}` : group.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!profileForm.id && (
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Kode profil</span>
                  <input
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 uppercase"
                    placeholder="VAN 13"
                    value={profileForm.code}
                    onChange={(event) => setProfileForm({ ...profileForm, code: event.target.value })}
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block font-semibold text-muted-foreground">Nama profil</span>
                <input
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2"
                  placeholder="VAN 13 CP"
                  value={profileForm.name}
                  onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Berangkat gudang (opsional)</span>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 tabular-nums"
                    value={profileForm.depart}
                    onChange={(event) => setProfileForm({ ...profileForm, depart: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Hari ke berangkat</span>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 tabular-nums"
                    value={profileForm.departDay}
                    onChange={(event) => setProfileForm({ ...profileForm, departDay: event.target.value })}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Berlaku mulai</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2"
                    value={profileForm.effectiveFrom}
                    onChange={(event) => setProfileForm({ ...profileForm, effectiveFrom: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Berlaku sampai (opsional)</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2"
                    value={profileForm.effectiveUntil}
                    min={profileForm.effectiveFrom}
                    onChange={(event) => setProfileForm({ ...profileForm, effectiveUntil: event.target.value })}
                  />
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setProfileForm(null)}>
                Batal
              </Button>
              <Button size="sm" disabled={busy === "profile"} onClick={() => void submitProfile()}>
                {busy === "profile" ? "Menyimpan…" : "Simpan"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal titik */}
      {stopForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-foreground">{stopForm.id ? "Ubah Titik" : "Titik Baru"}</p>
              <button type="button" aria-label="Tutup" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setStopForm(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs">
              <label className="block">
                <span className="mb-1 block font-semibold text-muted-foreground">Nama toko</span>
                <input
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2"
                  placeholder="Toko Kopi Tuku Contoh"
                  value={stopForm.storeName}
                  onChange={(event) => setStopForm({ ...stopForm, storeName: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Jam SLA</span>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 tabular-nums"
                    value={stopForm.targetTime}
                    onChange={(event) => setStopForm({ ...stopForm, targetTime: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Hari ke</span>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 tabular-nums"
                    value={stopForm.dayOffset}
                    onChange={(event) => setStopForm({ ...stopForm, dayOffset: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Urutan</span>
                  <input
                    type="number"
                    min={1}
                    placeholder="otomatis"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 tabular-nums"
                    value={stopForm.order}
                    onChange={(event) => setStopForm({ ...stopForm, order: event.target.value })}
                  />
                </label>
              </div>
              {!stopForm.id && (
                <label className="block">
                  <span className="mb-1 block font-semibold text-muted-foreground">Address ID McEasy (opsional, pisahkan koma)</span>
                  <input
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-2 font-mono"
                    placeholder="43690, 6553"
                    value={stopForm.addressIds}
                    onChange={(event) => setStopForm({ ...stopForm, addressIds: event.target.value })}
                  />
                </label>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setStopForm(null)}>
                Batal
              </Button>
              <Button size="sm" disabled={busy === "stop"} onClick={() => void submitStop()}>
                {busy === "stop" ? "Menyimpan…" : "Simpan"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal import */}
      {importState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-foreground">Import SLA: {importState.fileName}</p>
              <button type="button" aria-label="Tutup" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setImportState(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {importState.clientIssues.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700">
                <p className="font-bold">Catatan parser ({importState.clientIssues.length})</p>
                <ul className="mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4">
                  {importState.clientIssues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block font-semibold text-muted-foreground">Kelompok tujuan</span>
                <select
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2"
                  value={importState.groupId}
                  onChange={(event) => setImportState({ ...importState, groupId: event.target.value, preview: null })}
                >
                  <option value="">Pilih kelompok</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.clientName ? `${group.clientName} · ${group.name}` : group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-muted-foreground">Berlaku mulai</span>
                <input
                  type="date"
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2"
                  value={importState.effectiveFrom}
                  onChange={(event) => setImportState({ ...importState, effectiveFrom: event.target.value, preview: null })}
                />
              </label>
              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-primary"
                  checked={importState.replace}
                  onChange={(event) => setImportState({ ...importState, replace: event.target.checked, preview: null })}
                />
                <span className="font-semibold text-muted-foreground">Nonaktifkan profil berkode sama</span>
              </label>
            </div>

            <div className="mt-3 rounded-xl border border-border">
              <p className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Profil terbaca ({importState.parsed.length})
              </p>
              <ul className="max-h-40 divide-y divide-border/60 overflow-y-auto px-3 py-1 text-xs">
                {importState.parsed.map((profile) => (
                  <li key={profile.code} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="font-bold tabular-nums text-foreground">{profile.code}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {profile.stops.length} titik{profile.depart ? ` · berangkat ${profile.depart}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {importState.preview && (
              <div className="mt-3 rounded-xl border border-border">
                <p className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Hasil validasi server
                </p>
                <ul className="max-h-40 divide-y divide-border/60 overflow-y-auto px-3 py-1 text-xs">
                  {importState.preview.map((profile) => (
                    <li key={profile.code} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="font-bold tabular-nums text-foreground">{profile.code}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {profile.stopCount} titik
                        {profile.unresolvedCount > 0 ? ` · ${profile.unresolvedCount} tanpa ID` : " · semua terhubung"}
                      </span>
                    </li>
                  ))}
                </ul>
                {importState.serverIssues.length > 0 && (
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto border-t border-border bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700">
                    {importState.serverIssues.map((issue, index) => (
                      <li key={index}>[{issue.profileCode}] {issue.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {importState.done && (
              <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-600">
                {importState.done}
              </p>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportState(null)}>
                Tutup
              </Button>
              <Button size="sm" variant="outline" disabled={busy === "import-preview" || !importState.groupId} onClick={() => void runImportPreview()}>
                {busy === "import-preview" ? "Memvalidasi…" : "Validasi"}
              </Button>
              <Button size="sm" disabled={busy === "import-commit" || !importState.preview} onClick={() => void commitImport()}>
                {busy === "import-commit" ? "Menyimpan…" : "Simpan Import"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </RouteGuard>
  );
}
