"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Portal from "@/components/ui/Portal";
import Button from "@/components/ui/Button";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";
import { DELIVERY_BUCKET, DELIVERY_METHODS, DELIVERY_STATUSES, deliveryPhotoError, deliveryPhotoUrl, type InvoiceDelivery, type DeliveryEvent } from "@/lib/finance-delivery";

const input = "w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm";
function localTime(value?: string) {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
export default function InvoiceDeliveryModal({ invoiceId, invoiceNo, current, initialStatus, onClose, onSaved }: {
  invoiceId: number; invoiceNo: string; current?: InvoiceDelivery;
  initialStatus?: InvoiceDelivery["status"]; onClose: () => void; onSaved: () => void;
}) {
  const { getPermissionLevel, user } = useAuth();
  const level = getPermissionLevel("finance");
  const writable = level === "edit" || (level === "input" && current?.status !== "Terkirim");
  const [next, setNext] = useState(false);
  const [status, setStatus] = useState(initialStatus ?? current?.status ?? "Pending");
  const [sentAt, setSentAt] = useState(localTime(current?.sent_at));
  const [method, setMethod] = useState(current?.method ?? "Tim JAMS");
  const [sender, setSender] = useState(current?.sender ?? "");
  const [recipient, setRecipient] = useState(current?.recipient ?? "");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [photo, setPhoto] = useState(current?.proof_path ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<DeliveryEvent[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: deliveries, error: de } = await supabase.from("finance_invoice_deliveries").select("id").eq("invoice_id", invoiceId);
      if (de) { if (active) setHistoryError(de.message); return; }
      if (!deliveries?.length) return;
      const result: DeliveryEvent[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error: he } = await supabase.from("finance_invoice_delivery_events").select("*").in("delivery_id", deliveries.map(d => d.id)).order("id", { ascending: false }).range(start, start + 999);
        if (he) { if (active) setHistoryError(he.message); return; }
        result.push(...data as DeliveryEvent[]);
        if (data.length < 1000) break;
      }
      if (active) setEvents(result);
    })();
    return () => { active = false; };
  }, [invoiceId]);
  async function save() {
    if (saving.current || !writable || !user) return;
    if (!sentAt || !sender.trim()) { setError("Tanggal dan pengirim wajib diisi."); return; }
    if (status === "Terkirim" && (!recipient.trim() || (!photo && !file))) { setError("Nama penerima dan foto bukti wajib diisi."); return; }
    if ((status === "Ditolak" || status === "Revisi") && !notes.trim()) { setError("Alasan wajib diisi."); return; }
    if (file && deliveryPhotoError(file)) { setError(deliveryPhotoError(file)!); return; }
    saving.current = true; setBusy(true); setError("");
    try {
      let path = photo;
      if (file) {
        const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
        path = `${user.id}/${invoiceId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(DELIVERY_BUCKET).upload(path, file, { upsert: false });
        if (uploadError) throw uploadError;
        setPhoto(path); setFile(null);
      }
      requestId.current ??= crypto.randomUUID();
      const { error: saveError } = await supabase.rpc("save_finance_invoice_delivery", {
        p_invoice_id: invoiceId, p_expected_version: current?.version ?? 0,
        p_expected_attempt: current?.attempt ?? 0,
        p_new_attempt: next, p_request_id: requestId.current,
        p_data: { status, sent_at: new Date(sentAt).toISOString(), method, sender, recipient, notes, proof_path: path },
      });
      if (saveError) throw saveError;
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : (e as { message?: string }).message ?? "Gagal menyimpan pengiriman."); }
    finally { saving.current = false; setBusy(false); }
  }
  function nextAttempt() {
    setNext(true); setStatus("Pending"); setSentAt(localTime()); setRecipient(""); setPhoto(null); setFile(null); setNotes("");
  }
  async function showPhoto(path: string) { try { setPreview(await deliveryPhotoUrl(path)); } catch { setError("Gagal membuka foto bukti."); } }
  return <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <section role="dialog" aria-modal="true" aria-label="Pengiriman Invoice" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 space-y-4">
      <div className="flex justify-between gap-3"><div><h2 className="font-bold text-lg">Pengiriman {invoiceNo}</h2><p className="text-sm text-muted-foreground">Pengiriman ke-{(current?.attempt ?? 1) + (next ? 1 : 0)}</p></div><Button variant="outline" onClick={onClose} disabled={busy}>Tutup</Button></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {writable && !next && (current?.status === "Ditolak" || current?.status === "Revisi") && <Button variant="outline" disabled={busy} onClick={nextAttempt}>Buat Pengiriman Berikutnya</Button>}
      <fieldset disabled={!writable || busy} className="grid sm:grid-cols-2 gap-4 disabled:opacity-70">
        <label className="text-sm">Status<select className={input} value={status} onChange={e => setStatus(e.target.value as InvoiceDelivery["status"])}>{DELIVERY_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="text-sm">Tanggal & waktu pengiriman *<input className={input} type="datetime-local" value={sentAt} onChange={e => setSentAt(e.target.value)} /></label>
        <label className="text-sm">Metode<select className={input} value={method} onChange={e => setMethod(e.target.value)}>{DELIVERY_METHODS.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="text-sm">Nama pengirim / kurir *<input className={input} maxLength={200} value={sender} onChange={e => setSender(e.target.value)} /></label>
        <label className="text-sm">Nama penerima {status === "Terkirim" && "*"}<input className={input} maxLength={200} value={recipient} onChange={e => setRecipient(e.target.value)} /></label>
        <label className="text-sm">Foto bukti {status === "Terkirim" && "*"}<input className={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) { const err = deliveryPhotoError(f); setError(err ?? ""); if (!err) setFile(f); } }} /><span className="text-xs text-muted-foreground">JPG/PNG/WebP, maksimal 5 MB</span></label>
        <label className="text-sm sm:col-span-2">Catatan / alasan {(status === "Ditolak" || status === "Revisi") && "*"}<textarea className={input} rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      </fieldset>
      {photo && <button className="text-primary text-sm underline" onClick={() => void showPhoto(photo)}>Lihat foto tersimpan</button>}
      {preview && <div className="rounded-xl border border-border p-3"><button className="text-xs text-primary mb-2" onClick={() => setPreview(null)}>Tutup foto</button><Image src={preview} alt="Bukti penerimaan invoice" width={1200} height={900} unoptimized className="w-full max-h-[60vh] object-contain" /></div>}
      {writable && <div className="flex justify-end"><Button disabled={busy} onClick={() => void save()}>{busy ? "Menyimpan…" : "Simpan Pengiriman"}</Button></div>}
      <h3 className="font-semibold border-t border-border pt-4">Riwayat Pengiriman</h3>
      {historyError && <p role="alert" className="text-danger text-sm">Gagal memuat riwayat: {historyError}</p>}
      {events.map(e => <article key={e.id} className="rounded-xl border border-border p-3 text-sm space-y-1">
        <p className="font-semibold">Ke-{e.snapshot.attempt} • {e.snapshot.status}</p>
        <p>{e.snapshot.method} • {e.snapshot.sender} → {e.snapshot.recipient || "—"}</p>
        <p>Pengiriman: {new Date(e.snapshot.sent_at).toLocaleString("id-ID")}</p>
        <p className="whitespace-pre-wrap">{e.snapshot.notes}</p>
        <p className="text-xs text-muted-foreground">Dicatat {e.actor_name} • {new Date(e.created_at).toLocaleString("id-ID")}</p>
        {e.snapshot.proof_path && <button className="text-primary underline" onClick={() => void showPhoto(e.snapshot.proof_path!)}>Foto bukti</button>}
      </article>)}
    </section>
  </div></Portal>;
}
