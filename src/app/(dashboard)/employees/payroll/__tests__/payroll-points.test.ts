import { describe, expect, it } from "vitest";
import { filterPayrollPoints } from "../payroll-points";
import type { EmployeeActivity } from "@/lib/employee-activity";

const points = [
  { employee_id: "faisal", tanggal: "2026-10-07", total: 60000 },
  { employee_id: "faisal", tanggal: "2026-10-08", total: 60000 },
  { employee_id: "faisal", tanggal: "2026-10-09", total: 94000 },
  { employee_id: "febry", tanggal: "2026-10-14", total: 60000 },
  { employee_id: "febry", tanggal: "2026-10-15", total: 84000 },
  { employee_id: "febry", tanggal: "2026-10-16", total: 60000 },
  { employee_id: "febry", tanggal: "2026-10-17", total: 60000 },
];

describe("titik payroll dan pembayaran cash Training", () => {
  it("Training → Ditolak/Tidak Aktif → diterima: titik cash tetap di luar payroll", () => {
    const employee: EmployeeActivity = { status: "Training", tanggal_bergabung: null, tanggal_keluar: null };
    const employees = new Map([["faisal", employee]]);
    expect(filterPayrollPoints(points, employees)).toEqual([]);
    employees.set("faisal", { ...employee, status: "Tidak Aktif", tanggal_keluar: "2026-11-10" });
    expect(filterPayrollPoints(points, employees)).toEqual([]);
    employees.set("faisal", { status: "Aktif", tanggal_bergabung: "2026-11-11", tanggal_keluar: null });
    const firstActivePoint = { employee_id: "faisal", tanggal: "2026-11-11", total: 60000 };
    expect(filterPayrollPoints([...points, firstActivePoint], employees)).toEqual([firstActivePoint]);
  });
  it.each([null, "2026-10-01"])("Training dikecualikan walaupun tanggal bergabung %s", (join) => {
    const employees = new Map<string, EmployeeActivity>([
      ["faisal", { status: "Training", tanggal_bergabung: join, tanggal_keluar: null }],
    ]);
    expect(filterPayrollPoints(points, employees)).toEqual([]);
  });

  it("setelah Aktif, tiga hari Training tetap dikeluarkan; tanggal bergabung inklusif", () => {
    const employees = new Map<string, EmployeeActivity>([
      ["febry", { status: "Aktif", tanggal_bergabung: "2026-10-17", tanggal_keluar: null }],
    ]);
    expect(filterPayrollPoints(points, employees)).toEqual([points[6]]);
  });

  it("Worksheet Faisal November menghasilkan sumber titik nol; pegawai aktif lain tetap dihitung", () => {
    const employees = new Map<string, EmployeeActivity>([
      ["faisal", { status: "Training", tanggal_bergabung: null, tanggal_keluar: null }],
      ["febry", { status: "Aktif", tanggal_bergabung: "2026-10-17", tanggal_keluar: null }],
    ]);
    const november = points.filter((p) => p.tanggal >= "2026-10-08" && p.tanggal <= "2026-11-07");
    const eligible = filterPayrollPoints(november, employees);
    expect(eligible.filter((p) => p.employee_id === "faisal").reduce((sum, p) => sum + p.total, 0)).toBe(0);
    expect(eligible.reduce((sum, p) => sum + p.total, 0)).toBe(60000);
    // Seleksi payroll tidak mengubah catatan operasional yang dibayar cash.
    expect(november.filter((p) => p.employee_id === "faisal").reduce((sum, p) => sum + p.total, 0)).toBe(154000);
  });

  it("mempertahankan hak historis pegawai nonaktif dan mengecualikan tanggal keluar/nonaktif", () => {
    const employees = new Map<string, EmployeeActivity>([
      ["febry", { status: "Tidak Aktif", tanggal_bergabung: "2026-10-14", tanggal_keluar: "2026-10-17", non_active_periods: [{ from: "2026-10-15", to: "2026-10-15" }] }],
    ]);
    expect(filterPayrollPoints(points, employees)).toEqual([points[3], points[5]]);
  });

  it("pegawai lama tanpa tanggal bergabung tetap mengikuti aturan aktif, record tanpa pegawai tidak dihitung", () => {
    const employees = new Map<string, EmployeeActivity>([
      ["febry", { status: "Aktif", tanggal_bergabung: null, tanggal_keluar: null }],
    ]);
    expect(filterPayrollPoints([...points, { employee_id: null, tanggal: "2026-10-17", total: 999 }], employees)).toEqual(points.slice(3));
  });
});
