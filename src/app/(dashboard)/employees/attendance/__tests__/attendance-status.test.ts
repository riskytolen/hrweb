import { describe, it, expect } from "vitest";
import {
  STATUS_OPTIONS,
  STATUS_BY_VALUE,
  NO_JAM_STATUSES,
  MANUAL_SPECIAL,
  needsJamMasuk,
  isManualSelectable,
  type AttendanceStatus,
} from "../lib/attendance-status";

describe("attendance-status", () => {
  describe("STATUS_OPTIONS", () => {
    it("memiliki 7 status standar", () => {
      expect(STATUS_OPTIONS).toHaveLength(7);
    });

    it("values unik (no duplikat)", () => {
      const values = STATUS_OPTIONS.map((s) => s.value);
      expect(new Set(values).size).toBe(values.length);
    });

    it("include semua enum AttendanceStatus", () => {
      const expected: AttendanceStatus[] = [
        "Hadir", "Terlambat", "Izin", "Sakit", "Alpha", "Libur", "Cuti",
      ];
      expected.forEach((s) => {
        expect(STATUS_OPTIONS.find((o) => o.value === s)).toBeDefined();
      });
    });

    it("semua option punya label & color hex", () => {
      STATUS_OPTIONS.forEach((o) => {
        expect(o.label.length).toBeGreaterThan(0);
        expect(o.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });
  });

  describe("STATUS_BY_VALUE", () => {
    it("lookup cepat konsisten dengan STATUS_OPTIONS", () => {
      STATUS_OPTIONS.forEach((o) => {
        expect(STATUS_BY_VALUE[o.value]).toEqual(o);
      });
    });

    it("semua 7 status punya entry", () => {
      const expected: AttendanceStatus[] = [
        "Hadir", "Terlambat", "Izin", "Sakit", "Alpha", "Libur", "Cuti",
      ];
      expected.forEach((s) => {
        expect(STATUS_BY_VALUE[s]).toBeDefined();
        expect(STATUS_BY_VALUE[s].value).toBe(s);
      });
    });
  });

  describe("NO_JAM_STATUSES", () => {
    it("memiliki 5 status yang tidak butuh jam_masuk", () => {
      expect(NO_JAM_STATUSES).toHaveLength(5);
    });

    it("termasuk Izin, Sakit, Alpha, Libur, Cuti", () => {
      expect(NO_JAM_STATUSES).toEqual(
        expect.arrayContaining(["Izin", "Sakit", "Alpha", "Libur", "Cuti"])
      );
    });

    it("TIDAK termasuk Hadir & Terlambat (butuh jam_masuk)", () => {
      expect(NO_JAM_STATUSES).not.toContain("Hadir");
      expect(NO_JAM_STATUSES).not.toContain("Terlambat");
    });
  });

  describe("MANUAL_SPECIAL", () => {
    it("hanya Alpha yang manual-selectable", () => {
      expect(MANUAL_SPECIAL).toEqual(["Alpha"]);
    });

    it("subset dari NO_JAM_STATUSES", () => {
      MANUAL_SPECIAL.forEach((s) => {
        expect(NO_JAM_STATUSES).toContain(s);
      });
    });
  });

  describe("needsJamMasuk helper", () => {
    it("return true untuk Hadir & Terlambat", () => {
      expect(needsJamMasuk("Hadir")).toBe(true);
      expect(needsJamMasuk("Terlambat")).toBe(true);
    });

    it("return false untuk status di NO_JAM_STATUSES", () => {
      NO_JAM_STATUSES.forEach((s) => {
        expect(needsJamMasuk(s)).toBe(false);
      });
    });

    it("return true untuk unknown string (default: butuh jam_masuk)", () => {
      // Implementation saat ini: `!NO_JAM_STATUSES.includes(s)` — any string
      // TIDAK ada di NO_JAM_STATUSES dianggap butuh jam_masuk. Ini konservatif
      // dan mencegah hilangnya jam_masuk saat ada legacy/unknown value.
      expect(needsJamMasuk("Unknown" as AttendanceStatus)).toBe(true);
      expect(needsJamMasuk("" as AttendanceStatus)).toBe(true);
    });
  });

  describe("isManualSelectable helper", () => {
    it("return true hanya untuk Alpha", () => {
      expect(isManualSelectable("Alpha")).toBe(true);
    });

    it("return false untuk status lain", () => {
      ["Hadir", "Terlambat", "Izin", "Sakit", "Libur", "Cuti"].forEach((s) => {
        expect(isManualSelectable(s)).toBe(false);
      });
    });
  });
});
