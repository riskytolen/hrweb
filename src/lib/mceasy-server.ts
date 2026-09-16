import "server-only";

import {
  normalizeMcEasyVehicleStatus,
  normalizeMcEasyVehicleStatusList,
  type TmsVehicleStatus,
} from "./tms-status";

/**
 * Adapter server-only untuk McEasy VSMS v2 public API.
 *
 * Modul ini tidak boleh diimpor dari Client Component. Token dibaca dari
 * environment server dan tidak pernah dikembalikan ke browser.
 */

export class McEasyError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 502, code?: string) {
    super(message);
    this.name = "McEasyError";
    this.status = status;
    this.code = code;
  }
}

interface McEasyConfig {
  token: string;
  baseUrl: string;
}

function readConfig(): McEasyConfig {
  const token = (process.env.MCEASY_API_TOKEN ?? "").trim();
  const baseUrl = (process.env.MCEASY_VSMS_V2_BASE_URL ?? "").trim().replace(/\/+$/, "");

  if (!token) {
    throw new McEasyError(
      "Integrasi tracking belum dikonfigurasi. Minta administrator mengatur MCEASY_API_TOKEN.",
      503,
      "MCEASY_NOT_CONFIGURED",
    );
  }
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new McEasyError(
      "Integrasi tracking belum dikonfigurasi. Minta administrator mengatur MCEASY_VSMS_V2_BASE_URL.",
      503,
      "MCEASY_NOT_CONFIGURED",
    );
  }
  return { token, baseUrl };
}

function sanitizeUpstreamDetail(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  if (!trimmed) return undefined;
  // Jangan pernah membocorkan token meskipun upstream menggemakannya.
  if (/bearer|mceasy_api_token|authorization/i.test(trimmed)) return undefined;
  return trimmed;
}

async function parseUpstreamError(response: Response): Promise<{ code?: string; detail?: string }> {
  try {
    const text = await response.text();
    if (!text) return {};
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const code = typeof parsed.code === "string" ? parsed.code : undefined;
    const detail = sanitizeUpstreamDetail(
      typeof parsed.detail === "string"
        ? parsed.detail
        : typeof parsed.message === "string"
          ? parsed.message
          : undefined,
    );
    return { code, detail };
  } catch {
    return {};
  }
}

function mapUpstreamError(status: number, code?: string, detail?: string): McEasyError {
  if (status === 401) {
    return new McEasyError(
      "Token integrasi tracking ditolak atau kedaluwarsa. Minta administrator memperbarui token.",
      502,
      code ?? "MCEASY_UNAUTHORIZED",
    );
  }
  if (status === 403) {
    return new McEasyError(
      "Akses integrasi tracking ditolak. Minta administrator memeriksa hak akses token.",
      502,
      code ?? "MCEASY_FORBIDDEN",
    );
  }
  if (status === 404) {
    return new McEasyError("Data kendaraan tidak ditemukan pada layanan tracking.", 502, code ?? "MCEASY_NOT_FOUND");
  }
  if (status === 429) {
    return new McEasyError(
      "Layanan McEasy sedang membatasi permintaan. Tunggu sejenak lalu coba lagi.",
      502,
      code ?? "MCEASY_RATE_LIMITED",
    );
  }
  if (status >= 500) {
    return new McEasyError(
      "Layanan McEasy sedang bermasalah. Data terakhir tetap ditampilkan bila tersedia.",
      502,
      code ?? "MCEASY_UNAVAILABLE",
    );
  }
  const suffix = detail ? ` (${detail})` : "";
  return new McEasyError(
    `Permintaan ke layanan tracking gagal diproses.${suffix}`,
    502,
    code ?? "MCEASY_BAD_REQUEST",
  );
}

interface McEasyFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function fetchMcEasy(path: string, query: URLSearchParams, options: McEasyFetchOptions = {}) {
  const { token, baseUrl } = readConfig();
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(`${baseUrl}${path}?${query.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) throw error;
      throw new McEasyError(
        "Permintaan ke layanan tracking kehabisan waktu. Coba lagi.",
        504,
        "MCEASY_TIMEOUT",
      );
    }
    throw new McEasyError(
      "Tidak dapat terhubung ke layanan tracking. Periksa koneksi lalu coba lagi.",
      502,
      "MCEASY_NETWORK",
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export interface VehicleStatusesQuery {
  withAddress?: boolean;
  withFilteredAddress?: boolean;
}

export async function fetchMcEasyVehicleStatuses(
  query: VehicleStatusesQuery = {},
  options: McEasyFetchOptions = {},
): Promise<TmsVehicleStatus[]> {
  const params = new URLSearchParams();
  params.set("withAddress", String(query.withAddress ?? true));
  if (query.withFilteredAddress !== undefined) {
    params.set("withFilteredAddress", String(query.withFilteredAddress));
  }

  const response = await fetchMcEasy("/vehicles/statuses", params, options);
  if (!response.ok) {
    const { code, detail } = await parseUpstreamError(response);
    throw mapUpstreamError(response.status, code, detail);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new McEasyError(
      "Respons layanan tracking tidak valid. Coba lagi.",
      502,
      "MCEASY_INVALID_RESPONSE",
    );
  }

  const data =
    payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown }).data
      : [];

  return normalizeMcEasyVehicleStatusList(data);
}

export async function fetchMcEasyVehicleStatus(
  id: string,
  query: VehicleStatusesQuery = {},
  options: McEasyFetchOptions = {},
): Promise<TmsVehicleStatus | null> {
  const identifier = id.trim();
  if (!identifier) {
    throw new McEasyError("Identitas kendaraan tidak valid.", 400, "MCEASY_INVALID_ID");
  }

  const params = new URLSearchParams();
  params.set("withAddress", String(query.withAddress ?? true));
  if (query.withFilteredAddress !== undefined) {
    params.set("withFilteredAddress", String(query.withFilteredAddress));
  }

  const response = await fetchMcEasy(
    `/vehicles/${encodeURIComponent(identifier)}/status`,
    params,
    options,
  );
  if (!response.ok) {
    const { code, detail } = await parseUpstreamError(response);
    throw mapUpstreamError(response.status, code, detail);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new McEasyError(
      "Respons layanan tracking tidak valid. Coba lagi.",
      502,
      "MCEASY_INVALID_RESPONSE",
    );
  }

  const raw =
    payload && typeof payload === "object"
      ? ((payload as { data?: unknown }).data as Record<string, unknown> | Record<string, unknown>[])
      : null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first || typeof first !== "object") return null;
  return normalizeMcEasyVehicleStatus(first as Record<string, unknown>);
}

export interface TripDetailQuery {
  /** Awal rentang dalam ISO UTC. */
  startDate: string;
  /** Akhir rentang dalam ISO UTC. */
  endDate: string;
  /** Batas kecepatan untuk pemecahan trip; default 120. */
  speedLimit?: number;
}

/**
 * Mengambil Detail Trip History kendaraan dari VSMS v2.
 * `id` dapat berupa Vehicle ID, license plate, atau IMEI.
 */
export async function fetchMcEasyTripDetail(
  id: string,
  query: TripDetailQuery,
  options: McEasyFetchOptions = {},
): Promise<unknown> {
  const identifier = id.trim();
  if (!identifier) {
    throw new McEasyError("Identitas kendaraan tidak valid.", 400, "MCEASY_INVALID_ID");
  }
  const startDate = (query.startDate ?? "").trim();
  const endDate = (query.endDate ?? "").trim();
  if (!startDate || !endDate) {
    throw new McEasyError(
      "Rentang waktu Detail Trip History tidak valid.",
      400,
      "MCEASY_INVALID_RANGE",
    );
  }

  const params = new URLSearchParams();
  params.set("startDate", startDate);
  params.set("endDate", endDate);
  params.set("speedLimit", String(query.speedLimit ?? 120));

  const response = await fetchMcEasy(
    `/trips/${encodeURIComponent(identifier)}/detail`,
    params,
    options,
  );
  if (!response.ok) {
    const { code, detail } = await parseUpstreamError(response);
    throw mapUpstreamError(response.status, code, detail);
  }

  try {
    return await response.json();
  } catch {
    throw new McEasyError(
      "Respons layanan tracking tidak valid. Coba lagi.",
      502,
      "MCEASY_INVALID_RESPONSE",
    );
  }
}

interface FleetPlanningConfig {
  baseUrl: string;
}

function readFleetPlanningConfig(): FleetPlanningConfig {
  const baseUrl = (process.env.MCEASY_FLEET_PLANNING_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new McEasyError(
      "Integrasi tracking belum dikonfigurasi. Minta administrator mengatur MCEASY_FLEET_PLANNING_BASE_URL.",
      503,
      "MCEASY_FLEET_PLANNING_NOT_CONFIGURED",
    );
  }
  return { baseUrl };
}

function mapFleetTaskTrackError(status: number, code?: string, detail?: string): McEasyError {
  if (status === 400) {
    return new McEasyError("ID tracking tidak valid. Periksa kembali tautan atau ID yang dimasukkan.", 400, code ?? "TRACK_INVALID_ID");
  }
  if (status === 404) {
    return new McEasyError(
      "Data Live Track Task tidak ditemukan. Pastikan ID tracking masih berlaku.",
      404,
      code ?? "TRACK_NOT_FOUND",
    );
  }
  if (status === 429) {
    return new McEasyError(
      "Layanan tracking sedang membatasi permintaan. Tunggu sejenak lalu coba lagi.",
      502,
      code ?? "MCEASY_RATE_LIMITED",
    );
  }
  if (status >= 500) {
    return new McEasyError(
      "Layanan tracking sedang bermasalah. Coba lagi nanti.",
      502,
      code ?? "MCEASY_UNAVAILABLE",
    );
  }
  const suffix = detail ? ` (${detail})` : "";
  return new McEasyError(
    `Permintaan Live Track Task gagal diproses.${suffix}`,
    502,
    code ?? "TRACK_BAD_REQUEST",
  );
}

/**
 * Mengambil detail Fleet Task Instant untuk Live Track beserta daftar
 * titik (points) dan riwayat status.
 *
 * Endpoint upstream dapat diakses tanpa autentikasi vendor, sehingga
 * request ini sengaja TIDAK membawa header Authorization.
 */
export async function fetchFleetTaskInstantTrack(
  id: string,
  options: McEasyFetchOptions = {},
): Promise<unknown> {
  const identifier = id.trim();
  if (!identifier) {
    throw new McEasyError("ID tracking tidak boleh kosong.", 400, "TRACK_INVALID_ID");
  }

  const { baseUrl } = readFleetPlanningConfig();
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(
      `${baseUrl}/fleet-task-instant/track/${encodeURIComponent(identifier)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const { code, detail } = await parseUpstreamError(response);
      throw mapFleetTaskTrackError(response.status, code, detail);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new McEasyError(
        "Respons layanan tracking tidak valid. Coba lagi.",
        502,
        "MCEASY_INVALID_RESPONSE",
      );
    }

    if (payload && typeof payload === "object") {
      const envelope = payload as { data?: unknown; DATA?: unknown };
      if (envelope.data !== undefined) return envelope.data;
      if (envelope.DATA !== undefined) return envelope.DATA;
    }
    return payload;
  } catch (error) {
    if (error instanceof McEasyError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) throw error;
      throw new McEasyError(
        "Permintaan Live Track Task kehabisan waktu. Coba lagi.",
        504,
        "MCEASY_TIMEOUT",
      );
    }
    throw new McEasyError(
      "Tidak dapat terhubung ke layanan tracking. Periksa koneksi lalu coba lagi.",
      502,
      "MCEASY_NETWORK",
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function mapFleetTaskError(status: number, code?: string, detail?: string): McEasyError {
  if (status === 401) {
    return new McEasyError(
      "Token integrasi tracking ditolak atau kedaluwarsa. Minta administrator memperbarui token.",
      502,
      code ?? "MCEASY_UNAUTHORIZED",
    );
  }
  if (status === 403) {
    return new McEasyError(
      "Akses integrasi tracking ditolak. Minta administrator memeriksa hak akses token.",
      502,
      code ?? "MCEASY_FORBIDDEN",
    );
  }
  if (status === 404) {
    return new McEasyError(
      "Data Fleet Task tidak ditemukan pada layanan tracking.",
      404,
      code ?? "FLEET_TASK_NOT_FOUND",
    );
  }
  if (status === 429) {
    return new McEasyError(
      "Layanan tracking sedang membatasi permintaan. Tunggu sejenak lalu coba lagi.",
      502,
      code ?? "MCEASY_RATE_LIMITED",
    );
  }
  if (status >= 500) {
    return new McEasyError(
      "Layanan tracking sedang bermasalah. Coba lagi nanti.",
      502,
      code ?? "MCEASY_UNAVAILABLE",
    );
  }
  const suffix = detail ? ` (${detail})` : "";
  return new McEasyError(
    `Permintaan data Fleet Task gagal diproses.${suffix}`,
    502,
    code ?? "FLEET_TASK_BAD_REQUEST",
  );
}

interface FleetPlanningFetchOptions extends McEasyFetchOptions {
  withAuth?: boolean;
}

async function fetchFleetPlanning(
  path: string,
  query: URLSearchParams,
  options: FleetPlanningFetchOptions = {},
) {
  const { baseUrl } = readFleetPlanningConfig();
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const suffix = query.toString();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.withAuth) {
      // Token vendor hanya dipakai untuk endpoint fleet planning yang
      // memang mewajibkan autentikasi (index/show), tidak pernah
      // dikembalikan ke browser.
      const token = (process.env.MCEASY_API_TOKEN ?? "").trim();
      if (!token) {
        throw new McEasyError(
          "Integrasi tracking belum dikonfigurasi. Minta administrator mengatur MCEASY_API_TOKEN.",
          503,
          "MCEASY_NOT_CONFIGURED",
        );
      }
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${baseUrl}${path}${suffix ? `?${suffix}` : ""}`, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    return response;
  } catch (error) {
    if (error instanceof McEasyError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) throw error;
      throw new McEasyError(
        "Permintaan data Fleet Task kehabisan waktu. Coba lagi.",
        504,
        "MCEASY_TIMEOUT",
      );
    }
    throw new McEasyError(
      "Tidak dapat terhubung ke layanan tracking. Periksa koneksi lalu coba lagi.",
      502,
      "MCEASY_NETWORK",
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

async function readFleetPlanningJson(
  path: string,
  query: URLSearchParams,
  options: FleetPlanningFetchOptions = {},
): Promise<unknown> {
  const response = await fetchFleetPlanning(path, query, options);
  if (!response.ok) {
    const { code, detail } = await parseUpstreamError(response);
    throw mapFleetTaskError(response.status, code, detail);
  }
  try {
    return await response.json();
  } catch {
    throw new McEasyError(
      "Respons layanan tracking tidak valid. Coba lagi.",
      502,
      "MCEASY_INVALID_RESPONSE",
    );
  }
}

export interface FleetTaskInstantListQuery {
  limit?: number;
  page?: number;
  search?: string;
  sort?: string;
}

export interface FleetTaskInstantListResult {
  items: unknown[];
  total: number | null;
  page: number | null;
  counts: {
    draft: number | null;
    scheduled: number | null;
    started: number | null;
    ended: number | null;
    canceled: number | null;
  } | null;
}

function toNullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Mengambil daftar Fleet Task Instant (Index). Endpoint ini mewajibkan
 * autentikasi vendor sehingga request membawa Bearer token server-side.
 *
 * Catatan: parameter `filter` status saat diverifikasi tidak berpengaruh
 * di sisi upstream, jadi filter status dilakukan di UI/API kita.
 */
export async function fetchFleetTaskInstantList(
  query: FleetTaskInstantListQuery = {},
  options: McEasyFetchOptions = {},
): Promise<FleetTaskInstantListResult> {
  const params = new URLSearchParams();
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 20), 1), 100);
  params.set("limit", String(limit));
  if (query.page !== undefined && Number.isFinite(query.page) && query.page >= 1) {
    params.set("page", String(Math.trunc(query.page)));
  }
  if (query.search && query.search.trim()) {
    params.set("search", query.search.trim());
  }
  if (query.sort && query.sort.trim()) {
    params.set("sort", query.sort.trim());
  }

  const payload = await readFleetPlanningJson("/fleet-task-instant", params, {
    ...options,
    withAuth: true,
  });

  if (!payload || typeof payload !== "object") {
    throw new McEasyError(
      "Respons layanan tracking tidak valid. Coba lagi.",
      502,
      "MCEASY_INVALID_RESPONSE",
    );
  }

  const envelope = payload as {
    metadata?: Record<string, unknown>;
    data?: { paginated_result?: unknown; ids?: unknown };
  };
  const items = Array.isArray(envelope.data?.paginated_result)
    ? (envelope.data.paginated_result as unknown[])
    : [];
  const metadata = envelope.metadata ?? {};

  return {
    items,
    total: toNullableCount(metadata.total_count),
    page: toNullableCount(metadata.page),
    counts: {
      draft: toNullableCount(metadata.total_count_draft),
      scheduled: toNullableCount(metadata.total_count_scheduled),
      started: toNullableCount(metadata.total_count_started),
      ended: toNullableCount(metadata.total_count_ended),
      canceled: toNullableCount(metadata.total_count_canceled),
    },
  };
}

/**
 * Mengambil detail satu Fleet Task Instant berdasarkan UUID (Show).
 * Berisi ringkasan task, timeline titik, serta rute planned/actual
 * dalam bentuk encoded polyline.
 */
export async function fetchFleetTaskInstantDetail(
  uuid: string,
  options: McEasyFetchOptions = {},
): Promise<unknown> {
  const identifier = uuid.trim();
  if (!identifier) {
    throw new McEasyError("ID Fleet Task tidak boleh kosong.", 400, "FLEET_TASK_INVALID_ID");
  }

  const payload = await readFleetPlanningJson(
    `/fleet-task-instant/${encodeURIComponent(identifier)}`,
    new URLSearchParams(),
    { ...options, withAuth: true },
  );

  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}
