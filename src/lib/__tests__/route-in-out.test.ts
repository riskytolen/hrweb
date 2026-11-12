import { describe, it, expect } from "vitest";
import { parseGrid, parseDate, summarize, selectRows, formatSeconds, routeAccess, type ImportData } from "../route-in-out";
import { readRouteFile } from "../route-in-out-file";
const header = ["Date","Address","Arrived","Departed","Detention","RUTE"];
const grid = [header,
  ["8/11/2026","Gudang","3:13","3:44","0:31:00","THERMO BOX 1"],
  ["8/11/2026","Toko","4:52","5:22","0:30:00","THERMO BOX 1"],
  ["8/11/2026","Finish","8:23","8:23","0:00:00","THERMO BOX 1"]];
describe("Rekap In-Out Unit",()=>{
  it("menghitung contoh 04:39 dan detention dari file",()=>{
    const parsed = parseGrid(grid);
    expect(parsed.issues).toEqual([]);
    const {units} = summarize(parsed.rows);
    expect(formatSeconds(units[0].duration)).toBe("04:39:00");
    expect(formatSeconds(units[0].detention)).toBe("01:01:00");
    expect(parsed.rows[0].date).toBe("2026-11-08");
  });
  it("tanggal invalid ditolak, baris kosong dilewati dan unit tidak dibatasi",()=>{
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseGrid([header,[],...[1,12,99].map(n=>["8/11/2026","Toko","3:00","4:00","1:00",`Unit ${n}`])]).rows).toHaveLength(3);
    expect(()=>parseGrid([header,["31/02/2026","Toko","3:00","4:00","1:00","Unit"]])).toThrow();
  });
  it("lintas tengah malam dan rata-rata tidak menjadi siang hari",()=>{
    const p = parseGrid([header,["8/11/2026","Start","23:45","23:55","0:10","U"],["8/11/2026","Finish","00:55","01:00","0:05","U"],["9/11/2026","Start","00:00","00:05","0:05","U"],["9/11/2026","Finish","01:05","01:05","0:00","U"]]);
    const result = summarize(p.rows);
    expect(formatSeconds(result.units[0].duration)).toBe("01:00:00");
    expect(formatSeconds(result.units[0].start,true)).toBe("00:00:00");
  });
  it("jam kosong tidak dianggap nol, selisih detention dilaporkan",()=>{
    const p = parseGrid([header,["8/11/2026","Start","3:00","","1:00","U"],["8/11/2026","Finish","4:00","4:10","0:20","U"]]);
    expect(p.issues.length).toBe(2);
    expect(summarize(p.rows).units[0].validTrips).toBe(0);
    expect(summarize(p.rows).units[0].duration).toBeNull();
  });
  it("unggahan terbaru mengganti seluruh trip tanpa menghitung dua kali",()=>{
    const rows = parseGrid(grid).rows;
    const old:ImportData = {id:"old",created_at:"2026-11-08",file_name:"a",rows,issues:[]};
    const fresh:ImportData = {...old,id:"new",created_at:"2026-11-09",rows:rows.slice(0,2)};
    expect(selectRows([old,fresh])).toHaveLength(2);
    expect(selectRows([old,fresh],"","","","old")).toHaveLength(3);
    expect(selectRows([old],"2026-11-09")).toHaveLength(0);
  });
  it("CSV DD/MM tetap 8 November dan alamat berkoma tetap utuh",async()=>{
    const csv = 'Date,Address,Arrived,Departed,Detention,RUTE\n8/11/2026,"Toko, Jakarta",03:13,03:44,00:31:00,U';
    const p = await readRouteFile(new TextEncoder().encode(csv));
    expect(p.rows[0].date).toBe("2026-11-08");
    expect(p.rows[0].address).toBe("Toko, Jakarta");
  });
  it("Excel serial tanggal dan waktu serta pilihan sheet",async()=>{
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Petunjuk penggunaan"]]),"Petunjuk");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([header,[46334,"Toko",0.25,0.5,0.25,"U"]]),"Data");
    const p = await readRouteFile(new Uint8Array(XLSX.write(wb,{type:"array",bookType:"xlsx"})));
    expect(p.sheet).toBe("Data");
    expect(p.rows[0].arrived).toBe(21600);
    expect(p.rows[0].date).toBe(parseDate(46334));
  });
  it("permission lihat/input/edit terpisah dan eksternal ditolak",()=>{
    expect(routeAccess(["route-in-out.view"],"internal","input")).toBe(false);
    expect(routeAccess(["route-in-out.input"],"internal","edit")).toBe(false);
    expect(routeAccess(["route-in-out.input"],"internal","view")).toBe(true);
    expect(routeAccess(["route-in-out"],"internal","edit")).toBe(true);
    expect(routeAccess(["all"],"external","view")).toBe(false);
    expect(routeAccess(["tms"],"internal","view")).toBe(false);
  });
});
