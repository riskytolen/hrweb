import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import {
  canTransitionPurchaseStatus,
  purchasePaymentStatus,
  purchaseRemaining,
  purchaseStatusNeedsReason,
  validatePurchaseForm,
  type PurchaseProcessStatus,
} from "@/lib/purchase";
import { getPurchaseActor, manageForbidden, NO_STORE_HEADERS, type PurchaseActor } from "../../_auth";

export const dynamic = "force-dynamic";

const STATUSES: PurchaseProcessStatus[] = [
  "po_masuk",
  "po_diterima",
  "on_process",
  "waiting_list",
  "pending_payment",
  "non_approve",
  "cancel",
];

async function loadOrder(admin: ReturnType<typeof createAdminClient>, id: number) {
  const { data, error } = await admin.from("purchase_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

function canView(actor: PurchaseActor, order: Record<string, unknown>): boolean {
  if (actor.canManage) return true;
  return order.submitted_by === actor.userId;
}

// ─── GET /api/purchase/orders/[id] ───
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "ID PO tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const admin = createAdminClient();
    const order = await loadOrder(admin, id);
    if (!order || !canView(actor, order)) {
      return NextResponse.json({ error: "PO tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const [payRes, attRes, evRes] = await Promise.all([
      admin.from("purchase_order_payments").select("*").eq("order_id", id).order("payment_date", { ascending: true }),
      admin.from("purchase_order_attachments").select("id, order_id, file_name, mime_type, file_size, kind, payment_id, created_at").eq("order_id", id).order("created_at", { ascending: true }),
      admin.from("purchase_order_events").select("*").eq("order_id", id).order("created_at", { ascending: false }).limit(100),
    ]);
    if (payRes.error) throw payRes.error;
    if (attRes.error) throw attRes.error;
    if (evRes.error) throw evRes.error;

    const amount = Number(order.amount) || 0;
    const totalPaid = Number(order.total_paid) || 0;
    return NextResponse.json(
      {
        item: {
          ...order,
          payment_status: purchasePaymentStatus(amount, totalPaid),
          remaining: purchaseRemaining(amount, totalPaid),
        },
        payments: payRes.data || [],
        attachments: attRes.data || [],
        events: evRes.data || [],
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("GET /api/purchase/orders/[id] error:", err);
    return NextResponse.json({ error: "Gagal memuat detail PO." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// ─── PATCH /api/purchase/orders/[id] ───
// action: "status" (Purchasing) | "note" (Purchasing) | "edit" (pengaju, PO Masuk)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "ID PO tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body request tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const action = body.action;

  try {
    const admin = createAdminClient();
    const order = await loadOrder(admin, id);
    if (!order || !canView(actor, order)) {
      return NextResponse.json({ error: "PO tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const from = order.process_status as PurchaseProcessStatus;
    const hasPayments = (Number(order.total_paid) || 0) > 0;

    if (action === "status") {
      if (!actor.canManage) return manageForbidden();
      const to = body.to as PurchaseProcessStatus;
      if (!STATUSES.includes(to)) {
        return NextResponse.json({ error: "Status tujuan tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
      }
      if (!canTransitionPurchaseStatus(from, to, { hasPayments })) {
        return NextResponse.json(
          { error: hasPayments && (to === "non_approve" || to === "cancel") ? "PO yang sudah memiliki pembayaran tidak dapat ditolak/dibatalkan." : "Perpindahan status tidak diperbolehkan." },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
      if (purchaseStatusNeedsReason(to) && !note) {
        return NextResponse.json({ error: "Alasan wajib diisi untuk status ini." }, { status: 400, headers: NO_STORE_HEADERS });
      }
      const { error } = await admin.from("purchase_orders").update({ process_status: to }).eq("id", id);
      if (error) throw error;
      await admin.from("purchase_order_events").insert({
        order_id: id,
        event_type: "status_change",
        from_status: from,
        to_status: to,
        note: note || null,
        actor_id: actor.userId,
      });
      await logAudit({
        supabase: await createClient(),
        action: "status_change",
        entityType: "purchase_orders",
        entityId: id,
        entityLabel: `${order.po_no as string} — ${from} → ${to}`,
        oldData: { process_status: from },
        newData: { process_status: to, note: note || null },
      });
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }

    if (action === "note") {
      if (!actor.canManage) return manageForbidden();
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!note) {
        return NextResponse.json({ error: "Catatan wajib diisi." }, { status: 400, headers: NO_STORE_HEADERS });
      }
      if (note.length > 1000) {
        return NextResponse.json({ error: "Catatan maksimal 1000 karakter." }, { status: 400, headers: NO_STORE_HEADERS });
      }
      const { error } = await admin.from("purchase_order_events").insert({
        order_id: id,
        event_type: "note",
        note,
        actor_id: actor.userId,
      });
      if (error) throw error;
      await logAudit({
        supabase: await createClient(),
        action: "update",
        entityType: "purchase_orders",
        entityId: id,
        entityLabel: `${order.po_no as string} — catatan Purchasing`,
        newData: { note },
      });
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }

    if (action === "edit") {
      const isOwner = order.submitted_by === actor.userId;
      if (!isOwner || from !== "po_masuk") {
        return NextResponse.json(
          { error: "Pengajuan hanya bisa diubah pemiliknya sebelum diterima Purchasing." },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }
      const input = {
        title: typeof body.title === "string" ? body.title.trim() : "",
        detail: typeof body.detail === "string" ? body.detail.trim() : "",
        amount: Math.round(Number(body.amount) || 0),
        vendor_name: typeof body.vendor_name === "string" ? body.vendor_name.trim() : "",
        bank_name: typeof body.bank_name === "string" ? body.bank_name.trim() : "",
        account_number: typeof body.account_number === "string" ? body.account_number.trim() : "",
        account_name: typeof body.account_name === "string" ? body.account_name.trim() : "",
        purpose: typeof body.purpose === "string" ? body.purpose.trim() : "",
      };
      const errors = validatePurchaseForm(input);
      if (Object.keys(errors).length > 0) {
        return NextResponse.json({ error: "Validasi gagal.", fieldErrors: errors }, { status: 400, headers: NO_STORE_HEADERS });
      }
      const { error } = await admin.from("purchase_orders").update(input).eq("id", id);
      if (error) throw error;
      await admin.from("purchase_order_events").insert({
        order_id: id,
        event_type: "edited",
        actor_id: actor.userId,
      });
      await logAudit({
        supabase: await createClient(),
        action: "update",
        entityType: "purchase_orders",
        entityId: id,
        entityLabel: `${order.po_no as string} — diubah pengaju`,
        oldData: { title: order.title, amount: order.amount },
        newData: input,
      });
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400, headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("PATCH /api/purchase/orders/[id] error:", err);
    return NextResponse.json({ error: "Gagal memperbarui PO." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
