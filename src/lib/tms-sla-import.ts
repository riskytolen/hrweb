/**
 * Parser file Excel SLA menjadi payload import (pure, client-safe).
 *
 * Dua format didukung:
 * 1. Matrix ala Tuku: blok kolom `VAN 1..N` dengan kolom Start per toko,
 *    baris Total/MAPS/KM, dan baris jam berangkat gudang di bawah blok.
 * 2. Standar: satu baris per titik dengan header
 *    Profil | Nama Profil | Jam Berangkat | Urutan | Nama Toko |
 *    Jam SLA | Hari Ke | Address ID McEasy
 *
 * Parser bekerja pada grid string (hasil sheet_to_json header:1) agar
 * mudah diuji tanpa memuat library xlsx di modul ini.
 */

export interface ParsedSlaImportStop {
  order: number;
  storeName: string;
  targetTime: string;
  dayOffset: number;
  addressIds: string[];
}

export interface ParsedSlaImportProfile {
  code: string;
  depart: string | null;
  stops: ParsedSlaImportStop[];
}

export interface SlaImportParseResult {
  profiles: ParsedSlaImportProfile[];
  issues: string[];
}

export const SLA_STANDARD_HEADER = [
  "Profil",
  "Nama Profil",
  "Jam Berangkat",
  "Urutan",
  "Nama Toko",
  "Jam SLA",
  "Hari Ke",
  "Address ID McEasy",
] as const;

function cell(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

/** "4:58" -> "04:58", "4:58:00" -> "04:58:00"; null bila tak valid. */
export function normalizeSlaClock(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = match[3] ? Number(match[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const base = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return match[3] ? `${base}:${String(ss).padStart(2, "0")}` : base;
}

function normalizeVanCode(value: string): string | null {
  const match = /^VAN\s*(\d+)$/i.exec(value.trim());
  if (!match) return null;
  return `VAN ${Number(match[1])}`;
}

interface MatrixBlock {
  vans: { index: number; code: string }[];
  stops: { no: number; cells: string[]; times: string[] }[];
  departTimes: string[];
}

/** Deteksi format standar dari baris header. */
export function isSlaStandardGrid(grid: string[][]): boolean {
  for (const row of grid.slice(0, 5)) {
    const head = row.map(cell);
    if (head[0].toLowerCase() === "profil" && head[4].toLowerCase() === "nama toko") return true;
  }
  return false;
}

/** Parse format matrix (blok VAN). */
export function parseSlaMatrixGrid(grid: string[][]): SlaImportParseResult {
  const issues: string[] = [];
  const blocks: MatrixBlock[] = [];
  let current: MatrixBlock | null = null;

  for (const rawRow of grid) {
    const row = rawRow.map(cell);
    const vans: { index: number; code: string }[] = [];
    for (let c = 1; c < row.length; c += 2) {
      const code = normalizeVanCode(row[c]);
      if (code) vans.push({ index: c, code });
    }
    if (vans.length > 0) {
      current = { vans, stops: [], departTimes: new Array(vans.length).fill("") };
      blocks.push(current);
      continue;
    }
    const target = current ?? blocks[blocks.length - 1];
    if (!target) continue;
    const first = row[0] ?? "";
    const upper = first.toUpperCase();
    if (upper === "TOTAL" || upper === "MAPS" || upper === "KM") continue;
    if (first === "") {
      const times = target.vans.map((v) => row[v.index + 1] ?? "");
      if (times.some((t) => t !== "")) {
        target.departTimes = times.map((t) => {
          if (!t) return "";
          const normalized = normalizeSlaClock(t);
          if (!normalized) issues.push(`Jam berangkat "${t}" tidak valid; dikosongkan.`);
          return normalized ?? "";
        });
      }
      continue;
    }
    if (/^\d+$/.test(first)) {
      const cells = target.vans.map((v) => row[v.index] ?? "");
      const times = target.vans.map((v) => row[v.index + 1] ?? "");
      if (cells.some((c) => c !== "")) {
        target.stops.push({ no: Number(first), cells, times });
      }
    }
  }

  const profiles: ParsedSlaImportProfile[] = [];
  for (const block of blocks) {
    for (let vanIndex = 0; vanIndex < block.vans.length; vanIndex += 1) {
      const van = block.vans[vanIndex];
      const stops: ParsedSlaImportStop[] = [];
      for (const stopRow of block.stops) {
        const storeName = stopRow.cells[vanIndex] ?? "";
        if (!storeName) continue;
        const rawTime = stopRow.times[vanIndex] ?? "";
        const targetTime = normalizeSlaClock(rawTime);
        if (!targetTime) {
          issues.push(`${van.code} no ${stopRow.no}: jam "${rawTime || "(kosong)"}" tidak valid; baris dilewati.`);
          continue;
        }
        stops.push({ order: stopRow.no, storeName, targetTime, dayOffset: 0, addressIds: [] });
      }
      if (stops.length === 0) {
        issues.push(`${van.code} tidak memiliki titik valid; profil dilewati.`);
        continue;
      }
      // Urutan rapat 1..N mengikuti kemunculan baris.
      stops.forEach((stop, index) => {
        stop.order = index + 1;
      });
      const departRaw = block.departTimes[vanIndex] ?? "";
      profiles.push({ code: van.code, depart: departRaw || null, stops });
    }
  }
  return { profiles, issues };
}

/** Parse format standar (satu baris per titik). */
export function parseSlaStandardGrid(grid: string[][]): SlaImportParseResult {
  const issues: string[] = [];
  const headerIndex = grid.findIndex((row) => {
    const head = row.map(cell).map((c) => c.toLowerCase());
    return head[0] === "profil" && head[4] === "nama toko";
  });
  if (headerIndex < 0) return { profiles: [], issues: ["Header template standar tidak ditemukan."] };

  const byCode = new Map<string, ParsedSlaImportProfile & { name: string }>();
  grid.slice(headerIndex + 1).forEach((rawRow, rowIndex) => {
    const row = rawRow.map(cell);
    if (row.every((c) => c === "")) return;
    const lineNo = headerIndex + 2 + rowIndex;
    const code = row[0].toUpperCase().replace(/\s+/g, " ");
    const storeName = row[4];
    const targetTime = normalizeSlaClock(row[5]);
    if (!code) {
      issues.push(`Baris ${lineNo}: kolom Profil kosong; baris dilewati.`);
      return;
    }
    if (!storeName) {
      issues.push(`Baris ${lineNo}: nama toko kosong; baris dilewati.`);
      return;
    }
    if (!targetTime) {
      issues.push(`Baris ${lineNo}: jam SLA "${row[5] || "(kosong)"}" tidak valid; baris dilewati.`);
      return;
    }
    let profile = byCode.get(code);
    if (!profile) {
      const depart = row[2] ? normalizeSlaClock(row[2]) : null;
      if (row[2] && !depart) issues.push(`Profil ${code}: jam berangkat "${row[2]}" tidak valid; dikosongkan.`);
      profile = { code, name: row[1], depart, stops: [] };
      byCode.set(code, profile);
    }
    const orderRaw = Number(row[3]);
    const dayRaw = Number(row[7 - 1]);
    const addressRaw = row[7];
    profile.stops.push({
      order: Number.isInteger(orderRaw) && orderRaw >= 1 ? orderRaw : profile.stops.length + 1,
      storeName,
      targetTime,
      dayOffset: Number.isInteger(dayRaw) && dayRaw >= 0 ? dayRaw : 0,
      addressIds: addressRaw ? [addressRaw] : [],
    });
  });

  // Rapatkan urutan per profil mengikuti kemunculan baris; baris toko
  // yang sama digabung (mendukung beberapa address ID untuk satu toko).
  const profiles: ParsedSlaImportProfile[] = [...byCode.values()].map((profile) => {
    const merged: ParsedSlaImportStop[] = [];
    const indexByName = new Map<string, number>();
    for (const stop of profile.stops) {
      const key = stop.storeName.toLowerCase().replace(/\s+/g, " ").trim();
      const existing = indexByName.get(key);
      if (existing === undefined) {
        indexByName.set(key, merged.length);
        merged.push({ ...stop, addressIds: [...stop.addressIds] });
      } else {
        for (const addressId of stop.addressIds) {
          if (!merged[existing].addressIds.includes(addressId)) {
            merged[existing].addressIds.push(addressId);
          }
        }
      }
    }
    const stops = merged.map((stop, index) => ({ ...stop, order: index + 1 }));
    return { code: profile.code, depart: profile.depart, stops };
  });
  return { profiles, issues };
}

/** Template standar siap unduh (header + contoh). */
export function buildSlaStandardTemplate(): string[][] {
  return [
    [...SLA_STANDARD_HEADER],
    ["VAN 1", "VAN 1 CP", "04:15", "1", "Toko Kopi Tuku Contoh 1", "04:58", "0", "272"],
    ["VAN 1", "VAN 1 CP", "04:15", "2", "Toko Kopi Tuku Contoh 2", "05:56", "0", ""],
  ];
}
