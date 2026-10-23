# HR WEB — Context Lanjutan (dari session `HR WEB` / `brave-nebula`)

> Dibuat karena session lama terlalu besar untuk di-compact:
> `Session too large to compact - context exceeds model limit even after stripping media`
> dan `Conversation history too large to compact - exceeds model context limit`.
> Session lama JANGAN dihapus, hanya di-archive. Gunakan file ini untuk memulai chat/session baru.

- Session ID lama: `ses_0dddfdfa3ffelS8lo4Yw586HVt`
- Slug: `brave-nebula`
- Title: `HR WEB`
- Agent lama: `plan`
- Project dir: `C:\Users\Risky\.gemini\antigravity\scratch\hr_web`
- Project ID opencode: `ed9ea05e021def31326d03e53108a508e41c27b5`
- Ukuran saat diekspor: `10439 messages`, `47517 parts`
- Compaction sukses terakhir: `msg_0ea77dcc4001z8Sdjh3HfLbTRN`
- 2 compaction terakhir GAGAL (ContextOverflow), jadi chat baru wajib mulai dari file ini.
- Tanggal context: `2026-09-29`

## 1. Tujuan Aktif

Fokus terakhir BUKAN lagi live-tracking internal saja, melainkan **TMS multi-client**:

1. Buat client TMS: **Tuku** dan **Manginue**.
2. Buat user/client untuk masing-masing client (akun `external`).
3. Admin memilih kendaraan McEasy mana yang muncul untuk tiap client.
4. Saat user client login ke menu TMS, **hanya kendaraan yang di-mapping ke client tersebut yang muncul**.
5. Desain harus mudah tambah client baru ke depannya.
6. Permintaan user terakhir yang belum selesai:
   - Data awal boleh dikosongkan dulu, nanti dibuat oleh admin.
   - Email/akun client dibuat oleh Super Admin.

## 2. Repo & Lingkungan

- HR Web: `C:\Users\Risky\.gemini\antigravity\scratch\hr_web`
  - branch `master`
  - remote `https://github.com/riskytolen/hrweb.git`
  - Head saat context dibuat: `99a5abc feat(tms): client selector, membership ui, tenant-aware edge and mobile contracts`
- Flutter (Jams Absen): `C:\Users\Risky\.gemini\antigravity\scratch\jams_absen`
  - branch `master`
  - remote `https://github.com/riskytolen/jams_absen.git`
- Supabase project: `snovvucsmewwbrnggvek`
  - URL: `https://snovvucsmewwbrnggvek.supabase.co`
  - Kedua repo memakai database/project yang sama.
- Deploy HR Web: Vercel (auto-deploy dari `master`).

## 3. Status Git HR Web (terakhir)

Commit penting berurutan ke belakang:

- `99a5abc feat(tms): client selector, membership ui, tenant-aware edge and mobile contracts`
- `9d0a7cf feat(tms): enforce tenant client scope across tms apis`
- `59fc494 feat(tms): client tenancy foundation with tuku seed and backfill`
- `ebf5e4c feat(tms): granular role access per tms submenu`
- `3fc42f4 fix(tms): align role access for new tms menus`
- `d7c209a fix(build): exclude supabase edge functions from next typecheck`
- `22cd924 feat(tms): recipient signature, open claim to all roles, pre-claim route preview`

Status kerja saat diekspor (`git status --short --branch`):

- `M src/app/(dashboard)/settings/storage-usage/page.tsx`
- `M src/app/api/admin/storage-usage/route.ts`
- `?? supabase/migrations/20260915110000_harden_storage_usage_stats_rpc.sql`

> Itu adalah perubahan pre-existing yang TIDAK boleh ikut di-stage/commit (perbaikan keamanan fitur Penyimpanan, belum selesai).

## 4. Integrasi McEasy (aturan keras)

- Token McEasy **hanya di server**. Jangan kirim ke browser, jangan pakai prefix `NEXT_PUBLIC_`.
- Token mentah tanpa awalan `Bearer`; kode server yang menambahkan `Authorization: Bearer <token>`.
- `.env.local` (root HR Web, sudah diabaikan Git):
  ```env
  MCEASY_API_TOKEN=token_anda_di_sini
  MCEASY_VSMS_V2_BASE_URL=https://vsms-v2-public.mceasy.com/v1
  ```
- Endpoint inti yang dipakai:
  ```text
  GET ${MCEASY_VSMS_V2_BASE_URL}/vehicles/statuses?withAddress=true
  GET ${MCEASY_VSMS_V2_BASE_URL}/vehicles/{id}/status?withAddress=true
  POST ${MCEASY_VSMS_V2_BASE_URL}/live-data/create_temp_live_view
  POST ${MCEASY_VSMS_V2_BASE_URL}/live-data/stop_temp_live_view
  ```
- Token McEasy JAMS melihat **semua unit**. Tidak ada filter client di sisi McEasy.
  - Keputusan user: filter dilakukan di HR Web by endpoint/data, bukan minta token terpisah per client untuk tahap ini.
  - User sempat bilang token baru akan dibuatkan nanti, tapi keputusan jalan: **satu token, filter di HR Web**.
- Dokumentasi: `https://docs.mceasy.com/api/`
- Jangan expose secret/service-role/McEasy/TMS capture token di output.

## 5. Model Multi-Client TMS (yang sudah diimplementasi)

### 5.1 Tabel

- `tms_clients (id, code, slug, name, logo_url, timezone, status)`
  - Seed aktif: `('TUKU', 'tuku', 'Tuku')`
  - `Manginue` BELUM ada seed (baru disebut di komentar mobile).
- `tms_client_memberships (client_id, user_id, status, created_by)`
  - Many-to-many user -> client.
  - Migration seed memberikan membership TUKU ke semua `user_profiles` aktif agar enforcement tidak mengunci user lama.
- `tms_client_vehicle_assignments`
  - Mapping unit McEasy -> client dengan tanggal efektif:
  - `(client_id, mceasy_vehicle_id, license_plate, license_plate_key, effective_from, effective_until, status, source)`
  - Satu unit hanya boleh punya satu assignment aktif terbuka dalam satu waktu.
- Kolom `client_id` NULLABLE ditambahkan ke tabel TMS existing:
  - `tms_live_track_vehicles`, `tms_live_track_groups`, `tms_live_track_group_vehicles`
  - `tms_live_track_config_events`, `tms_live_track_task_snapshots`, `tms_live_track_task_occurrences`
  - `tms_epod_assignments`, `tms_epod_stops`, `tms_epod_submissions`, `tms_epod_evidence`, `tms_epod_events`
  - `tms_trip_visit_logs`, `tms_route_point_temperatures`
  - `NULL = UNASSIGNED`.
- RLS: tabel client/membership/assignment ditutup dari browser (`revoke ... from public, anon, authenticated`), hanya `service_role`.
- Browser tidak akses langsung; semua lewat Route Handler server-side.

### 5.2 Seed TUKU

- `20260930000000_tms_client_tenancy_foundation.sql`
  - Buat tabel + kolom `client_id` + seed client TUKU.
- `20260930000100_tms_client_tuku_seed_backfill.sql`
  - Sumber kebenaran: unit pada grup Live Track `CP` dan `Gudang`.
  - Isi `tms_client_vehicle_assignments` untuk TUKU dari grup tersebut.
  - Backfill `client_id` grup/kendaraan/task/e-POD yang `NULL` ke TUKU.
  - Idempotent.
- `20260930000200_tms_client_tuku_memberships.sql`
  - Beri membership TUKU ke semua akun aktif.
- `20260930000300_tms_epod_mobile_client_fields.sql`
  - RPC mobile mengembalikan `client_id/code/slug/name`.
  - Badge client Tuku/Manginue di aplikasi mobile.

### 5.3 Otorisasi

File pusat: `src/lib/tms-tenant-auth.ts`

- `resolveClientScope({ accountType, permissions, roleLevel, membershipClientIds })`
  - Super Admin (`level >= 100` atau `all`) -> `all`.
  - Internal + `tms.clients.all` -> `all`.
  - Internal biasa -> membership.
  - External -> selalu membership (permission all-client diabaikan).
- `authorizeTmsScope(...)`
  - Query `?client=` / `?client=tuku` tidak dipercaya mentah; harus dalam scope, di luar scope -> `404` agar tidak bocor.
  - Jika user non-`all` dan membership kosong -> `403 Akun belum ditugaskan ke client TMS mana pun`.
- `fetchScopedVehicleMap`, `isVehicleInScopedMap`, `isRecordInScope`, `applyClientScope`
  - Untuk filter data live vendor yang tidak punya `client_id`.
- Permission di `src/lib/permissions.ts`:
  - `tms`, `tms.view`, `tms.input`, `tms.clients.all`
  - `tms.live-view`, `tms.live-track-task`, `tms.logger-trips` + varian `.view/.input`
  - `tms.epod`, `tms.live-track-config`, `vehicle-odometer.*`
  - Catatan penting: banyak helper TMS masih `return false` untuk `account_type === "external"`. Ini sisa pekerjaan agar user client external bisa akses TMS view-only.

### 5.4 API yang sudah ada

- `GET /api/tms/clients`
  - Daftar client sesuai scope + `meta.allAllowed`.
  - Dipakai client selector dan manajemen membership.
- `GET /api/admin/tms-client-memberships?userId=...`
- `PATCH /api/admin/tms-client-memberships { userId, clientIds }`
  - Khusus Super Admin, replace set, validasi client aktif.
- API TMS sudah divalidasi scope `?client=`:
  - Live View, Live Track Task/board, e-POD, Logger Trips.
- `GET /api/tms/live-track-config/vehicles`
  - Daftar unit untuk selector konfigurasi, gabungan live McEasy + katalog lokal.

### 5.5 UI yang sudah ada

- Halaman akun: `src/app/(dashboard)/settings/accounts/page.tsx`
  - Modal user sudah ada state `tmsClients`, `userClientIds`, `fetchTmsClients`, `fetchUserMemberships`.
  - Simpan membership via `/api/admin/tms-client-memberships`.
- Komponen: `TmsClientSelector`
  - Admin: dropdown client.
  - Single-client user: badge terkunci.
  - Pilihan tersimpan di `?client=` dan me-reload daftar.
- Badge client di board task + daftar e-POD.
- Flutter:
  - Model assignment/detail membawa identitas client.
  - Badge client di kartu FO Saya, FO Tersedia, header detail.
  - Filter chips client dinamis bila >1 client.

### 5.6 Edge Function & Mobile

- `supabase/functions/epod-evidence-urls/index.ts` versi 3 deployed:
  - Tenant check + info client di response + `evidence_type`.
- RPC mobile mengembalikan client fields untuk overview/detail/preview.

## 6. Role & Akun Client (masalah terakhir sebelum context dibuat)

- User membuat role `Client`, kaitkan ke `tuku@jamslogistic.com`, saat login tidak muncul apa-apa.
  - Penyebab yang ditemukan: permission TMS untuk external belum dibuka + default route/sidebar belum menangani external TMS.
- Aturan yang disepakati:
  - Role menentukan AKSI/submenu (lihat/edit dll mengikuti pengaturan akun).
  - Membership menentukan DATA (client mana yang boleh dilihat).
  - Jangan buat role baru per perusahaan; satu role `Client TMS` bisa dipakai banyak client karena isolasi via membership, bukan via role.
  - External tidak boleh manage/config/admin.
- File terkait:
  - `src/lib/permissions.ts`
  - `src/components/AuthProvider.tsx` (saat ini external hanya boleh `vehicle-odometer`)
  - `src/lib/navigation.ts`
  - `src/components/layout/Sidebar.tsx`
  - `src/app/login/page.tsx` (`getDefaultRouteForPermissions`)
  - `src/app/(dashboard)/settings/accounts/page.tsx` (`PERMISSION_SECTIONS`)

## 7. Preferensi User yang Terekam

- Live Track:
  - Tab Aktif hanya FO `STARTED`.
  - Tab Riwayat hanya FO `ENDED`.
  - FO selesai boleh tampil di luar jadwal sebagai history.
  - FO tanpa grup jangan fallback/tampil.
  - Detail FO terminal: tampilkan route history/evidence; marker kendaraan statis/final.
- e-POD:
  - Tanda tangan penerima wajib untuk `DELIVERED`, `PARTIAL`, `REJECTED`.
  - `LOADING` tidak butuh/tidak boleh tanda tangan.
  - Retensi signature mengikuti evidence: 3 bulan.
  - Semua karyawan aktif/semua jabatan bisa akses menu dan claim FO.
  - Kartu FO Claim diklik -> tampilkan preview rute read-only sebelum claim, tanpa peta.
  - Flutter + HR Web dua-duanya.
- Tanda tangan (TTD):
  - Reset/hapus harus benar-benar menghapus canvas (pernah ada sisa tidak terhapus, sudah diperbaiki di `f4184c7`).
  - Input signature dibuat prominent dan robust (`ae0c28c`).
- Build Vercel:
  - Pernah gagal karena `supabase/functions/epod-evidence-urls/index.ts` ikut typecheck Next (`Cannot find module 'https://esm.sh/...'`).
  - Diperbaiki dengan exclude Edge Function dari Next typecheck (`d7c209a`).

## 8. Yang BELUM Selesai / Next Steps

1. Seed client `Manginue`:
   - `code='MANGINUE'`, `slug='manginue'`, `name='Manginue'`.
2. Tentukan daftar unit Manginue:
   - Butuh nomor polisi, idealnya + McEasy vehicle ID.
   - Daftar unit Tuku = grup `CP` dan `Gudang` pada menu grup unit (sudah dipakai sebagai seed).
3. Buat/flow admin untuk mapping kendaraan per client:
   - Pilih client -> pilih unit dari daftar McEasy -> simpan ke `tms_client_vehicle_assignments`.
   - User minta bisa dikosongkan dulu, nanti admin yang buat.
4. Buat/flow Super Admin untuk akun client:
   - Email dibuat oleh Super Admin.
   - `account_type = external`.
   - Assign membership ke Tuku/Manginue.
5. Buka akses TMS untuk external secara terkontrol:
   - `AuthProvider.hasPermission` / `getPermissionLevel`.
   - `canAccessTmsLive`, `canAccessTmsData`, `canViewTmsLiveView`, `canViewTmsLiveTask`, `canViewTmsLoggerTrips`, `canViewTmsEpod`.
   - Default route login external TMS.
   - Sidebar menampilkan menu TMS untuk external yang berhak.
   - Pastikan external tetap tidak bisa config/manage/admin dan tidak bisa lihat semua client.
6. Pastikan semua endpoint TMS memfilter by assignment:
   - Ambil live dari McEasy di server, filter dengan `tms_client_vehicle_assignments` sebelum kirim ke browser.
   - Tuku hanya unit Tuku, Manginue hanya unit Manginue.
7. Uji:
   - Admin melihat semua client + selector.
   - User Tuku hanya unit Tuku.
   - User Manginue hanya unit Manginue.
   - User tanpa membership -> 403 yang jelas.
   - `?client=milik-orang-lain` -> 404, tidak bocor.
8. Verifikasi standar:
   - `npx tsc --noEmit`
   - ESLint targeted
   - `npm test` / Vitest
   - `flutter analyze` untuk file mobile yang diubah

## 9. File Kunci untuk Chat Baru

- `src/lib/tms-tenant-auth.ts`
- `src/lib/permissions.ts`
- `src/components/AuthProvider.tsx`
- `src/lib/navigation.ts`
- `src/app/login/page.tsx`
- `src/app/(dashboard)/settings/accounts/page.tsx`
- `src/app/api/tms/clients/route.ts`
- `src/app/api/admin/tms-client-memberships/route.ts`
- `src/app/api/tms/live-track-config/vehicles/route.ts`
- `src/app/api/tms/live-track-board/route.ts`
- `src/app/api/tms/epod/route.ts`
- `supabase/migrations/20260930000000_tms_client_tenancy_foundation.sql`
- `supabase/migrations/20260930000100_tms_client_tuku_seed_backfill.sql`
- `supabase/migrations/20260930000200_tms_client_tuku_memberships.sql`
- `supabase/migrations/20260930000300_tms_epod_mobile_client_fields.sql`
- `supabase/functions/epod-evidence-urls/index.ts`

## 10. Prompt Siap Pakai untuk Chat Baru

```text
Lanjutkan HR WEB dari context.md.

Fokus: TMS multi-client Tuku dan Manginue.
- Tuku sudah ada seed (grup CP/Gudang).
- Manginue belum ada seed; buatkan seed + flow admin mapping unit.
- User external client hanya boleh melihat kendaraan yang di-mapping ke client-nya.
- Akun dibuat Super Admin, data awal boleh kosong dan dibuat admin.
- Ikuti model di src/lib/tms-tenant-auth.ts dan tabel tms_clients, tms_client_memberships, tms_client_vehicle_assignments.
- Jangan commit file unrelated: storage-usage page/route dan migration 20260915110000_harden_storage_usage_stats_rpc.sql.
- Verifikasi dengan tsc, eslint, dan test terkait.
```

## 11. Catatan Keamanan

- Jangan tampilkan atau commit secret, service-role key, McEasy token, atau password.
- Publishable key Supabase boleh ada di client; service-role tidak boleh.
- Default kredensial app hanya sebut email bila perlu, jangan tampilkan password.
- Token McEasy tidak boleh muncul di response API, log, atau error ke browser.
