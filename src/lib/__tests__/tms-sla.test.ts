import { describe, expect, it } from "vitest";
import {
  computeSlaDeltaSeconds,
  computeSlaTargetAt,
  evaluateSlaStatus,
  formatSlaCompliance,
  formatSlaDelta,
  matchSlaRouteProfile,
  normalizeSlaStoreKey,
  slaServiceDate,
  slaStatusLabel,
} from "@/lib/tms-sla";

describe("tms-sla", () => {
  it("menormalisasi kunci nama toko", () => {
    expect(normalizeSlaStoreKey("Toko Kopi Tuku  Pulo Asem")).toBe("pulo asem");
    expect(normalizeSlaStoreKey("  TOKO KOPI TUKU Bp Sunter ")).toBe("bp sunter");
    expect(normalizeSlaStoreKey(null)).toBe("");
  });

  it("mencocokkan profil dari irisan toko FO", () => {
    const profiles = [
      { id: "van-1", code: "VAN 1", addressIds: ["272", "154625", "273", "6117", "278"] },
      { id: "van-3", code: "VAN 3", addressIds: ["195837", "300613", "270", "154626", "274"] },
    ];
    const match = matchSlaRouteProfile(["195837", "300613", "270", "154626", "274"], profiles);
    expect(match).toMatchObject({ profileId: "van-3", matched: 5, total: 5, score: 1 });
  });

  it("mengikuti kendaraan yang bertukar rute (bukan nomor polisi)", () => {
    const profiles = [
      { id: "van-1", code: "VAN 1", addressIds: ["272", "154625"] },
      { id: "van-2", code: "VAN 2", addressIds: ["30533", "285"] },
    ];
    // FO berisi toko VAN 2 -> tetap dikenali walau unit biasanya VAN 1.
    expect(matchSlaRouteProfile(["30533", "285"], profiles)?.profileId).toBe("van-2");
  });

  it("menolak kecocokan lemah di bawah ambang", () => {
    const profiles = [{ id: "van-1", code: "VAN 1", addressIds: ["272", "154625", "273", "6117", "278"] }];
    expect(matchSlaRouteProfile(["272", "999", "998", "997"], profiles)).toBeNull();
    expect(matchSlaRouteProfile([], profiles)).toBeNull();
    expect(matchSlaRouteProfile(["272"], [])).toBeNull();
  });

  it("memecah tie-break berdasarkan kode profil", () => {
    const profiles = [
      { id: "van-9", code: "VAN 9", addressIds: ["43690"] },
      { id: "van-1", code: "VAN 1", addressIds: ["43690"] },
    ];
    expect(matchSlaRouteProfile(["43690"], profiles)?.profileId).toBe("van-1");
  });

  it("menghitung tanggal layanan zona Jakarta", () => {
    // 29 Sep 19:30 UTC = 30 Sep 02:30 WIB.
    expect(slaServiceDate("2026-09-29T19:30:00Z")).toBe("2026-09-30");
    expect(slaServiceDate("bukan-tanggal")).toBeNull();
  });

  it("membangun target lintas tengah malam via offset hari", () => {
    const target = computeSlaTargetAt("2026-09-30", "01:00", 1);
    expect(target).toBe("2026-09-30T18:00:00.000Z"); // 1 Okt 01:00 WIB
    expect(computeSlaTargetAt("2026-09-30", "04:58", 0)).toBe("2026-09-29T21:58:00.000Z");
    expect(computeSlaTargetAt("30-09-2026", "04:58", 0)).toBeNull();
    expect(computeSlaTargetAt("2026-09-30", "pagi", 0)).toBeNull();
  });

  it("menilai tanpa toleransi dan tanpa vonis sebelum tiba", () => {
    const target = "2026-09-29T21:58:00.000Z";
    expect(evaluateSlaStatus(target, "2026-09-29T21:58:00.000Z")).toBe("ON_TIME");
    expect(evaluateSlaStatus(target, "2026-09-29T21:58:01.000Z")).toBe("LATE");
    expect(evaluateSlaStatus(target, null)).toBe("PENDING");
    expect(evaluateSlaStatus(null, "2026-09-29T21:58:01.000Z")).toBe("UNSET");
    expect(evaluateSlaStatus(null, null)).toBe("UNSET");
  });

  it("menghitung selisih detik aktual - target", () => {
    expect(computeSlaDeltaSeconds("2026-09-29T21:58:00.000Z", "2026-09-29T22:10:00.000Z")).toBe(720);
    expect(computeSlaDeltaSeconds("2026-09-29T21:58:00.000Z", "2026-09-29T21:47:51.000Z")).toBe(-609);
    expect(computeSlaDeltaSeconds(null, "2026-09-29T21:47:51.000Z")).toBeNull();
  });

  it("memformat label status dan selisih", () => {
    expect(slaStatusLabel("ON_TIME")).toBe("Tepat Waktu");
    expect(slaStatusLabel("LATE")).toBe("Terlambat");
    expect(slaStatusLabel("PENDING", "ARRIVAL")).toBe("Belum Tiba");
    expect(slaStatusLabel("PENDING", "DEPARTURE")).toBe("Belum Berangkat");
    expect(slaStatusLabel("UNSET")).toBe("SLA Belum Diatur");
    expect(slaStatusLabel(null)).toBe("–");
    expect(formatSlaDelta(720)).toBe("Terlambat 12 mnt");
    expect(formatSlaDelta(-609)).toBe("10 mnt lebih awal");
    expect(formatSlaDelta(0)).toBe("Pas target");
    expect(formatSlaDelta(null)).toBe("–");
    expect(formatSlaCompliance(0.857)).toBe("85,7%");
    expect(formatSlaCompliance(null)).toBe("–");
  });
});
