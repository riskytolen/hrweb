import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { fetchFleetTaskInstantDetail, McEasyError } from "@/lib/mceasy-server";
import { normalizeFleetTaskInstantDetail } from "@/lib/fleet-task-track";
import { matchTemperaturesToPoints, type TemperatureReading } from "@/lib/tms-temperature";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

/** Toleransi default pencocokan suhu ke waktu kunjungan (menit). */
const DEFAULT_WINDOW_MINUTES = 30;
const MAX_READINGS = 1000;

function parsePermissions(permissions: unknown): string[] {
  if (Array.isArray(permissions)) return permissions.filter((p): p is string => typeof p === "string");
  if (typeof permissions === "string") {
    try {
      const parsed: unknown = JSON.parse(permissions);
      if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
    } catch {
      return [];
    }
  }
  return [];
}

interface TemperatureRow {
  license_plate: string | null;
  temperature: number | null;
  temperature_num: number | null;
  received_at: string | null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sesi login telah berakhir. Silakan masuk kembali." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("status, account_type, roles(id, nama, level, permissions, status)")
    .eq("id", user.id)
    .single();

  const roleRelation = profile?.roles;
  const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;
  const permissions = parsePermissions(role?.permissions);
  const allowed =
    profile?.status === "Aktif" &&
    profile.account_type === "internal" &&
    role?.status !== "Tidak Aktif" &&
    (permissions.includes("all") ||
      permissions.includes("tms") ||
      permissions.includes("tms.view") ||
      permissions.includes("tms.input"));

  if (!allowed) {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses ke menu TMS." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const { id } = await params;
  const url = new URL(request.url);
  const windowParam = Number(url.searchParams.get("windowMinutes"));
  const windowMinutes =
    Number.isFinite(windowParam) && windowParam >= 1 && windowParam <= 180
      ? Math.trunc(windowParam)
      : DEFAULT_WINDOW_MINUTES;

  try {
    const raw = await fetchFleetTaskInstantDetail(id);
    const detail = normalizeFleetTaskInstantDetail(raw);
    if (!detail) {
      return NextResponse.json(
        { error: "Data Fleet Task tidak ditemukan pada layanan tracking." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const licensePlate = detail.licensePlate?.trim() || null;
    if (!licensePlate) {
      return NextResponse.json(
        {
          data: [],
          meta: { licensePlate: null, windowMinutes, readings: 0, fetchedAt: new Date().toISOString() },
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("tms_temperature_events")
      .select("license_plate, temperature, temperature_num, received_at")
      .ilike("license_plate", licensePlate)
      .order("received_at", { ascending: false })
      .limit(MAX_READINGS);

    if (error) throw new Error(error.message);

    const readings: TemperatureReading[] = ((rows ?? []) as TemperatureRow[])
      .filter(
        (row) =>
          typeof row.temperature === "number" &&
          Number.isFinite(row.temperature) &&
          typeof row.received_at === "string" &&
          !Number.isNaN(Date.parse(row.received_at)),
      )
      .map((row) => ({
        temperature: row.temperature as number,
        temperatureNum: typeof row.temperature_num === "number" ? row.temperature_num : null,
        recordedAt: row.received_at as string,
      }));

    const data = matchTemperaturesToPoints(
      detail.timeline.map((point) => ({
        sequence: point.sequence,
        arrivalActual: point.arrivalActual,
        departureActual: point.departureActual,
      })),
      readings,
      windowMinutes,
    );

    return NextResponse.json(
      {
        data,
        meta: {
          licensePlate,
          windowMinutes,
          readings: readings.length,
          fetchedAt: new Date().toISOString(),
        },
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof McEasyError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      { error: "Gagal memuat data suhu. Coba lagi." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
