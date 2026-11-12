import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "./supabase-server";
import { parsePermissions } from "./permissions";
import { routeAccess } from "./route-in-out";
export const routeJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function authorizeRoute(action: "view" | "input" | "edit") {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false as const, response: routeJson({ error: "Silakan login kembali." },401) };
  const { data: profile } = await db.from("user_profiles").select("status, account_type, roles(status, permissions)").eq("id",user.id).single();
  const role = Array.isArray(profile?.roles) ? profile.roles[0] : profile?.roles;
  if (profile?.status !== "Aktif" || role?.status !== "Aktif" || !routeAccess(parsePermissions(role?.permissions),profile.account_type || "internal",action)) return { ok:false as const,response:routeJson({error:"Akses ditolak."},403) };
  return { ok:true as const,userId:user.id };
}
