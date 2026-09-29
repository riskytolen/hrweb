import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

interface GaVehicleRow {
  id: number;
  unit: string;
  jenis: string;
  status: string;
}

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sesi login telah berakhir. Silakan masuk kembali." },
        { status: 401, headers: NO_STORE_HEADERS },
      ),
    };
  }
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("status, account_type, roles(id, nama, level, permissions, status)")
    .eq("id", user.id)
    .single();
  const roleRelation = profile?.roles;
  const role = Array.isArray(roleRelation) ? roleRelation[0] : roleRelation;
  const permissions = Array.isArray(role?.permissions) ? role.permissions : [];
  const isSuperAdmin =
    profile?.status === "Aktif" &&
    profile?.account_type === "internal" &&
    role?.status !== "Tidak Aktif" &&
    (Number(role?.level ?? 0) >= 100 || permissions.includes("all"));
  if (!isSuperAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Hanya Super Admin yang dapat mengelola unit operasional client." },
        { status: 403, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { ok: true as const, userId: user.id };
}

/**
 * GET ?clientId=... -> daftar ga_vehicles + vehicleIds yang dipilih client.
 * Dipakai modal "Atur Unit Operasional" di tab Client TMS.
 */
export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() ?? "";
  if (!clientId) {
    return NextResponse.json({ error: "Parameter clientId wajib diisi." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const admin = createAdminClient();
  const { data: client, error: clientError } = await admin
    .from("tms_clients")
    .select("id, code, name, status")
    .eq("id", clientId)
    .single();
  if (clientError || !client) {
    return NextResponse.json({ error: "Client tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const [{ data: vehicles, error: vehiclesError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    admin.from("ga_vehicles").select("id, unit, jenis, status").order("unit", { ascending: true }),
    admin.from("client_vehicle_odometer_assignments").select("vehicle_id").eq("client_id", clientId).eq("status", "Aktif"),
  ]);
  if (vehiclesError || assignmentsError) {
    return NextResponse.json({ error: "Gagal memuat unit operasional." }, { status: 502, headers: NO_STORE_HEADERS });
  }

  const rows = (Array.isArray(vehicles) ? vehicles : []) as GaVehicleRow[];
  const selected = new Set(
    (Array.isArray(assignments) ? assignments : []).map((row) => Number((row as { vehicle_id: number }).vehicle_id)),
  );
  return NextResponse.json(
    {
      data: {
        client,
        vehicles: rows.map((v) => ({ id: v.id, unit: v.unit, jenis: v.jenis, status: v.status })),
        vehicleIds: [...selected].filter((id) => Number.isFinite(id)),
      },
      meta: { total: rows.length, selected: selected.size, fetchedAt: new Date().toISOString() },
    },
    { headers: NO_STORE_HEADERS },
  );
}

/**
 * PATCH { clientId, vehicleIds } -> ganti mapping unit operasional (replace set).
 * Satu unit boleh dipilih untuk beberapa client.
 */
export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body permintaan tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const { clientId, vehicleIds } = (body ?? {}) as { clientId?: unknown; vehicleIds?: unknown };
  if (typeof clientId !== "string" || !clientId.trim()) {
    return NextResponse.json({ error: "clientId wajib diisi." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!Array.isArray(vehicleIds) || !vehicleIds.every((v): v is number => typeof v === "number" && Number.isFinite(v))) {
    return NextResponse.json({ error: "vehicleIds harus array number." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const admin = createAdminClient();
  const { data: client, error: clientError } = await admin
    .from("tms_clients")
    .select("id, status")
    .eq("id", clientId)
    .eq("status", "Aktif")
    .single();
  if (clientError || !client) {
    return NextResponse.json({ error: "Client tidak valid/tidak aktif." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const uniqueIds = [...new Set(vehicleIds.map((v) => Math.trunc(v)).filter((v) => v > 0))];
  if (uniqueIds.length > 0) {
    const { data: vehicles, error: vehiclesError } = await admin
      .from("ga_vehicles")
      .select("id")
      .in("id", uniqueIds);
    if (vehiclesError) {
      return NextResponse.json({ error: "Gagal memvalidasi kendaraan." }, { status: 502, headers: NO_STORE_HEADERS });
    }
    const valid = new Set((Array.isArray(vehicles) ? vehicles : []).map((row) => Number((row as { id: number }).id)));
    const invalid = uniqueIds.filter((id) => !valid.has(id));
    if (invalid.length > 0) {
      return NextResponse.json({ error: "Terdapat kendaraan yang tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
    }
  }

  const { error: deleteError } = await admin
    .from("client_vehicle_odometer_assignments")
    .delete()
    .eq("client_id", clientId);
  if (deleteError) {
    return NextResponse.json({ error: "Gagal memperbarui unit operasional." }, { status: 502, headers: NO_STORE_HEADERS });
  }
  if (uniqueIds.length > 0) {
    const { error: insertError } = await admin.from("client_vehicle_odometer_assignments").insert(
      uniqueIds.map((vehicle_id) => ({ client_id: clientId, vehicle_id, status: "Aktif", created_by: gate.userId })),
    );
    if (insertError) {
      return NextResponse.json({ error: "Gagal menyimpan unit operasional." }, { status: 502, headers: NO_STORE_HEADERS });
    }
  }
  return NextResponse.json(
    { data: { clientId, vehicleIds: uniqueIds }, meta: { fetchedAt: new Date().toISOString() } },
    { headers: NO_STORE_HEADERS },
  );
}
