ALTER TABLE public.legal_documents DROP CONSTRAINT IF EXISTS legal_documents_kategori_check;
ALTER TABLE public.legal_documents ADD CONSTRAINT legal_documents_kategori_check CHECK (
  kategori::text = ANY (ARRAY['PKWT', 'SP', 'PERNYATAAN']::text[])
);
