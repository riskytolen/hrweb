import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncLiveTrack } from "@/lib/tms-live-track-sync-server";
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
 * Sinkronisasi terjadwal Live Track berkelompok dari McEasy ke Supabase.
 * Dipanggil oleh Supabase Cron setiap 2 menit; bukan endpoint browser.
 */
export async function POST(request: Request) {
  const expectedSecret = (
    process.env.TMS_LIVE_TRACK_SYNC_SECRET ??
    process.env.TMS_POINT_CAPTURE_SECRET ??
    ""
  ).trim();
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Sinkronisasi Live Track belum dikonfigurasi." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const providedSecret = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!secretsMatch(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401, headers: NO_STORE_HEADERS });
  }

  try {
    const summary = await syncLiveTrack(Date.now());
    return NextResponse.json({ data: summary }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof McEasyError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      { error: "Gagal menyinkronkan Live Track." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
