-- Integration verification against existing Finance fixtures. All writes roll back.
-- Run as postgres. Requires one active internal admin and an invoice without deliveries.
BEGIN;
DO $$
DECLARE
 u uuid; rid bigint; inv bigint; r public.finance_invoice_deliveries;
 repeated public.finance_invoice_deliveries; req uuid := gen_random_uuid();
 payload jsonb; failed boolean; path text; original_invoice jsonb; count_before bigint;
BEGIN
 SELECT up.id,up.role_id INTO u,rid FROM public.user_profiles up
 JOIN public.roles ro ON ro.id=up.role_id
 WHERE up.status='Aktif' AND ro.status='Aktif' AND up.account_type='internal'
 AND ro.permissions ? 'all' LIMIT 1;
 SELECT i.id,to_jsonb(i) INTO inv,original_invoice FROM public.finance_invoices i
 WHERE NOT EXISTS (SELECT 1 FROM public.finance_invoice_deliveries d WHERE d.invoice_id=i.id)
 ORDER BY i.invoice_date LIMIT 1;
 IF u IS NULL OR inv IS NULL THEN RAISE EXCEPTION 'Missing test fixtures'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 payload := jsonb_build_object('status','Pending','sent_at',now(),'method','Tim JAMS','sender','Verification rollback');
 SELECT count(*) INTO count_before FROM public.finance_invoice_delivery_events;
 r := public.save_finance_invoice_delivery(inv,0,0,false,req,payload);
 IF r.attempt<>1 OR r.version<>1 THEN RAISE EXCEPTION 'Initial attempt failed'; END IF;
 repeated := public.save_finance_invoice_delivery(inv,0,0,false,req,payload);
 IF repeated.id<>r.id OR (SELECT count(*) FROM public.finance_invoice_delivery_events)<>count_before+1 THEN
 RAISE EXCEPTION 'Idempotency failed'; END IF;

 failed := false;
 BEGIN
 PERFORM public.save_finance_invoice_delivery(inv,1,1,false,gen_random_uuid(),payload||'{"status":"Terkirim"}'::jsonb);
 EXCEPTION WHEN OTHERS THEN
 IF SQLERRM LIKE '%penerima%' THEN failed:=true; ELSE RAISE; END IF;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Missing evidence accepted'; END IF;

 failed := false;
 BEGIN
 PERFORM public.save_finance_invoice_delivery(inv,1,1,true,gen_random_uuid(),payload);
 EXCEPTION WHEN OTHERS THEN
 IF SQLERRM LIKE '%berikutnya%' THEN failed:=true; ELSE RAISE; END IF;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Invalid next attempt accepted'; END IF;

 r := public.save_finance_invoice_delivery(inv,1,1,false,gen_random_uuid(),payload||'{"status":"Revisi","notes":"Alamat diperbaiki"}'::jsonb);
 r := public.save_finance_invoice_delivery(inv,2,1,true,gen_random_uuid(),payload);
 IF r.attempt<>2 OR r.version<>1 THEN RAISE EXCEPTION 'Next attempt failed'; END IF;
 failed:=false;
 BEGIN
 PERFORM public.save_finance_invoice_delivery(inv,1,1,false,gen_random_uuid(),payload);
 EXCEPTION WHEN OTHERS THEN
 IF SQLERRM LIKE '%Data berubah%' THEN failed:=true; ELSE RAISE; END IF;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Stale attempt accepted'; END IF;

 UPDATE public.roles SET permissions='["finance.view"]'::jsonb WHERE id=rid;
 failed:=false;
 BEGIN
 PERFORM public.save_finance_invoice_delivery(inv,1,2,false,gen_random_uuid(),payload);
 EXCEPTION WHEN OTHERS THEN
 IF SQLERRM LIKE '%akses input%' THEN failed:=true; ELSE RAISE; END IF;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Viewer write accepted'; END IF;
 UPDATE public.roles SET permissions='["finance.input"]'::jsonb WHERE id=rid;
 r := public.save_finance_invoice_delivery(inv,1,2,false,gen_random_uuid(),payload);
 IF r.version<>2 THEN RAISE EXCEPTION 'Input permission failed'; END IF;

 -- Storage metadata fixture only, no real uploaded file, rolled back below.
 path:=u::text||'/'||inv::text||'/'||gen_random_uuid()::text||'.jpg';
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 VALUES('finance-invoice-delivery-proofs',path,u::text,'{"mimetype":"image/jpeg","size":100}');
 payload:=payload||jsonb_build_object('status','Terkirim','recipient','Penerima test','proof_path',path);
 r := public.save_finance_invoice_delivery(inv,2,2,false,gen_random_uuid(),payload);
 IF r.status<>'Terkirim' OR r.proof_path<>path THEN RAISE EXCEPTION 'Delivered failed'; END IF;
 failed:=false;
 BEGIN
 PERFORM public.save_finance_invoice_delivery(inv,3,2,false,gen_random_uuid(),payload);
 EXCEPTION WHEN OTHERS THEN
 IF SQLERRM LIKE '%akses edit%' THEN failed:=true; ELSE RAISE; END IF;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Input corrected completed delivery'; END IF;
 IF (SELECT to_jsonb(i) FROM public.finance_invoices i WHERE id=inv) IS DISTINCT FROM original_invoice THEN
 RAISE EXCEPTION 'Accounting invoice was changed'; END IF;
 IF has_table_privilege('authenticated','public.finance_invoice_delivery_events','UPDATE') OR
 has_table_privilege('authenticated','public.finance_invoice_deliveries','INSERT') OR
 has_function_privilege('anon','public.save_finance_invoice_delivery(bigint,integer,integer,boolean,uuid,jsonb)','EXECUTE') THEN
 RAISE EXCEPTION 'Unexpected direct write or anonymous access'; END IF;
END $$;
ROLLBACK;
