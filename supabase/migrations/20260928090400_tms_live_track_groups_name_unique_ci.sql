-- Nama kelompok Live Track unik tanpa membedakan huruf besar/kecil.
create unique index if not exists tms_live_track_groups_name_key_ci
  on public.tms_live_track_groups (lower(name));
