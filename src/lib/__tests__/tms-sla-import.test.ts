import { describe, expect, it } from "vitest";
import {
  buildSlaStandardTemplate,
  isSlaStandardGrid,
  normalizeSlaClock,
  parseSlaMatrixGrid,
  parseSlaStandardGrid,
} from "@/lib/tms-sla-import";

describe("tms-sla-import", () => {
  it("menormalisasi jam", () => {
    expect(normalizeSlaClock("4:58")).toBe("04:58");
    expect(normalizeSlaClock("04:58:00")).toBe("04:58:00");
    expect(normalizeSlaClock("25:00")).toBeNull();
    expect(normalizeSlaClock("pagi")).toBeNull();
  });

  it("mendeteksi format standar", () => {
    expect(
      isSlaStandardGrid([["Profil", "Nama Profil", "Jam Berangkat", "Urutan", "Nama Toko", "Jam SLA", "Hari Ke", "Address ID McEasy"]]),
    ).toBe(true);
    expect(isSlaStandardGrid([["NO", "VAN 1", "Start"]])).toBe(false);
  });

  it("memparse matrix VAN Tuku", () => {
    const grid = [
      ["NO", "VAN 1", "Start", "VAN 2", "Start"],
      ["1", "Toko Kopi Tuku Jati asih", "4:58", "Toko Kopi Tuku Cempaka putih", "5:04"],
      ["2", "Toko Kopi Tuku Grand Wisata", "5:56", "", ""],
      ["Total", "2", "", "1", ""],
      ["MAPS", "http://x", "", "http://y", ""],
      ["", "", "4:15", "", "4:21"],
    ];
    const { profiles, issues } = parseSlaMatrixGrid(grid);
    expect(issues).toEqual([]);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({ code: "VAN 1", depart: "04:15" });
    expect(profiles[0].stops).toHaveLength(2);
    expect(profiles[0].stops[0]).toMatchObject({ order: 1, storeName: "Toko Kopi Tuku Jati asih", targetTime: "04:58" });
    expect(profiles[1]).toMatchObject({ code: "VAN 2", depart: "04:21" });
    expect(profiles[1].stops).toHaveLength(1);
  });

  it("melewati baris matrix berjam rusak dengan issue", () => {
    const grid = [
      ["NO", "VAN 1", "Start"],
      ["1", "Toko A", "pagi"],
      ["2", "Toko B", "5:56"],
    ];
    const { profiles, issues } = parseSlaMatrixGrid(grid);
    expect(profiles[0].stops).toHaveLength(1);
    expect(profiles[0].stops[0].storeName).toBe("Toko B");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("memparse format standar dan menggabung alias address", () => {
    const grid = [
      ["Profil", "Nama Profil", "Jam Berangkat", "Urutan", "Nama Toko", "Jam SLA", "Hari Ke", "Address ID McEasy"],
      ["VAN 4", "VAN 4 CP", "04:41", "1", "Toko Kopi Tuku Cibubur point", "04:59", "0", "240298"],
      ["VAN 4", "VAN 4 CP", "04:41", "1", "Toko Kopi Tuku Cibubur point", "04:59", "0", "6553"],
      ["VAN 4", "VAN 4 CP", "04:41", "2", "Toko Kopi Tuku Bp Sentul", "06:04", "1", ""],
    ];
    const { profiles, issues } = parseSlaStandardGrid(grid);
    expect(issues).toEqual([]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].depart).toBe("04:41");
    expect(profiles[0].stops).toHaveLength(2);
    expect(profiles[0].stops[0]).toMatchObject({
      order: 1,
      storeName: "Toko Kopi Tuku Cibubur point",
      addressIds: ["240298", "6553"],
    });
    expect(profiles[0].stops[1]).toMatchObject({ order: 2, dayOffset: 1, addressIds: [] });
  });

  it("membangun template standar", () => {
    const template = buildSlaStandardTemplate();
    expect(template[0][0]).toBe("Profil");
    expect(template.length).toBe(3);
  });
});
