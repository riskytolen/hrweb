/**
 * Helper tanda tangan digital Finance — PNG transparan di bucket privat.
 *
 * Desain keamanan: file TTD disimpan di bucket privat `finance-signatures`
 * (bukan bucket logo publik). Database hanya menyimpan `signer_signature_path`;
 * URL bertanda (signed URL) dibuat sesaat saat preview/pembuatan PDF.
 */

export const SIGNATURE_BUCKET = "finance-signatures";
export const SIGNATURE_MIME = "image/png";
export const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
/** Batas gambar TTD di area tanda tangan PDF (mm). Sengaja besar agar terasa seperti TTD/cap asli. */
export const SIGNATURE_MAX_W_MM = 72;
export const SIGNATURE_MAX_H_MM = 28;
/** Alpha di bawah ini dianggap transparan (toleransi anti-aliasing tepi). */
export const SIGNATURE_TRANSPARENT_ALPHA_THRESHOLD = 250;
/** Jumlah piksel transparan minimum agar PNG dianggap berlatar transparan. */
export const SIGNATURE_MIN_TRANSPARENT_PIXELS = 8;

export interface SignatureBox {
  w: number;
  h: number;
}

export interface SignatureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Validasi file TTD: harus PNG dan maksimal 2 MB. Mengembalikan pesan error atau null. Pure. */
export function signatureFileError(file: { type?: string | null; size?: number | null } | null | undefined): string | null {
  if (!file) return "Pilih file PNG terlebih dahulu.";
  if ((file.type || "") !== SIGNATURE_MIME) return "TTD harus file PNG transparan.";
  if (!Number.isFinite(file.size as number) || (file.size as number) <= 0) return "Ukuran file tidak valid.";
  if ((file.size as number) > SIGNATURE_MAX_BYTES) return "Ukuran TTD maksimal 2 MB.";
  return null;
}

/**
 * True bila data piksel RGBA mengandung piksel transparan yang cukup.
 * `data` adalah array channel [r,g,b,a, r,g,b,a, ...] dari canvas ImageData.
 * Pure agar bisa di-test di Node tanpa browser.
 */
export function hasTransparentPixels(
  data: ArrayLike<number> | null | undefined,
  threshold: number = SIGNATURE_TRANSPARENT_ALPHA_THRESHOLD,
  minimum: number = SIGNATURE_MIN_TRANSPARENT_PIXELS,
): boolean {
  if (!data || data.length < 4) return false;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < threshold) {
      count += 1;
      if (count >= minimum) return true;
    }
  }
  return false;
}

/** Cari bounding box piksel yang terlihat dari data RGBA. Pure. */
export function findVisibleAlphaBounds(
  data: ArrayLike<number> | null | undefined,
  width: number,
  height: number,
  threshold: number = SIGNATURE_TRANSPARENT_ALPHA_THRESHOLD,
): SignatureBounds | null {
  if (!data || width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha >= threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Hitung ukuran TTD proporsional agar muat dalam kotak maksimum (mm).
 * Gambar kecil tidak diperbesar (scale dibatasi 1) agar tidak pecah.
 * Pure.
 */
export function computeSignatureBox(
  width: number,
  height: number,
  maxW: number = SIGNATURE_MAX_W_MM,
  maxH: number = SIGNATURE_MAX_H_MM,
): SignatureBox {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { w: 0, h: 0 };
  }
  if (!Number.isFinite(maxW) || !Number.isFinite(maxH) || maxW <= 0 || maxH <= 0) {
    return { w: 0, h: 0 };
  }
  const scale = Math.min(1, maxW / width, maxH / height);
  // Clamp agar floating-point tidak membuat hasil melebihi kotak maksimum.
  return { w: Math.min(maxW, width * scale), h: Math.min(maxH, height * scale) };
}

/** Nama file aman untuk upload TTD, selalu berekstensi .png. Pure. */
export function signatureFileName(originalName: string | null | undefined, now: number = Date.now()): string {
  const base = (originalName || "tanda-tangan")
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(/[^a-zA-Z0-9-]+/g, "_")
    .replace(/[_-]+$/, "")
    .slice(0, 60) || "tanda-tangan";
  return `${now}-${base}.png`;
}
