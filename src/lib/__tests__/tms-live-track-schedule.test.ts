import { describe, expect, it } from "vitest";
import {
  currentLiveTrackWindowBounds,
  formatLiveTrackClock,
  isLiveTrackWindowActive,
  normalizeLiveTrackPlateKey,
  parseClockToMinutes,
} from "@/lib/tms-live-track-schedule";

// WIB = UTC+7.
const at = (isoUtc: string): number => Date.parse(isoUtc);

describe("parseClockToMinutes", () => {
  it("parses HH:MM and HH:MM:SS", () => {
    expect(parseClockToMinutes("06:00")).toBe(360);
    expect(parseClockToMinutes("20:00:30")).toBe(1200);
    expect(parseClockToMinutes(" 07:05 ")).toBe(425);
  });

  it("rejects invalid clocks", () => {
    expect(parseClockToMinutes(null)).toBeNull();
    expect(parseClockToMinutes("")).toBeNull();
    expect(parseClockToMinutes("24:00")).toBeNull();
    expect(parseClockToMinutes("6:00")).toBeNull();
    expect(parseClockToMinutes("ab:cd")).toBeNull();
  });
});

describe("isLiveTrackWindowActive", () => {
  it("activates same-day windows inclusively at start, exclusively at end", () => {
    // 06:00–18:00 WIB.
    expect(isLiveTrackWindowActive(360, 1080, at("2026-09-27T23:00:00Z"))).toBe(true); // 06:00 WIB
    expect(isLiveTrackWindowActive(360, 1080, at("2026-09-28T10:59:00Z"))).toBe(true); // 17:59 WIB
    expect(isLiveTrackWindowActive(360, 1080, at("2026-09-28T11:00:00Z"))).toBe(false); // 18:00 WIB
    expect(isLiveTrackWindowActive(360, 1080, at("2026-09-27T22:59:00Z"))).toBe(false); // 05:59 WIB
  });

  it("supports overnight windows", () => {
    // 20:00–05:00 WIB.
    expect(isLiveTrackWindowActive(1200, 300, at("2026-09-28T13:00:00Z"))).toBe(true); // 20:00 WIB
    expect(isLiveTrackWindowActive(1200, 300, at("2026-09-28T21:00:00Z"))).toBe(true); // 04:00 WIB (besok)
    expect(isLiveTrackWindowActive(1200, 300, at("2026-09-28T22:00:00Z"))).toBe(false); // 05:00 WIB
    expect(isLiveTrackWindowActive(1200, 300, at("2026-09-28T10:00:00Z"))).toBe(false); // 17:00 WIB
  });

  it("rejects ambiguous or invalid windows", () => {
    expect(isLiveTrackWindowActive(360, 360, at("2026-09-28T00:00:00Z"))).toBe(false);
    expect(isLiveTrackWindowActive(null, 360, at("2026-09-28T00:00:00Z"))).toBe(false);
    expect(isLiveTrackWindowActive(360, null, at("2026-09-28T00:00:00Z"))).toBe(false);
  });
});

describe("currentLiveTrackWindowBounds", () => {
  it("bounds same-day windows", () => {
    // 10:00 UTC = 17:00 WIB pada 28 Sep 2026.
    const bounds = currentLiveTrackWindowBounds(360, 1080, at("2026-09-28T10:00:00Z"));
    expect(bounds?.windowStartedAt).toBe("2026-09-27T23:00:00.000Z"); // 06:00 WIB
    expect(bounds?.visibleUntil).toBe("2026-09-28T11:00:00.000Z"); // 18:00 WIB
  });

  it("bounds overnight windows starting today", () => {
    // 14:00 UTC = 21:00 WIB pada 28 Sep 2026; window 20:00–05:00.
    const bounds = currentLiveTrackWindowBounds(1200, 300, at("2026-09-28T14:00:00Z"));
    expect(bounds?.windowStartedAt).toBe("2026-09-28T13:00:00.000Z"); // 20:00 WIB
    expect(bounds?.visibleUntil).toBe("2026-09-28T22:00:00.000Z"); // 05:00 WIB besok
  });

  it("bounds overnight windows started yesterday", () => {
    // 20:00 UTC = 03:00 WIB pada 29 Sep 2026; window 20:00–05:00.
    const bounds = currentLiveTrackWindowBounds(1200, 300, at("2026-09-28T20:00:00Z"));
    expect(bounds?.windowStartedAt).toBe("2026-09-28T13:00:00.000Z"); // 20:00 WIB 28 Sep
    expect(bounds?.visibleUntil).toBe("2026-09-28T22:00:00.000Z"); // 05:00 WIB 29 Sep
  });

  it("returns null for ambiguous windows", () => {
    expect(currentLiveTrackWindowBounds(360, 360, at("2026-09-28T10:00:00Z"))).toBeNull();
    expect(currentLiveTrackWindowBounds(null, 1080, at("2026-09-28T10:00:00Z"))).toBeNull();
  });
});

describe("normalizeLiveTrackPlateKey", () => {
  it("canonicalizes plates", () => {
    expect(normalizeLiveTrackPlateKey("B 9448 BRO")).toBe("B9448BRO");
    expect(normalizeLiveTrackPlateKey("b-9448.bro")).toBe("B9448BRO");
    expect(normalizeLiveTrackPlateKey(null)).toBe("");
  });
});

describe("formatLiveTrackClock", () => {
  it("formats clocks in Indonesian style", () => {
    expect(formatLiveTrackClock("06:00")).toBe("06.00");
    expect(formatLiveTrackClock("20:00:00")).toBe("20.00");
    expect(formatLiveTrackClock("invalid")).toBe("–");
  });
});
