import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getPurchaseActor, NO_STORE_HEADERS } from "../../_auth";

export const dynamic = "force-dynamic";

const BUCKET = "purchase-attachments";
const URL_TTL_SECONDS = 600;

// ─── GET /api/purchase/attachments/[id] — signed URL unduhan ───
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "ID lampiran tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const admin = createAdminClient();
    const { data: attachment, error } = await admin
      .from("purchase_order_attachments")
      .select("id, file_name, storage_path, order_id, purchase_orders!inner(submitted_by)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!attachment) {
      return NextResponse.json({ error: "Lampiran tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const order = attachment.purchase_orders as unknown as { submitted_by: string } | { submitted_by: string }[];
    const submittedBy = Array.isArray(order) ? order[0]?.submitted_by : order?.submitted_by;
    if (!actor.canManage && submittedBy !== actor.userId) {
      return NextResponse.json({ error: "Lampiran tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const { data, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(attachment.storage_path as string, URL_TTL_SECONDS);
    if (signError || !data?.signedUrl) throw signError || new Error("sign");
    return NextResponse.json(
      { url: data.signedUrl, file_name: attachment.file_name, expires_in: URL_TTL_SECONDS },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("GET /api/purchase/attachments/[id] error:", err);
    return NextResponse.json({ error: "Gagal membuka lampiran." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// ─── DELETE /api/purchase/attachments/[id] ───
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "ID lampiran tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const admin = createAdminClient();
    const { data: attachment, error } = await admin
      .from("purchase_order_attachments")
      .select("id, file_name, storage_path, order_id, purchase_orders!inner(submitted_by, process_status)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!attachment) {
      return NextResponse.json({ error: "Lampiran tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const order = attachment.purchase_orders as unknown as { submitted_by: string; process_status: string };
    const ord = Array.isArray(order) ? order[0] : order;
    const isOwnerDraft = ord?.submitted_by === actor.userId && ord?.process_status === "po_masuk";
    if (!actor.canManage && !isOwnerDraft) {
      return NextResponse.json({ error: "Lampiran tidak dapat dihapus." }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const { error: delError } = await admin.from("purchase_order_attachments").delete().eq("id", id);
    if (delError) throw delError;
    await admin.storage.from(BUCKET).remove([attachment.storage_path as string]).catch(() => {});
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("DELETE /api/purchase/attachments/[id] error:", err);
    return NextResponse.json({ error: "Gagal menghapus lampiran." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
