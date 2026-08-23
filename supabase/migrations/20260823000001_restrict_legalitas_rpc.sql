-- Harden Legalitas RPCs: revoke anon/public, keep authenticated + service_role

REVOKE ALL ON FUNCTION public.create_company_legal_document(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_legal_document(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_legal_document(bigint, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.create_company_legal_document_version(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_legal_document_version(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_legal_document_version(bigint, text) TO service_role;
