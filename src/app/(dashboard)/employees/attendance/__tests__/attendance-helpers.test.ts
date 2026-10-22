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
  isCountableManualRecord,
  pickDominantDivisionLabel,
  timeToMinutesOrNull,
  minutesToHHMM,
  computeAvgJamMasuk,
  compareRankingEntries,
  computeWeeklyChallenge,
  mondayOfWeek,
  listPeriodWeeks,
  formatWeekLabel,
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

  describe("isCountableManualRecord", () => {
    it("record manual di luar Back Office ikut dihitung", () => {
      expect(isCountableManualRecord(true, "Lapangan")).toBe(true);
      expect(isCountableManualRecord(true, null)).toBe(true);
      expect(isCountableManualRecord(true, undefined)).toBe(true);
    });

    it("record manual divisi Back Office tidak dihitung (konsisten Report Manual)", () => {
      expect(isCountableManualRecord(true, "Back Office")).toBe(false);
      expect(isCountableManualRecord(true, "back office")).toBe(false);
      expect(isCountableManualRecord(true, "  BACK OFFICE  ")).toBe(false);
    });

    it("nama divisi serupa tapi beda tetap dihitung", () => {
      expect(isCountableManualRecord(true, "back-office")).toBe(true);
      expect(isCountableManualRecord(true, "Backoffice")).toBe(true);
    });

    it("record bukan manual tidak dihitung", () => {
      expect(isCountableManualRecord(false, "Lapangan")).toBe(false);
      expect(isCountableManualRecord(false, "Back Office")).toBe(false);
    });
  });

  describe("pickDominantDivisionLabel", () => {
    const rec = (division_id: number, tanggal: string, nama: string | null = `Div-${division_id}`, color: string | null = "#123456") =>
      ({ division_id, tanggal, nama, color });

    it("divisi dengan record terbanyak menjadi label pegawai", () => {
      const result = pickDominantDivisionLabel([
        rec(1, "2026-10-01", "Lapangan", "#0ea5e9"),
        rec(1, "2026-10-02", "Lapangan", "#0ea5e9"),
        rec(1, "2026-10-03", "Lapangan", "#0ea5e9"),
        rec(2, "2026-10-05", "Gudang", "#f59e0b"),
        rec(2, "2026-10-06", "Gudang", "#f59e0b"),
      ]);
      expect(result).toEqual({ id: 1, nama: "Lapangan", color: "#0ea5e9" });
    });

    it("seri 1–1 → divisi dengan tanggal absen terbaru menjadi label", () => {
      const result = pickDominantDivisionLabel([
        rec(1, "2026-10-01"),
        rec(2, "2026-10-02"),
      ]);
      expect(result?.id).toBe(2); // jumlah sama → tanggal terbaru menang
      // Pemanggil (hook) tetap menggabungkan seluruh record ke metrik pegawai.
    });

    it("seri jumlah → divisi dengan tanggal absen terbaru menang", () => {
      const result = pickDominantDivisionLabel([
        rec(1, "2026-10-02", "Lama"),
        rec(2, "2026-10-08", "Baru"),
      ]);
      expect(result).toEqual({ id: 2, nama: "Baru", color: "#123456" });
    });

    it("seri jumlah & tanggal saban → division_id terkecil untuk hasil stabil", () => {
      const result = pickDominantDivisionLabel([
        rec(5, "2026-10-01", "E"),
        rec(2, "2026-10-01", "B"),
      ]);
      expect(result?.id).toBe(2);
      expect(result?.nama).toBe("B");
    });

    it("label dari divisi menang meski baris pertama milik divisi lain", () => {
      const result = pickDominantDivisionLabel([
        rec(3, "2026-10-01", "C"),
        rec(4, "2026-10-02", "D"),
        rec(4, "2026-10-03", "D"),
      ]);
      expect(result?.nama).toBe("D");
    });

    it("kosong → null (dipakai fallback '-' oleh pemanggil)", () => {
      expect(pickDominantDivisionLabel([])).toBeNull();
    });
  });

  describe("timeToMinutesOrNull & minutesToHHMM", () => {
    it("konversi HH:MM → menit dan kembali", () => {
      expect(timeToMinutesOrNull("07:35")).toBe(455);
      expect(minutesToHHMM(455)).toBe("07:35");
      expect(minutesToHHMM(0)).toBe("00:00");
    });

    it("input tidak valid → null", () => {
      expect(timeToMinutesOrNull("")).toBeNull();
      expect(timeToMinutesOrNull("ab:cd")).toBeNull();
      expect(timeToMinutesOrNull(null)).toBeNull();
      expect(timeToMinutesOrNull(undefined)).toBeNull();
      expect(timeToMinutesOrNull("2026-09-24")).toBeNull();
    });

    it("jam 00:00 tetap valid (bukan null)", () => {
      expect(timeToMinutesOrNull("00:00")).toBe(0);
    });
  });

  describe("computeAvgJamMasuk", () => {
    const rec = (division_id: number, status: string, jam_masuk: string | null) =>
      ({ division_id, status, jam_masuk });

    it("rata-rata hanya record hadir/terlambat pada divisi target", () => {
      const result = computeAvgJamMasuk([
        rec(1, "Hadir", "07:00"),
        rec(1, "Terlambat", "09:00"),
        rec(1, "Izin", null),
        rec(1, "Alpha", null),
        rec(2, "Hadir", "05:00"), // divisi lain diabaikan
      ], 1);
      expect(result).toBe("08:00"); // (420 + 540) / 2 = 480
    });

    it("record tanpa jam masuk valid dilewati", () => {
      const result = computeAvgJamMasuk([
        rec(1, "Hadir", "08:00"),
        rec(1, "Hadir", null),
        rec(1, "Hadir", "bukan-jam"),
      ], 1);
      expect(result).toBe("08:00");
    });

    it("tidak ada record hadir → null (ditampilkan '-')", () => {
      expect(computeAvgJamMasuk([rec(1, "Izin", null)], 1)).toBeNull();
      expect(computeAvgJamMasuk([], 1)).toBeNull();
    });
  });

  describe("compareRankingEntries", () => {
    const e = (hadirEfektifPct: number, manual: number, avgJam: string | null, nama: string) =>
      ({ hadirEfektifPct, manual, avgJam, nama });

    it("kehadiran tertinggi di atas", () => {
      expect(compareRankingEntries(e(100, 0, "07:00", "B"), e(90, 0, "06:00", "A"))).toBeLessThan(0);
    });

    it("seri kehadiran → manual tersedikit menang", () => {
      expect(compareRankingEntries(e(100, 0, "09:00", "Z"), e(100, 3, "07:00", "A"))).toBeLessThan(0);
    });

    it("seri kehadiran & manual → rata-rata jam paling awal menang", () => {
      expect(compareRankingEntries(e(95, 0, "07:15", "A"), e(95, 0, "07:45", "B"))).toBeLessThan(0);
    });

    it("pegawai tanpa jam masuk (null) berada di bawah yang punya jam", () => {
      expect(compareRankingEntries(e(95, 0, null, "A"), e(95, 0, "07:00", "B"))).toBeGreaterThan(0);
    });

    it("semua seri → nama A-Z hanya urutan render (setara)", () => {
      expect(compareRankingEntries(e(95, 1, "08:00", "Andi"), e(95, 1, "08:00", "Budi"))).toBeLessThan(0);
      expect(compareRankingEntries(e(95, 1, "08:00", "Andi"), e(95, 1, "08:00", "Andi"))).toBe(0);
    });
  });

  describe("Challenge Mingguan CP Suka — enumerasi minggu", () => {
    it("mondayOfWeek: Senin pada minggu yang memuat tanggal", () => {
      expect(mondayOfWeek("2026-10-23")).toBe("2026-10-19"); // Jumat → Senin 19
      expect(mondayOfWeek("2026-10-19")).toBe("2026-10-19"); // sudah Senin
      expect(mondayOfWeek("2026-10-18")).toBe("2026-10-12"); // Minggu → mundur 6 hari
    });

    it("listPeriodWeeks: semua minggu Senin–Minggu yang memotong rentang", () => {
      // Periode payroll 8 Sep – 7 Okt 2026.
      const weeks = listPeriodWeeks("2026-09-08", "2026-10-07");
      expect(weeks[0]).toEqual({ weekStart: "2026-09-07", weekEnd: "2026-09-13" });
      expect(weeks[weeks.length - 1]).toEqual({ weekStart: "2026-10-05", weekEnd: "2026-10-11" });
      // Setiap minggu berurutan nada 7 hari, lintas bulan aman.
      expect(weeks.length).toBe(5);
      expect(weeks[1]).toEqual({ weekStart: "2026-09-14", weekEnd: "2026-09-20" });
    });

    it("listPeriodWeeks: rentang tidak valid → kosong", () => {
      expect(listPeriodWeeks("2026-09-10", "2026-09-08")).toEqual([]);
      expect(listPeriodWeeks("", "")).toEqual([]);
    });

    it("formatWeekLabel: satu bulan & lintas bulan", () => {
      expect(formatWeekLabel("2026-09-07", "2026-09-13")).toBe("7 – 13 Sep 2026");
      expect(formatWeekLabel("2026-09-28", "2026-10-04")).toBe("28 Sep – 4 Okt 2026");
    });
  });

  describe("Challenge Mingguan CP Suka — computeWeeklyChallenge", () => {
    // Minggu uji: Senin 7 Sep – Minggu 13 Sep 2026 (semua hari sudah lewat).
    const WS = "2026-09-07";
    const SATU = "1", DUA = "2"; // employee id
    const TODAY = "2026-09-15"; // sudah lewat minggu uji
    const D = [
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ];

    const CP = { id: 9, nama: "Cp Suka", color: "#0ea5e9" };
    const LAIN = { id: 3, nama: "Divisi Lain", color: "#111111" };

    /** Record absensi: default divisi CP Suka status Hadir pagi. */
    const rec = (
      eid: string,
      tanggal: string,
      status = "Hadir",
      opts: { div?: { id: number; nama: string; color: string }; isManual?: boolean; jam?: string | null } = {},
    ) => ({
      employee_id: eid,
      division_id: (opts.div ?? CP).id,
      status,
      tanggal,
      is_manual: opts.isManual ?? false,
      jam_masuk: opts.jam ?? null,
      divisionNama: (opts.div ?? CP).nama,
      divisionColor: (opts.div ?? CP).color,
    });

    /** Semua hari wajib hadir (7 hari, tanpa libur). */
    const fullHadir = (eid: string) => D.map((t) => rec(eid, t));

    const names = new Map<string, string>([[SATU, "Andi"], [DUA, "Budi"]]);

    it("full hadir 7/7 tanpa manual → lolos rank 1", () => {
      const w = computeWeeklyChallenge(fullHadir(SATU), WS, TODAY, names);
      expect(w.isRunning).toBe(false);
      expect(w.items).toHaveLength(1);
      const p = w.items[0];
      expect(p.lolos).toBe(true);
      expect(p.rank).toBe(1);
      expect(p.hadirWajib).toBe(7);
      expect(p.totalWajib).toBe(7);
      expect(p.manual).toBe(0);
      expect(p.alasanGugur).toEqual([]);
    });

    it("1 manual masih lolos; 0 manual di atasnya; >1 manual gugur", () => {
      const duaDenganSatuManual = [
        ...fullHadir(DUA).map((r, i) => (i === 2 ? { ...r, is_manual: true } : r)),
      ];
      const w = computeWeeklyChallenge([...fullHadir(SATU), ...duaDenganSatuManual], WS, TODAY, names);
      expect(w.items.map((i) => `${i.nama}:${i.rank}`)).toEqual(["Andi:1", "Budi:2"]);
      expect(w.items[1].lolos).toBe(true);
      expect(w.items[1].manual).toBe(1);

      // Tambah 1 manual lagi untuk Budi → gugur karena manual > 1.
      const duaDenganDuaManual = duaDenganSatuManual.map((r) =>
        r.tanggal === D[3] ? { ...r, is_manual: true } : r,
      );
      const w2 = computeWeeklyChallenge([...fullHadir(SATU), ...duaDenganDuaManual], WS, TODAY, names);
      const budi = w2.items.find((i) => i.employee_id === DUA)!;
      expect(budi.lolos).toBe(false);
      expect(budi.rank).toBeNull();
      expect(budi.alasanGugur).toEqual(["2 absen manual (maks 1)"]);
      // Gugur tetap tampil di bawah peserta lolos.
      expect(w2.items[w2.items.length - 1].employee_id).toBe(DUA);
    });

    it("hari Libur terjadwal bersifat netral — tidak dihitung wajib", () => {
      const denganLibur = fullHadir(SATU).map((r, i) =>
        i === 3 ? rec(SATU, r.tanggal, "Libur") : r,
      );
      const w = computeWeeklyChallenge(denganLibur, WS, TODAY, names);
      expect(w.items[0].totalWajib).toBe(6);
      expect(w.items[0].hadirWajib).toBe(6);
      expect(w.items[0].lolos).toBe(true);
    });

    it("Izin/Sakit/Cuti/Alpha pada hari wajib → gugur beserta alasan hari", () => {
      const recs = fullHadir(SATU).map((r, i) => {
        if (i === 1) return rec(SATU, r.tanggal, "Izin");
        if (i === 5) return rec(SATU, r.tanggal, "Alpha");
        return r;
      });
      const w = computeWeeklyChallenge(recs, WS, TODAY, names);
      const p = w.items[0];
      expect(p.lolos).toBe(false);
      expect(p.rank).toBeNull();
      expect(p.hadirWajib).toBe(5);
      expect(p.totalWajib).toBe(7);
      expect(p.alasanGugur).toEqual(["Izin pada 8 Sep", "Alpha pada 12 Sep"]);
      expect(p.days.filter((d) => d.libur)).toEqual([]);
    });

    it("hari wajib tanpa record sama sekali → gugur 'Tanpa absen'", () => {
      const tanpaKamis = fullHadir(SATU).filter((r) => r.tanggal !== D[3]);
      const w = computeWeeklyChallenge(tanpaKamis, WS, TODAY, names);
      expect(w.items[0].hadirWajib).toBe(6);
      expect(w.items[0].alasanGugur).toEqual(["Tanpa absen pada 10 Sep"]);
    });

    it("minggu berjalan: hari mendatang belum dinilai, kosong bukan gugur", () => {
      const todayMid = D[3]; // Kamis — minggu berjalan
      // Andi hadir Senin–Kamis; Jumat–Minggu masih mendatang.
      const w = computeWeeklyChallenge(fullHadir(SATU).filter((r) => r.tanggal <= todayMid), WS, todayMid, names);
      expect(w.isRunning).toBe(true);
      expect(w.items[0].totalWajib).toBe(4);
      expect(w.items[0].hadirWajib).toBe(4);
      expect(w.items[0].lolos).toBe(true);
    });

    it("minggu mendatang: isFuture, tanpa peserta", () => {
      const w = computeWeeklyChallenge(fullHadir(SATU), "2026-10-19", "2026-10-15", names);
      expect(w.isFuture).toBe(true);
      expect(w.items).toEqual([]);
      expect(w.isRunning).toBe(false);
    });

    it("peserta hanya divisi dominan CP Suka; pegawai divisi lain diabaikan", () => {
      // Andi dominan CP Suka (5 vs 1); Budi semua di divisi lain → tidak jadi peserta.
      const recs = [
        ...fullHadir(SATU),
        rec(SATU, D[0], "Hadir", { div: LAIN }),
        ...fullHadir(DUA).map((r) => ({ ...r, division_id: LAIN.id, divisionNama: LAIN.nama, divisionColor: LAIN.color })),
      ];
      const w = computeWeeklyChallenge(recs, WS, TODAY, names);
      expect(w.items.map((i) => i.employee_id)).toEqual([SATU]);
      expect(w.items[0].divisionNama).toBe("Cp Suka");
    });

    it("record otomatis tanpa divisi (Libur/Alpha) tidak menentukan divisi dominan", () => {
      // 5 hari Libur tanpa divisi + 2 hari hadir CP Suka → dominan tetap CP Suka.
      const recs = fullHadir(SATU).map((r, i) =>
        i < 5 ? { ...r, division_id: null, divisionNama: null, divisionColor: null, status: "Libur" } : r,
      );
      const w = computeWeeklyChallenge(recs, WS, TODAY, names);
      expect(w.items).toHaveLength(1);
      // Libur netral → hanya 2 hari wajib, keduanya hadir.
      expect(w.items[0].totalWajib).toBe(2);
      expect(w.items[0].lolos).toBe(true);
    });

    it("rata-rata jam hanya dari record CP Suka; seri manual diputuskan jam paling awal", () => {
      const recs = [
        ...fullHadir(SATU).map((r) => rec(SATU, r.tanggal, "Hadir", { jam: "07:00" })),
        ...fullHadir(DUA).map((r) => rec(DUA, r.tanggal, "Hadir", { jam: "06:55" })),
        // Record pada divisi lain tidak ikut rata-rata (jadwal antar-divisi tidak setara).
        rec(DUA, D[0], "Hadir", { div: LAIN, jam: "01:00" }),
      ];
      const w = computeWeeklyChallenge(recs, WS, TODAY, names);
      expect(w.items.find((i) => i.employee_id === SATU)!.avgJamMasuk).toBe("07:00");
      // Rata-rata Budi tetap dari record CP Suka saja — record divisi lain (jam 01:00) diabaikan.
      const budi = w.items.find((i) => i.employee_id === DUA)!;
      expect(budi.avgJamMasuk).toBe("06:55");
      // Keduanya 0 manual & full hadir → Budi dengan rata-rata jam lebih awal rank 1.
      expect(w.items[0].employee_id).toBe(DUA);
      expect(w.items[1].employee_id).toBe(SATU);
    });
  });
});
