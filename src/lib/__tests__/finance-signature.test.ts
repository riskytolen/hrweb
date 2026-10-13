import { describe, expect, it } from "vitest";
import {
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MAX_H_MM,
  SIGNATURE_MAX_W_MM,
  computeSignatureBox,
  findVisibleAlphaBounds,
  hasTransparentPixels,
  signatureFileError,
  signatureFileName,
} from "../finance-signature";

function opaquePixels(count: number): number[] {
  const data: number[] = [];
  for (let i = 0; i < count; i += 1) data.push(0, 0, 0, 255);
  return data;
}

describe("finance signature helpers", () => {
  it("hanya menerima PNG maksimal 2 MB", () => {
    expect(signatureFileError(null)).not.toBeNull();
    expect(signatureFileError({ type: "image/jpeg", size: 100 })).toMatch(/PNG/);
    expect(signatureFileError({ type: "image/png", size: SIGNATURE_MAX_BYTES + 1 })).toMatch(/2 MB/);
    expect(signatureFileError({ type: "image/png", size: SIGNATURE_MAX_BYTES })).toBeNull();
    expect(signatureFileError({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("mendeteksi latar transparan dari channel alpha", () => {
    expect(hasTransparentPixels(opaquePixels(64))).toBe(false);
    expect(hasTransparentPixels([])).toBe(false);
    expect(hasTransparentPixels(null)).toBe(false);
    const withTransparent = [...opaquePixels(64)];
    for (let i = 0; i < 8; i += 1) withTransparent[i * 4 + 3] = 0;
    expect(hasTransparentPixels(withTransparent)).toBe(true);
  });

  it("mencari crop area TTD dari piksel non-transparan", () => {
    const width = 6;
    const height = 5;
    const data = opaquePixels(width * height).map((value, index) => (index % 4 === 3 ? 0 : value));
    // Area terlihat: x 2..4, y 1..3.
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }

    expect(findVisibleAlphaBounds(data, width, height)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
    expect(findVisibleAlphaBounds(data.map((value, index) => (index % 4 === 3 ? 0 : value)), width, height)).toBeNull();
  });

  it("crop TTD tetap menghitung tepi anti-alias yang semi-transparan", () => {
    const width = 4;
    const height = 4;
    const data = opaquePixels(width * height).map((value, index) => (index % 4 === 3 ? 0 : value));
    data[(0 * width + 1) * 4 + 3] = 12;
    data[(3 * width + 2) * 4 + 3] = 18;

    expect(findVisibleAlphaBounds(data, width, height)).toEqual({ x: 1, y: 0, width: 2, height: 4 });
  });

  it("gambar proporsional dan tidak melebihi kotak tanda tangan", () => {
    const landscape = computeSignatureBox(1200, 300);
    expect(landscape.w).toBeLessThanOrEqual(SIGNATURE_MAX_W_MM);
    expect(landscape.h).toBeLessThanOrEqual(SIGNATURE_MAX_H_MM);
    expect(landscape.w / landscape.h).toBeCloseTo(4, 5);

    const portrait = computeSignatureBox(300, 900);
    expect(portrait.w).toBeLessThanOrEqual(SIGNATURE_MAX_W_MM);
    expect(portrait.h).toBeLessThanOrEqual(SIGNATURE_MAX_H_MM);
    expect(portrait.h).toBeCloseTo(SIGNATURE_MAX_H_MM, 5);

    expect(SIGNATURE_MAX_W_MM).toBeGreaterThanOrEqual(70);
    expect(SIGNATURE_MAX_H_MM).toBeGreaterThanOrEqual(28);

    // Gambar kecil tidak diperbesar; pembesaran utama berasal dari crop area transparan.
    expect(computeSignatureBox(20, 5)).toEqual({ w: 20, h: 5 });
    expect(computeSignatureBox(0, 10)).toEqual({ w: 0, h: 0 });
    expect(computeSignatureBox(NaN, 10)).toEqual({ w: 0, h: 0 });
  });

  it("nama file aman dan selalu berekstensi png", () => {
    expect(signatureFileName("TTD Pak Bos!.jpg", 123)).toBe("123-TTD_Pak_Bos.png");
    expect(signatureFileName(null, 7)).toBe("7-tanda-tangan.png");
  });
});
