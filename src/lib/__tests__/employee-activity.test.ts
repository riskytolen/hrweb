import { describe, expect, it } from "vitest";
import {
  buildNonActivePeriod,
  computeGapokProrata,
  countActiveDaysInPeriod,
  countDaysInRange,
  hasActiveDayInPeriod,
  isEmployeeActiveOnDate,
} from "@/lib/employee-activity";

describe("employee activity contract (tanggal_keluar = first inactive)", () => {
  it("counts join date as active and exit date as inactive", () => {
    const emp = { tanggal_bergabung: "2026-05-10", tanggal_keluar: "2026-05-20", non_active_periods: [] };
    expect(isEmployeeActiveOnDate("2026-05-10", emp)).toBe(true);
    expect(isEmployeeActiveOnDate("2026-05-19", emp)).toBe(true);
    expect(isEmployeeActiveOnDate("2026-05-20", emp)).toBe(false);
    expect(isEmployeeActiveOnDate("2026-05-21", emp)).toBe(false);
    expect(isEmployeeActiveOnDate("2026-05-09", emp)).toBe(false);
  });

  it("treats inactive without exit date as needing data fix", () => {
    const emp = { status: "Tidak Aktif", tanggal_bergabung: null, tanggal_keluar: null, non_active_periods: [] };
    expect(isEmployeeActiveOnDate("2026-05-10", emp)).toBe(false);
    expect(hasActiveDayInPeriod(emp, "2026-05-08", "2026-06-07")).toBe(false);
  });

  it("excludes historical non-active ranges inclusively", () => {
    const emp = {
      tanggal_bergabung: "2026-01-01",
      tanggal_keluar: null,
      non_active_periods: [{ from: "2026-05-10", to: "2026-05-12" }],
    };
    expect(isEmployeeActiveOnDate("2026-05-09", emp)).toBe(true);
    expect(isEmployeeActiveOnDate("2026-05-10", emp)).toBe(false);
    expect(isEmployeeActiveOnDate("2026-05-12", emp)).toBe(false);
    expect(isEmployeeActiveOnDate("2026-05-13", emp)).toBe(true);
  });

  it("counts active days 8-19 May = 12 days for exit 20 May", () => {
    const emp = { tanggal_bergabung: null, tanggal_keluar: "2026-05-20", non_active_periods: [] };
    expect(countActiveDaysInPeriod(emp, "2026-05-08", "2026-06-07")).toBe(12);
    expect(countDaysInRange("2026-05-08", "2026-06-07")).toBe(31);
  });

  it("detects no active day when exit is on/before period start", () => {
    expect(hasActiveDayInPeriod({ tanggal_bergabung: null, tanggal_keluar: "2026-05-08", non_active_periods: [] }, "2026-05-08", "2026-06-07")).toBe(false);
    expect(hasActiveDayInPeriod({ tanggal_bergabung: null, tanggal_keluar: "2026-05-09", non_active_periods: [] }, "2026-05-08", "2026-06-07")).toBe(true);
  });
});

describe("gapok prorata monthly/30 x active days", () => {
  it("pays full monthly when active for the whole short period", () => {
    // Feb period 8 Jan - 7 Feb can be 31 days; use a 28-day synthetic range too.
    expect(computeGapokProrata(6000000, 28, 28).amount).toBe(6000000);
    expect(computeGapokProrata(6000000, 29, 29).amount).toBe(6000000);
    expect(computeGapokProrata(6000000, 31, 31).amount).toBe(6000000);
  });

  it("computes 12 active days example", () => {
    expect(computeGapokProrata(6000000, 12, 31).amount).toBe(2400000);
  });

  it("caps at monthly even if active days exceed divisor", () => {
    expect(computeGapokProrata(6000000, 30, 31).amount).toBe(6000000);
  });

  it("returns zero when no active days", () => {
    expect(computeGapokProrata(6000000, 0, 31).amount).toBe(0);
  });
});

describe("non-active period builder", () => {
  it("starts at exit date (first inactive), ends day before rejoin", () => {
    expect(buildNonActivePeriod("2026-05-20", "2026-06-01")).toEqual({ from: "2026-05-20", to: "2026-05-31" });
    expect(buildNonActivePeriod("2026-05-20", "2026-05-20")).toBeNull();
  });
});
