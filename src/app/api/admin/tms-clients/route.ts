import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const DEFAULT_TIMEZONE = "Asia/Jakarta";
const CODE_RE = /^[A-Z0-9][A-Z0-9 _-]{1,29}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;

interface ClientRow {
  id: string;
  code: string;
  slug: string;
  name: string;
  logo_url: string | null;
  timezone: string;
  status: string;
}

function toResponse(row: ClientRow) {
  return {
    id: row.id,
    code: row.code,
    slug: row.slug,
    name: row.name,
    logoUrl: row.logo_url,
    timezone: row.timezone,
    status: row.status,
  };
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
        { error: "Hanya Super Admin yang dapat mengelola client TMS." },
        { status: 403, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { ok: true as const };
}

function normalizeStatus(value: unknown): "Aktif" | "Tidak Aktif" | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "Aktif" || value === "Tidak Aktif") return value;
  return undefined as unknown as null;
}

function normalizePayload(body: Record<string, unknown>): {
  ok: true;
  value: { code: string; slug: string; name: string; logoUrl: string | null; timezone: string; status: "Aktif" | "Tidak Aktif" };
} | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const codeRaw = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const slugRaw = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const timezoneRaw = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : DEFAULT_TIMEZONE;
  const logoRaw = typeof body.logoUrl === "string" ? body.logoUrl.trim() : typeof body.logo_url === "string" ? body.logo_url.trim() : "";
  const statusValue = normalizeStatus(body.status);

  if (!name || name.length < 2 || name.length > 100) {
    return { ok: false, error: "Nama client wajib 2-100 karakter." };
  }
  if (!CODE_RE.test(codeRaw)) {
    return { ok: false, error: "Kode client 2-30 karakter, huruf kapital/angka/spasi/_/-." };
  }
  if (!SLUG_RE.test(slugRaw)) {
    return { ok: false, error: "Slug client 2-60 karakter, huruf kecil/angka/-." };
  }
  if (statusValue === undefined) {
    return { ok: false, error: "Status client tidak valid." };
  }
  if (timezoneRaw.length > 60) {
    return { ok: false, error: "Timezone maksimal 60 karakter." };
  }
  if (logoRaw && logoRaw.length > 500) {
    return { ok: false, error: "Logo URL maksimal 500 karakter." };
  }

  return {
    ok: true,
    value: {
      code: codeRaw,
      slug: slugRaw,
      name,
      logoUrl: logoRaw ? logoRaw : null,
      timezone: timezoneRaw,
      status: statusValue ?? "Aktif",
    },
  };
}

function duplicateMessage(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("tms_clients_code_key") || (lower.includes("code") && lower.includes("duplicate"))) {
    return "Kode client sudah dipakai.";
  }
  if (lower.includes("tms_clients_slug_key") || (lower.includes("slug") && lower.includes("duplicate"))) {
    return "Slug client sudah dipakai.";
  }
  if (message.includes("23505") || lower.includes("duplicate key")) {
    return "Kode/slug client sudah dipakai.";
  }
  return null;
}

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tms_clients")
    .select("id, code, slug, name, logo_url, timezone, status")
    .order("name", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "Gagal memuat client TMS." }, { status: 502, headers: NO_STORE_HEADERS });
  }
  const rows = (Array.isArray(data) ? data : []) as ClientRow[];
  // Hitung unit operasional aktif per client (best effort; 0 bila gagal).
  const counts = new Map<string, number>();
  try {
    const { data: assignments } = await admin
      .from("client_vehicle_odometer_assignments")
      .select("client_id")
      .eq("status", "Aktif");
    for (const row of (Array.isArray(assignments) ? assignments : []) as { client_id: string }[]) {
      const key = String(row.client_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  } catch {
    // Abaikan; count default 0.
  }
  return NextResponse.json(
    {
      data: rows.map((row) => ({ ...toResponse(row), odometerVehicleCount: counts.get(row.id) ?? 0 })),
      meta: { total: rows.length, fetchedAt: new Date().toISOString() },
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body permintaan tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const normalized = normalizePayload((body ?? {}) as Record<string, unknown>);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tms_clients")
    .insert({
      code: normalized.value.code,
      slug: normalized.value.slug,
      name: normalized.value.name,
      logo_url: normalized.value.logoUrl,
      timezone: normalized.value.timezone,
      status: normalized.value.status,
    })
    .select("id, code, slug, name, logo_url, timezone, status")
    .single();
  if (error) {
    const friendly = duplicateMessage(error.message || "");
    return NextResponse.json(
      { error: friendly ?? "Gagal membuat client TMS." },
      { status: friendly ? 409 : 502, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { data: toResponse(data as ClientRow), meta: { fetchedAt: new Date().toISOString() } },
    { status: 201, headers: NO_STORE_HEADERS },
  );
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body permintaan tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const record = (body ?? {}) as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "ID client wajib diisi." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const normalized = normalizePayload(record);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tms_clients")
    .update({
      code: normalized.value.code,
      slug: normalized.value.slug,
      name: normalized.value.name,
      logo_url: normalized.value.logoUrl,
      timezone: normalized.value.timezone,
      status: normalized.value.status,
    })
    .eq("id", id)
    .select("id, code, slug, name, logo_url, timezone, status")
    .single();
  if (error) {
    const msg = error.message || "";
    if (msg.toLowerCase().includes("no rows") || msg.includes("PGRST116")) {
      return NextResponse.json({ error: "Client tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const friendly = duplicateMessage(msg);
    return NextResponse.json(
      { error: friendly ?? "Gagal memperbarui client TMS." },
      { status: friendly ? 409 : 502, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { data: toResponse(data as ClientRow), meta: { fetchedAt: new Date().toISOString() } },
    { headers: NO_STORE_HEADERS },
  );
}
