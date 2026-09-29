"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TmsClientOption {
  id: string;
  code: string;
  slug: string;
  name: string;
  logoUrl: string | null;
}

interface TmsClientSelection {
  clients: TmsClientOption[];
  allAllowed: boolean;
  /** slug/code client terpilih, atau null = semua (khusus allAllowed). */
  selected: string | null;
  loading: boolean;
}

/** Event window saat pilihan client TMS berubah (untuk reload daftar). */
export const TMS_CLIENT_CHANGED_EVENT = "tms-client-changed";

export function readTmsClientParam(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("client")?.trim() ?? "";
  return value ? value : null;
}

function readClientParam(): string | null {
  return readTmsClientParam();
}

/**
 * Pilihan client TMS dari query `?client=`. External satu client otomatis
 * terkunci; admin all-scope dapat memilih Semua/semua client.
 */
export function useTmsClientSelection(): TmsClientSelection {
  const [clients, setClients] = useState<TmsClientOption[]>([]);
  const [allAllowed, setAllAllowed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(readClientParam());
    void (async () => {
      try {
        const response = await fetch("/api/tms/clients", { cache: "no-store" });
        const payload = (await response.json()) as {
          data?: TmsClientOption[];
          meta?: { allAllowed?: boolean };
        };
        if (cancelled || !response.ok) return;
        setClients(Array.isArray(payload.data) ? payload.data : []);
        setAllAllowed(payload.meta?.allAllowed === true);
      } catch {
        if (!cancelled) {
          setClients([]);
          setAllAllowed(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { clients, allAllowed, selected, loading };
}

/** Header selector client untuk halaman TMS (dropdown admin / badge terkunci). */
export default function TmsClientSelector({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { clients, allAllowed, selected, loading } = useTmsClientSelection();

  const applySelection = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(
        typeof window === "undefined" ? "" : window.location.search,
      );
      if (value) params.set("client", value);
      else params.delete("client");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      window.dispatchEvent(new Event(TMS_CLIENT_CHANGED_EVENT));
    },
    [pathname, router],
  );

  // Sinkron saat tombol back/forward browser dipakai.
  useEffect(() => {
    const onPopState = () => {
      window.dispatchEvent(new Event(TMS_CLIENT_CHANGED_EVENT));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat client…
      </span>
    );
  }

  // Satu client & bukan admin global: kunci otomatis, tampil sebagai badge.
  if (!allAllowed && clients.length <= 1) {
    const only = clients[0] ?? null;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-foreground">
        <Building2 className="h-3.5 w-3.5 text-primary" />
        {only ? only.name : "Client"}
      </span>
    );
  }

  const selectedClient = selected
    ? (clients.find(
        (c) =>
          c.slug.toLowerCase() === selected.toLowerCase() ||
          c.code.toLowerCase() === selected.toLowerCase() ||
          c.id === selected,
      ) ?? null)
    : null;

  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1",
        compact ? "text-[11px]" : "text-xs",
      )}
    >
      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="hidden font-semibold text-muted-foreground sm:inline">Klien</span>
      <select
        value={selectedClient ? selectedClient.slug : ""}
        onChange={(event) => applySelection(event.target.value || null)}
        className="max-w-40 cursor-pointer truncate bg-transparent font-bold text-foreground outline-none"
        aria-label="Pilih client TMS"
      >
        {allAllowed && <option value="">Semua Klien</option>}
        {clients.map((client) => (
          <option key={client.id} value={client.slug}>
            {client.name}
          </option>
        ))}
      </select>
    </label>
  );
}
