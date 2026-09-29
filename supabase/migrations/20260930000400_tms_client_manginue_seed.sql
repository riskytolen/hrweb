-- TMS multi-client: seed client MANGINUE kosong (Tahap 4).
--
-- Client dibuat dulu tanpa mapping unit agar Super Admin bisa mengisi
-- grup/unit lewat Pengaturan Live Track. Mapping unit menyusul setelah
-- daftar unit Manginue tersedia. Idempotent: aman dijalankan ulang.

insert into public.tms_clients (code, slug, name, timezone, status)
values ('MANGINUE', 'manginue', 'Manginue', 'Asia/Jakarta', 'Aktif')
on conflict (code) do nothing;

notify pgrst, 'reload schema';
