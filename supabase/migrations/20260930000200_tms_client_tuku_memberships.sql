-- TMS multi-client: seed membership TUKU untuk seluruh akun aktif (Tahap 3).
--
-- Seluruh akun aktif existing (internal maupun external) bekerja pada data
-- TUKU, sehingga enforcement client scope tidak mengunci mereka keluar.
-- Idempotent: aman dijalankan ulang.

insert into public.tms_client_memberships (client_id, user_id, status, created_by)
select
  (select id from public.tms_clients where code = 'TUKU'),
  up.id,
  'Aktif',
  null
from public.user_profiles up
where up.status = 'Aktif'
  and not exists (
    select 1 from public.tms_client_memberships m
    where m.client_id = (select id from public.tms_clients where code = 'TUKU')
      and m.user_id = up.id
  );

notify pgrst, 'reload schema';
