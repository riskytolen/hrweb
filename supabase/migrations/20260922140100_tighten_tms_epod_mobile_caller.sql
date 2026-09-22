-- Perketat guard e-POD mobile: hanya akun operasional mobile.
--
-- Versi awal `tms_epod_mobile_is_caller` juga meloloskan semua user dengan
-- user_profiles aktif. Itu keliru karena akun eksternal (mis. role Client)
-- ikut lolos, padahal akun eksternal tidak boleh mengakses e-POD. Guard kini
-- hanya menerima sesi dari akun operasional mobile.
create or replace function public.tms_epod_mobile_is_caller()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'pegawai@jamslogistic.com';
$$;

revoke all on function public.tms_epod_mobile_is_caller() from public, anon, authenticated;
grant execute on function public.tms_epod_mobile_is_caller() to service_role;
