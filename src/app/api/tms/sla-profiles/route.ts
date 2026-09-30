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

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+07:00`));
}

function normalizeTime(value: string | null | undefined): string | null {
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

/**
 * Daftar profil rute SLA dalam scope client user.
 * Dipakai filter Logger Trips dan halaman Pengaturan SLA.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeSlaConfig(false);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const groupId = params.get("groupId")?.trim() ?? "";
  const clientRef = params.get("client")?.trim() ?? "";
  const statusFilter = (params.get("status")?.trim() ?? "Aktif").toUpperCase();
  const wantAll = statusFilter === "ALL";
  const scopeIds = auth.context.allowedClientIds;

  const admin = createAdminClient();
  let query = admin
    .from("tms_sla_route_profiles")
    .select(
      "id, code, name, client_id, group_id, departure_target_time, departure_day_offset, " +
        "effective_from, effective_until, status, source_file",
    )
    .order("code", { ascending: true });
  if (!wantAll) query = query.eq("status", statusFilter === "AKTIF" ? "Aktif" : "Tidak Aktif");
  if (scopeIds !== "all") query = query.in("client_id", scopeIds);
  if (groupId) query = query.eq("group_id", groupId);
  if (clientRef) {
    const { data: clientRow } = await admin
      .from("tms_clients")
      .select("id")
      .or(`code.ilike.${clientRef},slug.ilike.${clientRef}`)
      .maybeSingle();
    const client = clientRow as { id?: string } | null;
    if (!client?.id) return slaConfigJson({ data: [] });
    if (scopeIds !== "all" && !scopeIds.includes(client.id)) {
      return slaConfigError("Client di luar cakupan akses Anda.", 403);
    }
    query = query.eq("client_id", client.id);
  }

  const { data: profiles, error: profilesError } = await query;
  if (profilesError) {
    return slaConfigError("Gagal memuat profil SLA.", 502);
  }
  const list = (Array.isArray(profiles) ? profiles : []) as unknown as ProfileRow[];

  const groupIdSet = [...new Set(list.map((p) => p.group_id))];

  const groupNames = new Map<string, string>();
  if (groupIdSet.length > 0) {
    const { data: groupRows } = await admin
      .from("tms_live_track_groups")
      .select("id, name, client_id")
      .in("id", groupIdSet);
    for (const row of (Array.isArray(groupRows) ? groupRows : []) as unknown as {
      id: string;
      name: string;
      client_id: string | null;
    }[]) {
      // Kelompok milik client di luar scope tidak ikut ditampilkan.
      if (scopeIds !== "all" && (!row.client_id || !scopeIds.includes(row.client_id))) continue;
      if (row?.id) groupNames.set(row.id, row.name);
    }
  }

  const visible = list.filter((p) => groupNames.has(p.group_id));

  const stopCounts = new Map<string, number>();
  const unresolvedCounts = new Map<string, number>();
  if (visible.length > 0) {
    const visibleIds = visible.map((p) => p.id);
    const { data: stopRows } = await admin
      .from("tms_sla_route_stops")
      .select("id, profile_id")
      .in("profile_id", visibleIds);
    const stops = (Array.isArray(stopRows) ? stopRows : []) as unknown as {
      id: string;
      profile_id: string;
    }[];
    const stopIds = stops.map((s) => s.id);
    const mappedStopIds = new Set<string>();
    if (stopIds.length > 0) {
      const { data: addressRows } = await admin
        .from("tms_sla_route_stop_addresses")
        .select("route_stop_id")
        .in("route_stop_id", stopIds);
      for (const row of (Array.isArray(addressRows) ? addressRows : []) as unknown as {
        route_stop_id: string;
      }[]) {
        if (row?.route_stop_id) mappedStopIds.add(row.route_stop_id);
      }
    }
    for (const stop of stops) {
      stopCounts.set(stop.profile_id, (stopCounts.get(stop.profile_id) ?? 0) + 1);
      if (!mappedStopIds.has(stop.id)) {
        unresolvedCounts.set(stop.profile_id, (unresolvedCounts.get(stop.profile_id) ?? 0) + 1);
      }
    }
  }

  return slaConfigJson({
    data: visible.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      clientId: p.client_id,
      groupId: p.group_id,
      groupName: groupNames.get(p.group_id) ?? null,
      departureTargetTime: p.departure_target_time ? p.departure_target_time.slice(0, 5) : null,
      departureDayOffset: p.departure_day_offset ?? 0,
      effectiveFrom: p.effective_from,
      effectiveUntil: p.effective_until,
      status: p.status,
      sourceFile: p.source_file,
      stopCount: stopCounts.get(p.id) ?? 0,
      unresolvedCount: unresolvedCounts.get(p.id) ?? 0,
    })),
    meta: { canManage: auth.context.canManage },
  });
}

interface CreateProfileBody {
  groupId?: unknown;
  code?: unknown;
  name?: unknown;
  departureTargetTime?: unknown;
  departureDayOffset?: unknown;
  effectiveFrom?: unknown;
  effectiveUntil?: unknown;
}

/** Buat profil rute baru (kelola). Client mengikuti pemilik kelompok. */
export async function POST(request: NextRequest) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;

  let body: CreateProfileBody;
  try {
    body = (await request.json()) as CreateProfileBody;
  } catch {
    return slaConfigError("Body permintaan tidak valid.", 400);
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase().replace(/\s+/g, " ") : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : code;
  const effectiveFrom = typeof body.effectiveFrom === "string" ? body.effectiveFrom.trim() : "";
  const effectiveUntil =
    typeof body.effectiveUntil === "string" && body.effectiveUntil.trim() ? body.effectiveUntil.trim() : null;
  const dayOffset =
    typeof body.departureDayOffset === "number" && Number.isInteger(body.departureDayOffset) && body.departureDayOffset >= 0
      ? body.departureDayOffset
      : 0;

  if (!groupId) return slaConfigError("Kelompok kendaraan wajib dipilih.", 400);
  if (!code) return slaConfigError("Kode profil wajib diisi (mis. VAN 13).", 400);
  if (!isValidDate(effectiveFrom)) {
    return slaConfigError("Tanggal berlaku tidak valid. Gunakan YYYY-MM-DD.", 400);
  }
  if (effectiveUntil && (!isValidDate(effectiveUntil) || effectiveUntil < effectiveFrom)) {
    return slaConfigError("Tanggal berakhir tidak valid.", 400);
  }
  const departureTargetTime = normalizeTime(body.departureTargetTime as string | null | undefined);
  if (body.departureTargetTime !== undefined && body.departureTargetTime !== null && String(body.departureTargetTime).trim() !== "" && !departureTargetTime) {
    return slaConfigError("Jam berangkat tidak valid. Gunakan HH:MM.", 400);
  }

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

  const { data: created, error: insertError } = await admin
    .from("tms_sla_route_profiles")
    .insert({
      client_id: groupRow.client_id,
      group_id: groupId,
      code,
      name: name || `${code} ${groupRow.name}`,
      departure_target_time: departureTargetTime,
      departure_day_offset: dayOffset,
      effective_from: effectiveFrom,
      effective_until: effectiveUntil,
      status: "Aktif",
      created_by: auth.context.userId,
      updated_by: auth.context.userId,
    })
    .select("id")
    .single();
  if (insertError) {
    const message = /duplicate|unique/i.test(insertError.message)
      ? "Kode profil sudah dipakai pada kelompok dan tanggal berlaku ini."
      : "Gagal membuat profil SLA.";
    return slaConfigError(message, insertError.message && /duplicate|unique/i.test(insertError.message) ? 409 : 502);
  }
  const createdRow = created as { id: string } | null;
  return slaConfigJson({ data: { id: createdRow?.id ?? null } }, 201);
}
