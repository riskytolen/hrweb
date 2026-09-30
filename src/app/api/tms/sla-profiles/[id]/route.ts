import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeSlaConfig, slaConfigError, slaConfigJson } from "@/lib/tms-sla-auth";

export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  code: string;
  name: string;
  client_id: string;
  group_id: string;
  departure_target_time: string | null;
  departure_day_offset: number | null;
  effective_from: string;
  effective_until: string | null;
  status: string;
  source_file: string | null;
}

interface StopRow {
  id: string;
  profile_id: string;
  route_order: number;
  store_name: string;
  target_time: string;
  target_day_offset: number | null;
}

interface AddressRow {
  id: string;
  route_stop_id: string;
  vendor_address_id: string;
  store_name_snapshot: string | null;
  is_primary: boolean | null;
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+07:00`));
}

function normalizeTime(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = match[3] ? Number(match[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

async function loadProfileInScope(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  allowedClientIds: "all" | string[],
): Promise<{ ok: true; profile: ProfileRow } | { ok: false; response: Response }> {
  const { data, error } = await admin
    .from("tms_sla_route_profiles")
    .select(
      "id, code, name, client_id, group_id, departure_target_time, departure_day_offset, " +
        "effective_from, effective_until, status, source_file",
    )
    .eq("id", profileId)
    .maybeSingle();
  const profile = data as ProfileRow | null;
  if (error || !profile) return { ok: false, response: slaConfigError("Profil SLA tidak ditemukan.", 404) };
  if (allowedClientIds !== "all" && !allowedClientIds.includes(profile.client_id)) {
    return { ok: false, response: slaConfigError("Profil di luar cakupan akses Anda.", 403) };
  }
  return { ok: true, profile };
}

/** Detail profil + titik + mapping address (lihat). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeSlaConfig(false);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) return slaConfigError("ID profil tidak valid.", 400);

  const admin = createAdminClient();
  const loaded = await loadProfileInScope(admin, id, auth.context.allowedClientIds);
  if (!loaded.ok) return loaded.response;
  const profile = loaded.profile;

  const { data: group } = await admin
    .from("tms_live_track_groups")
    .select("id, name")
    .eq("id", profile.group_id)
    .maybeSingle();
  const groupRow = group as { id: string; name: string } | null;

  const { data: stopRows } = await admin
    .from("tms_sla_route_stops")
    .select("id, profile_id, route_order, store_name, target_time, target_day_offset")
    .eq("profile_id", profile.id)
    .order("route_order", { ascending: true });
  const stops = (Array.isArray(stopRows) ? stopRows : []) as unknown as StopRow[];
  const stopIds = stops.map((s) => s.id);

  const addressesByStop = new Map<string, AddressRow[]>();
  if (stopIds.length > 0) {
    const { data: addressRows } = await admin
      .from("tms_sla_route_stop_addresses")
      .select("id, route_stop_id, vendor_address_id, store_name_snapshot, is_primary")
      .in("route_stop_id", stopIds)
      .order("is_primary", { ascending: false });
    for (const row of (Array.isArray(addressRows) ? addressRows : []) as unknown as AddressRow[]) {
      const list = addressesByStop.get(row.route_stop_id) ?? [];
      list.push(row);
      addressesByStop.set(row.route_stop_id, list);
    }
  }

  return slaConfigJson({
    data: {
      id: profile.id,
      code: profile.code,
      name: profile.name,
      clientId: profile.client_id,
      groupId: profile.group_id,
      groupName: groupRow?.name ?? null,
      departureTargetTime: profile.departure_target_time ? profile.departure_target_time.slice(0, 5) : null,
      departureDayOffset: profile.departure_day_offset ?? 0,
      effectiveFrom: profile.effective_from,
      effectiveUntil: profile.effective_until,
      status: profile.status,
      sourceFile: profile.source_file,
      stops: stops.map((stop) => {
        const addresses = addressesByStop.get(stop.id) ?? [];
        return {
          id: stop.id,
          order: stop.route_order,
          storeName: stop.store_name,
          targetTime: stop.target_time.slice(0, 5),
          targetDayOffset: stop.target_day_offset ?? 0,
          unresolved: addresses.length === 0,
          addresses: addresses.map((address) => ({
            id: address.id,
            vendorAddressId: address.vendor_address_id,
            storeNameSnapshot: address.store_name_snapshot,
            isPrimary: address.is_primary ?? false,
          })),
        };
      }),
    },
    meta: { canManage: auth.context.canManage },
  });
}

interface PatchProfileBody {
  code?: unknown;
  name?: unknown;
  departureTargetTime?: unknown;
  departureDayOffset?: unknown;
  effectiveFrom?: unknown;
  effectiveUntil?: unknown;
  status?: unknown;
}

/** Ubah profil (kelola). Snapshot SLA lama tidak berubah (ikut id profil). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) return slaConfigError("ID profil tidak valid.", 400);

  let body: PatchProfileBody;
  try {
    body = (await request.json()) as PatchProfileBody;
  } catch {
    return slaConfigError("Body permintaan tidak valid.", 400);
  }

  const admin = createAdminClient();
  const loaded = await loadProfileInScope(admin, id, auth.context.allowedClientIds);
  if (!loaded.ok) return loaded.response;

  const patch: Record<string, unknown> = { updated_by: auth.context.userId, updated_at: new Date().toISOString() };
  if (body.code !== undefined) {
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase().replace(/\s+/g, " ") : "";
    if (!code) return slaConfigError("Kode profil tidak boleh kosong.", 400);
    if (code.length > 40) return slaConfigError("Kode profil maksimal 40 karakter.", 400);
    patch.code = code;
  }
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) return slaConfigError("Nama profil tidak boleh kosong.", 400);
    patch.name = name;
  }
  if (body.departureTargetTime !== undefined) {
    const normalized = normalizeTime(body.departureTargetTime);
    if (normalized === null && body.departureTargetTime !== null && String(body.departureTargetTime).trim() !== "") {
      return slaConfigError("Jam berangkat tidak valid. Gunakan HH:MM.", 400);
    }
    patch.departure_target_time = normalized;
  }
  if (body.departureDayOffset !== undefined) {
    if (typeof body.departureDayOffset !== "number" || !Number.isInteger(body.departureDayOffset) || body.departureDayOffset < 0) {
      return slaConfigError("Offset hari berangkat tidak valid.", 400);
    }
    patch.departure_day_offset = body.departureDayOffset;
  }
  if (body.effectiveFrom !== undefined) {
    const effectiveFrom = typeof body.effectiveFrom === "string" ? body.effectiveFrom.trim() : "";
    if (!isValidDate(effectiveFrom)) {
      return slaConfigError("Tanggal berlaku tidak valid. Gunakan YYYY-MM-DD.", 400);
    }
    patch.effective_from = effectiveFrom;
  }
  if (body.effectiveUntil !== undefined) {
    const effectiveUntil =
      body.effectiveUntil === null || (typeof body.effectiveUntil === "string" && !body.effectiveUntil.trim())
        ? null
        : typeof body.effectiveUntil === "string"
          ? body.effectiveUntil.trim()
          : "";
    if (effectiveUntil !== null && !isValidDate(effectiveUntil)) {
      return slaConfigError("Tanggal berakhir tidak valid. Gunakan YYYY-MM-DD.", 400);
    }
    const fromDate = (patch.effective_from as string | undefined) ?? loaded.profile.effective_from;
    if (effectiveUntil !== null && effectiveUntil < fromDate) {
      return slaConfigError("Tanggal berakhir tidak boleh sebelum tanggal mulai.", 400);
    }
    patch.effective_until = effectiveUntil;
  }
  if (body.status !== undefined) {
    if (body.status !== "Aktif" && body.status !== "Tidak Aktif") {
      return slaConfigError("Status tidak valid.", 400);
    }
    patch.status = body.status;
  }

  const { error: updateError } = await admin
    .from("tms_sla_route_profiles")
    .update(patch)
    .eq("id", id);
  if (updateError) {
    const conflict = /duplicate|unique/i.test(updateError.message);
    return slaConfigError(
      conflict ? "Kode profil bentrok dengan versi lain pada tanggal berlaku ini." : "Gagal memperbarui profil SLA.",
      conflict ? 409 : 502,
    );
  }
  return slaConfigJson({ data: { id } });
}
