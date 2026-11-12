import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({authorize:vi.fn(),admin:vi.fn()}));
vi.mock("@/lib/route-in-out-auth",()=>({
  authorizeRoute:mocks.authorize,
  routeJson:(body:unknown,status=200)=>Response.json(body,{status}),
}));
vi.mock("@/lib/supabase-admin",()=>({createAdminClient:mocks.admin}));
import { POST, GET } from "../route";
const csv = "Date,Address,Arrived,Departed,Detention,RUTE\n8/11/2026,Start,03:13,03:44,00:31:00,U\n8/11/2026,Finish,08:23,08:23,00:00:00,U";
function request(preview=true) {
  const body = new FormData();
  body.set("file",new File([csv],"test.csv"));body.set("preview",String(preview));
  return new Request("http://localhost/api/route-in-out",{method:"POST",body});
}
beforeEach(()=>{vi.clearAllMocks();mocks.authorize.mockResolvedValue({ok:true,userId:"test-user"});});
describe("route-in-out API",()=>{
  it("menolak akses sebelum membaca data atau file",async()=>{
    mocks.authorize.mockResolvedValue({ok:false,response:Response.json({error:"denied"},{status:403})});
    expect((await GET()).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("preview dihitung server dan tidak menyimpan file",async()=>{
    const response = await POST(request());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0].date).toBe("2026-11-08");
    expect(mocks.authorize).toHaveBeenCalledWith("input");
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("duplikat dihentikan sebelum upload",async()=>{
    const query = {select:vi.fn(),eq:vi.fn(),is:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:{id:"duplicate"},error:null})};
    query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.is.mockReturnValue(query);
    const storage = {from:vi.fn()};
    mocks.admin.mockReturnValue({from:()=>query,storage});
    expect((await POST(request(false))).status).toBe(409);
    expect(storage.from).not.toHaveBeenCalled();
  });
  it("ukuran berlebih ditolak sebelum parsing",async()=>{
    const response = await POST(new Request("http://localhost/api/route-in-out",{method:"POST",headers:{"content-length":"9999999"}}));
    expect(response.status).toBe(413);
  });
});
