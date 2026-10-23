import { describe, expect, it } from "vitest";
import {
  buildForecastFilename,
  buildForecastWeeks,
  clampDateToWeek,
  computeForecast,
  daysInForecastMonth,
  forecastMonthLabel,
  forecastMonthStart,
  rowsForWeek,
  shiftForecastPeriodKey,
  validateForecastDraft,
  weekNoForDate,
  type ForecastDraftInput,
} from "@/lib/finance-forecast";

describe("buildForecastWeeks", () => {
  it("membagi Agustus menjadi 1–7, 8–14, 15–21, 22–31", () => {
    const weeks = buildForecastWeeks("2026-08");
    expect(weeks).toHaveLength(4);
    expect(weeks.map((w) => [w.start, w.end])).toEqual([
      ["2026-08-01", "2026-08-07"],
      ["2026-08-08", "2026-08-14"],
      ["2026-08-15", "2026-08-21"],
      ["2026-08-22", "2026-08-31"],
    ]);
    expect(weeks[0].rangeLabel).toBe("1–7 Agu 2026");
    expect(weeks[3].rangeLabel).toBe("22–31 Agu 2026");
  });

  it("menutup minggu keempat di 28 Februari 2026", () => {
    const weeks = buildForecastWeeks("2026-02");
    expect(weeks[3].start).toBe("2026-02-22");
    expect(weeks[3].end).toBe("2026-02-28");
    expect(weeks[3].rangeLabel).toBe("22–28 Feb 2026");
  });

  it("mendukung tahun kabisat 29 Februari", () => {
    const weeks = buildForecastWeeks("2028-02");
    expect(daysInForecastMonth("2028-02")).toBe(29);
    expect(weeks[3].end).toBe("2028-02-29");
  });
});

describe("periode forecast", () => {
  it("membuat label bulan dan tanggal awal", () => {
    expect(forecastMonthLabel("2026-08")).toBe("Agustus 2026");
    expect(forecastMonthStart("2026-08")).toBe("2026-08-01");
  });

  it("menggeser periode melewati batas tahun", () => {
    expect(shiftForecastPeriodKey("2026-12", 1)).toBe("2027-01");
    expect(shiftForecastPeriodKey("2026-01", -1)).toBe("2025-12");
    expect(shiftForecastPeriodKey("2026-08", -3)).toBe("2026-05");
  });
});

describe("pemetaan tanggal ke minggu", () => {
  const weeks = buildForecastWeeks("2026-08");

  it("mengenali tanggal pada tiap minggu", () => {
    expect(weekNoForDate("2026-08-01", weeks)).toBe(1);
    expect(weekNoForDate("2026-08-07", weeks)).toBe(1);
    expect(weekNoForDate("2026-08-08", weeks)).toBe(2);
    expect(weekNoForDate("2026-08-21", weeks)).toBe(3);
    expect(weekNoForDate("2026-08-22", weeks)).toBe(4);
    expect(weekNoForDate("2026-08-31", weeks)).toBe(4);
  });

  it("menolak tanggal di luar bulan atau format salah", () => {
    expect(weekNoForDate("2026-09-01", weeks)).toBeNull();
    expect(weekNoForDate("2026-07-31", weeks)).toBeNull();
    expect(weekNoForDate("2026-8-1", weeks)).toBeNull();
  });

  it("clamp tanggal ke rentang minggu", () => {
    expect(clampDateToWeek("2026-07-15", weeks[1])).toBe("2026-08-08");
    expect(clampDateToWeek("2026-09-02", weeks[1])).toBe("2026-08-14");
    expect(clampDateToWeek("2026-08-11", weeks[1])).toBe("2026-08-11");
    expect(clampDateToWeek(null, weeks[2])).toBe("2026-08-15");
  });

  it("mengambil baris per minggu dengan urutan tetap", () => {
    const rows = [
      { week_no: 2, id: "a" },
      { week_no: 1, id: "b" },
      { week_no: 2, id: "c" },
    ];
    expect(rowsForWeek(rows, 2).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("computeForecast", () => {
  // Data contoh: saldo awal 5.201.112, dana tersedia 786.703.239,
  // pengeluaran 742.896.267, admin 45.000 → saldo akhir 43.761.972.
  const incomes = [
    { week_no: 1, amount: 150_000_000 },
    { week_no: 2, amount: 10_000_000 },
    { week_no: 3, amount: 5_000_000 },
    { week_no: 4, amount: 616_502_127 },
  ];
  const expenses = [
    { week_no: 1, amount: 43_926_071, payment: 0, admin: 0 },
    { week_no: 2, amount: 106_757_980, payment: 0, admin: 0 },
    { week_no: 3, amount: 11_092_464, payment: 0, admin: 0 },
    { week_no: 4, amount: 581_119_752, payment: 0, admin: 45_000 },
  ];

  it("menghasilkan saldo akhir contoh 43.761.972", () => {
    const summary = computeForecast(5_201_112, incomes, expenses);
    expect(summary.totalIncome).toBe(781_502_127);
    expect(summary.totalAvailable).toBe(786_703_239);
    expect(summary.totalNominalOut).toBe(742_896_267);
    expect(summary.totalAdmin).toBe(45_000);
    expect(summary.closingBalance).toBe(43_761_972);
    expect(summary.netChange).toBe(38_560_860);
  });

  it("merantai saldo awal minggu berikutnya dari saldo akhir sebelumnya", () => {
    const summary = computeForecast(5_201_112, incomes, expenses);
    expect(summary.weeks.map((w) => w.closing)).toEqual([
      111_275_041,
      14_517_061,
      8_424_597,
      43_761_972,
    ]);
    expect(summary.weeks[1].opening).toBe(summary.weeks[0].closing);
    expect(summary.weeks[2].opening).toBe(summary.weeks[1].closing);
    expect(summary.weeks[3].opening).toBe(summary.weeks[2].closing);
    expect(summary.weeks[3].closing).toBe(summary.closingBalance);
  });

  it("memisahkan nominal, pembayaran, dan sisa tanpa mengubah saldo", () => {
    const summary = computeForecast(1_000_000, [], [
      { week_no: 1, amount: 400_000, payment: 150_000, admin: 5_000 },
    ]);
    const week = summary.weeks[0];
    expect(week.nominalOut).toBe(400_000);
    expect(week.payment).toBe(150_000);
    expect(week.sisa).toBe(250_000);
    expect(week.admin).toBe(5_000);
    expect(week.closing).toBe(595_000);
    expect(summary.totalSisa).toBe(250_000);
    expect(summary.totalPayment).toBe(150_000);
  });

  it("mengizinkan saldo akhir negatif (defisit forecast)", () => {
    const summary = computeForecast(100_000, [], [
      { week_no: 1, amount: 250_000, payment: 0, admin: 0 },
    ]);
    expect(summary.closingBalance).toBe(-150_000);
    expect(summary.weeks[0].closing).toBe(-150_000);
  });
});

describe("validateForecastDraft", () => {
  const base: ForecastDraftInput = {
    periodKey: "2026-08",
    openingBalance: 1_000_000,
    incomes: [
      {
        week_no: 1,
        planned_date: "2026-08-03",
        description: "Pelunasan invoice",
        amount: 500_000,
        invoice_id: 10,
      },
    ],
    expenses: [
      {
        week_no: 2,
        planned_date: "2026-08-10",
        description: "Gaji driver",
        amount: 300_000,
        payment: 100_000,
        admin: 5_000,
      },
    ],
  };

  it("menerima draft yang lengkap", () => {
    expect(validateForecastDraft(base)).toEqual([]);
  });

  it("menolak keterangan kosong dan nominal nol", () => {
    const errors = validateForecastDraft({
      ...base,
      incomes: [{ ...base.incomes[0], description: "   ", amount: 0 }],
    });
    expect(errors.some((e) => e.includes("keterangan wajib diisi"))).toBe(true);
    expect(errors.some((e) => e.includes("nominal harus lebih dari 0"))).toBe(true);
  });

  it("menolak pembayaran melebihi nominal dan admin negatif", () => {
    const errors = validateForecastDraft({
      ...base,
      expenses: [{ ...base.expenses[0], amount: 100_000, payment: 150_000, admin: -1 }],
    });
    expect(errors.some((e) => e.includes("pembayaran tidak boleh melebihi nominal"))).toBe(true);
    expect(errors.some((e) => e.includes("admin tidak boleh negatif"))).toBe(true);
  });

  it("menolak tanggal di luar rentang minggu", () => {
    const errors = validateForecastDraft({
      ...base,
      incomes: [{ ...base.incomes[0], planned_date: "2026-08-09" }],
    });
    expect(errors.some((e) => e.includes("tanggal harus di dalam rentang minggu 1"))).toBe(true);
  });

  it("menolak saldo awal negatif", () => {
    expect(validateForecastDraft({ ...base, openingBalance: -1 })).toContain(
      "Saldo awal bulan tidak boleh negatif.",
    );
  });

  it("menolak invoice yang sama dipakai dua kali", () => {
    const errors = validateForecastDraft({
      ...base,
      incomes: [
        base.incomes[0],
        {
          week_no: 2,
          planned_date: "2026-08-10",
          description: "Invoice yang sama",
          amount: 200_000,
          invoice_id: 10,
        },
      ],
    });
    expect(errors).toContain("Invoice yang sama dipakai lebih dari sekali dalam satu bulan.");
  });
});

describe("buildForecastFilename", () => {
  it("memakai period key dan ekstensi", () => {
    expect(buildForecastFilename("pdf", "2026-08")).toBe("Forecast_Finance_2026-08.pdf");
    expect(buildForecastFilename("xlsx", "2026-08")).toBe("Forecast_Finance_2026-08.xlsx");
  });
});
