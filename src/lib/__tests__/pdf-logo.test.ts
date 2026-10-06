import { describe, expect, it } from "vitest";
import { computeDownscaledSize, PDF_LOGO_MAX_WIDTH } from "../pdf-logo";

describe("pdf logo downscale", () => {
  it("tidak mengubah gambar yang sudah kecil", () => {
    expect(computeDownscaledSize(700, 300)).toEqual({ width: 700, height: 300 });
  });

  it("menurunkan gambar raksasa secara proporsional", () => {
    expect(computeDownscaledSize(10039, 4134)).toEqual({ width: 800, height: 329 });
  });

  it("menghormati batas custom", () => {
    expect(computeDownscaledSize(1400, 577, 1400)).toEqual({ width: 1400, height: 577 });
    expect(computeDownscaledSize(1400, 577, 700)).toEqual({ width: 700, height: 289 });
  });

  it("aman untuk dimensi tidak valid", () => {
    expect(computeDownscaledSize(0, 100)).toEqual({ width: 0, height: 0 });
    expect(computeDownscaledSize(NaN, 100)).toEqual({ width: 0, height: 0 });
  });

  it("batas default 800px", () => {
    expect(PDF_LOGO_MAX_WIDTH).toBe(800);
  });
});
