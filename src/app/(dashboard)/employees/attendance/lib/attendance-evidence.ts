import { supabase } from "@/lib/supabase";
import { ATTENDANCE_EVIDENCE_BUCKET } from "./attendance-evidence-spec";

/** Unggah satu foto eviden. Path harus sudah dibuat oleh `buildAttendanceEvidencePath`. */
export async function uploadAttendanceEvidence(path: string, file: File): Promise<void> {
  const { error } = await supabase.storage
    .from(ATTENDANCE_EVIDENCE_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
  if (error) throw error;
}

/** Hapus objek eviden. Best-effort cleanup; caller boleh menangkap error. */
export async function removeAttendanceEvidence(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(ATTENDANCE_EVIDENCE_BUCKET).remove([path]);
  if (error) throw error;
}

/** Signed URL singkat untuk melihat foto privat. */
export async function createAttendanceEvidenceSignedUrl(
  path: string,
  expiresInSeconds = 600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ATTENDANCE_EVIDENCE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("URL eviden tidak tersedia.");
  return data.signedUrl;
}
