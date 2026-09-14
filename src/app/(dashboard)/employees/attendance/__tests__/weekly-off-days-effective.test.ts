import { describe, it, expect } from "vitest";
import {
  isWeeklyOffDay,
  isOffDayActiveOnDate,
  isAutoRestorableToLibur,
} from "../lib/attendance-helpers";

/**
 * Regresi: Dendi Saputra (ID99334) pindah libur mingguan Kamis -> Sabtu
 * efektif 2026-09-14. Perubahan tidak boleh menghitung ulang histori.
 */
const DENDI = "ID99334";
const DENDI_SCHEDULE = [
  { employee_id: DENDI, day_of_week: 4, effective_from: "2026-05-08", effective_to: "2026-09-13" },
  { employee_id: DENDI, day_of_week: 6, effective_from: "2026-09-14", effective_to: null },
];

function dowOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

describe("weekly off-days efektif (regresi Kamis -> Sabtu)", () => {
  it("Kamis historis sebelum cutoff tetap libur", () => {
    expect(dowOf("2026-09-03")).toBe(4);
    expect(isWeeklyOffDay(DENDI_SCHEDULE, DENDI, 4, "2026-09-03")).toBe(true);
    expect(isWeeklyOffDay(DENDI_SCHEDULE, DENDI, 4, "2026-08-06")).toBe(true);
    expect(isWeeklyOffDay(DENDI_SCHEDULE, DENDI, 4, "2026-05-28")).toBe(true);
  });

  it("Kamis setelah riwayat ditutup bukan libur lagi", () => {
    expect(dowOf("2026-09-17")).toBe(4);
    expect(isWeeklyOffDay(DENDI_SCHEDULE, DENDI, 4, "2026-09-17")).toBe(false);
  });

  it("Sabtu sebelum tanggal efektif bukan jadwal baru", () => {
    expect(dowOf("2026-09-12")).toBe(6);
    expect(isWeeklyOffDay(DENDI_SCHEDULE, DENDI, 6, "2026-09-12")).toBe(false);
  });

  it("Sabtu pada/setelah tanggal efektif menjadi libur", () => {
    // 2026-09-14 = Senin -> bukan hari libur Dendi.
    expect(isWeeklyOffDay(DENDI_SCHEDULE, DENDI, dowOf("2026-09-14"), "2026-09-14")).toBe(false);
    expect(dowOf("2026-09-19")).toBe(6);
    expect(isWeeklyOffDay(DENDI_SCHEDULE, DENDI, dowOf("2026-09-19"), "2026-09-19")).toBe(true);
    expect(isWeeklyOffDay(DENDI_SCHEDULE, DENDI, dowOf("2026-09-26"), "2026-09-26")).toBe(true);
  });

  it("batas efektif inklusif di kedua sisi", () => {
    expect(isOffDayActiveOnDate(DENDI_SCHEDULE[0], "2026-05-08")).toBe(true);
    expect(isOffDayActiveOnDate(DENDI_SCHEDULE[0], "2026-09-13")).toBe(true);
    expect(isOffDayActiveOnDate(DENDI_SCHEDULE[0], "2026-09-14")).toBe(false);
    expect(isOffDayActiveOnDate(DENDI_SCHEDULE[1], "2026-09-13")).toBe(false);
    expect(isOffDayActiveOnDate(DENDI_SCHEDULE[1], "2026-09-14")).toBe(true);
  });

  it("baris legacy tanpa tanggal efektif dianggap aktif sejak MIN_DATE", () => {
    const legacy = { employee_id: DENDI, day_of_week: 0 };
    expect(isOffDayActiveOnDate(legacy, "2026-06-01")).toBe(true);
    expect(isOffDayActiveOnDate(legacy, "2026-05-01")).toBe(false);
  });

  it("record Alpha otomatis boleh dipulihkan menjadi Libur", () => {
    expect(isAutoRestorableToLibur({
      status: "Alpha",
      catatan: "Alpha otomatis — tidak ada record kehadiran",
      is_manual: false,
    })).toBe(true);
  });

  it("record Izin/Sakit/Cuti otomatis boleh dipulihkan menjadi Libur", () => {
    expect(isAutoRestorableToLibur({
      status: "Izin",
      catatan: "Izin otomatis — sudah disetujui",
      is_manual: false,
    })).toBe(true);
  });

  it("record Hadir/Terlambat/manual/Libur tidak pernah ditimpa", () => {
    expect(isAutoRestorableToLibur({ status: "Hadir", catatan: null, is_manual: false })).toBe(false);
    expect(isAutoRestorableToLibur({ status: "Terlambat", catatan: null, is_manual: false })).toBe(false);
    expect(isAutoRestorableToLibur({ status: "Libur", catatan: "Hari libur", is_manual: false })).toBe(false);
    expect(isAutoRestorableToLibur({
      status: "Alpha",
      catatan: "Alpha otomatis — tidak ada record kehadiran",
      is_manual: true,
    })).toBe(false);
    // Izin dari approval (catatan "Jenis: alasan") bukan auto -> jangan restore.
    expect(isAutoRestorableToLibur({ status: "Izin", catatan: "Izin: sakit kepala", is_manual: false })).toBe(false);
  });
});
