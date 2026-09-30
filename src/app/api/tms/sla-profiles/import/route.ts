import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeSlaConfig, slaConfigError, slaConfigJson } from "@/lib/tms-sla-auth";
import { normalizeSlaStoreKey } from "@/lib/tms-sla";

export const dynamic = "force-dynamic";

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+07:00`));
}

function normalizeTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
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

interface ImportStop {
  order?: unknown;
  storeName?: unknown;
  targetTime?: unknown;
  targetDayOffset?: unknown;
  addressIds?: unknown;
}

interface ImportProfile {
  code?: unknown;
  name?: unknown;
  departureTargetTime?: unknown;
  departureDayOffset?: unknown;
  stops?: unknown;
}

interface ImportBody {
  groupId?: unknown;
  effectiveFrom?: unknown;
  replace?: unknown;
  sourceFile?: unknown;
  dryRun?: unknown;
  profiles?: unknown;
}

export interface ImportIssue {
  profileCode: string;
  order: number | null;
  type: "UNKNOWN_ADDRESS" | "MISSING_MAPPING";
  message: string;
}

interface NormalizedStop {
  order: number;
  storeName: string;
  targetTime: string;
  dayOffset: number;
  addressIds: string[];
}

interface NormalizedProfile {
  code: string;
  name: string;
  departureTargetTime: string | null;
  departureDayOffset: number;
  stops: NormalizedStop[];
}

/**
 * Import profil SLA sekaligus (kelola).
 * `dryRun: true` hanya memvalidasi + preview tanpa menulis.
 * Address yang belum dikenal McEasy tidak menggagalkan import; titik
 * dibuat tanpa mapping dan dilaporkan sebagai unresolved.
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;

  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return slaConfigError("Body permintaan tidak valid.", 400);
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  const effectiveFrom = typeof body.effectiveFrom === "string" ? body.effectiveFrom.trim() : "";
  const replace = body.replace === true;
  const dryRun = body.dryRun === true;
  const sourceFile =
    typeof body.sourceFile === "string" && body.sourceFile.trim()
      ? body.sourceFile.trim().slice(0, 200)
      : null;

  if (!groupId) return slaConfigError("Kelompok kendaraan wajib dipilih.", 400);
  if (!isValidDate(effectiveFrom)) {
    return slaConfigError("Tanggal berlaku tidak valid. Gunakan YYYY-MM-DD.", 400);
  }
  if (!Array.isArray(body.profiles) || body.profiles.length === 0) {
    return slaConfigError("Daftar profil kosong.", 400);
  }
  if (body.profiles.length > 200) return slaConfigError("Maksimal 200 profil per import.", 400);

  const admin = createAdminClient();
  const { data: group, error: groupError } = await admin
    .from("tms_live_track_groups")
    .select("id, name, client_id")
    .eq("id", groupId)
    .maybeSingle();
  const groupRow = group as { id: string; name: string; client_id: string | null } | null;
  if (groupError || !groupRow) return slaConfigError("Kelompok tidak ditemukan.", 404);
  if (!groupRow.client_id) return slaConfigError("Kelompok belum terikat ke client mana pun.", 409);
  if (auth.context.allowedClientIds !== "all" && !auth.context.allowedClientIds.includes(groupRow.client_id)) {
    return slaConfigError("Kelompok di luar cakupan akses Anda.", 403);
  }

  // Normalisasi + validasi fatal.
  const normalized: NormalizedProfile[] = [];
  const seenCodes = new Set<string>();
  for (const raw of body.profiles as ImportProfile[]) {
    const code =
      typeof raw?.code === "string" ? raw.code.trim().toUpperCase().replace(/\s+/g, " ") : "";
    if (!code) return slaConfigError("Setiap profil wajib memiliki kode.", 400);
    if (seenCodes.has(code)) return slaConfigError(`Kode profil ganda dalam file: ${code}.`, 400);
    seenCodes.add(code);
    const name =
      typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : `${code} ${groupRow.name}`;
    const departureTargetTime = normalizeTime(raw?.departureTargetTime ?? null);
    if (raw?.departureTargetTime !== undefined && raw?.departureTargetTime !== null && String(raw.departureTargetTime).trim() !== "" && !departureTargetTime) {
      return slaConfigError(`Jam berangkat profil ${code} tidak valid. Gunakan HH:MM.`, 400);
    }
    const departureDayOffset =
      raw?.departureDayOffset === undefined
        ? 0
        : typeof raw.departureDayOffset === "number" && Number.isInteger(raw.departureDayOffset) && raw.departureDayOffset >= 0
          ? raw.departureDayOffset
          : NaN;
    if (Number.isNaN(departureDayOffset)) {
      return slaConfigError(`Hari ke berangkat profil ${code} tidak valid.`, 400);
    }
    if (!Array.isArray(raw?.stops) || (raw?.stops as unknown[]).length === 0) {
      return slaConfigError(`Profil ${code} wajib memiliki minimal 1 titik.`, 400);
    }
    const stopsRaw = raw.stops as ImportStop[];
    if (stopsRaw.length > 100) return slaConfigError(`Profil ${code} melebihi 100 titik.`, 400);

    const stops: NormalizedStop[] = [];
    const usedOrders = new Set<number>();
    stopsRaw.forEach((stopRaw, index) => {
      const storeName =
        typeof stopRaw?.storeName === "string" ? stopRaw.storeName.trim().slice(0, 200) : "";
      const targetTime = normalizeTime(stopRaw?.targetTime);
      const dayOffset =
        stopRaw?.targetDayOffset === undefined
          ? 0
          : typeof stopRaw.targetDayOffset === "number" && Number.isInteger(stopRaw.targetDayOffset) && stopRaw.targetDayOffset >= 0
            ? stopRaw.targetDayOffset
            : NaN;
      const order =
        typeof stopRaw?.order === "number" && Number.isInteger(stopRaw.order) && stopRaw.order >= 1
          ? stopRaw.order
          : index + 1;
      const addressIds = Array.isArray(stopRaw?.addressIds)
        ? [...new Set(
            (stopRaw.addressIds as unknown[])
              .filter((v): v is string => typeof v === "string" && v.trim() !== "")
              .map((v) => v.trim()),
          )]
        : [];
      stops.push({ order, storeName, targetTime: targetTime ?? "", dayOffset: Number.isNaN(dayOffset) ? -1 : dayOffset, addressIds });
    });
    for (const stop of stops) {
      if (!stop.storeName) return slaConfigError(`Profil ${code} memiliki titik tanpa nama toko.`, 400);
      if (!stop.targetTime) {
        return slaConfigError(`Jam SLA titik "${stop.storeName}" profil ${code} tidak valid. Gunakan HH:MM.`, 400);
      }
      if (stop.dayOffset < 0) {
        return slaConfigError(`Hari ke titik "${stop.storeName}" profil ${code} tidak valid.`, 400);
      }
      if (usedOrders.has(stop.order)) {
        return slaConfigError(`Urutan ${stop.order} ganda pada profil ${code}.`, 400);
      }
      usedOrders.add(stop.order);
    }
    normalized.push({ code, name, departureTargetTime, departureDayOffset, stops });
  }

  // Address yang pernah tercatat pada client ini dianggap dikenal.
  const knownAddresses = new Set<string>();
  const { data: knownRows } = await admin
    .from("tms_trip_visit_logs")
    .select("address_id")
    .eq("client_id", groupRow.client_id)
    .not("address_id", "is", null)
    .limit(5000);
  for (const row of (Array.isArray(knownRows) ? knownRows : []) as { address_id: string | null }[]) {
    if (row?.address_id) knownAddresses.add(row.address_id);
  }

  const issues: ImportIssue[] = [];
  const preview = normalized.map((profile) => {
    let unresolved = 0;
    for (const stop of profile.stops) {
      const known = stop.addressIds.filter((id) => knownAddresses.has(id));
      const unknown = stop.addressIds.filter((id) => !knownAddresses.has(id));
      for (const id of unknown) {
        issues.push({
          profileCode: profile.code,
          order: stop.order,
          type: "UNKNOWN_ADDRESS",
          message: `Address ${id} ("${stop.storeName}") belum pernah tercatat; titik dibuat tanpa mapping.`,
        });
      }
      if (known.length === 0) {
        unresolved += 1;
        if (stop.addressIds.length === 0) {
          issues.push({
            profileCode: profile.code,
            order: stop.order,
            type: "MISSING_MAPPING",
            message: `Titik "${stop.storeName}" tanpa address McEasy; statusnya SLA Belum Diatur hingga dipetakan.`,
          });
        }
      }
      stop.addressIds = known;
    }
    return { code: profile.code, stopCount: profile.stops.length, unresolvedCount: unresolved };
  });

  if (dryRun) {
    return slaConfigJson({ data: { profiles: preview, issues, wrote: false } });
  }

  const created: { id: string; code: string; stopCount: number; unresolvedCount: number }[] = [];
  const deactivated: string[] = [];
  for (const [index, profile] of normalized.entries()) {
    if (replace) {
      const { data: activeDupes } = await admin
        .from("tms_sla_route_profiles")
        .select("id")
        .eq("group_id", groupId)
        .eq("code", profile.code)
        .eq("status", "Aktif");
      const dupeIds = ((Array.isArray(activeDupes) ? activeDupes : []) as { id: string }[]).map((d) => d.id);
      if (dupeIds.length > 0) {
        await admin
          .from("tms_sla_route_profiles")
          .update({ status: "Tidak Aktif", updated_by: auth.context.userId, updated_at: new Date().toISOString() })
          .in("id", dupeIds);
        deactivated.push(...dupeIds);
      }
    }
    const { data: createdProfile, error: profileError } = await admin
      .from("tms_sla_route_profiles")
      .insert({
        client_id: groupRow.client_id,
        group_id: groupId,
        code: profile.code,
        name: profile.name,
        departure_target_time: profile.departureTargetTime,
        departure_day_offset: profile.departureDayOffset,
        effective_from: effectiveFrom,
        effective_until: null,
        status: "Aktif",
        source_file: sourceFile,
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
      })
      .select("id")
      .single();
    if (profileError || !createdProfile) {
      return slaConfigError(`Gagal menyimpan profil ${profile.code}. Import dihentikan.`, 502);
    }
    const profileId = (createdProfile as { id: string }).id;
    for (const stop of profile.stops) {
      const { data: createdStop, error: stopError } = await admin
        .from("tms_sla_route_stops")
        .insert({
          profile_id: profileId,
          route_order: stop.order,
          store_name: stop.storeName,
          store_name_key: normalizeSlaStoreKey(stop.storeName),
          target_time: stop.targetTime,
          target_day_offset: stop.dayOffset,
        })
        .select("id")
        .single();
      if (stopError || !createdStop) {
        return slaConfigError(`Gagal menyimpan titik "${stop.storeName}" profil ${profile.code}.`, 502);
      }
      const stopId = (createdStop as { id: string }).id;
      if (stop.addressIds.length > 0) {
        const { error: addressError } = await admin.from("tms_sla_route_stop_addresses").insert(
          stop.addressIds.map((vendorAddressId, addressIndex) => ({
            route_stop_id: stopId,
            vendor_address_id: vendorAddressId,
            store_name_snapshot: stop.storeName,
            is_primary: addressIndex === 0,
          })),
        );
        if (addressError) return slaConfigError(`Gagal menyimpan mapping titik "${stop.storeName}".`, 502);
      }
    }
    created.push({
      id: profileId,
      code: profile.code,
      stopCount: preview[index].stopCount,
      unresolvedCount: preview[index].unresolvedCount,
    });
  }

  return slaConfigJson({ data: { profiles: created, deactivated, issues, wrote: true } }, 201);
}
