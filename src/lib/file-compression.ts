import imageCompression from "browser-image-compression";

/** Batas ukuran file maksimal (300KB) */
export const MAX_FILE_SIZE = 300 * 1024; // 300KB

/** Cek apakah file adalah gambar */
const isImage = (file: File): boolean =>
  file.type.startsWith("image/");

/** Cek apakah file adalah PDF */
const isPdf = (file: File): boolean =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

/**
 * Format ukuran file ke string yang mudah dibaca
 * @example formatFileSize(1536000) => "1.5 MB"
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export type CompressionResult =
  | { success: true; file: File; originalSize: number; compressedSize: number }
  | { success: false; error: string };

/**
 * Kompres file sebelum upload ke Supabase Storage.
 *
 * - **Gambar**: dikompres otomatis menggunakan browser-image-compression
 *   (target max 1MB, resolusi max 1920px, kualitas JPEG/WebP disesuaikan).
 * - **PDF**: hanya divalidasi ukurannya (max 1MB). Kompresi PDF di browser
 *   tidak praktis, jadi hanya dibatasi ukurannya.
 * - **File lain**: ditolak.
 *
 * @param file - File yang akan dikompres
 * @param maxSizeMB - Ukuran maksimal dalam MB (default: 1)
 * @returns CompressionResult
 */
export async function compressFile(
  file: File,
  maxSizeKB: number = 300
): Promise<CompressionResult> {
  const maxSizeBytes = maxSizeKB * 1024;
  const maxSizeMB = maxSizeKB / 1024;

  // --- Gambar: kompres ---
  if (isImage(file)) {
    try {
      // Jika sudah kecil, langsung return
      if (file.size <= maxSizeBytes) {
        return {
          success: true,
          file,
          originalSize: file.size,
          compressedSize: file.size,
        };
      }

      const compressed = await imageCompression(file, {
        maxSizeMB,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
        fileType: file.type as string,
        initialQuality: 0.5,
      });

      // Buat File baru dengan nama asli agar ekstensi tetap benar
      const compressedFile = new File([compressed], file.name, {
        type: compressed.type,
        lastModified: Date.now(),
      });

      return {
        success: true,
        file: compressedFile,
        originalSize: file.size,
        compressedSize: compressedFile.size,
      };
    } catch {
      return {
        success: false,
        error: `Gagal mengompres gambar "${file.name}". Silakan coba file lain.`,
      };
    }
  }

  // --- PDF: validasi ukuran saja ---
  if (isPdf(file)) {
    if (file.size > maxSizeBytes) {
      return {
        success: false,
        error: `File PDF "${file.name}" (${formatFileSize(file.size)}) melebihi batas ${maxSizeKB}KB. Silakan kompres PDF terlebih dahulu menggunakan tools online seperti ilovepdf.com.`,
      };
    }
    return {
      success: true,
      file,
      originalSize: file.size,
      compressedSize: file.size,
    };
  }

  // --- File lain: tolak ---
  return {
    success: false,
    error: `Tipe file "${file.name}" tidak didukung. Hanya gambar (JPG, PNG) dan PDF yang diperbolehkan.`,
  };
}
