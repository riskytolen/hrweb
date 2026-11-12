import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeRoute, routeJson } from "@/lib/route-in-out-auth";
export const dynamic = "force-dynamic";
type Context = {params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Context) {
  const auth = await authorizeRoute("view");
  if (!auth.ok) return auth.response;
  const {id} = await params;
  const db = createAdminClient();
  const {data,error} = await db.from("route_in_out_imports").select("storage_path,file_name").eq("id",id).is("deleted_at",null).maybeSingle();
  if (error || !data) return routeJson({error:"Riwayat tidak ditemukan."},404);
  const signed = await db.storage.from("route-in-out-files").createSignedUrl(data.storage_path,120,{download:data.file_name});
  if (signed.error) return routeJson({error:"Gagal membuka file."},500);
  return routeJson({url:signed.data.signedUrl});
}
export async function DELETE(_request:Request,{params}:Context) {
  const auth = await authorizeRoute("edit");
  if (!auth.ok) return auth.response;
  const {id} = await params;
  const {data,error} = await createAdminClient().from("route_in_out_imports").update({deleted_at:new Date().toISOString(),deleted_by:auth.userId}).eq("id",id).is("deleted_at",null).select("id").maybeSingle();
  if (error) return routeJson({error:"Gagal menghapus riwayat."},500);
  if (!data) return routeJson({error:"Riwayat tidak ditemukan."},404);
  return routeJson({ok:true});
}
