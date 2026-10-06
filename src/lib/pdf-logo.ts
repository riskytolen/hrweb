/**
 * Helper logo untuk generator PDF client-side.
 *
 * Logo yang dimasukkan ke jsPDF dalam resolusi asli (mis. puluhan megapiksel)
 * akan menggembungkan ukuran file PDF sampai ratusan MB. Helper ini selalu
 * me-downscale logo sebelum `addImage` sehingga PDF tetap ratusan KB.
 */

/** Lebar maksimum logo yang ditanam ke PDF (px). Cukup untuk kop 70mm @300dpi. */
export const PDF_LOGO_MAX_WIDTH = 800;

export interface DownscaledSize {
  width: number;
  height: number;
}

/** Hitung dimensi proporsional dengan batas lebar maksimum. Pure, bisa di-test. */
export function computeDownscaledSize(
  width: number,
  height: number,
  maxWidth: number = PDF_LOGO_MAX_WIDTH,
): DownscaledSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  if (width <= maxWidth) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Downscale PNG data URL (mis. logo dari storage) ke batas lebar maksimum.
 * Mengembalikan null jika gagal; pemanggil tetap bisa memakai data URL asli.
 */
export async function downscaleDataUrl(
  dataUrl: string,
  maxWidth: number = PDF_LOGO_MAX_WIDTH,
): Promise<string | null> {
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("logo"));
      image.src = dataUrl;
    });
    const size = computeDownscaledSize(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      maxWidth,
    );
    if (size.width <= 0 || size.height <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Muat logo dari URL/path publik dan kembalikan sebagai PNG data URL yang
 * sudah di-downscale. Mengembalikan null jika gagal (pemanggil pakai fallback teks).
 */
export async function loadDownscaledLogoDataUrl(
  src: string,
  maxWidth: number = PDF_LOGO_MAX_WIDTH,
): Promise<string | null> {
  try {
    const response = await fetch(src, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) return null;
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("logo"));
        image.src = objectUrl;
      });
      const size = computeDownscaledSize(
        image.naturalWidth || image.width,
        image.naturalHeight || image.height,
        maxWidth,
      );
      if (size.width <= 0 || size.height <= 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}
