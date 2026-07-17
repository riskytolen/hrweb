export interface HistoryCopyRow {
  id: number;
  employee_id: string | null;
  employee_nama: string | null;
  zone_id: number;
  role: "Driver" | "Helper";
}

export interface HistoryRowItem {
  id: number;
  employee_id: string | null;
  employee_nama_snapshot: string | null;
  current_employee_nama: string | null;
  role: "Driver" | "Helper";
  zone_id: number;
  eligible: boolean;
  ineligible_reason?: string;
  in_worksheet: boolean;
  in_target_db: boolean;
  selected: boolean;
}

export interface HistoryZoneGroup {
  zone_id: number;
  zone_nama: string;
  zone_status: string;
  rows: HistoryRowItem[];
  selected: boolean;
}

export function groupByZone(
  historyRows: HistoryCopyRow[],
  employees: { id: string; nama: string; status: string }[],
  zones: { id: number; nama: string }[],
  existingBatchKeys: Set<string>,
  existingDbKeys: Set<string>,
): HistoryZoneGroup[] {
  const zoneMap = new Map<number, HistoryZoneGroup>();
  const seenKeys = new Set<string>();

  for (const row of historyRows) {
    const dedupKey = `${row.employee_id || "null"}-${row.zone_id}-${row.role}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    const employee = employees.find((e) => e.id === row.employee_id) ?? null;
    const zone = zones.find((z) => z.id === row.zone_id) ?? null;
    const batchKey = dedupKey;
    const inWs = existingBatchKeys.has(batchKey);
    const inDb = existingDbKeys.has(batchKey);

    let eligible = true;
    let reason: string | undefined;

    if (!row.employee_id) {
      eligible = false;
      reason = "Pegawai sudah dihapus";
    } else if (!employee) {
      eligible = false;
      reason = "Pegawai tidak ditemukan di master data";
    } else if (employee.status !== "Aktif" && employee.status !== "Training") {
      eligible = false;
      reason = `Pegawai berstatus ${employee.status}`;
    }

    if (!zone && eligible) {
      eligible = false;
      reason = "Nama Titik sudah tidak aktif";
    }

    const zoneNama = zone?.nama ?? "(Tidak Aktif)";
    const zoneStatus = zone ? "Aktif" : "Tidak Aktif";

    const zg = zoneMap.get(row.zone_id) ?? {
      zone_id: row.zone_id,
      zone_nama: zoneNama,
      zone_status: zoneStatus,
      rows: [],
      selected: false,
    };
    zg.rows.push({
      id: row.id,
      employee_id: row.employee_id,
      employee_nama_snapshot: row.employee_nama,
      current_employee_nama: employee?.nama ?? null,
      role: row.role,
      zone_id: row.zone_id,
      eligible,
      ineligible_reason: eligible ? undefined : reason,
      in_worksheet: inWs,
      in_target_db: inDb,
      selected: false,
    });
    zoneMap.set(row.zone_id, zg);
  }

  return Array.from(zoneMap.values()).sort((a, b) => a.zone_nama.localeCompare(b.zone_nama));
}

export function duplicateKey(employee_id: string | null, zone_id: number, role: string): string {
  return `${employee_id || "null"}-${zone_id}-${role}`;
}

export function mergeIntoWorksheet(
  batchRows: { rowKey: string; employee_id: string | null; nama: string; zone_id: number; role: string; jumlah_titik: string; catatan: string; status_id: number }[],
  selectedItems: HistoryRowItem[],
  nextRowKey: () => string,
): { merged: typeof batchRows; copied: number; skipped: number } {
  let copied = 0;
  let skipped = 0;

  const existingKeys = new Set(batchRows.map((r) => duplicateKey(r.employee_id, r.zone_id, r.role)));

  const newRows: typeof batchRows = [];

  for (const item of selectedItems) {
    if (!item.eligible) { skipped++; continue; }
    const key = duplicateKey(item.employee_id, item.zone_id, item.role);
    if (existingKeys.has(key)) { skipped++; continue; }
    if (!item.current_employee_nama) { skipped++; continue; }

    newRows.push({
      rowKey: nextRowKey(),
      employee_id: item.employee_id,
      nama: item.current_employee_nama,
      zone_id: item.zone_id,
      role: item.role,
      jumlah_titik: "",
      catatan: "",
      status_id: 0,
    });
    existingKeys.add(key);
    copied++;
  }

  const result = [...batchRows];
  let insertIdx = 0;
  for (const nr of newRows) {
    const blankIdx = result.findIndex(
      (r, i) => i >= insertIdx && !r.employee_id && !r.zone_id && !r.role && !r.jumlah_titik,
    );
    if (blankIdx >= 0 && blankIdx < result.length) {
      result[blankIdx] = nr;
      insertIdx = blankIdx + 1;
    } else {
      result.push(nr);
    }
  }

  return { merged: result, copied, skipped };
}
