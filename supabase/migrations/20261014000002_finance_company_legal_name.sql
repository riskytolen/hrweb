-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Nama legal perusahaan untuk header invoice Finance
-- ───────────────────────────────────────────────────────────────
-- Profil Finance sebelumnya memakai nama pendek "Jamslogistic". Untuk
-- invoice fisik, header harus memakai nama legal perusahaan.
-- Kondisional agar tidak menimpa jika user sudah mengubah nama secara manual.
-- ═══════════════════════════════════════════════════════════════

UPDATE public.finance_company_settings
SET company_name = 'CV Jami Berkah Transindo'
WHERE id = 1
  AND trim(lower(company_name)) IN ('jamslogistic', 'jams logistics', 'jams logistics cv. jami berkah transindo');
