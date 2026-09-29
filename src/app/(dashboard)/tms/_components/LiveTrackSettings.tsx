"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TriangleAlert,
  Truck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import RouteGuard from "@/components/RouteGuard";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import Portal from "@/components/ui/Portal";
import {
  summarizeLiveTrackWindow,
  type LiveTrackGroup,
  type LiveTrackVehicleOption,
} from "@/lib/tms-live-track-config";
import {
  isLiveTrackWindowActive,
  parseClockToMinutes,
} from "@/lib/tms-live-track-schedule";

/* ─── Tipe respons ─── */

interface GroupsResponse {
  data?: LiveTrackGroup[];
  error?: string;
  meta?: { canManage?: boolean };
}

interface VehiclesResponse {
  data?: LiveTrackVehicleOption[];
  error?: string;
  meta?: { liveError?: string | null; canManage?: boolean };
}

interface MemberDraft {
  mceasyVehicleId: number;
  licensePlate: string;
  vendorGroups: string[];
  useGroupSchedule: boolean;
  overrideWindowStart: string;
  overrideWindowEnd: string;
  enabled: boolean;
}

interface GroupDraft {
  id: string | null;
  name: string;
  description: string;
  color: string;
  status: string;
  defaultWindowStart: string;
  defaultWindowEnd: string;
  effectiveFrom: string;
  effectiveUntil: string;
  members: MemberDraft[];
  clientId: string;
}

interface TmsClientOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_DRAFT: GroupDraft = {
  id: null,
  name: "",
  description: "",
  color: "#0284c7",
  status: "Aktif",
  defaultWindowStart: "06:00",
  defaultWindowEnd: "18:00",
  effectiveFrom: "",
  effectiveUntil: "",
  members: [],
  clientId: "",
};

const GROUP_COLORS = ["#0284c7", "#16a34a", "#ea580c", "#7c3aed", "#db2777", "#0891b2", "#ca8a04", "#475569"];

/* ─── Helper ─── */

function memberEffectiveWindow(
  member: { useGroupSchedule: boolean; overrideWindowStart: string | null; overrideWindowEnd: string | null },
  groupStart: string,
  groupEnd: string,
): { start: string; end: string; overridden: boolean } {
  if (!member.useGroupSchedule && member.overrideWindowStart && member.overrideWindowEnd) {
    return { start: member.overrideWindowStart, end: member.overrideWindowEnd, overridden: true };
  }
  return { start: groupStart, end: groupEnd, overridden: false };
}

function countActiveMembers(group: LiveTrackGroup, nowMs: number): number {
  if (group.status !== "Aktif") return 0;
  return group.members.filter((m) => {
    if (!m.enabled) return false;
    const window = memberEffectiveWindow(m, group.defaultWindowStart, group.defaultWindowEnd);
    return isLiveTrackWindowActive(
      parseClockToMinutes(window.start),
      parseClockToMinutes(window.end),
      nowMs,
    );
  }).length;
}

/* ─── Komponen ─── */

export default function LiveTrackSettings() {
  const [groups, setGroups] = useState<LiveTrackGroup[]>([]);
  const [vehicles, setVehicles] = useState<LiveTrackVehicleOption[]>([]);
  const [tmsClients, setTmsClients] = useState<TmsClientOption[]>([]);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState<GroupDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vendorGroupFilter, setVendorGroupFilter] = useState("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCanManage(null);
    try {
      const [groupsRes, vehiclesRes, clientsRes] = await Promise.all([
        fetch("/api/tms/live-track-config/groups", { cache: "no-store" }),
        fetch("/api/tms/live-track-config/vehicles", { cache: "no-store" }),
        fetch("/api/tms/clients", { cache: "no-store" }),
      ]);
      const groupsPayload = (await groupsRes.json()) as GroupsResponse;
      const vehiclesPayload = (await vehiclesRes.json()) as VehiclesResponse;
      const clientsPayload = (await clientsRes.json().catch(() => ({}))) as {
        data?: TmsClientOption[];
      };
      if (!groupsRes.ok || groupsPayload.error) {
        setError(groupsPayload.error ?? "Gagal memuat kelompok Live Track.");
        return;
      }
      if (!vehiclesRes.ok || vehiclesPayload.error) {
        setError(vehiclesPayload.error ?? "Gagal memuat daftar unit.");
        return;
      }
      setGroups(Array.isArray(groupsPayload.data) ? groupsPayload.data : []);
      setVehicles(Array.isArray(vehiclesPayload.data) ? vehiclesPayload.data : []);
      setTmsClients(Array.isArray(clientsPayload.data) ? clientsPayload.data : []);
      setCanManage(
        Boolean(groupsPayload.meta?.canManage) || Boolean(vehiclesPayload.meta?.canManage),
      );
      setLiveError(vehiclesPayload.meta?.liveError ?? null);
    } catch {
      setError("Gagal memuat Pengaturan Live Track.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const vendorGroups = useMemo(() => {
    const set = new Set<string>();
    for (const vehicle of vehicles) {
      for (const group of vehicle.vendorGroups) set.add(group);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "id"));
  }, [vehicles]);

  const filteredGroups = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return groups;
    return groups.filter((group) =>
      [group.name, group.description ?? ""].join(" ").toLowerCase().includes(keyword),
    );
  }, [groups, search]);

  const openCreate = useCallback(() => {
    setDraft({ ...EMPTY_DRAFT, members: [] });
    setSaveError(null);
    setVehicleSearch("");
    setVendorGroupFilter("all");
    setShowModal(true);
  }, []);

  const openEdit = useCallback((group: LiveTrackGroup) => {
    setDraft({
      id: group.id,
      name: group.name,
      description: group.description ?? "",
      color: group.color,
      status: group.status,
      defaultWindowStart: group.defaultWindowStart,
      defaultWindowEnd: group.defaultWindowEnd,
      effectiveFrom: group.effectiveFrom ?? "",
      effectiveUntil: group.effectiveUntil ?? "",
      clientId: "",
      members: group.members.map((m) => ({
        mceasyVehicleId: m.mceasyVehicleId,
        licensePlate: m.licensePlate,
        vendorGroups: m.vendorGroups,
        useGroupSchedule: m.useGroupSchedule,
        overrideWindowStart: m.overrideWindowStart ?? group.defaultWindowStart,
        overrideWindowEnd: m.overrideWindowEnd ?? group.defaultWindowEnd,
        enabled: m.enabled,
      })),
    });
    setSaveError(null);
    setVehicleSearch("");
    setVendorGroupFilter("all");
    setShowModal(true);
  }, []);

  const draftMemberMap = useMemo(
    () => new Map(draft.members.map((m) => [m.mceasyVehicleId, m])),
    [draft.members],
  );

  const filteredVehicles = useMemo(() => {
    const keyword = vehicleSearch.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      if (vendorGroupFilter !== "all" && !vehicle.vendorGroups.includes(vendorGroupFilter)) return false;
      if (!keyword) return true;
      return [vehicle.licensePlate, String(vehicle.mceasyVehicleId)]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [vehicles, vehicleSearch, vendorGroupFilter]);

  const toggleVehicle = useCallback(
    (vehicle: LiveTrackVehicleOption) => {
      setDraft((prev) => {
        const exists = prev.members.some((m) => m.mceasyVehicleId === vehicle.mceasyVehicleId);
        if (exists) {
          return { ...prev, members: prev.members.filter((m) => m.mceasyVehicleId !== vehicle.mceasyVehicleId) };
        }
        return {
          ...prev,
          members: [
            ...prev.members,
            {
              mceasyVehicleId: vehicle.mceasyVehicleId,
              licensePlate: vehicle.licensePlate,
              vendorGroups: vehicle.vendorGroups,
              useGroupSchedule: true,
              overrideWindowStart: prev.defaultWindowStart,
              overrideWindowEnd: prev.defaultWindowEnd,
              enabled: true,
            },
          ],
        };
      });
    },
    [],
  );

  const selectAllFiltered = useCallback(() => {
    setDraft((prev) => {
      const existing = new Set(prev.members.map((m) => m.mceasyVehicleId));
      const additions: MemberDraft[] = filteredVehicles
        .filter((v) => !existing.has(v.mceasyVehicleId))
        .map((v) => ({
          mceasyVehicleId: v.mceasyVehicleId,
          licensePlate: v.licensePlate,
          vendorGroups: v.vendorGroups,
          useGroupSchedule: true,
          overrideWindowStart: prev.defaultWindowStart,
          overrideWindowEnd: prev.defaultWindowEnd,
          enabled: true,
        }));
      return { ...prev, members: [...prev.members, ...additions] };
    });
  }, [filteredVehicles]);

  const updateMember = useCallback((vehicleId: number, patch: Partial<MemberDraft>) => {
    setDraft((prev) => ({
      ...prev,
      members: prev.members.map((m) => (m.mceasyVehicleId === vehicleId ? { ...m, ...patch } : m)),
    }));
  }, []);

  const applyGroupScheduleToAll = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      members: prev.members.map((m) => ({ ...m, useGroupSchedule: true })),
    }));
  }, []);

  const validateDraft = useCallback((): string | null => {
    if (!draft.name.trim()) return "Nama kelompok wajib diisi.";
    if (!draft.id && tmsClients.length > 0 && !draft.clientId) {
      return "Pilih client pemilik kelompok (mis. Tuku atau Manginue).";
    }
    if (parseClockToMinutes(draft.defaultWindowStart) === parseClockToMinutes(draft.defaultWindowEnd)) {
      return "Jam mulai dan jam selesai kelompok tidak boleh sama.";
    }
    if (draft.effectiveFrom && draft.effectiveUntil && draft.effectiveUntil < draft.effectiveFrom) {
      return "Tanggal berlaku sampai tidak boleh sebelum tanggal mulai.";
    }
    for (const member of draft.members) {
      if (!member.useGroupSchedule) {
        if (!member.overrideWindowStart || !member.overrideWindowEnd) {
          return `Jam khusus unit ${member.licensePlate} wajib diisi.`;
        }
        if (member.overrideWindowStart === member.overrideWindowEnd) {
          return `Jam mulai dan selesai unit ${member.licensePlate} tidak boleh sama.`;
        }
      }
    }
    return null;
  }, [draft, tmsClients]);

  const saveDraft = useCallback(async () => {
    const validation = validateDraft();
    if (validation) {
      setSaveError(validation);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        color: draft.color,
        status: draft.status,
        defaultWindowStart: draft.defaultWindowStart,
        defaultWindowEnd: draft.defaultWindowEnd,
        effectiveFrom: draft.effectiveFrom || undefined,
        effectiveUntil: draft.effectiveUntil || undefined,
        clientId: !draft.id && draft.clientId ? draft.clientId : undefined,
        members: draft.members.map((m) => ({
          mceasyVehicleId: m.mceasyVehicleId,
          licensePlate: m.licensePlate,
          vendorGroups: m.vendorGroups,
          useGroupSchedule: m.useGroupSchedule,
          overrideWindowStart: m.useGroupSchedule ? null : m.overrideWindowStart,
          overrideWindowEnd: m.useGroupSchedule ? null : m.overrideWindowEnd,
          enabled: m.enabled,
        })),
      };
      const url = draft.id
        ? `/api/tms/live-track-config/groups/${draft.id}`
        : "/api/tms/live-track-config/groups";
      const response = await fetch(url, {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) {
        setSaveError(result.error ?? "Gagal menyimpan kelompok.");
        return;
      }
      setShowModal(false);
      void load();
    } catch {
      setSaveError("Gagal menyimpan kelompok.");
    } finally {
      setSaving(false);
    }
  }, [draft, load, validateDraft]);

  const toggleGroupStatus = useCallback(
    async (group: LiveTrackGroup) => {
      const next = group.status === "Aktif" ? "Tidak Aktif" : "Aktif";
      if (!window.confirm(`${next === "Aktif" ? "Aktifkan" : "Nonaktifkan"} kelompok ${group.name}?`)) return;
      setTogglingId(group.id);
      try {
        const response = await fetch(`/api/tms/live-track-config/groups/${group.id}/status`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok || result.error) {
          setError(result.error ?? "Gagal mengubah status kelompok.");
          return;
        }
        void load();
      } catch {
        setError("Gagal mengubah status kelompok.");
      } finally {
        setTogglingId(null);
      }
    },
    [load],
  );

  return (
    <RouteGuard permission="tms.live-track-config">
      <div className="space-y-5">
        <PageHeader
          title="Pengaturan Live Track"
          description="Kelompok customer, unit McEasy, dan jam tampil harian berbasis kontrak"
          icon={Settings2}
          actions={
            <>
              <Button size="sm" variant="outline" icon={RefreshCw} disabled={loading} onClick={() => void load()}>
                Muat ulang
              </Button>
              {canManage === true && (
                <Button size="sm" icon={Plus} onClick={openCreate}>
                  Kelompok Baru
                </Button>
              )}
            </>
          }
        />

        {!loading && canManage === false && (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700">
            Anda hanya dapat melihat konfigurasi. Perubahan membutuhkan permission Kelola Pengaturan Live Track.
          </p>
        )}
        {liveError && (
          <p className="rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-muted-foreground">
            Data live McEasy tidak tersedia ({liveError}). Pilihan unit memakai katalog lokal terakhir.
          </p>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-lg border border-border bg-card py-2 pl-8 pr-3 text-xs"
              placeholder="Cari kelompok"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm text-danger">{error}</p>
        ) : filteredGroups.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            Belum ada kelompok Live Track. Buat kelompok pertama, mis. CP Suka, lalu pilih unitnya.
          </p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {filteredGroups.map((group) => {
              const activeCount = countActiveMembers(group, nowMs);
              return (
                <article key={group.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                        style={{ backgroundColor: group.color }}
                      >
                        <Truck className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{group.name}</p>
                        <p className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                          <Clock3 className="h-3 w-3" />
                          {summarizeLiveTrackWindow(group.defaultWindowStart, group.defaultWindowEnd)} WIB
                          {group.effectiveUntil ? ` · s.d. ${group.effectiveUntil}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant={group.status === "Aktif" ? "success" : "muted"}>
                        {group.status === "Aktif" ? `${activeCount} aktif` : "Nonaktif"}
                      </Badge>
                      {canManage === true && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(group)}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Ubah kelompok"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleGroupStatus(group)}
                            disabled={togglingId === group.id}
                            className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={group.status === "Aktif" ? "Nonaktifkan" : "Aktifkan"}
                          >
                            {togglingId === group.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : group.status === "Aktif" ? "Nonaktifkan" : "Aktifkan"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {group.description && (
                    <p className="mt-2 text-xs text-muted-foreground">{group.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {group.members.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">Belum ada unit.</span>
                    )}
                    {group.members.map((member) => {
                      const window = memberEffectiveWindow(member, group.defaultWindowStart, group.defaultWindowEnd);
                      const active = member.enabled && isLiveTrackWindowActive(
                        parseClockToMinutes(window.start),
                        parseClockToMinutes(window.end),
                        nowMs,
                      );
                      return (
                        <span
                          key={member.mceasyVehicleId}
                          title={`${member.licensePlate} · ${summarizeLiveTrackWindow(window.start, window.end)} WIB${window.overridden ? " (khusus)" : ""}`}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
                            !member.enabled
                              ? "bg-muted text-muted-foreground line-through"
                              : active
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
                          {member.licensePlate}
                          {window.overridden && <span className="font-sans">*</span>}
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {group.activeMemberCount} dari {group.memberCount} unit diaktifkan · tanda * memakai jam khusus
                  </p>
                </article>
              );
            })}
          </div>
        )}

        {/* Modal create/edit */}
        {showModal && (
          <Portal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && setShowModal(false)} />
              <div className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      {draft.id ? "Ubah Kelompok" : "Kelompok Baru"}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Jadwal cukup diinput sekali dan berlaku setiap hari sampai kontrak berubah.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => !saving && setShowModal(false)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-foreground">Nama kelompok *</span>
                      <input
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
                        placeholder="cth. CP Suka"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-foreground">Warna</span>
                      <span className="flex items-center gap-1.5">
                        {GROUP_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setDraft({ ...draft, color })}
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-full",
                              draft.color === color && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
                            )}
                            style={{ backgroundColor: color }}
                            aria-label={`Warna ${color}`}
                          >
                            {draft.color === color && <Check className="h-3.5 w-3.5 text-white" />}
                          </button>
                        ))}
                      </span>
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-foreground">Deskripsi</span>
                      <input
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
                        placeholder="Keterangan customer/kontrak (opsional)"
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      />
                    </label>
                    {!draft.id && (
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-foreground">
                          Client pemilik *
                        </span>
                        <select
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
                          value={draft.clientId}
                          onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}
                        >
                          <option value="">Pilih client…</option>
                          {tmsClients.map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.name} ({client.code})
                            </option>
                          ))}
                        </select>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          Kelompok baru wajib terikat ke satu client agar unit Tuku/Manginue tidak tercampur.
                        </span>
                      </label>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-foreground">Jam mulai tampil *</span>
                        <input
                          type="time"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs tabular-nums"
                          value={draft.defaultWindowStart}
                          onChange={(event) => setDraft({ ...draft, defaultWindowStart: event.target.value })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-foreground">Jam selesai tampil *</span>
                        <input
                          type="time"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs tabular-nums"
                          value={draft.defaultWindowEnd}
                          onChange={(event) => setDraft({ ...draft, defaultWindowEnd: event.target.value })}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-foreground">Berlaku mulai</span>
                        <input
                          type="date"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
                          value={draft.effectiveFrom}
                          onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-foreground">Berlaku sampai</span>
                        <input
                          type="date"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
                          value={draft.effectiveUntil}
                          min={draft.effectiveFrom || undefined}
                          onChange={(event) => setDraft({ ...draft, effectiveUntil: event.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
                    Jam selesai lebih kecil dari jam mulai berarti melewati tengah malam (cth. 20.00–05.00).
                    Unit otomatis mengikuti jam kelompok kecuali diberi jam khusus.
                  </p>

                  {/* Unit selector */}
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">
                        Unit ({draft.members.length} dipilih)
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={selectAllFiltered}
                          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                        >
                          Pilih semua hasil filter
                        </button>
                        <button
                          type="button"
                          onClick={applyGroupScheduleToAll}
                          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
                        >
                          Samakan ke jam kelompok
                        </button>
                      </div>
                    </div>
                    <div className="mb-1.5 flex flex-wrap gap-2">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs"
                          placeholder="Cari nopol"
                          value={vehicleSearch}
                          onChange={(event) => setVehicleSearch(event.target.value)}
                        />
                      </div>
                      <select
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                        value={vendorGroupFilter}
                        onChange={(event) => setVendorGroupFilter(event.target.value)}
                        aria-label="Filter grup vendor"
                      >
                        <option value="all">Semua grup vendor</option>
                        {vendorGroups.map((group) => (
                          <option key={group} value={group}>{group}</option>
                        ))}
                      </select>
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                      {filteredVehicles.length === 0 && (
                        <p className="px-2 py-4 text-center text-xs text-muted-foreground">Tidak ada unit yang cocok.</p>
                      )}
                      {filteredVehicles.map((vehicle) => {
                        const selected = draftMemberMap.get(vehicle.mceasyVehicleId);
                        const otherGroups = vehicle.memberOf.filter((g) => g.groupId !== draft.id);
                        return (
                          <div key={vehicle.mceasyVehicleId}>
                            <button
                              type="button"
                              onClick={() => toggleVehicle(vehicle)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted/60",
                                selected && "bg-primary/5",
                              )}
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                  selected ? "border-primary bg-primary text-white" : "border-border bg-background",
                                )}
                              >
                                {selected && <Check className="h-3 w-3" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono font-semibold tabular-nums text-foreground">
                                  {vehicle.licensePlate}
                                </span>
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  ID {vehicle.mceasyVehicleId}
                                  {vehicle.vendorGroups.length > 0 ? ` · ${vehicle.vendorGroups.join(", ")}` : ""}
                                  {vehicle.catalogStale ? " · stale" : ""}
                                  {otherGroups.length > 0 ? ` · juga di: ${otherGroups.map((g) => g.groupName).join(", ")}` : ""}
                                </span>
                              </span>
                              {selected ? (
                                <span className="shrink-0 text-[10px] font-semibold text-primary">
                                  {selected.useGroupSchedule
                                    ? "Ikuti kelompok"
                                    : `${selected.overrideWindowStart}–${selected.overrideWindowEnd}`}
                                </span>
                              ) : (
                                vehicle.status && (
                                  <span className="shrink-0 text-[10px] text-muted-foreground">{vehicle.status}</span>
                                )
                              )}
                            </button>
                            {selected && (
                              <div className="ml-6 flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
                                <label className="flex items-center gap-1 text-[11px] text-foreground">
                                  <input
                                    type="checkbox"
                                    checked={selected.useGroupSchedule}
                                    onChange={(event) =>
                                      updateMember(vehicle.mceasyVehicleId, {
                                        useGroupSchedule: event.target.checked,
                                        overrideWindowStart: event.target.checked
                                          ? draft.defaultWindowStart
                                          : selected.overrideWindowStart,
                                        overrideWindowEnd: event.target.checked
                                          ? draft.defaultWindowEnd
                                          : selected.overrideWindowEnd,
                                      })
                                    }
                                    className="h-3.5 w-3.5 rounded accent-primary"
                                  />
                                  Ikuti jam kelompok
                                </label>
                                {!selected.useGroupSchedule && (
                                  <span className="flex items-center gap-1 text-[11px]">
                                    <input
                                      type="time"
                                      className="rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
                                      value={selected.overrideWindowStart}
                                      onChange={(event) =>
                                        updateMember(vehicle.mceasyVehicleId, { overrideWindowStart: event.target.value })
                                      }
                                    />
                                    <span className="text-muted-foreground">–</span>
                                    <input
                                      type="time"
                                      className="rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
                                      value={selected.overrideWindowEnd}
                                      onChange={(event) =>
                                        updateMember(vehicle.mceasyVehicleId, { overrideWindowEnd: event.target.value })
                                      }
                                    />
                                  </span>
                                )}
                                <label className="flex items-center gap-1 text-[11px] text-foreground">
                                  <input
                                    type="checkbox"
                                    checked={selected.enabled}
                                    onChange={(event) =>
                                      updateMember(vehicle.mceasyVehicleId, { enabled: event.target.checked })
                                    }
                                    className="h-3.5 w-3.5 rounded accent-primary"
                                  />
                                  Aktif
                                </label>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {draft.members.some((m) => {
                      const option = vehicles.find((v) => v.mceasyVehicleId === m.mceasyVehicleId);
                      return option && option.memberOf.some((g) => g.groupId !== draft.id);
                    }) && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-600">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Sebagian unit juga ada di kelompok lain. FO-nya akan tampil di semua kelompok yang jadwalnya aktif.
                      </p>
                    )}
                  </div>

                  {saveError && (
                    <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{saveError}</p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
                  <Button variant="outline" size="sm" onClick={() => setShowModal(false)} disabled={saving}>
                    Batal
                  </Button>
                  <Button size="sm" onClick={() => void saveDraft()} disabled={saving}>
                    {saving ? "Menyimpan…" : draft.id ? "Simpan" : "Buat Kelompok"}
                  </Button>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </div>
    </RouteGuard>
  );
}
