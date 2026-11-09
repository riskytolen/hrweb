import { isEmployeeActiveOnDate, type EmployeeActivity } from "@/lib/employee-activity";

/** Titik Training dibayar cash. Setelah aktif, batas payroll mengikuti tanggal bergabung. */
export function filterPayrollPoints<T extends { employee_id: string | null; tanggal: string }>(
  points: T[],
  employees: ReadonlyMap<string, EmployeeActivity>,
): T[] {
  return points.filter((point) => {
    if (!point.employee_id) return false;
    const employee = employees.get(point.employee_id);
    if (!employee || employee.status === "Training") return false;
    return isEmployeeActiveOnDate(point.tanggal, employee);
  });
}
