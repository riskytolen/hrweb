-- ============================================================
-- FIX: Perlebar kolom varchar yang terlalu pendek & ubah NOT NULL
-- menjadi nullable agar import CSV bisa berjalan dengan benar
-- Error: "value too long for type character varying(20)"
-- ============================================================

-- ─── 1. Perlebar kolom yang terlalu pendek ───

-- no_ktp: dari varchar(16) ke varchar(30) — antisipasi format dengan spasi/dash
ALTER TABLE public.pegawai ALTER COLUMN no_ktp TYPE varchar(30);

-- no_telp: dari varchar(20) ke varchar(30) — antisipasi kode negara (+62xxx)
ALTER TABLE public.pegawai ALTER COLUMN no_telp TYPE varchar(30);

-- no_bpjs_kesehatan: dari varchar(20) ke varchar(50) — nomor BPJS bisa panjang
ALTER TABLE public.pegawai ALTER COLUMN no_bpjs_kesehatan TYPE varchar(50);

-- no_bpjs_ketenagakerjaan: dari varchar(20) ke varchar(50)
ALTER TABLE public.pegawai ALTER COLUMN no_bpjs_ketenagakerjaan TYPE varchar(50);

-- no_rekening: dari varchar(30) ke varchar(50) — beberapa bank punya nomor panjang
ALTER TABLE public.pegawai ALTER COLUMN no_rekening TYPE varchar(50);

-- ─── 2. Ubah kolom NOT NULL menjadi nullable (sesuai kebutuhan import) ───

-- Kolom-kolom ini seharusnya opsional saat import CSV
ALTER TABLE public.pegawai ALTER COLUMN jenis_kelamin DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN agama DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN no_ktp DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN tempat_lahir DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN tanggal_lahir DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN alamat_ktp DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN alamat_domisili DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN tanggal_bergabung DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN no_rekening DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN bank DROP NOT NULL;
ALTER TABLE public.pegawai ALTER COLUMN nama_rekening DROP NOT NULL;

-- ─── 3. Update CHECK constraint untuk status (tambah 'Training') ───
ALTER TABLE public.pegawai DROP CONSTRAINT IF EXISTS pegawai_status_check;
ALTER TABLE public.pegawai ADD CONSTRAINT pegawai_status_check CHECK (
  status::text = ANY (ARRAY['Aktif', 'Tidak Aktif', 'Cuti', 'Training']::text[])
);
