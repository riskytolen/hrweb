"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Download, Upload, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import RouteGuard from "@/components/RouteGuard";
import { useAuth } from "@/components/AuthProvider";
import { formatSeconds as fmt, routeAccess, selectRows, summarize, MAX_IMPORT_BYTES, type ImportData, type Stop } from "@/lib/route-in-out";

const field = "rounded-lg border border-border bg-card px-3 py-2 text-sm";
const button = `${field} hover:bg-muted disabled:opacity-50 inline-flex items-center gap-2`;
type Preview = {rows:Stop[];issues:string[];sheets:string[];sheet:string};
async function api(url:string, init?:RequestInit) {
  const response = await fetch(url,init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Permintaan gagal.");
  return data;
}
function Table({headers,rows}:{headers:string[];rows:(string|number)[][]}) {
  const [page,setPage] = useState(1);
  const pages = Math.max(1,Math.ceil(rows.length/100));
  const current = Math.min(page,pages);
  return <div className="rounded-xl border border-border bg-card overflow-hidden">
    <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-muted"><tr>{headers.map(h=><th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{rows.slice((current-1)*100,current*100).map((row,i)=><tr key={i} className="border-t border-border hover:bg-muted/40">{row.map((v,j)=><td key={j} className="px-4 py-2 whitespace-nowrap tabular-nums">{v}</td>)}</tr>)}</tbody></table>
      {!rows.length && <p className="p-8 text-center text-muted-foreground">Belum ada data untuk filter ini.</p>}</div>
    {pages>1 && <div className="p-3 flex items-center gap-3"><button className={button} disabled={current===1} onClick={()=>setPage(current-1)}>Sebelumnya</button><span>{current} / {pages} · {rows.length} baris</span><button className={button} disabled={current===pages} onClick={()=>setPage(current+1)}>Berikutnya</button></div>}
  </div>;
}
export default function Page() { return <RouteGuard permission="route-in-out"><Content /></RouteGuard>; }
function Content() {
  const {profile} = useAuth();
  const permissions = profile?.roles?.permissions || [];
  const canInput = routeAccess(permissions,profile?.account_type || "internal","input");
  const canEdit = routeAccess(permissions,profile?.account_type || "internal","edit");
  const [imports,setImports] = useState<ImportData[]>([]);
  const [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [file,setFile] = useState<File|null>(null), [preview,setPreview] = useState<Preview|null>(null);
  const [from,setFrom] = useState(""), [to,setTo] = useState(""), [unit,setUnit] = useState(""), [importId,setImportId] = useState("");
  const [tab,setTab] = useState("detail");
  const load = useCallback(async()=>{
    try {setImports((await api("/api/route-in-out")).data);} catch(e){setError(e instanceof Error?e.message:"Gagal memuat data.");} finally {setLoading(false);}
  },[]);
  useEffect(()=>{
    let active = true;
    api("/api/route-in-out").then(data=>{if(active)setImports(data.data);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"Gagal memuat data.");})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);
  const units = useMemo(()=>[...new Set(imports.flatMap(i=>i.rows.map(r=>r.unit)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),[imports]);
  const selected = useMemo(()=>selectRows(imports,from,to,unit,importId),[imports,from,to,unit,importId]);
  const result = useMemo(()=>summarize(selected),[selected]);
  const headers = tab==="detail" ? ["Unit","Urutan pertama","Toko / Titik","Kunjungan","Rata-rata IN","Sampel IN","Rata-rata OUT","Sampel OUT","Rata-rata Detention","Sampel Detention"] : ["Unit","Trip","Trip waktu valid","Rata-rata Mulai","Rata-rata Selesai","Rata-rata Total Detention / Trip","Rata-rata Waktu Tempuh"];
  const rows = tab==="detail" ? result.detail.map(r=>[r.unit,r.order,r.address,r.samples,fmt(r.arrived,true),r.inSamples,fmt(r.departed,true),r.outSamples,fmt(r.detention),r.detentionSamples]) : result.units.map(r=>[r.unit,r.trips,r.validTrips,fmt(r.start,true),fmt(r.end,true),fmt(r.detention),fmt(r.duration)]);
  async function process(nextFile:File, sheet="", save=false) {
    setBusy(true);setError("");
    try {
      if (nextFile.size>MAX_IMPORT_BYTES) throw new Error("Maksimal file 3 MB.");
      const form = new FormData();form.set("file",nextFile);form.set("preview",String(!save));if(sheet)form.set("sheet",sheet);
      const data = await api("/api/route-in-out",{method:"POST",body:form});
      if (save) {setPreview(null);setFile(null);await load();setTab("detail");} else setPreview(data);
    } catch(e){setError(e instanceof Error?e.message:"Gagal memproses file.");} finally {setBusy(false);}
  }
  async function exportFile(kind:"xlsx"|"csv") {
    setBusy(true);setError("");
    try {
      const XLSX = await import("xlsx");
      const safeRows = rows.map(row=>row.map(value=>typeof value==="string" && /^[=+@\-\t\r]/.test(value) ? `'${value}` : value));
      const sheet = XLSX.utils.aoa_to_sheet([headers,...safeRows]);
      const book = XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,tab==="detail"?"Per Toko":"Per Unit");
      XLSX.writeFile(book,`rekap-in-out-${tab}-${from||"semua"}-${to||"semua"}.${kind}`,{bookType:kind});
    } catch {setError("Gagal mengekspor rekap.");} finally {setBusy(false);}
  }
  async function historyAction(item:ImportData, remove=false) {
    if(remove && !window.confirm(`Hapus ${item.file_name} dari rekap? Versi sebelumnya untuk trip yang sama akan digunakan kembali.`))return;
    setBusy(true);setError("");
    try {
      const data = await api(`/api/route-in-out/${item.id}`,remove?{method:"DELETE"}:undefined);
      if(remove){if(importId===item.id)setImportId("");await load();}else window.location.assign(data.url);
    } catch(e){setError(e instanceof Error?e.message:"Permintaan gagal.");} finally {setBusy(false);}
  }
  return <div className="space-y-5">
    <PageHeader title="Rekap In-Out Unit" description="Rata-rata kedatangan, keberangkatan, detention, dan waktu perjalanan dari Excel/CSV" icon={Clock}/>
    {error && <div role="alert" className="rounded-xl bg-danger/10 text-danger p-4">{error}</div>}
    {canInput && <section className="rounded-xl border border-border bg-card p-5 space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><Upload size={18}/> Import Excel / CSV</h2>
      <p className="text-sm text-muted-foreground">Kolom: Date, Address, Arrived, Departed, Detention, RUTE. Tanggal DD/MM/YYYY · maksimal 3 MB / 20.000 baris. Satu unit per tanggal = satu trip.</p>
      <input aria-label="File Excel atau CSV" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";setPreview(null);setFile(f||null);if(f)void process(f);}} className={field}/>
      {busy && <p role="status" className="text-sm">Memproses…</p>}
      {preview && file && <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3"><strong>{file.name}</strong><select aria-label="Sheet" className={field} value={preview.sheet} disabled={busy} onChange={e=>{void process(file,e.target.value);}}>{preview.sheets.map(s=><option key={s}>{s}</option>)}</select><span>{preview.rows.length} baris · {new Set(preview.rows.map(r=>r.unit)).size} unit</span></div>
        {!!preview.issues.length && <details className="text-sm text-warning"><summary>{preview.issues.length} catatan validasi</summary><ul className="max-h-48 overflow-y-auto list-disc pl-5">{preview.issues.map((v,i)=><li key={i}>{v}</li>)}</ul></details>}
        <Table headers={["Tanggal","Unit","Toko","IN","OUT","Detention"]} rows={preview.rows.slice(0,20).map(r=>[r.date,r.unit,r.address,fmt(r.arrived,true),fmt(r.departed,true),fmt(r.detention)])}/>
        <p className="text-xs text-muted-foreground">Preview 20 baris pertama. Trip tanggal/unit yang sama akan memakai versi unggahan terbaru. Titik pertama dan terakhir mengikuti urutan file.</p>
        <button className={`${button} bg-primary text-white`} disabled={busy} onClick={()=>void process(file,preview.sheet,true)}>Simpan File & Hasil</button>
      </div>}
    </section>}
    <div className="flex flex-wrap gap-3 items-end">
      <label className="text-xs space-y-1">Dari<input aria-label="Tanggal awal" className={`${field} block`} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="text-xs space-y-1">Sampai<input aria-label="Tanggal akhir" className={`${field} block`} type="date" min={from} value={to} onChange={e=>setTo(e.target.value)}/></label>
      <select aria-label="Filter unit" className={field} value={unit} onChange={e=>setUnit(e.target.value)}><option value="">Semua unit</option>{units.map(u=><option key={u}>{u}</option>)}</select>
      <select aria-label="Filter riwayat" className={`${field} max-w-xs`} value={importId} onChange={e=>setImportId(e.target.value)}><option value="">Seluruh riwayat (versi terbaru)</option>{imports.map(i=><option key={i.id} value={i.id}>{i.file_name} · {new Date(i.created_at).toLocaleString("id-ID")}</option>)}</select>
    </div>
    {from && to && from>to && <p role="alert" className="text-danger">Tanggal akhir harus pada atau setelah tanggal awal.</p>}
    <div className="grid grid-cols-3 gap-3">{[["Unit",result.units.length],["Trip",result.daily.length],["Kunjungan",selected.length]].map(([name,value])=><div key={name} className="rounded-xl border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{name}</p><strong className="text-2xl">{value}</strong></div>)}</div>
    <div className="flex flex-wrap gap-2 items-center">{[["detail","Detail per Toko"],["unit","Ringkasan Unit"],["history","Riwayat Import"]].map(([key,label])=><button className={`${button} ${tab===key?"bg-primary/10 text-primary":""}`} key={key} onClick={()=>setTab(key)}>{label}</button>)}
      {tab!=="history" && <><button className={button} disabled={busy||!rows.length} onClick={()=>void exportFile("xlsx")}><Download size={16}/> Excel</button><button className={button} disabled={busy||!rows.length} onClick={()=>void exportFile("csv")}>CSV</button></>}
    </div>
    {loading ? <p role="status">Memuat riwayat…</p> : tab==="history" ? <div className="space-y-3">{!imports.length && <p>Belum ada riwayat import.</p>}{imports.map(item=><div key={item.id} className="border border-border bg-card rounded-xl p-4 space-y-2"><div className="flex flex-wrap justify-between gap-3"><div><strong>{item.file_name}</strong><p className="text-sm text-muted-foreground">{new Date(item.created_at).toLocaleString("id-ID")} · {item.rows.length} baris</p></div><div className="flex gap-2"><button className={button} onClick={()=>{setImportId(item.id);setTab("detail");}}>Buka Hasil</button><button className={button} disabled={busy} onClick={()=>void historyAction(item)}><Download size={16}/> File Asli</button>{canEdit && <button aria-label={`Hapus ${item.file_name}`} className={button} disabled={busy} onClick={()=>void historyAction(item,true)}><Trash2 size={16}/></button>}</div></div>{!!item.issues.length && <details><summary>{item.issues.length} catatan</summary><ul className="max-h-40 overflow-y-auto text-sm">{item.issues.map((v,i)=><li key={i}>{v}</li>)}</ul></details>}</div>)}</div> : <><Table key={tab+from+to+unit+importId} headers={headers} rows={rows}/><p className="text-xs text-muted-foreground">Waktu tempuh = OUT titik pertama → IN titik terakhir, termasuk detention di titik antara. Detention memakai nilai file. Rata-rata total detention per trip hanya memakai trip dengan detention lengkap. Jam ditampilkan HH:mm:ss; data kosong tidak dianggap nol. Jam lintas tengah malam dihitung melingkar. Urutan pada detail adalah urutan pertama yang ditemukan untuk toko tersebut.</p></>}
  </div>;
}
