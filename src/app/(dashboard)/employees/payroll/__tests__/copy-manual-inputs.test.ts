import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PENDAPATAN_FIELDS, POTONGAN_FIELDS } from "../constants";

const MIGRATION_FILE = "20260906224349_copy_payroll_manual_inputs_include_catatan.sql";

// 12 kolom nominal manual yang bisa diedit di spreadsheet.
const EXPECTED_NUMERIC = [
  "extra_job",
  "uang_makan",
  "insentif",
  "tunjangan_jabatan",
  "transport",
  "tunjangan_lain",
  "tambahan_lain",
  "koperasi",
  "pinjaman_perusahaan",
  "potongan_lain",
  "jht",
  "bpjs_kesehatan",
];

// 5 kolom keterangan manual pendamping.
const EXPECTED_NOTES = [
  "extra_job_keterangan",
  "insentif_keterangan",
  "koperasi_keterangan",
  "pinjaman_perusahaan_keterangan",
  "potongan_lain_keterangan",
];

// Kolom otomatis / lifecycle yang tidak boleh disentuh RPC penyalinan.
const EXCLUDED_COLUMNS = [
  "gaji_pokok",
  "pendapatan_titik",
  "tambahan_backup_libur",
  "backup_libur_driver_days",
  "backup_libur_helper_days",
  "backup_libur_driver_rate",
  "backup_libur_helper_rate",
  "lembur",
  "potongan_absen",
  "source_gaji_pokok",
  "source_titik",
  "source_lembur",
  "last_recomputed_at",
  "gapok_bulanan",
  "gapok_hari_aktif",
  "gapok_total_hari",
  "gapok_pembagi",
  "gapok_is_prorata",
  "gapok_rincian",
  "total_pendapatan",
  "total_potongan",
  "netto",
  "snapshot_data",
  "final_employee_nama",
];

function readMigration(): string {
  return readFileSync(join(process.cwd(), "supabase", "migrations", MIGRATION_FILE), "utf8");
}

/** Ambil blok assignment SET ... FROM matched agar cek eksklusi tidak kena WHERE/JOIN. */
function readSetBlock(sql: string): string {
  const updateAt = sql.indexOf("updated_rows AS (");
  expect(updateAt).toBeGreaterThan(-1);
  const setAt = sql.indexOf("SET", updateAt);
  const fromAt = sql.indexOf("FROM matched m", setAt);
  expect(setAt).toBeGreaterThan(-1);
  expect(fromAt).toBeGreaterThan(setAt);
  return sql.slice(setAt, fromAt);
}

describe("copy manual inputs contract", () => {
  it("frontend spreadsheet editable fields match the copy manifest", () => {
    const editable = [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].filter((f) => !f.readonly);
    expect(editable.map((f) => f.key).sort()).toEqual([...EXPECTED_NUMERIC].sort());
    expect(editable.flatMap((f) => (f.keteranganKey ? [f.keteranganKey] : [])).sort()).toEqual(
      [...EXPECTED_NOTES].sort(),
    );
  });

  it("copies catatan only into empty targets", () => {
    const sql = readMigration();
    expect(sql).toContain("s.catatan");
    expect(sql).toContain("t.catatan");
    expect(sql).toContain("catatan = m.catatan");
    expect(readSetBlock(sql)).toContain("catatan = m.catatan");
  });

  it("writes every manual field and keeps automatic columns out of the update", () => {
    const sql = readMigration();
    const setBlock = readSetBlock(sql);
    for (const col of [...EXPECTED_NUMERIC, ...EXPECTED_NOTES]) {
      expect(setBlock).toContain(`${col} = m.${col}`);
    }
    for (const col of EXCLUDED_COLUMNS) {
      expect(setBlock).not.toContain(col);
    }
  });

  it("enforces permission, adjacent period, and duplicate safeguards", () => {
    const sql = readMigration();
    expect(sql).toContain("has_payroll_input_permission");
    expect(sql).toContain("payroll.input");
    expect(sql).toContain("insufficient_payroll_permission");
    expect(sql).toContain("invalid_period_format");
    expect(sql).toContain("source_period_not_previous");
    expect(sql).toContain("duplicate_payroll_rows");
  });
});
