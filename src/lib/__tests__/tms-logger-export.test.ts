import { describe, expect, it } from "vitest";
import {
  LOGGER_TRIP_EXPORT_EXCEL_HEADERS,
  LOGGER_TRIP_EXPORT_PDF_HEADERS,
  PROFILE_TRIP_EXPORT_EXCEL_HEADERS,
  PROFILE_TRIP_EXPORT_PDF_HEADERS,
  formatLoggerTripDuration,
  formatLoggerTripTemp,
  formatProfileScheduleTime,
  loggerTripDurationSeconds,
  loggerTripExportFileStamp,
  loggerTripVisitStatusLabel,
  toLoggerTripExcelRow,
  toLoggerTripPdfRow,
  toProfileTripExcelRow,
  toProfileTripPdfRow,
  type LoggerTripExportRow,
  type ProfileTripExportRow,
} from "@/lib/tms-logger-export";

const BASE_ROW: LoggerTripExportRow = {
  id: "row-1",
  taskNumber: "FO-1001",
  taskStatus: "STARTED",
  unit: "B 1234 TES",
  driver: "ASEP SURAHMAN",
  routeSequence: 2,
  store: "Toko A",
  address: "Jl. A No. 1",
  enteredAt: "2026-09-22T06:12:00+07:00",
  exitedAt: "2026-09-22T06:47:00+07:00",
  temperatureC: -16.2,
  groupName: "CP",
  slaProfileCode: "VAN 9",
  slaKind: "ARRIVAL",
  slaTargetAt: "2026-09-22T06:15:00+07:00",
  slaStatus: "LATE",
  slaDeltaSeconds: 1920,
};

describe("tms-logger-export", () => {
  it("memberi label status yang konsisten dengan badge tabel", () => {
    expect(loggerTripVisitStatusLabel(BASE_ROW)).toBe("Selesai");
    expect(loggerTripVisitStatusLabel({ ...BASE_ROW, exitedAt: null })).toBe("Di lokasi");
    expect(loggerTripVisitStatusLabel({ ...BASE_ROW, enteredAt: null, exitedAt: null })).toBe(
      "Belum dikunjungi",
    );
    expect(loggerTripVisitStatusLabel({ ...BASE_ROW, enteredAt: null })).toBe("Waktu tak lengkap");
    // Keluar sebelum masuk dianggap tak lengkap.
    expect(
      loggerTripVisitStatusLabel({
        ...BASE_ROW,
        enteredAt: "2026-09-22T07:00:00+07:00",
        exitedAt: "2026-09-22T06:00:00+07:00",
      }),
    ).toBe("Waktu tak lengkap");
  });

  it("menghitung durasi selesai dan berjalan", () => {
    // 06:12 -> 06:47 = 35 menit = 2100 detik.
    expect(loggerTripDurationSeconds(BASE_ROW, Date.now())).toBe(2100);
    const ongoing = { ...BASE_ROW, exitedAt: null };
    const nowMs = Date.parse("2026-09-22T07:12:00+07:00");
    expect(loggerTripDurationSeconds(ongoing, nowMs)).toBe(3600);
    expect(loggerTripDurationSeconds({ ...BASE_ROW, enteredAt: null, exitedAt: null }, nowMs)).toBeNull();
  });

  it("memformat durasi dan suhu gaya Indonesia", () => {
    expect(formatLoggerTripDuration(null)).toBe("–");
    expect(formatLoggerTripDuration(45)).toBe("45 dtk");
    expect(formatLoggerTripDuration(2100)).toBe("35 mnt");
    expect(formatLoggerTripDuration(5400)).toBe("1 jam 30 mnt");
    expect(formatLoggerTripTemp(null)).toBe("–");
    expect(formatLoggerTripTemp(-16.2)).toBe("-16,2°C");
  });

  it("membangun baris Excel 18 kolom dan PDF 10 kolom", () => {
    const nowMs = Date.parse("2026-09-22T08:00:00+07:00");
    const excel = toLoggerTripExcelRow(BASE_ROW, 0, nowMs);
    expect(excel).toHaveLength(LOGGER_TRIP_EXPORT_EXCEL_HEADERS.length);
    expect(excel[0]).toBe("1");
    expect(excel[1]).toBe("B 1234 TES");
    expect(excel[9]).toBe("Selesai");
    expect(excel[10]).toBe("-16,2°C");
    expect(excel[12]).toBe("CP");
    expect(excel[13]).toBe("VAN 9");
    expect(excel[14]).toBe("Kedatangan");
    expect(excel[16]).toBe("Terlambat");
    expect(excel[17]).toBe("Terlambat 32 mnt");

    const pdf = toLoggerTripPdfRow(BASE_ROW, 0, nowMs);
    expect(pdf).toHaveLength(LOGGER_TRIP_EXPORT_PDF_HEADERS.length);
    expect(pdf[0]).toBe("1");
    expect(pdf[8]).toBe("Terlambat");

    // Baris berjalan menampilkan "Di lokasi" pada kolom keluar.
    const ongoingExcel = toLoggerTripExcelRow({ ...BASE_ROW, exitedAt: null }, 1, nowMs);
    expect(ongoingExcel[7]).toBe("Di lokasi");
    expect(ongoingExcel[9]).toBe("Di lokasi");

    // Tanpa snapshot SLA: kolom SLA menampilkan strip.
    const noSla = toLoggerTripExcelRow(
      { ...BASE_ROW, slaTargetAt: null, slaStatus: null, slaDeltaSeconds: null, slaProfileCode: null },
      2,
      nowMs,
    );
    expect(noSla[13]).toBe("–");
    expect(noSla[16]).toBe("–");
    expect(noSla[17]).toBe("–");
  });

  it("membuat stamp file zona Jakarta", () => {
    const stamp = loggerTripExportFileStamp(new Date("2026-09-30T10:00:00Z"));
    // 10:00 UTC = 17:00 WIB.
    expect(stamp).toBe("20260930-1700");
  });

  it("memformat jam jadwal profil dan baris export profil", () => {
    expect(formatProfileScheduleTime("04:15:00")).toBe("04.15");
    expect(formatProfileScheduleTime("4:05")).toBe("04.05");
    expect(formatProfileScheduleTime("–")).toBe("–");

    const row: ProfileTripExportRow = {
      serviceDate: "2026-09-30",
      taskNumber: "FO-1",
      unit: "B 1 TES",
      driver: "DRIVER",
      routeOrder: 2,
      storeName: "Toko A",
      slaKind: "ARRIVAL",
      scheduleTarget: "04:58:00",
      slaTargetAt: "2026-09-30T04:58:00+07:00",
      enteredAt: "2026-09-30T04:50:00+07:00",
      exitedAt: "2026-09-30T05:00:00+07:00",
      slaStatus: "ON_TIME",
      slaDeltaSeconds: -480,
      temperatureC: -16.2,
    };
    const excel = toProfileTripExcelRow(row, 0);
    expect(excel).toHaveLength(PROFILE_TRIP_EXPORT_EXCEL_HEADERS.length);
    expect(excel[0]).toBe("1");
    expect(excel[5]).toBe("2");
    expect(excel[6]).toBe("Toko A");
    expect(excel[7]).toBe("Kedatangan");
    expect(excel[8]).toBe("04.58");
    expect(excel[12]).toBe("Tepat Waktu");
    expect(excel[13]).toBe("8 mnt lebih awal");
    expect(excel[14]).toBe("-16,2°C");

    const pdf = toProfileTripPdfRow(row, 0);
    expect(pdf).toHaveLength(PROFILE_TRIP_EXPORT_PDF_HEADERS.length);
    expect(pdf[1]).toBe("Toko A");
    expect(pdf[5]).toBe("Tepat Waktu");

    // Titik yang belum dikunjungi menampilkan status tunggu.
    const pending = toProfileTripExcelRow(
      { ...row, enteredAt: null, exitedAt: null, slaStatus: "PENDING", slaDeltaSeconds: null },
      1,
    );
    expect(pending[11]).toBe("Belum dikunjungi");
    expect(pending[12]).toBe("Belum Tiba");
  });
});
