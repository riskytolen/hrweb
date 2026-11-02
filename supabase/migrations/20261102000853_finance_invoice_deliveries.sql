-- Operational records remain independent of accounting period locks.
-- Applied via MCP; timestamp matches remote migration history.
CREATE TABLE public.finance_invoice_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 invoice_id bigint NOT NULL REFERENCES public.finance_invoices(id) ON DELETE RESTRICT,
 attempt integer NOT NULL CHECK (attempt > 0),
 status text NOT NULL CHECK (status IN ('Pending','Terkirim','Ditolak','Revisi')),
 sent_at timestamptz NOT NULL,
 method text NOT NULL CHECK (method IN ('Lalamove','Tim JAMS','Lainnya')),
 sender text NOT NULL CHECK (length(btrim(sender)) BETWEEN 1 AND 200),
 recipient text NOT NULL DEFAULT '', proof_path text, notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1, actor_name text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(invoice_id, attempt),
 CHECK (status <> 'Terkirim' OR (btrim(recipient) <> '' AND proof_path IS NOT NULL)),
 CHECK (status NOT IN ('Ditolak','Revisi') OR btrim(notes) <> '')
);
CREATE TABLE public.finance_invoice_delivery_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 delivery_id bigint NOT NULL REFERENCES public.finance_invoice_deliveries(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE, actor_id uuid NOT NULL,
 actor_name text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.finance_invoice_delivery_events(delivery_id, id DESC);
CREATE INDEX ON public.finance_invoice_deliveries(sent_at DESC);
CREATE INDEX ON public.finance_invoice_deliveries(status);
ALTER TABLE public.finance_invoice_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_invoice_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_invoice_deliveries, public.finance_invoice_delivery_events FROM anon, authenticated;
GRANT SELECT ON public.finance_invoice_deliveries, public.finance_invoice_delivery_events TO authenticated;
CREATE POLICY delivery_read ON public.finance_invoice_deliveries FOR SELECT TO authenticated
 USING ((SELECT public.finance_internal_active()) AND (SELECT public.has_app_permission('finance', true)));
CREATE POLICY delivery_events_read ON public.finance_invoice_delivery_events FOR SELECT TO authenticated
 USING ((SELECT public.finance_internal_active()) AND (SELECT public.has_app_permission('finance', true)));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('finance-invoice-delivery-proofs','finance-invoice-delivery-proofs',false,5242880,ARRAY['image/jpeg','image/png','image/webp']);
CREATE POLICY delivery_photo_read ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id = 'finance-invoice-delivery-proofs' AND (SELECT public.finance_internal_active())
 AND (SELECT public.has_app_permission('finance',true)));
CREATE POLICY delivery_photo_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
 bucket_id = 'finance-invoice-delivery-proofs' AND (SELECT public.finance_internal_active())
 AND ((SELECT public.has_app_permission('finance')) OR (SELECT public.has_app_permission('finance.input')))
 AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
 AND EXISTS (SELECT 1 FROM public.finance_invoices i WHERE i.id::text = (storage.foldername(name))[2]));
-- Evidence has no overwrite/delete policy so history remains readable.
CREATE FUNCTION public.save_finance_invoice_delivery(
 p_invoice_id bigint, p_expected_version integer, p_expected_attempt integer, p_new_attempt boolean, p_request_id uuid, p_data jsonb
) RETURNS public.finance_invoice_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v public.finance_invoice_deliveries; e public.finance_invoice_delivery_events;
 n text; old_snapshot jsonb; photo text := nullif(p_data->>'proof_path','');
BEGIN
 IF auth.uid() IS NULL OR NOT public.finance_internal_active() OR NOT (
 public.has_app_permission('finance') OR public.has_app_permission('finance.input')) THEN
 RAISE EXCEPTION 'Tidak memiliki akses input Finance'; END IF;
 IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_attempt IS NULL OR p_new_attempt IS NULL THEN
 RAISE EXCEPTION 'Parameter pengiriman tidak lengkap'; END IF;
 PERFORM pg_advisory_xact_lock(p_invoice_id);
 SELECT * INTO e FROM public.finance_invoice_delivery_events WHERE request_id=p_request_id;
 IF FOUND THEN
   IF e.actor_id <> auth.uid() OR (e.snapshot->>'invoice_id')::bigint <> p_invoice_id THEN RAISE EXCEPTION 'Request tidak sesuai'; END IF;
   SELECT * INTO v FROM public.finance_invoice_deliveries WHERE id=e.delivery_id;
   RETURN v;
 END IF;
 PERFORM 1 FROM public.finance_invoices WHERE id=p_invoice_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan'; END IF;
 SELECT * INTO v FROM public.finance_invoice_deliveries WHERE invoice_id=p_invoice_id ORDER BY attempt DESC LIMIT 1 FOR UPDATE;
 old_snapshot := CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END;
 IF coalesce(v.version,0) <> p_expected_version OR coalesce(v.attempt,0) <> p_expected_attempt THEN RAISE EXCEPTION 'Data berubah. Tutup form dan muat ulang.'; END IF;
 IF p_new_attempt AND v.id IS NOT NULL AND v.status NOT IN ('Ditolak','Revisi') THEN
 RAISE EXCEPTION 'Pengiriman berikutnya hanya setelah Ditolak atau Revisi'; END IF;
 IF NOT p_new_attempt AND v.status='Terkirim' AND NOT public.has_app_permission('finance') THEN
 RAISE EXCEPTION 'Koreksi pengiriman selesai memerlukan akses edit Finance'; END IF;
 IF p_data->>'status' NOT IN ('Pending','Terkirim','Ditolak','Revisi') OR p_data->>'status' IS NULL
 OR p_data->>'method' NOT IN ('Lalamove','Tim JAMS','Lainnya') OR p_data->>'method' IS NULL
 OR nullif(btrim(p_data->>'sender'),'') IS NULL OR nullif(p_data->>'sent_at','') IS NULL THEN
 RAISE EXCEPTION 'Lengkapi status, tanggal, metode, dan nama pengirim'; END IF;
 IF length(coalesce(p_data->>'notes','')) > 2000 OR length(coalesce(p_data->>'recipient','')) > 200 THEN RAISE EXCEPTION 'Catatan atau penerima terlalu panjang'; END IF;
 IF photo IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM storage.objects o WHERE o.bucket_id='finance-invoice-delivery-proofs' AND o.name=photo
 AND (storage.foldername(o.name))[2]=p_invoice_id::text
 AND ((storage.foldername(o.name))[1]=auth.uid()::text OR (NOT p_new_attempt AND photo=v.proof_path))
 ) THEN RAISE EXCEPTION 'Foto bukti tidak valid'; END IF;
 IF p_data->>'status'='Terkirim' AND (photo IS NULL OR nullif(btrim(p_data->>'recipient'),'') IS NULL) THEN RAISE EXCEPTION 'Nama penerima dan foto wajib untuk Terkirim'; END IF;
 IF p_data->>'status' IN ('Ditolak','Revisi') AND nullif(btrim(p_data->>'notes'),'') IS NULL THEN RAISE EXCEPTION 'Alasan wajib diisi'; END IF;
 SELECT nama INTO n FROM public.user_profiles WHERE id=auth.uid();
 IF p_new_attempt AND photo IS NOT NULL AND EXISTS (SELECT 1 FROM public.finance_invoice_delivery_events WHERE snapshot->>'proof_path'=photo) THEN RAISE EXCEPTION 'Pengiriman berikutnya memerlukan foto baru'; END IF;
 IF v.id IS NULL OR p_new_attempt THEN
 INSERT INTO public.finance_invoice_deliveries(invoice_id,attempt,status,sent_at,method,sender,recipient,proof_path,notes,actor_name)
 VALUES(p_invoice_id,coalesce(v.attempt,0)+1,p_data->>'status',(p_data->>'sent_at')::timestamptz,p_data->>'method',btrim(p_data->>'sender'),coalesce(btrim(p_data->>'recipient'),''),photo,coalesce(p_data->>'notes',''),n) RETURNING * INTO v;
 ELSE
 UPDATE public.finance_invoice_deliveries SET status=p_data->>'status',sent_at=(p_data->>'sent_at')::timestamptz,
 method=p_data->>'method',sender=btrim(p_data->>'sender'),recipient=coalesce(btrim(p_data->>'recipient'),''),
 proof_path=photo,notes=coalesce(p_data->>'notes',''),actor_name=n,updated_at=now(),version=version+1 WHERE id=v.id RETURNING * INTO v;
 END IF;
 INSERT INTO public.finance_invoice_delivery_events(delivery_id,request_id,actor_id,actor_name,snapshot) VALUES(v.id,p_request_id,auth.uid(),n,to_jsonb(v));
 INSERT INTO public.audit_logs(user_id,user_email,user_nama,action,entity_type,entity_id,entity_label,old_data,new_data)
 SELECT auth.uid(),up.email,n,'status_change','finance_invoice_deliveries',v.id::text,i.invoice_no,old_snapshot,to_jsonb(v)
 FROM public.user_profiles up CROSS JOIN public.finance_invoices i WHERE up.id=auth.uid() AND i.id=p_invoice_id;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.save_finance_invoice_delivery(bigint,integer,integer,boolean,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_finance_invoice_delivery(bigint,integer,integer,boolean,uuid,jsonb) TO authenticated;
