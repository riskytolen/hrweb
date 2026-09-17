import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { normalizeTemperatureWebhook } from "@/lib/tms-temperature";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Webhook publik untuk event McEasy. Semua payload JSON disimpan sebagai raw
 * log terlebih dahulu untuk diagnosis; bila payload memuat data suhu yang
 * dikenali, data juga dinormalisasi ke tabel suhu.
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
  let payloadValid = true;
  let payloadError: string | null = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
    payloadValid = false;
    payloadError = "Payload JSON tidak valid.";
  }

  const events = extractCandidates(payload)
    .map((candidate) => {
      const normalized = normalizeTemperatureWebhook(candidate);
      if (!normalized) return null;
      return { normalized, raw: candidate };
    })
    .filter((event): event is NonNullable<typeof event> => event !== null);

  try {
    const supabase = createAdminClient();

    const { error: rawError } = await supabase.from("tms_webhook_events").insert({
      provider: "mceasy",
      event_type: request.headers.get("x-mceasy-event") ?? request.headers.get("x-event-type"),
      http_method: request.method,
      user_agent: request.headers.get("user-agent"),
      payload: payloadValid ? (payload as Record<string, unknown>) : null,
      payload_valid: payloadValid,
      payload_error: payloadError,
      normalized_count: events.length,
    });
    if (rawError) throw new Error(rawError.message);

    if (events.length > 0) {
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
    }
  } catch {
    return NextResponse.json(
      { error: "Gagal menyimpan payload webhook. Coba lagi." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { ok: true, received: true, normalized: events.length, inserted: events.length },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
