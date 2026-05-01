-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Auth Roles & User Profiles for Jamslogistic HRM
-- Jalankan SQL ini di Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Tabel roles
CREATE TABLE IF NOT EXISTS public.roles (
  id          SERIAL PRIMARY KEY,
  nama        TEXT NOT NULL UNIQUE,
  deskripsi   TEXT,
  level       INT NOT NULL DEFAULT 0,        -- semakin tinggi = semakin banyak akses
  permissions JSONB NOT NULL DEFAULT '[]',   -- array of permission strings
  status      TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabel user_profiles (linked ke auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  nama        TEXT NOT NULL,
  role_id     INT REFERENCES public.roles(id) ON DELETE SET NULL,
  employee_id TEXT REFERENCES public.pegawai(id) ON DELETE SET NULL,  -- opsional, link ke pegawai
  avatar_url  TEXT,
  status      TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Tidak Aktif')),
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Seed default roles
INSERT INTO public.roles (nama, deskripsi, level, permissions) VALUES
  ('Super Admin', 'Akses penuh ke seluruh sistem', 100, '["all"]'),
  ('Admin HR', 'Mengelola data pegawai, absensi, cuti, penggajian', 80, '["employees","attendance","leave","payroll","recruitment","income","performance","legal"]'),
  ('Manager', 'Melihat data tim dan approval', 60, '["employees.view","attendance.view","leave","payroll.view","performance","income.view"]'),
  ('Staff HR', 'Operasional HR harian', 40, '["employees","attendance","leave","recruitment"]'),
  ('Viewer', 'Hanya bisa melihat data', 10, '["employees.view","attendance.view","leave.view","payroll.view"]')
ON CONFLICT (nama) DO NOTHING;

-- 4. Trigger auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. RLS Policies
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Roles: semua authenticated user bisa baca
CREATE POLICY "Roles viewable by authenticated" ON public.roles
  FOR SELECT TO authenticated USING (true);

-- Roles: hanya superadmin (level >= 100) yang bisa insert/update/delete
CREATE POLICY "Roles manageable by superadmin" ON public.roles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND r.level >= 100
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND r.level >= 100
    )
  );

-- User profiles: user bisa lihat semua profil
CREATE POLICY "Profiles viewable by authenticated" ON public.user_profiles
  FOR SELECT TO authenticated USING (true);

-- User profiles: user bisa update profil sendiri
CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- User profiles: superadmin bisa manage semua
CREATE POLICY "Superadmin manages all profiles" ON public.user_profiles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND r.level >= 100
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      JOIN public.roles r ON r.id = up.role_id
      WHERE up.id = auth.uid() AND r.level >= 100
    )
  );

-- 6. Function: buat user baru (dipanggil dari client via supabase.rpc)
--    Ini menggunakan supabase admin API, jadi kita buat function helper
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, nama, role_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nama', split_part(NEW.email, '@', 1)),
    (SELECT id FROM public.roles WHERE nama = 'Viewer' LIMIT 1)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: auto-create profile saat user baru register
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════
-- SELESAI! Setelah menjalankan SQL ini:
-- 1. Buat user pertama (Super Admin) via Supabase Auth Dashboard
-- 2. Update role_id user tersebut di tabel user_profiles ke role Super Admin
-- ═══════════════════════════════════════════════════════════════
