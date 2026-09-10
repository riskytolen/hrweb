/**
 * Kebijakan password tunggal untuk Manajemen Akun.
 *
 * Minimal 6 karakter adalah batas teknis terendah yang didukung
 * Supabase Auth (nilai konfigurasi di bawah 6 dikembalikan ke 6),
 * sehingga validasi aplikasi tidak boleh lebih rendah dari ini.
 */
export const MIN_PASSWORD_LENGTH = 6;

export const PASSWORD_MIN_MESSAGE = `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`;

/** Hasil validasi password: `null` berarti valid. */
export function validatePasswordLength(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Password wajib diisi.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return PASSWORD_MIN_MESSAGE;
  }
  return null;
}
