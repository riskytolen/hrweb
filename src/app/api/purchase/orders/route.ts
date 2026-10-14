import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit";
import {
  purchasePaymentStatus,
  purchaseRemaining,
  validatePurchaseForm,
  type PurchasePaymentStatus,
  type PurchaseProcessStatus,
} from "@/lib/purchase";
import { getPurchaseActor, NO_STORE_HEADERS, requestForbidden } from "../_auth";

export const dynamic = "force-dynamic";

const PROCESS_STATUSES: PurchaseProcessStatus[] = [
  "po_masuk",
  "po_diterima",
  "on_process",
  "waiting_list",
  "pending_payment",
  "non_approve",
  "cancel",
];
const PAY_STATUSES: PurchasePaymentStatus[] = ["unpaid", "installment", "paid"];
const SORT_COLUMNS = ["submitted_at", "amount", "po_no"] as const;

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400, headers: NO_STORE_HEADERS });
}

function payStatusOf(row: { amount: number; total_paid: number }): PurchasePaymentStatus {
  return purchasePaymentStatus(Number(row.amount) || 0, Number(row.total_paid) || 0);
}

// ─── GET /api/purchase/orders — daftar server-side ───
export async function GET(request: NextRequest) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  if (!actor.canRequest && !actor.canManage) {
    return NextResponse.json(
      { error: "Anda belum memiliki akses modul Purchase." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 10));
  const q = (sp.get("q") || "").trim().slice(0, 100);
  const processStatus = sp.get("process_status") || "";
  const payStatus = sp.get("pay_status") || "";
  const jabatanId = sp.get("jabatan_id") || "";
  const dateFrom = sp.get("date_from") || "";
  const dateTo = sp.get("date_to") || "";
  const sort = (SORT_COLUMNS as readonly string[]).includes(sp.get("sort") || "")
    ? (sp.get("sort") as (typeof SORT_COLUMNS)[number])
    : "submitted_at";
  const dir = sp.get("dir") === "asc" ? true : false;

  if (processStatus && !PROCESS_STATUSES.includes(processStatus as PurchaseProcessStatus)) {
    return badRequest("Filter status proses tidak valid.");
  }
  if (payStatus && !PAY_STATUSES.includes(payStatus as PurchasePaymentStatus)) {
    return badRequest("Filter status pembayaran tidak valid.");
  }

  try {
    const admin = createAdminClient();
    let query = admin
      .from("purchase_orders")
      .select(
        "id, po_no, title, amount, vendor_name, process_status, total_paid, submitted_at, submitted_by, requester_name, requester_jabatan_id, requester_jabatan_nama",
        { count: "exact" },
      );

    if (!actor.canManage) query = query.eq("submitted_by", actor.userId);
    if (processStatus) query = query.eq("process_status", processStatus);
    if (jabatanId) {
      const jid = Number(jabatanId);
      if (!Number.isInteger(jid)) return badRequest("Filter jabatan tidak valid.");
      query = query.eq("requester_jabatan_id", jid);
    }
    if (dateFrom) query = query.gte("submitted_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("submitted_at", `${dateTo}T23:59:59.999`);
    if (q) {
      const like = `%${q.replace(/[%_]/g, "")}%`;
      query = query.or(`po_no.ilike.${like},title.ilike.${like},requester_name.ilike.${like},vendor_name.ilike.${like}`);
    }

    // Filter status pembayaran dihitung dari kolom amount/total_paid.
    if (payStatus) {
      query = query.order(sort, { ascending: dir }).limit(2000);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []).filter((r) => payStatusOf(r as { amount: number; total_paid: number }) === payStatus);
      const total = rows.length;
      const items = rows.slice((page - 1) * pageSize, page * pageSize).map(enrich);
      return NextResponse.json({ items, total, page, pageSize }, { headers: NO_STORE_HEADERS });
    }

    query = query.order(sort, { ascending: dir }).range((page - 1) * pageSize, page * pageSize - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return NextResponse.json(
      { items: (data || []).map(enrich), total: count || 0, page, pageSize },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("GET /api/purchase/orders error:", err);
    return NextResponse.json(
      { error: "Gagal memuat daftar PO." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

function enrich(row: Record<string, unknown>) {
  const amount = Number(row.amount) || 0;
  const totalPaid = Number(row.total_paid) || 0;
  return {
    ...row,
    payment_status: payStatusOf({ amount, total_paid: totalPaid }),
    remaining: purchaseRemaining(amount, totalPaid),
  };
}

// ─── POST /api/purchase/orders — buat pengajuan ───
export async function POST(request: NextRequest) {
  const auth = await getPurchaseActor();
  if (!auth.ok) return auth.response;
  const { actor } = auth;
  if (!actor.canRequest) return requestForbidden();
  if (!actor.employeeId || actor.jabatanId === null) {
    return NextResponse.json(
      { error: "Akun Anda belum terhubung ke pegawai aktif. Hubungi Super Admin." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Body request tidak valid.");
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
  const idempotencyKey =
    typeof body.idempotency_key === "string" && /^[0-9a-fA-F-]{8,64}$/.test(body.idempotency_key.trim())
      ? body.idempotency_key.trim()
      : null;

  try {
    const admin = createAdminClient();

    if (idempotencyKey) {
      const { data: existing } = await admin
        .from("purchase_orders")
        .select("id, po_no")
        .eq("idempotency_key", idempotencyKey)
        .eq("submitted_by", actor.userId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { item: existing, duplicate: true },
          { headers: NO_STORE_HEADERS },
        );
      }
    }

    const { data: poNo, error: noError } = await admin.rpc("next_purchase_order_no");
    if (noError || !poNo) throw noError || new Error("no-number");

    const { data: order, error } = await admin
      .from("purchase_orders")
      .insert({
        po_no: poNo as string,
        ...input,
        submitted_by: actor.userId,
        requester_employee_id: actor.employeeId,
        requester_name: actor.employeeName,
        requester_jabatan_id: actor.jabatanId,
        requester_jabatan_nama: actor.jabatanNama,
        process_status: "po_masuk",
        idempotency_key: idempotencyKey,
      })
      .select("id, po_no")
      .single();
    if (error) throw error;

    await admin.from("purchase_order_events").insert({
      order_id: (order as { id: number }).id,
      event_type: "created",
      to_status: "po_masuk",
      actor_id: actor.userId,
    });

    const { createClient } = await import("@/lib/supabase-server");
    await logAudit({
      supabase: await createClient(),
      action: "create",
      entityType: "purchase_orders",
      entityId: (order as { id: number }).id,
      entityLabel: `${poNo as string} — ${input.title}`,
      newData: { po_no: poNo, ...input },
    });

    return NextResponse.json({ item: order, duplicate: false }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("POST /api/purchase/orders error:", err);
    return NextResponse.json(
      { error: "Gagal menyimpan pengajuan PO. Silakan coba lagi." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
