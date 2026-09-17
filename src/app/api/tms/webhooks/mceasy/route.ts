import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { normalizeTemperatureWebhook } from "@/lib/tms-temperature";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Webhook publik untuk event suhu kendaraan (Temperature Data Update
 * DVC-DU/T1). Sengaja tanpa autentikasi pengguna karena dipanggil oleh
 * layanan tracking — payload yang tidak memuat suhu valid langsung
 * ditolak dengan 400.
 */
function extractCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const envelope = payload as Record<string, unknown>;
    for (const key of ["data", "DATA", "events", "items"]) {
      const nested = envelope[key];
      if (Array.isArray(nested)) return nested;
      if (nested && typeof nested === "object") return [nested];
    }
    return [payload];
  }
  return [];
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Payload JSON tidak valid." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const events = extractCandidates(payload)
    .map((candidate) => {
      const normalized = normalizeTemperatureWebhook(candidate);
      if (!normalized) return null;
      return { normalized, raw: candidate };
    })
    .filter((event): event is NonNullable<typeof event> => event !== null);

  if (events.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada data suhu yang valid pada payload." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("tms_temperature_events").insert(
      events.map(({ normalized, raw }) => ({
        license_plate: normalized.licensePlate,
        imei: normalized.imei,
        driver_name: normalized.driverName,
        latitude: normalized.latitude,
        longitude: normalized.longitude,
        temperature_num: normalized.temperatureNum,
        temperature: normalized.temperature,
        engine_on: normalized.engineOn,
        raw_payload: raw as Record<string, unknown>,
      })),
    );
    if (error) throw new Error(error.message);
  } catch {
    return NextResponse.json(
      { error: "Gagal menyimpan data suhu. Coba lagi." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { ok: true, inserted: events.length },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
