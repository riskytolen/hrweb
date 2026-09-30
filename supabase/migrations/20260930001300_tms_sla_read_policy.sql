-- SLA: buka baca konfigurasi untuk user TMS terautentikasi.
--
-- Route Handler /api/tms/* memakai koneksi user (bukan service_role),
-- sehingga daftar profil/stop/assignment perlu kebijakan SELECT.
-- Data bersifat konfigurasi operasional (bukan rahasia); pembatasan
-- antar-client tetap ditegakkan di lapisan API via client scope.
-- Tulis tetap hanya service_role (tidak ada kebijakan insert/update/delete).

create policy "tms_sla_route_profiles: authenticated can read"
  on public.tms_sla_route_profiles for select
  to authenticated
  using (true);

create policy "tms_sla_route_stops: authenticated can read"
  on public.tms_sla_route_stops for select
  to authenticated
  using (true);

create policy "tms_sla_route_stop_addresses: authenticated can read"
  on public.tms_sla_route_stop_addresses for select
  to authenticated
  using (true);

create policy "tms_sla_task_assignments: authenticated can read"
  on public.tms_sla_task_assignments for select
  to authenticated
  using (true);

notify pgrst, 'reload schema';
