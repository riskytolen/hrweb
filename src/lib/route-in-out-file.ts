import { MAX_IMPORT_ROWS, parseGrid } from "./route-in-out";

/** Keep CSV dates as text: Excel dates are serial numbers, CSV is DD/MM/YYYY. */
export async function readRouteFile(bytes: Uint8Array, requestedSheet = "") {
  const XLSX = await import("xlsx");
  const book = XLSX.read(bytes,{type:"array",raw:true,sheetRows:MAX_IMPORT_ROWS+20});
  const required = ["date", "address", "arrived", "departed", "detention", "rute"];
  const name = requestedSheet || book.SheetNames.find(candidate => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[candidate], {header:1, raw:true, defval:""});
    return rows.slice(0,10).some(row => required.every(h => row.some(v => String(v).trim().toLowerCase() === h)));
  }) || book.SheetNames[0];
  if (!book.SheetNames.includes(name)) throw new Error("Sheet tidak ditemukan.");
  const sheet = book.Sheets[name];
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
  if (range.e.r>MAX_IMPORT_ROWS+10 || range.e.c>100) throw new Error("File melebihi batas 20.000 baris / 101 kolom.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:""});
  if (book.Workbook?.WBProps?.date1904) {
    const header = grid.findIndex(row=>row.some(v=>String(v).trim().toLowerCase()==="date"));
    if(header>=0) {
      const column = grid[header].findIndex(v=>String(v).trim().toLowerCase()==="date");
      for(const row of grid.slice(header+1)) if(typeof row[column]==="number") row[column]=(row[column] as number)+1462;
    }
  }
  return {...parseGrid(grid), sheets:book.SheetNames, sheet:name};
}
