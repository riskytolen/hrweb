export type BackupLiburRole = "Driver" | "Helper";

export type BackupLiburSettings = {
  delivery_status_id: number | null;
  driver_amount: number;
  helper_amount: number;
};

export type BackupLiburPoint = {
  employee_id: string | null;
  tanggal: string;
  role: string | null;
  status_id: number | null;
};

export type BackupLiburPayrollValues = {
  tambahan_backup_libur: number;
  backup_libur_driver_days: number;
  backup_libur_helper_days: number;
  backup_libur_driver_rate: number;
  backup_libur_helper_rate: number;
};

export function normalizeBackupLiburAmount(value: unknown): number {
  const numeric = typeof value === "number" ? value : parseInt(String(value ?? "").replace(/\D/g, ""), 10);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

export function emptyBackupLiburPayrollValues(settings?: BackupLiburSettings | null): BackupLiburPayrollValues {
  return {
    tambahan_backup_libur: 0,
    backup_libur_driver_days: 0,
    backup_libur_helper_days: 0,
    backup_libur_driver_rate: settings?.driver_amount ?? 0,
    backup_libur_helper_rate: settings?.helper_amount ?? 0,
  };
}

export function calculateBackupLiburByEmployee(
  points: BackupLiburPoint[],
  settings: BackupLiburSettings | null | undefined,
): Map<string, BackupLiburPayrollValues> {
  const results = new Map<string, BackupLiburPayrollValues>();
  if (!settings?.delivery_status_id) return results;

  const driverAmount = normalizeBackupLiburAmount(settings.driver_amount);
  const helperAmount = normalizeBackupLiburAmount(settings.helper_amount);
  const seen = new Set<string>();

  for (const point of points) {
    if (!point.employee_id || point.status_id !== settings.delivery_status_id) continue;
    if (point.role !== "Driver" && point.role !== "Helper") continue;

    const uniqueKey = `${point.employee_id}\u0000${point.tanggal}\u0000${point.role}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    const current = results.get(point.employee_id) ?? emptyBackupLiburPayrollValues({
      delivery_status_id: settings.delivery_status_id,
      driver_amount: driverAmount,
      helper_amount: helperAmount,
    });

    if (point.role === "Driver") current.backup_libur_driver_days += 1;
    else current.backup_libur_helper_days += 1;

    current.tambahan_backup_libur =
      current.backup_libur_driver_days * driverAmount + current.backup_libur_helper_days * helperAmount;
    current.backup_libur_driver_rate = driverAmount;
    current.backup_libur_helper_rate = helperAmount;
    results.set(point.employee_id, current);
  }

  return results;
}

export function getBackupLiburPayrollValues(
  results: Map<string, BackupLiburPayrollValues>,
  employeeId: string,
  settings?: BackupLiburSettings | null,
): BackupLiburPayrollValues {
  return results.get(employeeId) ?? emptyBackupLiburPayrollValues(settings);
}
