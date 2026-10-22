import { describe, it, expect } from "vitest";
import {
  buildChallengePdfFilename,
  buildChallengePdfRows,
  challengeMedalColor,
} from "../lib/attendance-challenge-pdf";
import type { ChallengeEmployeeResult } from "../lib/attendance-helpers";

/** Fixture peserta challenge dengan default lolos rank tertentu. */
function makeItem(overrides: Partial<ChallengeEmployeeResult>): ChallengeEmployeeResult {
  return {
    employee_id: "emp-1",
    nama: "Budi",
    divisionNama: "CP Suka",
    divisionColor: "#f59e0b",
    hadirWajib: 6,
    totalWajib: 6,
    manual: 0,
    avgJamMasuk: "07:35:00",
    avgJamDetik: 27300,
    lolos: true,
    alasanGugur: [],
    rank: 1,
    statusCounts: { hadir: 6, terlambat: 0, izin: 0, sakit: 0, cuti: 0, alpha: 0, libur: 0 },
    days: [],
    ...overrides,
  };
}

describe("attendance-challenge-pdf", () => {
  describe("buildChallengePdfFilename", () => {
    it("format Challenge_CP_Suka_<weekStart>_<weekEnd>.pdf", () => {
      expect(buildChallengePdfFilename("2026-10-19", "2026-10-25")).toBe(
        "Challenge_CP_Suka_2026-10-19_2026-10-25.pdf",
      );
    });
  });

  describe("challengeMedalColor", () => {
    it("rank 1 = emas", () => {
      expect(challengeMedalColor(1)).toEqual([217, 119, 6]);
    });

    it("rank 2 = perak", () => {
      expect(challengeMedalColor(2)).toEqual([100, 116, 139]);
    });

    it("rank 3 = perunggu", () => {
      expect(challengeMedalColor(3)).toEqual([180, 83, 9]);
    });

    it("rank di luar 1-3 dan gugur = null", () => {
      expect(challengeMedalColor(4)).toBeNull();
      expect(challengeMedalColor(null)).toBeNull();
    });
  });

  describe("buildChallengePdfRows", () => {
    it("peserta lolos: rank angka, status LOLOS, rekap status terisi", () => {
      const rows = buildChallengePdfRows([
        makeItem({
          nama: "Siti",
          rank: 2,
          manual: 1,
          statusCounts: { hadir: 5, terlambat: 1, izin: 0, sakit: 0, cuti: 0, alpha: 0, libur: 0 },
        }),
      ]);
      expect(rows).toEqual([
        ["2", "Siti", "6/6", "5", "1", "0", "0", "0", "0", "0", "1", "07:35:00", "LOLOS"],
      ]);
    });

    it("peserta gugur: rank em dash, status = gabungan alasan", () => {
      const rows = buildChallengePdfRows([
        makeItem({
          nama: "Rudi",
          lolos: false,
          rank: null,
          alasanGugur: ["Izin pada 19 Okt", "2 absen manual (maks 1)"],
          avgJamMasuk: null,
          avgJamDetik: null,
          statusCounts: { hadir: 4, terlambat: 0, izin: 1, sakit: 0, cuti: 0, alpha: 1, libur: 0 },
        }),
      ]);
      expect(rows).toEqual([
        ["—", "Rudi", "6/6", "4", "0", "1", "0", "0", "1", "0", "0", "—", "Izin pada 19 Okt • 2 absen manual (maks 1)"],
      ]);
    });

    it("urutan baris mengikuti urutan input (rank lolos → gugur di bawah)", () => {
      const rows = buildChallengePdfRows([
        makeItem({ nama: "A", rank: 1, lolos: true }),
        makeItem({ nama: "B", rank: 2, lolos: true }),
        makeItem({ nama: "C", rank: null, lolos: false, alasanGugur: ["Alpha pada 20 Okt"] }),
      ]);
      expect(rows.map((r) => r[0])).toEqual(["1", "2", "—"]);
      expect(rows.map((r) => r[1])).toEqual(["A", "B", "C"]);
      expect(rows.map((r) => r[12])).toEqual(["LOLOS", "LOLOS", "Alpha pada 20 Okt"]);
    });
  });
});
