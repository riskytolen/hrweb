import { describe, expect, it } from "vitest";
import {
  LOGGER_TRIP_EXPORT_EXCEL_HEADERS,
  LOGGER_TRIP_EXPORT_PDF_HEADERS,
  formatLoggerTripDuration,
  formatLoggerTripTemp,
  loggerTripDurationSeconds,
  loggerTripExportFileStamp,
  loggerTripVisitStatusLabel,
  toLoggerTripExcelRow,
  toLoggerTripPdfRow,
  type LoggerTripExportRow,
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

  it("membangun baris Excel 12 kolom dan PDF 9 kolom", () => {
    const nowMs = Date.parse("2026-09-22T08:00:00+07:00");
    const excel = toLoggerTripExcelRow(BASE_ROW, 0, nowMs);
    expect(excel).toHaveLength(LOGGER_TRIP_EXPORT_EXCEL_HEADERS.length);
    expect(excel[0]).toBe("1");
    expect(excel[1]).toBe("B 1234 TES");
    expect(excel[9]).toBe("Selesai");
    expect(excel[10]).toBe("-16,2°C");

    const pdf = toLoggerTripPdfRow(BASE_ROW, 0, nowMs);
    expect(pdf).toHaveLength(LOGGER_TRIP_EXPORT_PDF_HEADERS.length);
    expect(pdf[0]).toBe("1");
    expect(pdf[7]).toBe("Selesai");

    // Baris berjalan menampilkan "Di lokasi" pada kolom keluar.
    const ongoingExcel = toLoggerTripExcelRow({ ...BASE_ROW, exitedAt: null }, 1, nowMs);
    expect(ongoingExcel[7]).toBe("Di lokasi");
    expect(ongoingExcel[9]).toBe("Di lokasi");
  });

  it("membuat stamp file zona Jakarta", () => {
    const stamp = loggerTripExportFileStamp(new Date("2026-09-30T10:00:00Z"));
    // 10:00 UTC = 17:00 WIB.
    expect(stamp).toBe("20260930-1700");
  });
});
