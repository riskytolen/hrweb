export type Stop = { date: string; unit: string; address: string; order: number; arrived: number | null; departed: number | null; detention: number | null };
export type ImportData = { id: string; created_at: string; file_name: string; rows: Stop[]; issues: string[] };
export const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20000;
export function routeAccess(permissions: string[], accountType: string, action: "view" | "input" | "edit") {
  if (accountType !== "internal") return false;
  return permissions.includes("all") || permissions.includes("route-in-out") ||
    (action !== "edit" && permissions.includes("route-in-out.input")) ||
    (action === "view" && permissions.includes("route-in-out.view"));
}
const text = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
export function parseClock(v: unknown, duration = false): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && (duration || v < 1) ? Math.round(v * 86400) : null;
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(text(v));
  if (!m || +m[2] > 59 || +(m[3] || 0) > 59 || (!duration && +m[1] > 23)) return null;
  return +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0);
}
export function parseDate(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 60 && v < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  const s = text(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const [y, m, d] = iso ? [+iso[1], +iso[2], +iso[3]] : dmy ? [+dmy[3], +dmy[2], +dmy[1]] : [0, 0, 0];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
export function parseGrid(grid: unknown[][]): { rows: Stop[]; issues: string[] } {
  const headers = ["date", "address", "arrived", "departed", "detention", "rute"];
  const start = grid.findIndex(r => headers.every(h => r.map(v => text(v).toLowerCase()).includes(h)));
  if (start < 0) throw new Error("Kolom wajib: Date, Address, Arrived, Departed, Detention, RUTE.");
  if (grid.length - start - 1 > MAX_IMPORT_ROWS) throw new Error(`Maksimal ${MAX_IMPORT_ROWS} baris per file.`);
  const index = headers.map(h => grid[start].findIndex(v => text(v).toLowerCase() === h));
  const rows: Stop[] = [], issues: string[] = [];
  const orders = new Map<string, number>();
  const previous = new Map<string, number>();
  for (let i = start + 1; i < grid.length; i++) {
    const r = grid[i];
    if (r.every(v => !text(v))) continue;
    const [dateRaw, addressRaw, inRaw, outRaw, detRaw, unitRaw] = index.map(j => r[j]);
    const date = parseDate(dateRaw), address = text(addressRaw), unit = text(unitRaw).toUpperCase();
    if (!date || !address || !unit) throw new Error(`Baris ${i + 1}: tanggal, alamat, atau unit tidak valid.`);
    const key = `${date}|${unit}`;
    let arrived = parseClock(inRaw), departed = parseClock(outRaw);
    const detention = parseClock(detRaw, true);
    if (arrived === null || departed === null || detention === null) issues.push(`Baris ${i + 1}: jam/detention kosong atau tidak valid; tidak dihitung pada rata-rata terkait.`);
    // Jam sesudah tengah malam tetap relatif terhadap hari keberangkatan trip.
    const prev = previous.get(key);
    if (arrived !== null && prev !== undefined) {
      while (arrived < prev - 43200) arrived += 86400;
      if (arrived < prev) issues.push(`Baris ${i + 1}: waktu kedatangan tumpang tindih dengan titik sebelumnya.`);
    }
    if (departed !== null) {
      const anchor = arrived ?? prev ?? 0;
      while (departed < anchor) departed += 86400;
    }
    if (departed !== null || arrived !== null) previous.set(key, departed ?? arrived!);
    if (arrived !== null && departed !== null && detention !== null && Math.abs(departed - arrived - detention) > 60) issues.push(`Baris ${i + 1}: Detention berbeda dari OUT − IN.`);
    const order = (orders.get(key) || 0) + 1;
    orders.set(key, order);
    rows.push({ date, unit, address, order, arrived, departed, detention });
  }
  if (!rows.length) throw new Error("File tidak memiliki data.");
  return { rows, issues };
}
export function selectRows(imports: ImportData[], from = "", to = "", unit = "", importId = ""): Stop[] {
  const trips = new Map<string, Stop[]>();
  for (const item of [...imports].sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))) {
    if (importId && item.id !== importId) continue;
    const grouped = new Map<string, Stop[]>();
    for (const row of item.rows) {
      if ((from && row.date < from) || (to && row.date > to) || (unit && row.unit !== unit)) continue;
      const key = `${row.date}|${row.unit}`;
      grouped.set(key, [...(grouped.get(key) || []), row]);
    }
    for (const [key, rows] of grouped) if (!trips.has(key)) trips.set(key, rows);
  }
  return [...trips.values()].flat();
}
const average = (values: (number | null)[]) => {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length ? valid.reduce((a,b) => a+b,0) / valid.length : null;
};
// Circular mean avoids averaging 23:55 and 00:05 into noon.
function clockAverage(values: (number | null)[]) {
  const valid = values.filter((v): v is number => v !== null);
  if (!valid.length) return null;
  const x = valid.reduce((s,v) => s + Math.cos(v / 86400 * 2 * Math.PI),0);
  const y = valid.reduce((s,v) => s + Math.sin(v / 86400 * 2 * Math.PI),0);
  if (Math.hypot(x,y) < 1e-8) return null;
  return ((Math.atan2(y,x) / (2 * Math.PI) * 86400) + 86400) % 86400;
}
export function summarize(rows: Stop[]) {
  const stores = new Map<string, Stop[]>(), trips = new Map<string, Stop[]>();
  for (const r of rows) {
    const sk = `${r.unit}|${r.address.toLowerCase()}`;
    stores.set(sk, [...(stores.get(sk) || []),r]);
    const tk = `${r.unit}|${r.date}`;
    trips.set(tk, [...(trips.get(tk) || []),r]);
  }
  const detail = [...stores.values()].map(rs => ({ unit: rs[0].unit, address: rs[0].address, order: Math.min(...rs.map(r=>r.order)), samples: rs.length, inSamples: rs.filter(r=>r.arrived!==null).length, outSamples: rs.filter(r=>r.departed!==null).length, detentionSamples: rs.filter(r=>r.detention!==null).length, arrived: clockAverage(rs.map(r=>r.arrived)), departed: clockAverage(rs.map(r=>r.departed)), detention: average(rs.map(r=>r.detention)) })).sort((a,b)=>a.unit.localeCompare(b.unit,undefined,{numeric:true}) || a.order-b.order);
  const daily = [...trips.values()].map(rs => {
    const sorted = [...rs].sort((a,b)=>a.order-b.order), first = sorted[0], last = sorted[sorted.length-1];
    const duration = sorted.length > 1 && first.departed !== null && last.arrived !== null && last.arrived >= first.departed ? last.arrived-first.departed : null;
    return { unit:first.unit, date:first.date, start:first.departed, end:last.arrived, duration, detention: rs.every(r=>r.detention!==null) ? rs.reduce((s,r)=>s+r.detention!,0) : null };
  });
  const units = [...new Set(rows.map(r=>r.unit))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(unit=>{
    const ds = daily.filter(d=>d.unit===unit);
    return { unit, trips:ds.length, validTrips:ds.filter(d=>d.duration!==null).length, start:clockAverage(ds.map(d=>d.start)), end:clockAverage(ds.map(d=>d.end)), detention:average(ds.map(d=>d.detention)), duration:average(ds.map(d=>d.duration)) };
  });
  return { detail, units, daily };
}
export function formatSeconds(value: number | null, clock = false) {
  if (value === null) return "—";
  const s = clock ? Math.round(value) % 86400 : Math.round(value);
  return `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor(s%3600/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
}
