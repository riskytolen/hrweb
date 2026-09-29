import "server-only";

import { NextResponse } from "next/server";
import { createAdminClient } from "./supabase-admin";
import {
  TMS_CLIENTS_ALL_PERMISSION,
  type AccountType,
} from "./permissions";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

/**
 * Otorisasi tenant TMS terpusat.
 *
 * Permission role menentukan AKSI (lihat/kelola per submenu — dicek oleh
 * pemanggil via authorizeEpod/authorizeLiveTrackConfig/canAccessTmsData).
 * Modul ini menentukan DATA SCOPE: client mana yang boleh dibaca user.
 *
 * - Super Admin (level >= 100 atau permission "all") -> semua client.
 * - Internal + `tms.clients.all` -> semua client.
 * - Internal biasa -> membership `tms_client_memberships`.
 * - External -> selalu membership (permission all-client diabaikan).
 */

export type ClientScope = string[] | "all";

export interface TmsScopeResolution {
  allowedClientIds: ClientScope;
  isSuperAdmin: boolean;
  canAccessAllClients: boolean;
}

export interface ScopeDecisionInput {
  accountType: AccountType;
  permissions: string[];
  roleLevel: number;
  membershipClientIds: string[];
}

/**
 * Keputusan scope murni (tanpa I/O) agar mudah di-unit-test.
 * `membershipClientIds` harus sudah difilter aktif di sisi database.
 */
export function resolveClientScope(input: ScopeDecisionInput): TmsScopeResolution {
  const memberships = [...new Set(input.membershipClientIds.filter(Boolean))];
  const isSuperAdmin = input.roleLevel >= 100 || input.permissions.includes("all");
  if (isSuperAdmin) {
    return { allowedClientIds: "all", isSuperAdmin: true, canAccessAllClients: true };
  }
  if (
    input.accountType === "internal" &&
    input.permissions.includes(TMS_CLIENTS_ALL_PERMISSION)
  ) {
    return { allowedClientIds: "all", isSuperAdmin: false, canAccessAllClients: true };
  }
  return {
    allowedClientIds: memberships,
    isSuperAdmin: false,
    canAccessAllClients: false,
  };
}

/** Ambil client aktif dari membership user. Gagal tertutup (fail closed). */
export async function fetchMembershipClientIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string[]> {
  try {
    const { data, error } = await admin
      .from("tms_client_memberships")
      .select("client_id, client:tms_clients!inner(status)")
      .eq("user_id", userId)
      .eq("status", "Aktif");
    if (error || !Array.isArray(data)) return [];
    const ids: string[] = [];
    for (const row of data as { client_id: string; client?: { status?: string } | { status?: string }[] }[]) {
      const client = Array.isArray(row.client) ? row.client[0] : row.client;
      if (client?.status && client.status !== "Aktif") continue;
      if (typeof row.client_id === "string" && row.client_id) ids.push(row.client_id);
    }
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

export type TmsScopeResult =
  | { ok: true; scope: TmsScopeResolution; selectedClientId: string | null }
  | { ok: false; response: NextResponse };

function scopeError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

/** Referensi UUID valid — satu-satunya bentuk yang boleh dicari via kolom `id`. */
const UUID_REF_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidRef(value: string): boolean {
  return UUID_REF_PATTERN.test(value);
}

/**
 * Totapkan scope client untuk request yang sudah lolos cek permission modul.
 * `requestedClientId` (mis. query `?client=`) tidak pernah dipercaya
 * mentah-mentah: harus berada dalam scope, jika tidak maka 404 agar
 * keberadaan data client lain tidak bocor.
 */
export async function authorizeTmsScope(input: {
  userId: string;
  accountType: AccountType;
  permissions: string[];
  roleLevel: number;
  requestedClientId?: string | null;
  /** Referensi client bebas (id/code/slug, mis. `?client=tuku`) — divalidasi ke scope. */
  requestedClientRef?: string | null;
}): Promise<TmsScopeResult> {
  const admin = createAdminClient();
  const memberships = await fetchMembershipClientIds(admin, input.userId);
  const scope = resolveClientScope({
    accountType: input.accountType,
    permissions: input.permissions,
    roleLevel: input.roleLevel,
    membershipClientIds: memberships,
  });

  if (scope.allowedClientIds !== "all" && scope.allowedClientIds.length === 0) {
    return {
      ok: false,
      response: scopeError(
        "Akun belum ditugaskan ke client TMS mana pun. Hubungi Super Admin.",
        403,
      ),
    };
  }

  const requestedRef = (input.requestedClientRef ?? input.requestedClientId ?? "").trim();
  if (requestedRef) {
    // Resolusi id/code/slug ke client aktif. Sanitasi agar aman untuk filter .or().
    const safeRef = requestedRef.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
    if (!safeRef) {
      return { ok: false, response: scopeError("Data tidak ditemukan.", 404) };
    }
    // Kolom `id` bertipe UUID: slug/code seperti "tuku" tidak boleh dicari
    // via `id.eq.<slug>` karena membuat seluruh query resolusi gagal.
    // UUID dicari persis by id; selain itu hanya by code/slug.
    const clientQuery = admin.from("tms_clients").select("id").eq("status", "Aktif");
    const { data: client, error: clientError } = isUuidRef(safeRef)
      ? await clientQuery.eq("id", safeRef).maybeSingle()
      : await clientQuery.or(`code.ilike.${safeRef},slug.ilike.${safeRef}`).maybeSingle();
    if (clientError) {
      return { ok: false, response: scopeError("Gagal memvalidasi client TMS.", 502) };
    }
    const resolvedId = (client as { id?: string } | null)?.id ?? null;
    if (
      !resolvedId ||
      (scope.allowedClientIds !== "all" && !scope.allowedClientIds.includes(resolvedId))
    ) {
      return { ok: false, response: scopeError("Data tidak ditemukan.", 404) };
    }
    // Sempitkan scope efektif ke client yang diminta agar pemanggil cukup
    // memfilter dengan allowedClientIds.
    const narrowed: TmsScopeResolution = { ...scope, allowedClientIds: [resolvedId] };
    return { ok: true, scope: narrowed, selectedClientId: resolvedId };
  }

  const selectedClientId =
    scope.allowedClientIds === "all"
      ? null
      : scope.allowedClientIds.length === 1
        ? scope.allowedClientIds[0]
        : null;
  return { ok: true, scope, selectedClientId };
}

/**
 * Terapkan filter scope ke query builder Supabase (service-role).
 * Mengembalikan query tanpa filter bila scope "all".
 */
export function applyClientScope<TQuery>(
  query: TQuery,
  allowedClientIds: ClientScope,
  apply: (query: TQuery, ids: string[]) => TQuery,
): TQuery {
  if (allowedClientIds === "all") return query;
  if (allowedClientIds.length === 0) return apply(query, ["00000000-0000-0000-0000-000000000000"]);
  return apply(query, allowedClientIds);
}

export interface ScopedVehicleMap {
  byMceasyId: Map<number, string>;
  byPlateKey: Map<string, string>;
}

/** Normalisasi nomor polisi seperti seed mapping (tanpa spasi/titik/strip, huruf besar). */
export function normalizeTenantPlateKey(plate: string | null | undefined): string {
  return (plate ?? "").toUpperCase().replace(/[\s.\-]/g, "");
}

/**
 * Muat mapping unit aktif (per hari ini) untuk scope pemanggil.
 * Dipakai memfilter data vendor live yang tidak punya client_id.
 */
export async function fetchScopedVehicleMap(
  allowedClientIds: ClientScope,
): Promise<ScopedVehicleMap | "all"> {
  const empty: ScopedVehicleMap = { byMceasyId: new Map(), byPlateKey: new Map() };
  if (allowedClientIds === "all") return "all";
  if (allowedClientIds.length === 0) return empty;
  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await admin
      .from("tms_client_vehicle_assignments")
      .select("client_id,mceasy_vehicle_id,license_plate_key,effective_from,effective_until,status")
      .in("client_id", allowedClientIds)
      .eq("status", "active");
    if (error || !Array.isArray(data)) return empty;
    for (
      const row of data as {
        client_id: string;
        mceasy_vehicle_id: number;
        license_plate_key: string;
        effective_from: string | null;
        effective_until: string | null;
      }[]
    ) {
      if (typeof row.effective_from === "string" && row.effective_from.slice(0, 10) > today) continue;
      if (typeof row.effective_until === "string" && row.effective_until.slice(0, 10) < today) continue;
      if (typeof row.mceasy_vehicle_id === "number") {
        empty.byMceasyId.set(row.mceasy_vehicle_id, row.client_id);
      }
      const key = normalizeTenantPlateKey(row.license_plate_key);
      if (key) empty.byPlateKey.set(key, row.client_id);
    }
    return empty;
  } catch {
    return empty;
  }
}

/** True bila unit McEasy / nomor polisi berada dalam mapping scope. */
export function isVehicleInScopedMap(
  map: ScopedVehicleMap | "all",
  mceasyVehicleId: number | string | null | undefined,
  licensePlate?: string | null,
): boolean {
  if (map === "all") return true;
  const numeric = typeof mceasyVehicleId === "string" ? Number(mceasyVehicleId) : mceasyVehicleId;
  if (typeof numeric === "number" && Number.isFinite(numeric) && map.byMceasyId.has(numeric)) {
    return true;
  }
  const key = normalizeTenantPlateKey(licensePlate ?? null);
  if (key && map.byPlateKey.has(key)) return true;
  return false;
}

/** Verifikasi satu record tenant berada dalam scope (untuk endpoint detail). */
export function isRecordInScope(
  recordClientId: string | null | undefined,
  allowedClientIds: ClientScope,
): boolean {
  if (allowedClientIds === "all") return true;
  if (!recordClientId) return false;
  return allowedClientIds.includes(recordClientId);
}
