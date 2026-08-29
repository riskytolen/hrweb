import { describe, expect, it } from "vitest";
import {
  calculateBackupLiburByEmployee,
  getBackupLiburPayrollValues,
  normalizeBackupLiburAmount,
  type BackupLiburPoint,
} from "../backup-libur";

const settings = {
  delivery_status_id: 5,
  driver_amount: 65000,
  helper_amount: 45000,
};

describe("backup-libur payroll calculation", () => {
  it("counts one incentive per employee, date, and role", () => {
    const points: BackupLiburPoint[] = [
      { employee_id: "EMP-1", tanggal: "2026-08-10", role: "Driver", status_id: 5 },
      { employee_id: "EMP-1", tanggal: "2026-08-11", role: "Driver", status_id: 5 },
      { employee_id: "EMP-1", tanggal: "2026-08-12", role: "Helper", status_id: 5 },
    ];

    const result = getBackupLiburPayrollValues(calculateBackupLiburByEmployee(points, settings), "EMP-1", settings);

    expect(result).toEqual({
      tambahan_backup_libur: 175000,
      backup_libur_driver_days: 2,
      backup_libur_helper_days: 1,
      backup_libur_driver_rate: 65000,
      backup_libur_helper_rate: 45000,
    });
  });

  it("deduplicates repeated employee-date-role records", () => {
    const points: BackupLiburPoint[] = [
      { employee_id: "EMP-1", tanggal: "2026-08-10", role: "Driver", status_id: 5 },
      { employee_id: "EMP-1", tanggal: "2026-08-10", role: "Driver", status_id: 5 },
      { employee_id: "EMP-1", tanggal: "2026-08-10", role: "Helper", status_id: 5 },
    ];

    const result = getBackupLiburPayrollValues(calculateBackupLiburByEmployee(points, settings), "EMP-1", settings);

    expect(result.tambahan_backup_libur).toBe(110000);
    expect(result.backup_libur_driver_days).toBe(1);
    expect(result.backup_libur_helper_days).toBe(1);
  });

  it("ignores non Backup Libur statuses, unsupported roles, and rows without employees", () => {
    const points: BackupLiburPoint[] = [
      { employee_id: "EMP-1", tanggal: "2026-08-10", role: "Driver", status_id: 3 },
      { employee_id: "EMP-1", tanggal: "2026-08-10", role: "Standby", status_id: 5 },
      { employee_id: null, tanggal: "2026-08-10", role: "Helper", status_id: 5 },
    ];

    const result = getBackupLiburPayrollValues(calculateBackupLiburByEmployee(points, settings), "EMP-1", settings);

    expect(result.tambahan_backup_libur).toBe(0);
    expect(result.backup_libur_driver_days).toBe(0);
    expect(result.backup_libur_helper_days).toBe(0);
  });

  it("returns zero amount while preserving configured rates when employee has no Backup Libur", () => {
    const result = getBackupLiburPayrollValues(new Map(), "EMP-1", settings);

    expect(result).toEqual({
      tambahan_backup_libur: 0,
      backup_libur_driver_days: 0,
      backup_libur_helper_days: 0,
      backup_libur_driver_rate: 65000,
      backup_libur_helper_rate: 45000,
    });
  });

  it("normalizes invalid and negative currency input to a non-negative integer", () => {
    expect(normalizeBackupLiburAmount("Rp65.500")).toBe(65500);
    expect(normalizeBackupLiburAmount(-45000.9)).toBe(0);
    expect(normalizeBackupLiburAmount("abc")).toBe(0);
  });
});
