import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PENDAPATAN_FIELDS, POTONGAN_FIELDS } from "../constants";

const MIGRATION_FILE = "20260907223417_reset_payroll_manual_inputs.sql";

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

// Kolom otomatis / lifecycle yang tidak boleh disentuh RPC reset.
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

/** Ambil blok assignment SET ... FROM target agar cek eksklusi tidak kena filter/WHERE. */
function readSetBlock(sql: string): string {
  const updateAt = sql.indexOf("reset_rows AS (");
  expect(updateAt).toBeGreaterThan(-1);
  const setAt = sql.indexOf("SET", updateAt);
  const fromAt = sql.indexOf("FROM target_rows t", setAt);
  expect(setAt).toBeGreaterThan(-1);
  expect(fromAt).toBeGreaterThan(setAt);
  return sql.slice(setAt, fromAt);
}

describe("reset manual inputs contract", () => {
  it("frontend spreadsheet editable fields match the reset manifest", () => {
    const editable = [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].filter((f) => !f.readonly);
    expect(editable.map((f) => f.key).sort()).toEqual([...EXPECTED_NUMERIC].sort());
    expect(editable.flatMap((f) => (f.keteranganKey ? [f.keteranganKey] : [])).sort()).toEqual(
      [...EXPECTED_NOTES].sort(),
    );
  });

  it("clears every manual field plus catatan and bumps version", () => {
    const sql = readMigration();
    const setBlock = readSetBlock(sql);
    for (const col of EXPECTED_NUMERIC) {
      expect(setBlock).toContain(`${col} = 0`);
    }
    for (const col of [...EXPECTED_NOTES, "catatan"]) {
      expect(setBlock).toContain(`${col} = NULL`);
    }
    expect(setBlock).toContain("updated_at = now()");
    expect(setBlock).toContain("version = p.version + 1");
  });

  it("only touches Worksheet rows with optional employee filter", () => {
    const sql = readMigration();
    expect(sql).toContain("status = 'Worksheet'");
    expect(sql).toContain("p_employee_ids");
    expect(sql).toContain("employee_id = ANY(p_employee_ids)");
    expect(sql).not.toContain("'Draft'");
    expect(sql).not.toContain("'Final'");
  });

  it("keeps automatic columns out of the reset update", () => {
    const setBlock = readSetBlock(readMigration());
    for (const col of EXCLUDED_COLUMNS) {
      expect(setBlock).not.toContain(col);
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
