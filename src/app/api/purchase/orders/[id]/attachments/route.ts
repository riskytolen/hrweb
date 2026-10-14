import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import {
  PURCHASE_ATTACHMENT_MIME_TYPES,
  PURCHASE_MAX_ATTACHMENT_BYTES,
  PURCHASE_MAX_ATTACHMENTS,
} from "@/lib/purchase";
import { getPurchaseActor, manageForbidden, NO_STORE_HEADERS } from "../../../_auth";

export const dynamic = "force-dynamic";

const BUCKET = "purchase-attachments";
const ALLOWED = new Set<string>([...PURCHASE_ATTACHMENT_MIME_TYPES]);

function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "lampiran";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "lampiran";
}

// ─── POST /api/purchase/orders/[id]/attachments — upload lampiran ───
// kinds: "bukti" (pengaju saat PO Masuk / Purchasing kapan saja),
//        "pembayaran" (Purchasing, opsional payment_id).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "ID PO tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Form upload tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const file = form.get("file");
  const kind = form.get("kind") === "pembayaran" ? "pembayaran" : "bukti";
  const paymentIdRaw = form.get("payment_id");
  const paymentId = typeof paymentIdRaw === "string" && paymentIdRaw ? Number(paymentIdRaw) : null;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File wajib dilampirkan." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Lampiran harus PDF, JPG, JPEG, atau PNG." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (file.size <= 0 || file.size > PURCHASE_MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "Ukuran tiap file maksimal 10 MB." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from("purchase_orders")
      .select("id, po_no, submitted_by, process_status")
      .eq("id", id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ error: "PO tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const isOwner = order.submitted_by === actor.userId;
    if (actor.canManage) {
      // Purchasing boleh mengunggah kapan saja.
    } else if (isOwner && kind === "bukti" && order.process_status === "po_masuk") {
      // Pengaju hanya sebelum PO diterima Purchasing.
    } else {
      return actor.canManage ? manageForbidden() : NextResponse.json(
        { error: "Anda tidak dapat menambah lampiran pada PO ini." },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    const { count } = await admin
      .from("purchase_order_attachments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", id);
    if ((count || 0) >= PURCHASE_MAX_ATTACHMENTS) {
      return NextResponse.json(
        { error: `Maksimal ${PURCHASE_MAX_ATTACHMENTS} lampiran per PO.` },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (paymentId !== null) {
      const { data: pay } = await admin
        .from("purchase_order_payments")
        .select("id")
        .eq("id", paymentId)
        .eq("order_id", id)
        .maybeSingle();
      if (!pay) {
        return NextResponse.json({ error: "Pembayaran rujukan tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
      }
    }

    const safeName = sanitizeFileName(file.name);
    const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: attachment, error: insertError } = await admin
      .from("purchase_order_attachments")
      .insert({
        order_id: id,
        file_name: safeName,
        mime_type: file.type,
        file_size: file.size,
        storage_path: path,
        kind,
        payment_id: paymentId,
        uploaded_by: actor.userId,
      })
      .select("id, file_name, mime_type, file_size, kind, created_at")
      .single();
    if (insertError) {
      await admin.storage.from(BUCKET).remove([path]).catch(() => {});
      throw insertError;
    }

    await admin.from("purchase_order_events").insert({
      order_id: id,
      event_type: "attachment",
      note: `Lampiran ${safeName}`,
      actor_id: actor.userId,
    });
    await logAudit({
      supabase: await createClient(),
      action: "create",
      entityType: "purchase_order_attachments",
      entityId: (attachment as { id: number }).id,
      entityLabel: `${order.po_no as string} — ${safeName}`,
      newData: { order_id: id, file_name: safeName, kind },
    });

    return NextResponse.json({ item: attachment }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("POST /api/purchase/orders/[id]/attachments error:", err);
    return NextResponse.json({ error: "Gagal mengunggah lampiran." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
