"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Truck } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import RouteGuard from "@/components/RouteGuard";
import Button from "@/components/ui/Button";
import InvoiceDeliveryModal from "@/components/finance/InvoiceDeliveryModal";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";
import { DELIVERY_METHODS, DELIVERY_STATUSES, fetchDeliveries, latestDeliveries, type InvoiceDelivery } from "@/lib/finance-delivery";
import { invoiceStatus } from "@/lib/finance";

interface Invoice { id: number; invoice_no: string; total_amount: number; client: { company_name: string | null; contact_name: string } | null }
const input = "rounded-xl border border-border bg-card px-3 py-2 text-sm";
export default function InvoiceDeliveryPage() {
  return <RouteGuard permission="finance"><DeliveryRegister /></RouteGuard>;
}
function DeliveryRegister() {
  const { getPermissionLevel } = useAuth();
  const level = getPermissionLevel("finance");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [deliveries, setDeliveries] = useState<InvoiceDelivery[]>([]);
  const [paid, setPaid] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [attempt, setAttempt] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<{ invoice: Invoice; status?: InvoiceDelivery["status"] } | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const inv: Invoice[] = [];
      const payments = new Map<number, number>();
      const [rows] = await Promise.all([fetchDeliveries(), (async () => {
        for (let start = 0; ; start += 1000) {
          const { data, error } = await supabase.from("finance_invoices").select("id,invoice_no,total_amount,client:finance_clients(company_name,contact_name)").order("id", { ascending: false }).range(start, start + 999);
          if (error) throw error;
          inv.push(...data as unknown as Invoice[]);
          if (data.length < 1000) break;
        }
      })(), (async () => {
        for (let start = 0; ; start += 1000) {
          const { data, error } = await supabase.from("finance_invoice_payments").select("invoice_id,amount").order("id").range(start, start + 999);
          if (error) throw error;
          data.forEach(p => payments.set(p.invoice_id, (payments.get(p.invoice_id) ?? 0) + Number(p.amount)));
          if (data.length < 1000) break;
        }
      })()]);
      setInvoices(inv); setDeliveries(rows); setPaid(payments);
    } catch (e) { setError((e as { message?: string }).message ?? "Gagal memuat pengiriman."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);
  const latest = useMemo(() => latestDeliveries(deliveries), [deliveries]);
  const filtered = invoices.filter(i => {
    const d = latest.get(i.id);
    const text = [i.invoice_no, i.client?.company_name, i.client?.contact_name, d?.sender, d?.recipient].join(" ").toLowerCase();
    const date = d ? new Date(d.sent_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) : "";
    return text.includes(search.toLowerCase()) && (!status || (d?.status ?? "Belum Dicatat") === status)
      && (!method || d?.method === method) && (!attempt || d?.attempt === Number(attempt))
      && (!from || date >= from) && (!to || (!!date && date <= to));
  });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  return <>
    <PageHeader title="Pengiriman Invoice" description="Pencatatan pengiriman, penerima, dan bukti penerimaan tagihan" icon={Truck} />
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">{["Belum Dicatat", ...DELIVERY_STATUSES].map(s => <button key={s} onClick={() => { setStatus(s); setPage(0); }} className="rounded-2xl border border-border bg-card p-4 text-left"><p className="text-xs text-muted-foreground">{s}</p><p className="text-2xl font-bold">{invoices.filter(i => (latest.get(i.id)?.status ?? "Belum Dicatat") === s).length}</p></button>)}</div>
    {error && <p role="alert" className="mb-4 text-danger">{error}</p>}
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap gap-2 p-4 border-b border-border">
        <input className={input} aria-label="Cari pengiriman" placeholder="Invoice, klien, pengirim, penerima…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        <select className={input} aria-label="Filter status" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">Semua status</option>{["Belum Dicatat", ...DELIVERY_STATUSES].map(s => <option key={s}>{s}</option>)}</select>
        <select className={input} aria-label="Filter metode" value={method} onChange={e => setMethod(e.target.value)}><option value="">Semua metode</option>{DELIVERY_METHODS.map(s => <option key={s}>{s}</option>)}</select>
        <input className={input + " w-36"} type="number" min={1} aria-label="Pengiriman ke" placeholder="Pengiriman ke" value={attempt} onChange={e => setAttempt(e.target.value)} />
        <label className="text-xs">Dari (WIB)<input className={input + " block"} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs">Sampai (WIB)<input className={input + " block"} type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <Button variant="outline" disabled={loading} onClick={() => void load()}>Refresh</Button>
        <Button variant="outline" onClick={() => { setSearch(""); setStatus(""); setMethod(""); setFrom(""); setTo(""); setAttempt(""); setPage(0); }}>Reset</Button>
      </div>
      {loading ? <p className="p-8 text-center">Memuat pengiriman…</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/30"><tr>{["Invoice / Klien", "Status Bayar", "Status Pengiriman", "Ke", "Tanggal", "Metode / Pengirim", "Penerima", "Bukti", "Diinput Oleh", "Aksi"].map(h => <th key={h} className="p-3 text-left whitespace-nowrap">{h}</th>)}</tr></thead><tbody>
        {filtered.slice(currentPage * 25, currentPage * 25 + 25).map(i => {
          const d = latest.get(i.id);
          const writable = level === "edit" || (level === "input" && d?.status !== "Terkirim");
          return <tr key={i.id} className="border-t border-border"><td className="p-3"><p className="font-semibold">{i.invoice_no}</p><p className="text-xs text-muted-foreground">{i.client?.company_name || i.client?.contact_name || "—"}</p></td><td className="p-3">{invoiceStatus(i.total_amount, paid.get(i.id) ?? 0)}</td>
            <td className="p-3">{writable ? <select aria-label={`Status pengiriman ${i.invoice_no}`} className={input} value={d?.status ?? ""} onChange={e => setSelected({ invoice: i, status: e.target.value as InvoiceDelivery["status"] })}><option value="" disabled>Belum Dicatat</option>{DELIVERY_STATUSES.map(s => <option key={s}>{s}</option>)}</select> : d?.status ?? "Belum Dicatat"}</td>
            <td className="p-3">{d?.attempt ?? "—"}</td><td className="p-3 whitespace-nowrap">{d ? new Date(d.sent_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "—"}</td><td className="p-3">{d?.method ?? "—"}<p>{d?.sender}</p></td><td className="p-3">{d?.recipient || "—"}</td><td className="p-3">{d?.proof_path ? <button className="text-primary underline" onClick={() => setSelected({ invoice: i })}>Foto tersedia</button> : "—"}</td><td className="p-3">{d?.actor_name ?? "—"}</td><td className="p-3"><Button variant="outline" size="sm" onClick={() => setSelected({ invoice: i })}>{writable ? "Catat / Detail" : "Detail"}</Button></td>
          </tr>;
        })}
        {!filtered.length && <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Tidak ada invoice sesuai filter.</td></tr>}
      </tbody></table></div>}
      <div className="p-4 flex items-center justify-between text-sm"><span>{filtered.length} invoice • Halaman {currentPage + 1}</span><div className="flex gap-2"><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Sebelumnya</Button><Button variant="outline" disabled={(currentPage + 1) * 25 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Berikutnya</Button></div></div>
    </div>
    {selected && <InvoiceDeliveryModal invoiceId={selected.invoice.id} invoiceNo={selected.invoice.invoice_no} current={latest.get(selected.invoice.id)} initialStatus={selected.status} onClose={() => setSelected(null)} onSaved={() => void load()} />}
  </>;
}
