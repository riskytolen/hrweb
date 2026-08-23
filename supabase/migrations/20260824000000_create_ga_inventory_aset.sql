-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: GA Inventory Aset (General Affair)
-- - Master: categories (prefix + sequence), locations
-- - Core: assets (kode per kategori, harga/tanggal, foto)
-- - History: assignments (penanggung jawab, divisi, lokasi)
-- - RLS view/input/edit via inventory-aset + has_app_permission
-- - RPC atomik untuk kode + transfer/return
-- - Bucket privat untuk foto aset
-- ═══════════════════════════════════════════════════════════════

-- Dibutuhkan oleh indeks pencarian trigram di tabel aset.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ──────────────────────────────────────────
-- Helper: updated_at trigger (reuse if exists)
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────
-- 1. Categories
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ga_asset_categories (
  id bigserial PRIMARY KEY,
  nama text NOT NULL CHECK (char_length(btrim(nama)) BETWEEN 2 AND 120),
  kode_prefix text NOT NULL CHECK (kode_prefix ~ '^[A-Z0-9]{2,10}$'),
  deskripsi text,
  next_sequence integer NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  status text NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_ga_asset_categories_nama UNIQUE (nama),
  CONSTRAINT uq_ga_asset_categories_prefix UNIQUE (kode_prefix)
);

CREATE INDEX IF NOT EXISTS idx_ga_asset_categories_status ON public.ga_asset_categories(status);
CREATE INDEX IF NOT EXISTS idx_ga_asset_categories_sort ON public.ga_asset_categories(sort_order);

DROP TRIGGER IF EXISTS ga_asset_categories_updated_at ON public.ga_asset_categories;
CREATE TRIGGER ga_asset_categories_updated_at
  BEFORE UPDATE ON public.ga_asset_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ga_asset_categories (nama, kode_prefix, deskripsi, sort_order, status)
VALUES
  ('Elektronik', 'EL', 'Laptop, PC, printer, proyektor, dll', 1, 'Aktif'),
  ('Furniture', 'FR', 'Meja, kursi, lemari, rak', 2, 'Aktif'),
  ('Alat Kerja', 'AK', 'Perkakas dan alat operasional', 3, 'Aktif'),
  ('Kendaraan Non-Armada', 'KN', 'Aset kendaraan kecil bila diperlukan', 4, 'Aktif'),
  ('Lainnya', 'LL', 'Aset lain', 99, 'Aktif')
ON CONFLICT (nama) DO NOTHING;

-- ──────────────────────────────────────────
-- 2. Locations
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ga_asset_locations (
  id bigserial PRIMARY KEY,
  nama text NOT NULL CHECK (char_length(btrim(nama)) BETWEEN 2 AND 150),
  alamat text,
  keterangan text,
  status text NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_ga_asset_locations_nama UNIQUE (nama)
);

CREATE INDEX IF NOT EXISTS idx_ga_asset_locations_status ON public.ga_asset_locations(status);
CREATE INDEX IF NOT EXISTS idx_ga_asset_locations_sort ON public.ga_asset_locations(sort_order);

DROP TRIGGER IF EXISTS ga_asset_locations_updated_at ON public.ga_asset_locations;
CREATE TRIGGER ga_asset_locations_updated_at
  BEFORE UPDATE ON public.ga_asset_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ga_asset_locations (nama, keterangan, sort_order, status)
VALUES
  ('Kantor Pusat', 'Lokasi utama perusahaan', 1, 'Aktif'),
  ('Gudang GA', 'Penyimpanan aset General Affair', 2, 'Aktif'),
  ('Ruang Operasional', 'Ruang kerja operasional', 3, 'Aktif')
ON CONFLICT (nama) DO NOTHING;

-- ──────────────────────────────────────────
-- 3. Assets
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ga_assets (
  id bigserial PRIMARY KEY,
  kode_aset text NOT NULL,
  nama_aset text NOT NULL CHECK (char_length(btrim(nama_aset)) BETWEEN 2 AND 200),
  category_id bigint NOT NULL REFERENCES public.ga_asset_categories(id) ON DELETE RESTRICT,
  merek text,
  model text,
  serial_number text,
  spesifikasi text,
  tanggal_beli date,
  harga_beli numeric(14,2),
  kondisi text NOT NULL DEFAULT 'Baik' CHECK (kondisi IN ('Baik', 'Rusak Ringan', 'Rusak Berat')),
  status text NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Rusak', 'Tidak Aktif')),
  lokasi_id bigint REFERENCES public.ga_asset_locations(id) ON DELETE SET NULL,
  foto_url text,
  foto_path text,
  catatan text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ga_assets_kode UNIQUE (kode_aset),
  CONSTRAINT chk_ga_assets_harga CHECK (harga_beli IS NULL OR harga_beli >= 0),
  CONSTRAINT chk_ga_assets_tanggal CHECK (tanggal_beli IS NULL OR tanggal_beli <= CURRENT_DATE + INTERVAL '1 day')
);

CREATE INDEX IF NOT EXISTS idx_ga_assets_category ON public.ga_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_ga_assets_status ON public.ga_assets(status);
CREATE INDEX IF NOT EXISTS idx_ga_assets_kondisi ON public.ga_assets(kondisi);
CREATE INDEX IF NOT EXISTS idx_ga_assets_lokasi ON public.ga_assets(lokasi_id);
CREATE INDEX IF NOT EXISTS idx_ga_assets_nama_trgm ON public.ga_assets USING gin (nama_aset gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ga_assets_kode_trgm ON public.ga_assets USING gin (kode_aset gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ga_assets_serial_trgm ON public.ga_assets USING gin (serial_number gin_trgm_ops);

DROP TRIGGER IF EXISTS ga_assets_updated_at ON public.ga_assets;
CREATE TRIGGER ga_assets_updated_at
  BEFORE UPDATE ON public.ga_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────
-- 4. Assignments (riwayat serah terima)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ga_asset_assignments (
  id bigserial PRIMARY KEY,
  asset_id bigint NOT NULL REFERENCES public.ga_assets(id) ON DELETE CASCADE,
  pegawai_id text REFERENCES public.pegawai(id) ON DELETE SET NULL,
  pegawai_nama text,
  division_id bigint REFERENCES public.divisions(id) ON DELETE SET NULL,
  divisi_nama text,
  lokasi_id bigint REFERENCES public.ga_asset_locations(id) ON DELETE SET NULL,
  lokasi_nama text,
  tanggal_serah date NOT NULL DEFAULT CURRENT_DATE,
  tanggal_kembali date,
  status text NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Selesai')),
  catatan text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ga_asset_assignments_tanggal CHECK (tanggal_kembali IS NULL OR tanggal_kembali >= tanggal_serah)
);

CREATE INDEX IF NOT EXISTS idx_ga_asset_assignments_asset ON public.ga_asset_assignments(asset_id);
CREATE INDEX IF NOT EXISTS idx_ga_asset_assignments_pegawai ON public.ga_asset_assignments(pegawai_id);
CREATE INDEX IF NOT EXISTS idx_ga_asset_assignments_division ON public.ga_asset_assignments(division_id);
CREATE INDEX IF NOT EXISTS idx_ga_asset_assignments_lokasi ON public.ga_asset_assignments(lokasi_id);
CREATE INDEX IF NOT EXISTS idx_ga_asset_assignments_status ON public.ga_asset_assignments(status);
CREATE INDEX IF NOT EXISTS idx_ga_asset_assignments_asset_status ON public.ga_asset_assignments(asset_id, status);

-- Hanya satu penempatan aktif per aset
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_asset_assignments_one_active_per_asset
  ON public.ga_asset_assignments(asset_id)
  WHERE status = 'Aktif';

DROP TRIGGER IF EXISTS ga_asset_assignments_updated_at ON public.ga_asset_assignments;
CREATE TRIGGER ga_asset_assignments_updated_at
  BEFORE UPDATE ON public.ga_asset_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────
-- 5. RLS
-- ──────────────────────────────────────────
ALTER TABLE public.ga_asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_asset_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_asset_assignments ENABLE ROW LEVEL SECURITY;

-- Categories
DROP POLICY IF EXISTS auth_select_ga_asset_categories ON public.ga_asset_categories;
DROP POLICY IF EXISTS auth_insert_ga_asset_categories ON public.ga_asset_categories;
DROP POLICY IF EXISTS auth_update_ga_asset_categories ON public.ga_asset_categories;
DROP POLICY IF EXISTS auth_delete_ga_asset_categories ON public.ga_asset_categories;

CREATE POLICY auth_select_ga_asset_categories
  ON public.ga_asset_categories FOR SELECT TO authenticated
  USING (public.has_app_permission('inventory-aset', true));

CREATE POLICY auth_insert_ga_asset_categories
  ON public.ga_asset_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('inventory-aset'));

CREATE POLICY auth_update_ga_asset_categories
  ON public.ga_asset_categories FOR UPDATE TO authenticated
  USING (public.has_app_permission('inventory-aset'))
  WITH CHECK (public.has_app_permission('inventory-aset'));

CREATE POLICY auth_delete_ga_asset_categories
  ON public.ga_asset_categories FOR DELETE TO authenticated
  USING (public.has_app_permission('inventory-aset'));

-- Locations
DROP POLICY IF EXISTS auth_select_ga_asset_locations ON public.ga_asset_locations;
DROP POLICY IF EXISTS auth_insert_ga_asset_locations ON public.ga_asset_locations;
DROP POLICY IF EXISTS auth_update_ga_asset_locations ON public.ga_asset_locations;
DROP POLICY IF EXISTS auth_delete_ga_asset_locations ON public.ga_asset_locations;

CREATE POLICY auth_select_ga_asset_locations
  ON public.ga_asset_locations FOR SELECT TO authenticated
  USING (public.has_app_permission('inventory-aset', true));

CREATE POLICY auth_insert_ga_asset_locations
  ON public.ga_asset_locations FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('inventory-aset'));

CREATE POLICY auth_update_ga_asset_locations
  ON public.ga_asset_locations FOR UPDATE TO authenticated
  USING (public.has_app_permission('inventory-aset'))
  WITH CHECK (public.has_app_permission('inventory-aset'));

CREATE POLICY auth_delete_ga_asset_locations
  ON public.ga_asset_locations FOR DELETE TO authenticated
  USING (public.has_app_permission('inventory-aset'));

-- Assets: view = view/input/edit ; insert = input/edit ; update/delete = edit
DROP POLICY IF EXISTS auth_select_ga_assets ON public.ga_assets;
DROP POLICY IF EXISTS auth_insert_ga_assets ON public.ga_assets;
DROP POLICY IF EXISTS auth_update_ga_assets ON public.ga_assets;
DROP POLICY IF EXISTS auth_delete_ga_assets ON public.ga_assets;

CREATE POLICY auth_select_ga_assets
  ON public.ga_assets FOR SELECT TO authenticated
  USING (public.has_app_permission('inventory-aset', true));

CREATE POLICY auth_insert_ga_assets
  ON public.ga_assets FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'inventory-aset' OR r.permissions ? 'inventory-aset.input')
    )
  );

CREATE POLICY auth_update_ga_assets
  ON public.ga_assets FOR UPDATE TO authenticated
  USING (public.has_app_permission('inventory-aset'))
  WITH CHECK (public.has_app_permission('inventory-aset'));

CREATE POLICY auth_delete_ga_assets
  ON public.ga_assets FOR DELETE TO authenticated
  USING (public.has_app_permission('inventory-aset'));

-- Assignments: view = view/input/edit ; insert/update = edit ; delete = edit
DROP POLICY IF EXISTS auth_select_ga_asset_assignments ON public.ga_asset_assignments;
DROP POLICY IF EXISTS auth_insert_ga_asset_assignments ON public.ga_asset_assignments;
DROP POLICY IF EXISTS auth_update_ga_asset_assignments ON public.ga_asset_assignments;
DROP POLICY IF EXISTS auth_delete_ga_asset_assignments ON public.ga_asset_assignments;

CREATE POLICY auth_select_ga_asset_assignments
  ON public.ga_asset_assignments FOR SELECT TO authenticated
  USING (public.has_app_permission('inventory-aset', true));

CREATE POLICY auth_insert_ga_asset_assignments
  ON public.ga_asset_assignments FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('inventory-aset'));

CREATE POLICY auth_update_ga_asset_assignments
  ON public.ga_asset_assignments FOR UPDATE TO authenticated
  USING (public.has_app_permission('inventory-aset'))
  WITH CHECK (public.has_app_permission('inventory-aset'));

CREATE POLICY auth_delete_ga_asset_assignments
  ON public.ga_asset_assignments FOR DELETE TO authenticated
  USING (public.has_app_permission('inventory-aset'));

-- ──────────────────────────────────────────
-- 6. Storage bucket privat foto aset
-- ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ga-asset-photos',
  'ga-asset-photos',
  false,
  5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp'];

DROP POLICY IF EXISTS auth_select_ga_asset_photos ON storage.objects;
DROP POLICY IF EXISTS auth_insert_ga_asset_photos ON storage.objects;
DROP POLICY IF EXISTS auth_update_ga_asset_photos ON storage.objects;
DROP POLICY IF EXISTS auth_delete_ga_asset_photos ON storage.objects;

CREATE POLICY auth_select_ga_asset_photos
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ga-asset-photos' AND public.has_app_permission('inventory-aset', true));

CREATE POLICY auth_insert_ga_asset_photos
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ga-asset-photos'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'inventory-aset' OR r.permissions ? 'inventory-aset.input')
    )
  );

CREATE POLICY auth_update_ga_asset_photos
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ga-asset-photos' AND public.has_app_permission('inventory-aset'))
  WITH CHECK (bucket_id = 'ga-asset-photos' AND public.has_app_permission('inventory-aset'));

CREATE POLICY auth_delete_ga_asset_photos
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ga-asset-photos' AND public.has_app_permission('inventory-aset'));

-- ──────────────────────────────────────────
-- 7. RPC: kode aset + transfer/return
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_ga_asset_code(p_category_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_seq integer;
  v_code text;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND up.status='Aktif' AND r.status='Aktif'
        AND (r.permissions ? 'all' OR r.permissions ? 'inventory-aset' OR r.permissions ? 'inventory-aset.input')
    )
  ) THEN
    RAISE EXCEPTION 'Tidak memiliki izin inventory-aset';
  END IF;

  SELECT kode_prefix, next_sequence INTO v_prefix, v_seq
  FROM public.ga_asset_categories
  WHERE id = p_category_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Kategori aset tidak ditemukan'; END IF;
  IF v_seq IS NULL OR v_seq < 1 THEN v_seq := 1; END IF;

  v_code := v_prefix || '-' || lpad(v_seq::text, 4, '0');

  UPDATE public.ga_asset_categories
  SET next_sequence = v_seq + 1, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_category_id;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.next_ga_asset_code(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_ga_asset_code(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_ga_asset_code(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.transfer_ga_asset(
  p_asset_id bigint,
  p_pegawai_id text,
  p_division_id bigint,
  p_lokasi_id bigint,
  p_catatan text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_id bigint;
  v_pegawai_nama text;
  v_divisi_nama text;
  v_lokasi_nama text;
  v_status text;
BEGIN
  IF NOT public.has_app_permission('inventory-aset') THEN
    RAISE EXCEPTION 'Tidak memiliki izin inventory-aset';
  END IF;

  SELECT status INTO v_status FROM public.ga_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aset tidak ditemukan'; END IF;
  IF v_status = 'Tidak Aktif' THEN RAISE EXCEPTION 'Aset sudah tidak aktif'; END IF;

  IF p_pegawai_id IS NOT NULL THEN
    SELECT nama INTO v_pegawai_nama FROM public.pegawai WHERE id = p_pegawai_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pegawai tidak ditemukan'; END IF;
  END IF;

  IF p_division_id IS NOT NULL THEN
    SELECT nama INTO v_divisi_nama FROM public.divisions WHERE id = p_division_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Divisi tidak ditemukan'; END IF;
  END IF;

  IF p_lokasi_id IS NOT NULL THEN
    SELECT nama INTO v_lokasi_nama FROM public.ga_asset_locations WHERE id = p_lokasi_id AND status='Aktif';
    IF NOT FOUND THEN RAISE EXCEPTION 'Lokasi tidak valid'; END IF;
  ELSE
    RAISE EXCEPTION 'Lokasi wajib diisi';
  END IF;

  -- Tutup penempatan aktif sebelumnya bila ada
  UPDATE public.ga_asset_assignments
  SET status='Selesai', tanggal_kembali=CURRENT_DATE, updated_at=now()
  WHERE asset_id = p_asset_id AND status='Aktif';

  INSERT INTO public.ga_asset_assignments (
    asset_id, pegawai_id, pegawai_nama, division_id, divisi_nama, lokasi_id, lokasi_nama, catatan, created_by
  ) VALUES (
    p_asset_id, p_pegawai_id, v_pegawai_nama, p_division_id, v_divisi_nama, p_lokasi_id, v_lokasi_nama,
    NULLIF(btrim(p_catatan), ''), auth.uid()
  ) RETURNING id INTO v_assignment_id;

  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_ga_asset(bigint, text, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_ga_asset(bigint, text, bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_ga_asset(bigint, text, bigint, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.return_ga_asset(
  p_asset_id bigint,
  p_catatan text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_app_permission('inventory-aset') THEN
    RAISE EXCEPTION 'Tidak memiliki izin inventory-aset';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ga_assets WHERE id = p_asset_id) THEN
    RAISE EXCEPTION 'Aset tidak ditemukan';
  END IF;

  UPDATE public.ga_asset_assignments
  SET status='Selesai', tanggal_kembali=CURRENT_DATE, updated_at=now(), catatan = COALESCE(NULLIF(btrim(p_catatan), ''), catatan)
  WHERE asset_id = p_asset_id AND status='Aktif';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tidak ada penempatan aktif untuk aset ini';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.return_ga_asset(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_ga_asset(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_ga_asset(bigint, text) TO service_role;

-- ──────────────────────────────────────────
-- 8. Tambah permission inventory-aset ke role GA/Umum
-- ──────────────────────────────────────────
UPDATE public.roles
SET permissions = (
  CASE WHEN NOT (permissions ? 'inventory-aset') THEN permissions || to_jsonb(ARRAY['inventory-aset']) ELSE permissions END
),
updated_at = now()
WHERE nama IN ('General Affair', 'Admin HR', 'Super Admin', 'Administrator')
  AND status = 'Aktif';

-- Fallback: bila role GA belum ada, tidak error (no-op).
