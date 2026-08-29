import { describe, expect, it } from "vitest";
import { daysUntilGapok, summarizeGapokSchedule } from "@/lib/gapok";

describe("gapok schedule helpers", () => {
  it("compares calendar dates without a UTC timezone shift", () => {
    expect(daysUntilGapok("2026-08-29", "2026-08-29")).toBe(0);
    expect(daysUntilGapok("2026-08-30", "2026-08-29")).toBe(1);
    expect(daysUntilGapok("2026-08-28", "2026-08-29")).toBe(-1);
  });

  it("uses the configured notification window", () => {
    const events = [
      { due_date: "2026-08-28" },
      { due_date: "2026-08-29" },
      { due_date: "2026-09-12" },
      { due_date: "2026-09-13" },
    ];

    expect(summarizeGapokSchedule(events, 14, "2026-08-29")).toEqual({
      overdue: 2,
      dueToday: 1,
      upcoming: 1,
    });
  });
});
