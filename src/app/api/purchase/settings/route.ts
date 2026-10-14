import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { getPurchaseActor, NO_STORE_HEADERS } from "../_auth";

export const dynamic = "force-dynamic";

// ─── GET /api/purchase/settings — daftar jabatan + aturan akses ───
export async function GET() {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  if (!actor.canRequest && !actor.canManage) {
    return NextResponse.json(
      { error: "Anda belum memiliki akses modul Purchase." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const admin = createAdminClient();
    const [jabRes, ruleRes] = await Promise.all([
      admin.from("jabatan").select("id, nama, status").eq("status", "Aktif").order("nama"),
      admin.from("purchase_jabatan_rules").select("jabatan_id, can_request, can_manage"),
    ]);
    if (jabRes.error) throw jabRes.error;
    if (ruleRes.error) throw ruleRes.error;
    return NextResponse.json(
      { jabatan: jabRes.data || [], rules: ruleRes.data || [] },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("GET /api/purchase/settings error:", err);
    return NextResponse.json({ error: "Gagal memuat pengaturan." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// ─── PUT /api/purchase/settings — simpan aturan jabatan (Super Admin) ───
export async function PUT(request: NextRequest) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  if (!actor.isSuperAdmin) {
    return NextResponse.json(
      { error: "Hanya Super Admin yang dapat mengubah pengaturan Purchase." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body request tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const requesterIds = Array.isArray(body.requester_jabatan_ids)
    ? body.requester_jabatan_ids.filter((v): v is number => Number.isInteger(v))
    : null;
  const managerIds = Array.isArray(body.manager_jabatan_ids)
    ? body.manager_jabatan_ids.filter((v): v is number => Number.isInteger(v))
    : null;
  if (!requesterIds || !managerIds) {
    return NextResponse.json({ error: "Daftar jabatan tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const admin = createAdminClient();
    const { data: jabatan } = await admin.from("jabatan").select("id").eq("status", "Aktif");
    const validIds = new Set((jabatan || []).map((j) => (j as { id: number }).id));
    const req = requesterIds.filter((v) => validIds.has(v));
    const mgr = managerIds.filter((v) => validIds.has(v));
    const wanted = new Map<number, { can_request: boolean; can_manage: boolean }>();
    for (const v of req) wanted.set(v, { can_request: true, can_manage: wanted.get(v)?.can_manage || false });
    for (const v of mgr) wanted.set(v, { can_request: wanted.get(v)?.can_request || false, can_manage: true });

    const { data: existing } = await admin.from("purchase_jabatan_rules").select("jabatan_id");
    const existingIds = new Set((existing || []).map((r) => (r as { jabatan_id: number }).jabatan_id));

    const upserts = Array.from(wanted.entries()).map(([jabatan_id, flags]) => ({
      jabatan_id,
      ...flags,
      updated_by: actor.userId,
    }));
    if (upserts.length > 0) {
      const { error } = await admin.from("purchase_jabatan_rules").upsert(upserts, { onConflict: "jabatan_id" });
      if (error) throw error;
    }
    const stale = Array.from(existingIds).filter((v) => !wanted.has(v));
    if (stale.length > 0) {
      const { error } = await admin.from("purchase_jabatan_rules").delete().in("jabatan_id", stale);
      if (error) throw error;
    }

    await logAudit({
      supabase: await createClient(),
      action: "update",
      entityType: "purchase_jabatan_rules",
      entityLabel: "Akses Jabatan Purchase",
      newData: { requester_jabatan_ids: req, manager_jabatan_ids: mgr },
    });
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("PUT /api/purchase/settings error:", err);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
