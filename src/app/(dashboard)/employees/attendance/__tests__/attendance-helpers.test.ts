import { describe, it, expect } from "vitest";
import {
  localDateStr,
  addDays,
  timeToMinutes,
  minutesToTime,
  computeLateness,
  computeDenda,
  computeDendaAlpha,
  getDeadlineTime,
  getSummaryPeriodRange,
  getSummaryCurrentPeriodKey,
  getCalPeriod,
  getDateRange,
  getAffectedEmployeeIds,
  isInNonActivePeriod,
  isEmployeeActiveOnDate,
  isEmployeeActiveInPeriod,
} from "../lib/attendance-helpers";
import { MIN_DATE, SUMMARY_CUT_OFF_DAY } from "../lib/attendance-constants";

describe("attendance-helpers", () => {
  describe("localDateStr", () => {
    it("return YYYY-MM-DD dari Date object", () => {
      const d = new Date(2026, 0, 15);
      expect(localDateStr(d)).toBe("2026-01-15");
    });

    it("zero-pad month & day", () => {
      expect(localDateStr(new Date(2026, 2, 5))).toBe("2026-03-05");
    });

    it("default ke tanggal hari ini (tidak throw)", () => {
      const result = localDateStr();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("addDays", () => {
    it("tambah 1 hari dari YYYY-MM-DD", () => {
      expect(addDays("2026-06-04", 1)).toBe("2026-06-05");
    });

    it("kurangi 1 hari", () => {
      expect(addDays("2026-06-04", -1)).toBe("2026-06-03");
    });

    it("rollover akhir bulan (Jun 30 + 1 = Jul 1)", () => {
      expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    });

    it("rollover akhir tahun (Dec 31 + 1 = Jan 1)", () => {
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    });

    it("clamped ke MIN_DATE saat mundur terlalu jauh", () => {
      expect(addDays("2026-06-04", -1000)).toBe(MIN_DATE);
    });
  });

  describe("timeToMinutes", () => {
    it("parse HH:MM ke menit", () => {
      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("08:00")).toBe(480);
      expect(timeToMinutes("08:30")).toBe(510);
      expect(timeToMinutes("23:59")).toBe(1439);
    });

    it("parse HH:MM:SS (ignore seconds)", () => {
      expect(timeToMinutes("08:30:45")).toBe(510);
    });

    it("handle missing minutes (treated as 0)", () => {
      expect(timeToMinutes("08")).toBe(480);
    });
  });

  describe("minutesToTime", () => {
    it("format 0 → 00:00", () => {
      expect(minutesToTime(0)).toBe("00:00");
    });

    it("format 480 → 08:00", () => {
      expect(minutesToTime(480)).toBe("08:00");
    });

    it("format 510 → 08:30", () => {
      expect(minutesToTime(510)).toBe("08:30");
    });

    it("format 1439 → 23:59", () => {
      expect(minutesToTime(1439)).toBe("23:59");
    });

    it("wrap-around untuk overnight (1500 = 25:00 = 01:00)", () => {
      expect(minutesToTime(1500)).toBe("01:00");
    });

    it("handle negative (wrapped forward)", () => {
      expect(minutesToTime(-30)).toBe("23:30");
    });
  });

  describe("computeLateness", () => {
    it("tepat waktu → Hadir, durasi 0", () => {
      const r = computeLateness("08:00", "08:00", 20);
      expect(r).toEqual({ status: "Hadir", durasi: 0 });
    });

    it("telat <= toleransi → Hadir, durasi 0", () => {
      const r = computeLateness("08:15", "08:00", 20);
      expect(r).toEqual({ status: "Hadir", durasi: 0 });
    });

    it("telat = toleransi → Hadir, durasi 0", () => {
      const r = computeLateness("08:20", "08:00", 20);
      expect(r).toEqual({ status: "Hadir", durasi: 0 });
    });

    it("telat > toleransi → Terlambat, durasi = selisih - toleransi", () => {
      const r = computeLateness("08:30", "08:00", 20);
      expect(r).toEqual({ status: "Terlambat", durasi: 10 });
    });

    it("datang awal → Hadir, durasi 0 (diff negatif <= toleransi)", () => {
      const r = computeLateness("07:55", "08:00", 20);
      expect(r).toEqual({ status: "Hadir", durasi: 0 });
    });
  });

  describe("computeDenda", () => {
    const defaults = { perMenit: 3000, batas: 20, maksimum: 60000 };

    it("durasi <= 0 → 0 (no fine)", () => {
      expect(computeDenda(0, undefined, defaults)).toBe(0);
      expect(computeDenda(-5, undefined, defaults)).toBe(0);
    });

    it("durasi <= batas → durasi * perMenit", () => {
      expect(computeDenda(10, undefined, defaults)).toBe(30000);
      expect(computeDenda(20, undefined, defaults)).toBe(60000);
    });

    it("durasi > batas → flat maksimum", () => {
      expect(computeDenda(30, undefined, defaults)).toBe(60000);
      expect(computeDenda(120, undefined, defaults)).toBe(60000);
    });

    it("pakai penalty override kalau ada", () => {
      const penalty = { division_id: 1, denda_per_menit: 5000, batas_menit: 10, denda_maksimum: 50000, denda_alpha: 100000 };
      expect(computeDenda(5, penalty, defaults)).toBe(25000);
      expect(computeDenda(20, penalty, defaults)).toBe(50000);
    });

    it("fallback ke defaults kalau penalty undefined", () => {
      expect(computeDenda(15, undefined, defaults)).toBe(45000);
    });
  });

  describe("computeDendaAlpha", () => {
    it("pakai penalty.denda_alpha", () => {
      const penalty = { division_id: 1, denda_per_menit: 0, batas_menit: 0, denda_maksimum: 0, denda_alpha: 150000 };
      expect(computeDendaAlpha(penalty, 100000)).toBe(150000);
    });

    it("fallback ke default kalau undefined", () => {
      expect(computeDendaAlpha(undefined, 100000)).toBe(100000);
    });
  });

  describe("getDeadlineTime", () => {
    it("schedule 08:00 + toleransi 20 → 08:20", () => {
      expect(getDeadlineTime("08:00", 20)).toBe("08:20");
    });

    it("schedule 08:30:00 + toleransi 0 → 08:30 (slice seconds)", () => {
      expect(getDeadlineTime("08:30:00", 0)).toBe("08:30");
    });

    it("schedule null → return null", () => {
      expect(getDeadlineTime(null, 20)).toBeNull();
    });

    it("schedule undefined → return null", () => {
      expect(getDeadlineTime(undefined, 20)).toBeNull();
    });

    it("toleransi null/undefined → treated as 0", () => {
      expect(getDeadlineTime("08:00", null)).toBe("08:00");
      expect(getDeadlineTime("08:00", undefined)).toBe("08:00");
    });
  });

  describe("getSummaryPeriodRange", () => {
    it("periode Juni 2026 = 8 Juni – 7 Juli", () => {
      const r = getSummaryPeriodRange("2026-06");
      expect(r.start).toBe("2026-06-08");
      expect(r.end).toBe("2026-07-07");
    });

    it("periode Desember 2026 = 8 Des 2026 – 7 Jan 2027", () => {
      const r = getSummaryPeriodRange("2026-12");
      expect(r.start).toBe("2026-12-08");
      expect(r.end).toBe("2027-01-07");
    });

    it("label mengandung nama bulan Indonesia", () => {
      const r = getSummaryPeriodRange("2026-06");
      expect(r.label).toContain("Juni");
      expect(r.label).toContain("Juli");
      expect(r.label).toContain(String(SUMMARY_CUT_OFF_DAY));
    });
  });

  describe("getCalPeriod", () => {
    it("Jun 2026 = 8 Jun – 7 Jul", () => {
      const r = getCalPeriod("2026-06");
      expect(r.start).toBe("2026-06-08");
      expect(r.end).toBe("2026-07-07");
    });

    it("periode rollover tahun (Des)", () => {
      const r = getCalPeriod("2026-12");
      expect(r.start).toBe("2026-12-08");
      expect(r.end).toBe("2027-01-07");
    });

    it("label mengandung 2 nama bulan", () => {
      const r = getCalPeriod("2026-06");
      expect(r.label).toContain("Juni");
      expect(r.label).toContain("Juli");
    });
  });

  describe("getSummaryCurrentPeriodKey", () => {
    it("5 Juni 2026 (sebelum cutoff 8) → '2026-05' (periode 8 Mei – 7 Juni)", () => {
      expect(getSummaryCurrentPeriodKey(new Date(2026, 5, 5))).toBe("2026-05");
    });

    it("8 Juni 2026 (tepat cutoff) → '2026-06' (periode 8 Juni – 7 Juli)", () => {
      expect(getSummaryCurrentPeriodKey(new Date(2026, 5, 8))).toBe("2026-06");
    });

    it("10 Juni 2026 (setelah cutoff) → '2026-06'", () => {
      expect(getSummaryCurrentPeriodKey(new Date(2026, 5, 10))).toBe("2026-06");
    });

    it("1 Juli 2026 (sebelum cutoff) → '2026-06' (periode 8 Juni – 7 Juli)", () => {
      expect(getSummaryCurrentPeriodKey(new Date(2026, 6, 1))).toBe("2026-06");
    });

    it("7 Juli 2026 (sebelum cutoff) → '2026-06'", () => {
      expect(getSummaryCurrentPeriodKey(new Date(2026, 6, 7))).toBe("2026-06");
    });

    it("1 Januari 2026 (sebelum cutoff, rollover tahun) → '2025-12'", () => {
      expect(getSummaryCurrentPeriodKey(new Date(2026, 0, 1))).toBe("2025-12");
    });

    it("15 Januari 2026 (setelah cutoff) → '2026-01'", () => {
      expect(getSummaryCurrentPeriodKey(new Date(2026, 0, 15))).toBe("2026-01");
    });

    it("31 Desember 2026 (setelah cutoff) → '2026-12'", () => {
      expect(getSummaryCurrentPeriodKey(new Date(2026, 11, 31))).toBe("2026-12");
    });

    it("default ke new Date() (tidak throw)", () => {
      expect(() => getSummaryCurrentPeriodKey()).not.toThrow();
      expect(getSummaryCurrentPeriodKey()).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe("isInNonActivePeriod", () => {
    it("returns false untuk null/undefined/empty periods", () => {
      expect(isInNonActivePeriod("2026-06-01", null)).toBe(false);
      expect(isInNonActivePeriod("2026-06-01", undefined)).toBe(false);
      expect(isInNonActivePeriod("2026-06-01", [])).toBe(false);
    });

    it("returns true untuk date DI DALAM satu period (inclusive both bounds)", () => {
      const periods = [{ from: "2026-05-22", to: "2026-06-03" }];
      expect(isInNonActivePeriod("2026-05-22", periods)).toBe(true);
      expect(isInNonActivePeriod("2026-05-30", periods)).toBe(true);
      expect(isInNonActivePeriod("2026-06-03", periods)).toBe(true);
    });

    it("returns false untuk date SEBELUM or SESUDAH period", () => {
      const periods = [{ from: "2026-05-22", to: "2026-06-03" }];
      expect(isInNonActivePeriod("2026-05-21", periods)).toBe(false);
      expect(isInNonActivePeriod("2026-06-04", periods)).toBe(false);
    });

    it("returns true jika date matches ANY of multiple periods", () => {
      const periods = [
        { from: "2024-01-01", to: "2024-03-31" },
        { from: "2025-06-01", to: "2025-08-31" },
        { from: "2026-05-22", to: "2026-06-03" },
      ];
      expect(isInNonActivePeriod("2024-02-15", periods)).toBe(true);
      expect(isInNonActivePeriod("2025-07-15", periods)).toBe(true);
      expect(isInNonActivePeriod("2026-05-30", periods)).toBe(true);
      expect(isInNonActivePeriod("2024-04-01", periods)).toBe(false);
      expect(isInNonActivePeriod("2025-09-01", periods)).toBe(false);
    });
  });

  describe("isEmployeeActiveOnDate", () => {
    const baseEmployee = {
      status: "Aktif",
      tanggal_bergabung: "2026-05-14",
      tanggal_keluar: null,
      non_active_periods: [],
    };

    it("false sebelum tanggal bergabung, true tepat tanggal bergabung", () => {
      expect(isEmployeeActiveOnDate("2026-05-13", baseEmployee)).toBe(false);
      expect(isEmployeeActiveOnDate("2026-05-14", baseEmployee)).toBe(true);
    });

    it("tanggal_keluar inclusive: false tepat tanggal keluar dan setelahnya", () => {
      const employee = { ...baseEmployee, tanggal_keluar: "2026-05-21" };
      expect(isEmployeeActiveOnDate("2026-05-20", employee)).toBe(true);
      expect(isEmployeeActiveOnDate("2026-05-21", employee)).toBe(false);
      expect(isEmployeeActiveOnDate("2026-05-22", employee)).toBe(false);
    });

    it("false untuk status Tidak Aktif tanpa tanggal_keluar", () => {
      const employee = { ...baseEmployee, status: "Tidak Aktif", tanggal_keluar: null };
      expect(isEmployeeActiveOnDate("2026-05-20", employee)).toBe(false);
    });

    it("false untuk tanggal di dalam historical non_active_periods", () => {
      const employee = {
        ...baseEmployee,
        non_active_periods: [{ from: "2026-05-22", to: "2026-06-03" }],
      };
      expect(isEmployeeActiveOnDate("2026-05-21", employee)).toBe(true);
      expect(isEmployeeActiveOnDate("2026-05-22", employee)).toBe(false);
      expect(isEmployeeActiveOnDate("2026-06-03", employee)).toBe(false);
      expect(isEmployeeActiveOnDate("2026-06-04", employee)).toBe(true);
    });
  });

  describe("isEmployeeActiveInPeriod", () => {
    const baseEmployee = {
      status: "Aktif",
      tanggal_bergabung: "2026-05-14",
      tanggal_keluar: null,
      non_active_periods: [],
    };

    it("true jika employee punya minimal 1 hari aktif di periode", () => {
      const employee = { ...baseEmployee, tanggal_keluar: "2026-05-21" };
      expect(isEmployeeActiveInPeriod({ start: "2026-05-08", end: "2026-06-07" }, employee)).toBe(true);
    });

    it("false jika tanggal_keluar sudah di periode sebelumnya", () => {
      const employee = { ...baseEmployee, tanggal_keluar: "2026-05-21" };
      expect(isEmployeeActiveInPeriod({ start: "2026-06-08", end: "2026-07-07" }, employee)).toBe(false);
    });

    it("false jika belum bergabung sampai periode selesai", () => {
      const employee = { ...baseEmployee, tanggal_bergabung: "2026-07-08" };
      expect(isEmployeeActiveInPeriod({ start: "2026-06-08", end: "2026-07-07" }, employee)).toBe(false);
    });

    it("false jika seluruh periode berada dalam non_active_periods", () => {
      const employee = {
        ...baseEmployee,
        non_active_periods: [{ from: "2026-06-08", to: "2026-07-07" }],
      };
      expect(isEmployeeActiveInPeriod({ start: "2026-06-08", end: "2026-07-07" }, employee)).toBe(false);
    });

    it("true jika periode setelah non_active_periods selesai (rehire)", () => {
      const employee = {
        ...baseEmployee,
        non_active_periods: [{ from: "2026-05-22", to: "2026-06-03" }],
      };
      expect(isEmployeeActiveInPeriod({ start: "2026-06-08", end: "2026-07-07" }, employee)).toBe(true);
    });
  });

  describe("getDateRange", () => {
    it("start == end → array 1 element", () => {
      expect(getDateRange("2026-06-04", null)).toEqual(["2026-06-04"]);
      expect(getDateRange("2026-06-04", "2026-06-04")).toEqual(["2026-06-04"]);
    });

    it("range 3 hari", () => {
      expect(getDateRange("2026-06-04", "2026-06-06")).toEqual([
        "2026-06-04",
        "2026-06-05",
        "2026-06-06",
      ]);
    });

    it("range rollover bulan", () => {
      expect(getDateRange("2026-06-29", "2026-07-02")).toEqual([
        "2026-06-29",
        "2026-06-30",
        "2026-07-01",
        "2026-07-02",
      ]);
    });

    it("range rollover tahun", () => {
      expect(getDateRange("2026-12-30", "2027-01-02")).toEqual([
        "2026-12-30",
        "2026-12-31",
        "2027-01-01",
        "2027-01-02",
      ]);
    });

    it("end null → single date", () => {
      expect(getDateRange("2026-06-04", null)).toEqual(["2026-06-04"]);
    });
  });

  describe("getAffectedEmployeeIds", () => {
    const employees = [
      { id: "ID1" }, { id: "ID2" }, { id: "ID3" },
    ];

    it("berlaku_untuk='semua' → return all employee IDs", () => {
      const result = getAffectedEmployeeIds(
        { berlaku_untuk: "semua", pegawai_ids: null },
        employees,
      );
      expect(result).toEqual(["ID1", "ID2", "ID3"]);
    });

    it("berlaku_untuk='pegawai' → return specific IDs", () => {
      const result = getAffectedEmployeeIds(
        { berlaku_untuk: "pegawai", pegawai_ids: ["ID1", "ID3"] },
        employees,
      );
      expect(result).toEqual(["ID1", "ID3"]);
    });

    it("berlaku_untuk='pegawai' dengan pegawai_ids null → empty", () => {
      const result = getAffectedEmployeeIds(
        { berlaku_untuk: "pegawai", pegawai_ids: null },
        employees,
      );
      expect(result).toEqual([]);
    });

    it("berlaku_untuk='divisi' → return [] (handled separately by caller)", () => {
      const result = getAffectedEmployeeIds(
        { berlaku_untuk: "divisi", pegawai_ids: null },
        employees,
      );
      expect(result).toEqual([]);
    });
  });
});
