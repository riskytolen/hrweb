/**
 * SLA kedatangan toko: pencocokan profil rute + evaluasi status (pure, client-safe).
 *
 * Sumber kebenaran SLA adalah jadwal internal client per kelompok kendaraan
 * (mis. Tuku CP: profil VAN 1-12), BUKAN status bawaan McEasy.
 *
 * Aturan bisnis:
 * - Tanpa toleransi: actual > target sedetik pun = terlambat.
 * - Tanpa actual = belum tiba/berangkat (PENDING), bukan terlambat.
 * - Tanpa konfigurasi target = SLA belum diatur (UNSET).
 * - Baris pertama rute (route_sequence = 1) memakai SLA keberangkatan.
 */

export type SlaKind = "DEPARTURE" | "ARRIVAL";
export type SlaStatus = "ON_TIME" | "LATE" | "PENDING" | "UNSET";

/** Skor minimum kecocokan toko agar FO terikat ke profil (0-1). */
export const SLA_MIN_MATCH_SCORE = 0.5;

export interface SlaProfileCandidate {
  id: string;
  code: string;
  addressIds: string[];
}

export interface SlaProfileMatch {
  profileId: string;
  matched: number;
  total: number;
  score: number;
}

/** Normalisasi nama toko untuk kunci perbandingan (huruf kecil, spasi tunggal). */
export function normalizeSlaStoreKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/^toko kopi tuku\s+/, "")
    .replace(/\s+/g, " ");
}

/**
 * Pilih profil rute terbaik berdasarkan irisan address_id toko FO
 * dengan himpunan address tiap profil (store_set_overlap).
 * Tie-break deterministik berdasarkan kode profil.
 */
export function matchSlaRouteProfile(
  taskAddressIds: Array<string | null | undefined>,
  profiles: SlaProfileCandidate[],
): SlaProfileMatch | null {
  const taskSet = new Set(
    taskAddressIds.filter((id): id is string => typeof id === "string" && id.trim() !== ""),
  );
  if (taskSet.size === 0 || profiles.length === 0) return null;

  let best: SlaProfileMatch | null = null;
  let bestCode = "";
  for (const profile of profiles) {
    const profileSet = new Set(profile.addressIds);
    let matched = 0;
    for (const addressId of taskSet) {
      if (profileSet.has(addressId)) matched += 1;
    }
    if (matched < 1) continue;
    const score = matched / taskSet.size;
    if (score < SLA_MIN_MATCH_SCORE) continue;
    if (
      best === null ||
      matched > best.matched ||
      (matched === best.matched && profile.code < bestCode)
    ) {
      best = { profileId: profile.id, matched, total: taskSet.size, score };
      bestCode = profile.code;
    }
  }
  return best;
}

/** Tanggal layanan (zona Asia/Jakarta) dari timestamp occurrence/window. */
export function slaServiceDate(isoTimestamp: string): string | null {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed));
}

/**
 * Bangun timestamp target dari tanggal layanan + jam SLA + offset hari.
 * WIB tidak mengenal DST sehingga offset +07:00 selalu tepat.
 */
export function computeSlaTargetAt(
  serviceDate: string,
  targetTime: string,
  dayOffset: number,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return null;
  const normalized = targetTime.trim().slice(0, 8);
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (!match) return null;
  const hh = match[1].padStart(2, "0");
  const mm = match[2];
  const ss = match[3] ?? "00";
  const offset = Number.isInteger(dayOffset) && dayOffset > 0 ? dayOffset : 0;
  const base = Date.parse(`${serviceDate}T00:00:00+07:00`);
  if (Number.isNaN(base)) return null;
  const targetMs =
    base + offset * 24 * 60 * 60 * 1000 + (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * 1000;
  return new Date(targetMs).toISOString();
}

/** Nilai status SLA dari pasangan target vs aktual (tanpa toleransi). */
export function evaluateSlaStatus(
  targetAt: string | null,
  actualAt: string | null,
): SlaStatus {
  if (!targetAt || Number.isNaN(Date.parse(targetAt))) return "UNSET";
  if (!actualAt || Number.isNaN(Date.parse(actualAt))) return "PENDING";
  return Date.parse(actualAt) <= Date.parse(targetAt) ? "ON_TIME" : "LATE";
}

/** Selisih detik aktual - target; null bila salah satunya kosong. */
export function computeSlaDeltaSeconds(
  targetAt: string | null,
  actualAt: string | null,
): number | null {
  if (!targetAt || !actualAt) return null;
  const target = Date.parse(targetAt);
  const actual = Date.parse(actualAt);
  if (Number.isNaN(target) || Number.isNaN(actual)) return null;
  return Math.round((actual - target) / 1000);
}

/** Label Indonesia untuk status SLA. */
export function slaStatusLabel(status: SlaStatus | null | undefined, kind?: SlaKind | null): string {
  switch (status) {
    case "ON_TIME":
      return "Tepat Waktu";
    case "LATE":
      return "Terlambat";
    case "PENDING":
      return kind === "DEPARTURE" ? "Belum Berangkat" : "Belum Tiba";
    case "UNSET":
      return "SLA Belum Diatur";
    default:
      return "–";
  }
}

/**
 * Perbandingan natural untuk kode profil ("VAN 2" < "VAN 10").
 * String dipecah menjadi segmen angka/huruf; segmen angka dibandingkan
 * numerik, sisanya leksikografis. Dipakai agar daftar VAN 1-12 selalu
 * urut benar di Logger Trips maupun Pengaturan SLA.
 */
export function compareSlaProfileCode(a: string, b: string): number {
  const chunksA = a.match(/\d+|\D+/g) ?? [];
  const chunksB = b.match(/\d+|\D+/g) ?? [];
  const len = Math.max(chunksA.length, chunksB.length);
  for (let i = 0; i < len; i++) {
    const x = chunksA[i] ?? "";
    const y = chunksB[i] ?? "";
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
      continue;
    }
    const cmp = x.localeCompare(y, "id");
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/** Label jenis SLA. */
export function slaKindLabel(kind: SlaKind | null | undefined): string {
  if (kind === "DEPARTURE") return "Keberangkatan";
  if (kind === "ARRIVAL") return "Kedatangan";
  return "–";
}

function formatSlaSpan(totalSeconds: number): string {
  const abs = Math.abs(Math.trunc(totalSeconds));
  if (abs < 60) return `${abs} dtk`;
  const minutes = Math.floor(abs / 60);
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} mnt`;
}

/** Label selisih: "Terlambat 12 mnt" / "6 mnt lebih awal" / "Pas target". */
export function formatSlaDelta(deltaSeconds: number | null | undefined): string {
  if (deltaSeconds === null || deltaSeconds === undefined) return "–";
  if (deltaSeconds === 0) return "Pas target";
  if (deltaSeconds > 0) return `Terlambat ${formatSlaSpan(deltaSeconds)}`;
  return `${formatSlaSpan(deltaSeconds)} lebih awal`;
}

/** Ringkasan kepatuhan: tepat waktu / (tepat waktu + terlambat), null bila kosong. */
export function computeSlaCompliance(onTime: number, late: number): number | null {
  const denom = onTime + late;
  if (denom <= 0) return null;
  return onTime / denom;
}

export function formatSlaCompliance(value: number | null): string {
  if (value === null) return "–";
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}
