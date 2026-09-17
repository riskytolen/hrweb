import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { fetchMcEasyTripDetail, McEasyError } from "@/lib/mceasy-server";
import { normalizeTripDetailTrail } from "@/lib/fleet-task-track";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

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

function canAccessTms(permissions: string[]): boolean {
  if (permissions.includes("all")) return true;
  return permissions.some((p) => p === "tms" || p === "tms.view" || p === "tms.input");
}

async function verifyTmsAccess(): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, status: 401 };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("status, account_type, roles(id, nama, level, permissions, status)")
    .eq("id", user.id)
    .single();

  const roleRelation = profile?.roles;
  const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;

  if (
    !profile ||
    profile.status !== "Aktif" ||
    profile.account_type !== "internal" ||
    !role ||
    role.status === "Tidak Aktif" ||
    !canAccessTms(parsePermissions(role.permissions))
  ) {
    return { ok: false, status: 403 };
  }

  return { ok: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await verifyTmsAccess();
  if (!access.ok) {
    return NextResponse.json(
      {
        error:
          access.status === 401
            ? "Sesi login telah berakhir. Silakan masuk kembali."
            : "Anda tidak memiliki akses ke menu TMS.",
      },
      { status: access.status, headers: NO_STORE_HEADERS },
    );
  }

  const { id } = await params;
  const startDate = request.nextUrl.searchParams.get("startDate")?.trim() ?? "";
  const endDate = request.nextUrl.searchParams.get("endDate")?.trim() ?? "";
  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "Parameter startDate dan endDate wajib diisi." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const speedLimitRaw = request.nextUrl.searchParams.get("speedLimit");
  const speedLimitParsed = speedLimitRaw === null ? null : Number(speedLimitRaw);
  const speedLimit =
    speedLimitParsed !== null && Number.isFinite(speedLimitParsed) && speedLimitParsed > 0
      ? Math.trunc(speedLimitParsed)
      : undefined;

  try {
    const query = speedLimit === undefined ? { startDate, endDate } : { startDate, endDate, speedLimit };
    const raw = await fetchMcEasyTripDetail(id, query);
    const trail = normalizeTripDetailTrail(raw);
    return NextResponse.json(
      { data: { trail }, meta: { total: trail.length, fetchedAt: new Date().toISOString() } },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof McEasyError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      { error: "Koneksi ke layanan tracking sedang bermasalah. Coba lagi." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
