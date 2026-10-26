-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: eviden foto untuk input absen manual
-- ───────────────────────────────────────────────────────────────
-- Satu absensi manual dapat memiliki satu foto eviden.
-- Foto disimpan di bucket privat `attendance-evidence`; tabel hanya
-- menyimpan path + metadata. Data absensi lama tidak diwajibkan
-- memiliki foto.
--
-- Input manual baru berstatus Hadir/Terlambat wajib menyertakan foto.
-- Status Alpha dan data lama tetap opsional.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS evidence_path TEXT,
  ADD COLUMN IF NOT EXISTS evidence_file_name TEXT,
  ADD COLUMN IF NOT EXISTS evidence_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS evidence_size INTEGER,
  ADD COLUMN IF NOT EXISTS evidence_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_uploaded_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_records_evidence_meta_check'
      AND conrelid = 'public.attendance_records'::regclass
  ) THEN
    ALTER TABLE public.attendance_records
      ADD CONSTRAINT attendance_records_evidence_meta_check
      CHECK (
        evidence_path IS NULL
        OR (
          btrim(evidence_path) <> ''
          AND evidence_file_name IS NOT NULL
          AND btrim(evidence_file_name) <> ''
          AND evidence_mime_type IN ('image/jpeg', 'image/png', 'image/webp')
          AND evidence_size IS NOT NULL
          AND evidence_size > 0
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_attendance_manual_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND NEW.is_manual IS TRUE
     AND NEW.status IN ('Hadir', 'Terlambat')
     AND NULLIF(btrim(NEW.evidence_path), '') IS NULL THEN
    RAISE EXCEPTION 'Eviden foto wajib dilampirkan untuk absen manual Hadir/Terlambat.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_manual_evidence ON public.attendance_records;
CREATE TRIGGER trg_attendance_manual_evidence
  BEFORE INSERT ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_attendance_manual_evidence();

COMMENT ON COLUMN public.attendance_records.evidence_path IS
  'Path objek foto eviden di bucket privat attendance-evidence.';
COMMENT ON COLUMN public.attendance_records.evidence_file_name IS
  'Nama file asli foto eviden.';
COMMENT ON COLUMN public.attendance_records.evidence_mime_type IS
  'MIME foto eviden: image/jpeg, image/png, atau image/webp.';
COMMENT ON COLUMN public.attendance_records.evidence_size IS
  'Ukuran file foto eviden setelah kompresi (byte).';
COMMENT ON COLUMN public.attendance_records.evidence_uploaded_at IS
  'Waktu foto eviden diunggah.';
COMMENT ON COLUMN public.attendance_records.evidence_uploaded_by IS
  'User yang mengunggah foto eviden.';

-- ─── Bucket privat ───
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-evidence',
  'attendance-evidence',
  false,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

-- ─── Policy Storage ───
DROP POLICY IF EXISTS auth_select_attendance_evidence ON storage.objects;
DROP POLICY IF EXISTS auth_insert_attendance_evidence ON storage.objects;
DROP POLICY IF EXISTS auth_update_attendance_evidence ON storage.objects;
DROP POLICY IF EXISTS auth_delete_attendance_evidence ON storage.objects;

CREATE POLICY auth_select_attendance_evidence
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'attendance-evidence'
    AND public.has_app_permission('attendance', true)
  );

CREATE POLICY auth_insert_attendance_evidence
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'attendance-evidence'
    AND (
      public.has_app_permission('attendance')
      OR EXISTS (
        SELECT 1
        FROM public.user_profiles up
        JOIN public.roles r ON r.id = up.role_id
        WHERE up.id = auth.uid()
          AND up.status = 'Aktif'
          AND r.status = 'Aktif'
          AND (
            r.permissions ? 'all'
            OR r.permissions ? 'attendance'
            OR r.permissions ? 'attendance.input'
          )
      )
    )
  );

CREATE POLICY auth_update_attendance_evidence
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'attendance-evidence'
    AND (
      public.has_app_permission('attendance')
      OR (
        owner_id = auth.uid()::text
        AND EXISTS (
          SELECT 1
          FROM public.user_profiles up
          JOIN public.roles r ON r.id = up.role_id
          WHERE up.id = auth.uid()
            AND up.status = 'Aktif'
            AND r.status = 'Aktif'
            AND (
              r.permissions ? 'all'
              OR r.permissions ? 'attendance'
              OR r.permissions ? 'attendance.input'
            )
        )
      )
    )
  )
  WITH CHECK (
    bucket_id = 'attendance-evidence'
    AND (
      public.has_app_permission('attendance')
      OR (
        owner_id = auth.uid()::text
        AND EXISTS (
          SELECT 1
          FROM public.user_profiles up
          JOIN public.roles r ON r.id = up.role_id
          WHERE up.id = auth.uid()
            AND up.status = 'Aktif'
            AND r.status = 'Aktif'
            AND (
              r.permissions ? 'all'
              OR r.permissions ? 'attendance'
              OR r.permissions ? 'attendance.input'
            )
        )
      )
    )
  );

CREATE POLICY auth_delete_attendance_evidence
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'attendance-evidence'
    AND (
      public.has_app_permission('attendance')
      OR (
        owner_id = auth.uid()::text
        AND EXISTS (
          SELECT 1
          FROM public.user_profiles up
          JOIN public.roles r ON r.id = up.role_id
          WHERE up.id = auth.uid()
            AND up.status = 'Aktif'
            AND r.status = 'Aktif'
            AND (
              r.permissions ? 'all'
              OR r.permissions ? 'attendance'
              OR r.permissions ? 'attendance.input'
            )
        )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
