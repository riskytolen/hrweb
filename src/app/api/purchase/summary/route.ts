import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  purchasePaymentStatus,
  purchaseRemaining,
  summarizePurchaseOrders,
  type PurchasePaymentStatus,
  type PurchaseProcessStatus,
  type PurchaseSummaryOrder,
} from "@/lib/purchase";
import { getPurchaseActor, NO_STORE_HEADERS } from "../_auth";

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
const PAY_STATUSES: PurchasePaymentStatus[] = ["unpaid", "installment", "paid"];

// ─── GET /api/purchase/summary — agregat seluruh hasil filter ───
// mode=submit (periode pengajuan) | mode=pay (periode pembayaran aktual)
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
  const mode = sp.get("mode") === "pay" ? "pay" : "submit";
  const processStatus = sp.get("process_status") || "";
  const payStatus = sp.get("pay_status") || "";
  const jabatanId = sp.get("jabatan_id") || "";
  const dateFrom = sp.get("date_from") || "";
  const dateTo = sp.get("date_to") || "";

  if (processStatus && !STATUSES.includes(processStatus as PurchaseProcessStatus)) {
    return NextResponse.json({ error: "Filter status tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (payStatus && !PAY_STATUSES.includes(payStatus as PurchasePaymentStatus)) {
    return NextResponse.json({ error: "Filter status tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const admin = createAdminClient();

    if (mode === "pay") {
      // Periode pembayaran: agregat transaksi pembayaran aktual.
      let payQuery = admin.from("purchase_order_payments").select("id, order_id, payment_date, amount").limit(5000);
      if (dateFrom) payQuery = payQuery.gte("payment_date", dateFrom);
      if (dateTo) payQuery = payQuery.lte("payment_date", dateTo);
      const { data: pays, error: payError } = await payQuery;
      if (payError) throw payError;
      let rows = (pays || []) as { id: number; order_id: number; payment_date: string; amount: number }[];
      if (!actor.canManage) {
        const { data: mine } = await admin.from("purchase_orders").select("id").eq("submitted_by", actor.userId);
        const mineIds = new Set((mine || []).map((o) => (o as { id: number }).id));
        rows = rows.filter((p) => mineIds.has(p.order_id));
      }
      const paidTotal = rows.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      return NextResponse.json(
        { mode, count: rows.length, paidTotal },
        { headers: NO_STORE_HEADERS },
      );
    }

    // Periode pengajuan: agregat kohort PO.
    let query = admin
      .from("purchase_orders")
      .select("id, amount, total_paid, process_status, requester_jabatan_id, requester_jabatan_nama, requester_name, submitted_by")
      .limit(5000);
    if (!actor.canManage) query = query.eq("submitted_by", actor.userId);
    if (processStatus) query = query.eq("process_status", processStatus);
    if (jabatanId) {
      const jid = Number(jabatanId);
      if (!Number.isInteger(jid)) {
        return NextResponse.json({ error: "Filter jabatan tidak valid." }, { status: 400, headers: NO_STORE_HEADERS });
      }
      query = query.eq("requester_jabatan_id", jid);
    }
    if (dateFrom) query = query.gte("submitted_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("submitted_at", `${dateTo}T23:59:59.999`);
    const { data, error } = await query;
    if (error) throw error;

    let orders: PurchaseSummaryOrder[] = (data || []).map((o) => {
      const r = o as {
        id: number; amount: number; total_paid: number; process_status: PurchaseProcessStatus;
        requester_jabatan_id: number | null; requester_jabatan_nama: string | null; requester_name: string;
      };
      return {
        id: r.id,
        amount: Number(r.amount) || 0,
        total_paid: Number(r.total_paid) || 0,
        process_status: r.process_status,
        requester_jabatan_id: r.requester_jabatan_id,
        requester_jabatan_nama: r.requester_jabatan_nama,
        requester_name: r.requester_name,
      };
    });
    if (payStatus) {
      orders = orders.filter(
        (o) => purchasePaymentStatus(o.amount, o.total_paid) === (payStatus as PurchasePaymentStatus),
      );
    }

    const summary = summarizePurchaseOrders(orders);
    // Pengaju: rekap jabatan dibatasi pada jabatannya sendiri.
    const byJabatan = actor.canManage
      ? summary.byJabatan
      : summary.byJabatan.filter((j) => j.jabatan_id === actor.jabatanId);
    return NextResponse.json(
      {
        mode,
        ...summary,
        byJabatan,
        orders: orders.map((o) => ({
          ...o,
          payment_status: purchasePaymentStatus(o.amount, o.total_paid),
          remaining: purchaseRemaining(o.amount, o.total_paid),
        })),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("GET /api/purchase/summary error:", err);
    return NextResponse.json({ error: "Gagal memuat ringkasan." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
