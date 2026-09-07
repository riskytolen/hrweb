import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PENDAPATAN_FIELDS, POTONGAN_FIELDS } from "../constants";

const MIGRATION_FILE = "20260907231631_reset_payroll_manual_input_column.sql";

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

// Kolom otomatis / lifecycle yang tidak boleh diterima RPC reset kolom.
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
  "catatan",
];

function readMigration(): string {
  return readFileSync(join(process.cwd(), "supabase", "migrations", MIGRATION_FILE), "utf8");
}

describe("reset column inputs contract", () => {
  it("frontend spreadsheet editable fields match the column whitelist", () => {
    const editable = [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].filter((f) => !f.readonly);
    expect(editable.map((f) => f.key).sort()).toEqual([...EXPECTED_NUMERIC].sort());
    expect(editable.flatMap((f) => (f.keteranganKey ? [f.keteranganKey] : [])).sort()).toEqual(
      [...EXPECTED_NOTES].sort(),
    );
  });

  it("whitelists exactly the 17 manual spreadsheet columns", () => {
    const sql = readMigration();
    for (const col of [...EXPECTED_NUMERIC, ...EXPECTED_NOTES]) {
      expect(sql).toContain(`'${col}'`);
    }
    expect(sql).toContain("invalid_column_key");
  });

  it("resets numerics to 0 and notes to NULL with version bump", () => {
    const sql = readMigration();
    expect(sql).toContain("v_assign := '0'");
    expect(sql).toContain("v_assign := 'NULL'");
    expect(sql).toContain("updated_at = now()");
    expect(sql).toContain("version = p.version + 1");
  });

  it("only touches Worksheet rows and rejects anything outside the whitelist", () => {
    const sql = readMigration();
    // Dinamis via EXECUTE format(), sehingga literal dikutip ganda.
    expect(sql).toContain("status = ''Worksheet''");
    expect(sql).not.toContain("'Draft'");
    expect(sql).not.toContain("'Final'");
    for (const col of EXCLUDED_COLUMNS) {
      expect(sql).not.toContain(`'${col}'`);
    }
  });

  it("enforces permission, period, and duplicate safeguards", () => {
    const sql = readMigration();
    expect(sql).toContain("has_payroll_input_permission");
    expect(sql).toContain("payroll.input");
    expect(sql).toContain("insufficient_payroll_permission");
    expect(sql).toContain("invalid_period_format");
    expect(sql).toContain("duplicate_payroll_rows");
  });
});
