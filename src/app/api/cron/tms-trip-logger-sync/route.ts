import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncTripVisitLogs } from "@/lib/tms-trip-logger-server";
import { McEasyError } from "@/lib/mceasy-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * Sinkronisasi terjadwal Logger Trips dari timeline McEasy ke Supabase.
 * Dipanggil oleh Supabase Cron setiap 2 menit; bukan endpoint browser.
 *
 * Body opsional: { "mode": "backfill", "days": 7, "maxPages": 30 }.
 */
export async function POST(request: Request) {
  const expectedSecret = (
    process.env.TMS_TRIP_LOGGER_SYNC_SECRET ??
    process.env.TMS_POINT_CAPTURE_SECRET ??
    ""
  ).trim();
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Sinkronisasi Logger Trips belum dikonfigurasi." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const providedSecret = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!secretsMatch(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401, headers: NO_STORE_HEADERS });
  }

  let body: { mode?: unknown; days?: unknown; maxPages?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const mode = body.mode === "backfill" ? "backfill" : "incremental";
  const days = typeof body.days === "number" && Number.isFinite(body.days)
    ? Math.min(Math.max(Math.trunc(body.days), 1), 30)
    : 7;
  const maxPages = typeof body.maxPages === "number" && Number.isFinite(body.maxPages)
    ? Math.min(Math.max(Math.trunc(body.maxPages), 1), 60)
    : undefined;

  try {
    const summary = await syncTripVisitLogs({ mode, days, maxPages });
    return NextResponse.json({ data: summary }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof McEasyError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      { error: "Gagal menyinkronkan Logger Trips." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
