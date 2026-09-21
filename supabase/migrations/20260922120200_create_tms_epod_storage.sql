-- Private bucket untuk foto bukti e-POD.
--
-- Bucket ini sengaja tidak diberi policy untuk anon/authenticated. Upload
-- dan unduh hanya lewat signed URL yang dibuat server-side (service_role)
-- setelah permission diverifikasi. Dengan begitu tidak ada URL permanen
-- yang bisa bocor dan tidak ada jalur bypass lewat REST Storage.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tms-epod-evidence',
  'tms-epod-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Pastikan tidak ada policy longgar yang tertinggal.
drop policy if exists "tms_epod_evidence_authenticated_all" on storage.objects;
drop policy if exists "tms_epod_evidence_public_select" on storage.objects;
