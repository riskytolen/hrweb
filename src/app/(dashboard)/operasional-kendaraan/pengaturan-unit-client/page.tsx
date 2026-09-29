"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, RefreshCw, Search, Settings2, Truck, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import RouteGuard from "@/components/RouteGuard";
import Portal from "@/components/ui/Portal";
import { cn } from "@/lib/utils";

interface UnitClient {
  id: string;
  code: string;
  slug: string;
  name: string;
  timezone: string;
  status: string;
  odometerVehicleCount: number;
}

interface UnitVehicle {
  id: number;
  unit: string;
  jenis: string;
  status: string;
}

type Toast = { type: "success" | "error"; message: string };
type Filter = "all" | "selected" | "unselected";

export default function OdometerClientUnitConfigPage() {
  const [clients, setClients] = useState<UnitClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [vehicles, setVehicles] = useState<UnitVehicle[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((type: Toast["type"], message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const res = await fetch("/api/admin/vehicle-odometer-client-assignments", { cache: "no-store" });
      const payload = (await res.json()) as { data?: { clients?: UnitClient[] }; error?: string };
      if (!res.ok) throw new Error(payload.error || "Gagal memuat daftar client.");
      const list = Array.isArray(payload.data?.clients) ? payload.data.clients : [];
      setClients(list);
      setSelectedClientId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? "";
      });
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Gagal memuat daftar client.");
    } finally {
      setLoadingClients(false);
    }
  }, [showToast]);

  const fetchUnits = useCallback(
    async (clientId: string) => {
      if (!clientId) {
        setVehicles([]);
        setSelectedIds([]);
        return;
      }
      setLoadingUnits(true);
      try {
        const res = await fetch(
          `/api/admin/vehicle-odometer-client-assignments?clientId=${encodeURIComponent(clientId)}`,
          { cache: "no-store" },
        );
        const payload = (await res.json()) as {
          data?: { vehicles?: UnitVehicle[]; vehicleIds?: number[] };
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error || "Gagal memuat unit operasional.");
        setVehicles(Array.isArray(payload.data?.vehicles) ? payload.data.vehicles : []);
        setSelectedIds(
          (Array.isArray(payload.data?.vehicleIds) ? payload.data.vehicleIds : []).filter(
            (v): v is number => typeof v === "number",
          ),
        );
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : "Gagal memuat unit operasional.");
      } finally {
        setLoadingUnits(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchClients();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchClients]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchUnits(selectedClientId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedClientId, fetchUnits]);

  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? null;

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (filter === "selected" && !selectedIds.includes(v.id)) return false;
      if (filter === "unselected" && selectedIds.includes(v.id)) return false;
      if (!q) return true;
      return v.unit.toLowerCase().includes(q) || v.jenis.toLowerCase().includes(q);
    });
  }, [vehicles, search, filter, selectedIds]);

  const toggleVehicle = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  const saveAssignments = async () => {
    if (!selectedClientId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/vehicle-odometer-client-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, vehicleIds: selectedIds }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Gagal menyimpan unit operasional.");
      showToast("success", `Unit operasional ${selectedClient?.name ?? ""} berhasil diperbarui.`);
      await fetchClients();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Gagal menyimpan unit operasional.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RouteGuard permission="vehicle-odometer.client-unit-config">
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Pengaturan Unit Client"
          description="Pilih unit Operasional Kendaraan yang dapat dilihat setiap client di Dashboard & Laporan."
          icon={Settings2}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  void fetchClients();
                  void fetchUnits(selectedClientId);
                }}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <Button size="sm" icon={CheckCircle} onClick={() => { void saveAssignments(); }} disabled={saving || !selectedClientId}>
                {saving ? "Menyimpan..." : "Simpan Perubahan"}
              </Button>
            </div>
          }
        />

        {/* Client selector */}
        <div className="bg-card rounded-2xl border border-border shadow-sm p-4">
          <label className="text-xs font-semibold text-foreground mb-1.5 block">Client</label>
          {loadingClients ? (
            <div className="h-10 w-full max-w-sm rounded-xl bg-muted animate-pulse" />
          ) : clients.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Belum ada client TMS aktif. Tambahkan dulu di Pengaturan → Manajemen Akun → Client TMS.
            </p>
          ) : (
            <div className="max-w-sm">
              <Select
                value={selectedClientId}
                onChange={(value) => setSelectedClientId(value)}
                options={clients.map((c) => ({
                  value: c.id,
                  label: `${c.name} (${c.odometerVehicleCount} unit)`,
                }))}
              />
            </div>
          )}
          {selectedClient && (
            <p className="text-[11px] text-muted-foreground mt-2">
              {selectedIds.length} dari {vehicles.length} unit dipilih untuk {selectedClient.name}.
              Satu unit boleh diberikan kepada beberapa client.
            </p>
          )}
        </div>

        {/* Vehicle list */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2 flex-1 max-w-sm">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Cari nomor polisi atau jenis..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-sm outline-none w-full text-foreground placeholder:text-muted-foreground/60"
              />
            </div>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-xl ml-auto">
              {([
                { value: "all" as Filter, label: "Semua" },
                { value: "selected" as Filter, label: "Dipilih" },
                { value: "unselected" as Filter, label: "Belum Dipilih" },
              ]).map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    filter === f.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {loadingUnits ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : !selectedClientId ? (
            <p className="text-xs text-muted-foreground text-center py-16">Pilih client terlebih dahulu.</p>
          ) : filteredVehicles.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-16">
              {vehicles.length === 0 ? "Belum ada kendaraan operasional." : "Kendaraan tidak ditemukan."}
            </p>
          ) : (
            <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredVehicles.map((v) => {
                const checked = selectedIds.includes(v.id);
                return (
                  <label
                    key={v.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                      checked ? "border-primary/30 bg-primary/5" : "border-border hover:bg-muted/30",
                      v.status !== "Aktif" && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVehicle(v.id)}
                      className="w-4 h-4 rounded accent-primary flex-shrink-0"
                    />
                    <Truck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">{v.unit}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{v.jenis}</p>
                    </div>
                    {v.status !== "Aktif" && (
                      <span className="px-2 py-0.5 rounded-full bg-danger-light text-danger text-[10px] font-semibold flex-shrink-0">
                        {v.status}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <Portal>
          <div className="fixed top-6 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 animate-fade-in">
            <div
              className={cn(
                "flex items-start gap-3 rounded-2xl border p-4 shadow-xl bg-card",
                toast.type === "success" ? "border-success/30" : "border-danger/30",
              )}
            >
              <div className="flex-1 text-sm text-foreground">{toast.message}</div>
              <button onClick={() => setToast(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </Portal>
      )}
    </RouteGuard>
  );
}
