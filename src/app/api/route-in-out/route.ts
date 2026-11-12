import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase-admin";
import { authorizeRoute, routeJson } from "@/lib/route-in-out-auth";
import { MAX_IMPORT_BYTES } from "@/lib/route-in-out";
import { readRouteFile } from "@/lib/route-in-out-file";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await authorizeRoute("view");
  if (!auth.ok) return auth.response;
  const db = createAdminClient();
  const all = [];
  for (let offset=0; ;offset+=100) {
    const {data,error} = await db.from("route_in_out_imports").select("id,file_name,created_at,rows,issues").is("deleted_at",null).order("created_at",{ascending:false}).order("id").range(offset,offset+99);
    if (error) return routeJson({error:"Gagal memuat riwayat."},500);
    all.push(...data);
    if (data.length<100) break;
  }
  return routeJson({data:all});
}
export async function POST(request: Request) {
  const auth = await authorizeRoute("input");
  if (!auth.ok) return auth.response;
  if (Number(request.headers.get("content-length")) > MAX_IMPORT_BYTES+65536) return routeJson({error:"Maksimal file 3 MB."},413);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/\.(xlsx|xls|csv)$/i.test(file.name) || file.size>MAX_IMPORT_BYTES || !file.size) return routeJson({error:"Gunakan Excel/CSV maksimal 3 MB."},400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const parsed = await readRouteFile(bytes,String(form.get("sheet") || ""));
    const sheetName = parsed.sheet;
    if (form.get("preview")==="true") return routeJson(parsed);
    const hash = createHash("sha256").update(bytes).update(`\0${sheetName}`).digest("hex");
    const db = createAdminClient();
    const { data: duplicate, error: lookupError } = await db.from("route_in_out_imports").select("id").eq("file_hash",hash).is("deleted_at",null).maybeSingle();
    if (lookupError) return routeJson({error:"Gagal memeriksa duplikasi."},500);
    if (duplicate) return routeJson({error:"File dan sheet ini sudah pernah disimpan."},409);
    const id = randomUUID(), path = `${id}/source.${file.name.split(".").pop()!.toLowerCase()}`;
    const {error:uploadError} = await db.storage.from("route-in-out-files").upload(path,bytes,{contentType:"application/octet-stream",upsert:false});
    if (uploadError) return routeJson({error:"Gagal menyimpan file asli."},500);
    const {error} = await db.from("route_in_out_imports").insert({id,file_name:file.name.slice(0,255),file_hash:hash,storage_path:path,sheet_name:sheetName,rows:parsed.rows,issues:parsed.issues,created_by:auth.userId});
    if (error) {
      await db.storage.from("route-in-out-files").remove([path]);
      return routeJson({error:error.code==="23505" ? "File sudah disimpan oleh pengguna lain." : "Gagal menyimpan hasil."},error.code==="23505"?409:500);
    }
    return routeJson({id},201);
  } catch (e) {
    return routeJson({error:e instanceof Error ? e.message : "File tidak dapat diproses."},400);
  }
}
