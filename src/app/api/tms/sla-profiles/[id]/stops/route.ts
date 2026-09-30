import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeSlaConfig, slaConfigError, slaConfigJson } from "@/lib/tms-sla-auth";
import { normalizeSlaStoreKey } from "@/lib/tms-sla";

export const dynamic = "force-dynamic";

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

async function loadProfileInScope(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
  allowedClientIds: "all" | string[],
) {
  const { data, error } = await admin
    .from("tms_sla_route_profiles")
    .select("id, client_id")
    .eq("id", profileId)
    .maybeSingle();
  const profile = data as { id: string; client_id: string } | null;
  if (error || !profile) return null;
  if (allowedClientIds !== "all" && !allowedClientIds.includes(profile.client_id)) return null;
  return profile;
}

interface CreateStopBody {
  storeName?: unknown;
  targetTime?: unknown;
  targetDayOffset?: unknown;
  routeOrder?: unknown;
  addressIds?: unknown;
}

/** Tambah titik SLA ke profil (kelola). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeSlaConfig(true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) return slaConfigError("ID profil tidak valid.", 400);

  let body: CreateStopBody;
  try {
    body = (await request.json()) as CreateStopBody;
  } catch {
    return slaConfigError("Body permintaan tidak valid.", 400);
  }

  const storeName = typeof body.storeName === "string" ? body.storeName.trim().slice(0, 200) : "";
  if (!storeName) return slaConfigError("Nama toko wajib diisi.", 400);
  const targetTime = normalizeTime(body.targetTime);
  if (!targetTime) return slaConfigError("Jam SLA tidak valid. Gunakan HH:MM.", 400);
  const dayOffset =
    body.targetDayOffset === undefined
      ? 0
      : typeof body.targetDayOffset === "number" && Number.isInteger(body.targetDayOffset) && body.targetDayOffset >= 0
        ? body.targetDayOffset
        : NaN;
  if (Number.isNaN(dayOffset)) return slaConfigError("Hari ke tidak valid.", 400);
  const addressIds = Array.isArray(body.addressIds)
    ? [...new Set(body.addressIds.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))]
    : [];

  const admin = createAdminClient();
  const profile = await loadProfileInScope(admin, id, auth.context.allowedClientIds);
  if (!profile) return slaConfigError("Profil SLA tidak ditemukan atau di luar cakupan.", 404);

  const { data: existingStops } = await admin
    .from("tms_sla_route_stops")
    .select("route_order")
    .eq("profile_id", id);
  const usedOrders = new Set(
    ((Array.isArray(existingStops) ? existingStops : []) as { route_order: number }[]).map((s) => s.route_order),
  );
  const routeOrder =
    typeof body.routeOrder === "number" && Number.isInteger(body.routeOrder) && body.routeOrder >= 1
      ? body.routeOrder
      : Math.max(0, ...usedOrders) + 1;
  if (usedOrders.has(routeOrder)) {
    return slaConfigError(`Urutan ${routeOrder} sudah dipakai pada profil ini.`, 409);
  }

  const { data: created, error: insertError } = await admin
    .from("tms_sla_route_stops")
    .insert({
      profile_id: id,
      route_order: routeOrder,
      store_name: storeName,
      store_name_key: normalizeSlaStoreKey(storeName),
      target_time: targetTime,
      target_day_offset: dayOffset,
    })
    .select("id")
    .single();
  if (insertError) {
    const conflict = /duplicate|unique/i.test(insertError.message);
    return slaConfigError(
      conflict ? "Urutan atau nama toko sudah dipakai pada profil ini." : "Gagal menambah titik SLA.",
      conflict ? 409 : 502,
    );
  }
  const stopRow = created as { id: string } | null;

  if (stopRow && addressIds.length > 0) {
    const { error: addressError } = await admin.from("tms_sla_route_stop_addresses").insert(
      addressIds.map((vendorAddressId, index) => ({
        route_stop_id: stopRow.id,
        vendor_address_id: vendorAddressId,
        store_name_snapshot: storeName,
        is_primary: index === 0,
      })),
    );
    if (addressError) return slaConfigError("Titik tersimpan, tetapi mapping address gagal.", 502);
  }

  return slaConfigJson({ data: { id: stopRow?.id ?? null } }, 201);
}
