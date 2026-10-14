import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { canRecordPurchasePayment, validatePurchasePayment, type PurchaseProcessStatus } from "@/lib/purchase";
import { getPurchaseActor, manageForbidden, NO_STORE_HEADERS } from "../../../_auth";

export const dynamic = "force-dynamic";

// ─── POST /api/purchase/orders/[id]/payments — catat pembayaran/cicilan (Purchasing) ───
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  if (!actor.canManage) return manageForbidden();
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

  const input = {
    payment_date: typeof body.payment_date === "string" ? body.payment_date : "",
    amount: Math.round(Number(body.amount) || 0),
  };
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
  const idempotencyKey =
    typeof body.idempotency_key === "string" && /^[0-9a-fA-F-]{8,64}$/.test(body.idempotency_key.trim())
      ? body.idempotency_key.trim()
      : null;

  try {
    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from("purchase_orders")
      .select("id, po_no, amount, total_paid, process_status")
      .eq("id", id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ error: "PO tidak ditemukan." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (!canRecordPurchasePayment(order.process_status as PurchaseProcessStatus)) {
      return NextResponse.json(
        { error: "PO yang sudah ditolak/dibatalkan tidak dapat menerima pembayaran." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const clientError = validatePurchasePayment(input, Number(order.amount) || 0, Number(order.total_paid) || 0);
    if (clientError) {
      return NextResponse.json({ error: clientError }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const { data, error } = await admin.rpc("record_purchase_payment", {
      p_order_id: id,
      p_payment_date: input.payment_date,
      p_amount: input.amount,
      p_notes: notes || null,
      p_actor: actor.userId,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      const message = error.message || "";
      if (message.includes("PURCHASE_PAYMENT_OVERPAY")) {
        return NextResponse.json(
          { error: "Total pembayaran melebihi nominal PO." },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      if (message.includes("PURCHASE_ORDER_CLOSED")) {
        return NextResponse.json(
          { error: "PO yang sudah ditolak/dibatalkan tidak dapat menerima pembayaran." },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      throw error;
    }

    const result = data as { payment_id: number; total_paid: number; duplicate: boolean };
    await logAudit({
      supabase: await createClient(),
      action: "create",
      entityType: "purchase_order_payments",
      entityId: result.payment_id,
      entityLabel: `${order.po_no as string} — pembayaran ${input.amount.toLocaleString("id-ID")} (${input.payment_date})`,
      newData: { order_id: id, ...input, notes: notes || null },
    });

    return NextResponse.json(
      { payment_id: result.payment_id, total_paid: result.total_paid, duplicate: result.duplicate },
      { status: result.duplicate ? 200 : 201, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("POST /api/purchase/orders/[id]/payments error:", err);
    return NextResponse.json(
      { error: "Gagal mencatat pembayaran. Silakan coba lagi." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
