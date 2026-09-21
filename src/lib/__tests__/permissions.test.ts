import { describe, expect, it } from "vitest";
import {
  canAccessTmsLive,
  canManageTmsEpod,
  canViewTmsEpod,
  parsePermissions,
  permissionGranted,
  permissionMatches,
} from "@/lib/permissions";

describe("parsePermissions", () => {
  it("menerima array dan menyaring nilai non-string", () => {
    expect(parsePermissions(["tms", 1, null, "tms.epod.view"])).toEqual(["tms", "tms.epod.view"]);
  });

  it("menerima JSON string", () => {
    expect(parsePermissions('["tms.epod.manage"]')).toEqual(["tms.epod.manage"]);
  });

  it("mengembalikan array kosong untuk nilai tidak valid", () => {
    expect(parsePermissions(null)).toEqual([]);
    expect(parsePermissions("{bukan json}")).toEqual([]);
    expect(parsePermissions(42)).toEqual([]);
  });
});

describe("permissionGranted", () => {
  it("memberi akses penuh untuk 'all'", () => {
    expect(permissionGranted(["all"], "tms.epod.manage")).toBe(true);
    expect(permissionGranted(["all"], "payroll")).toBe(true);
  });

  it("permission induk memberi akses ke turunannya", () => {
    expect(permissionGranted(["tms"], "tms.epod.view")).toBe(true);
    expect(permissionGranted(["tms"], "tms.epod.manage")).toBe(true);
  });

  it("permission anak tidak memberi akses ke induknya", () => {
    expect(permissionGranted(["tms.epod.view"], "tms")).toBe(false);
    expect(permissionGranted(["employees.view"], "settings")).toBe(false);
  });

  it("base dianggap terpenuhi oleh turunan langsungnya (kompatibel lama)", () => {
    expect(permissionGranted(["tms.view"], "tms")).toBe(true);
    expect(permissionGranted(["tms.input"], "tms")).toBe(true);
    expect(permissionGranted(["tms.epod.manage"], "tms.epod")).toBe(true);
  });

  it("'.manage' mengimplikasi base dan '.view' modul yang sama", () => {
    expect(permissionGranted(["tms.epod.manage"], "tms.epod")).toBe(true);
    expect(permissionGranted(["tms.epod.manage"], "tms.epod.view")).toBe(true);
    expect(permissionGranted(["employees.manage"], "employees.view")).toBe(true);
  });

  it("'.manage' tidak memberi akses ke modul lain", () => {
    expect(permissionGranted(["tms.epod.manage"], "tms")).toBe(false);
    expect(permissionGranted(["tms.epod.manage"], "payroll")).toBe(false);
  });
});

describe("canAccessTmsLive", () => {
  it("memberi akses untuk all/tms/tms.view/tms.input", () => {
    expect(canAccessTmsLive(["all"])).toBe(true);
    expect(canAccessTmsLive(["tms"])).toBe(true);
    expect(canAccessTmsLive(["tms.view"])).toBe(true);
    expect(canAccessTmsLive(["tms.input"])).toBe(true);
  });

  it("tidak memberi akses untuk permission e-POD saja", () => {
    expect(canAccessTmsLive(["tms.epod.view"])).toBe(false);
    expect(canAccessTmsLive(["tms.epod.manage"])).toBe(false);
  });

  it("selalu menolak akun eksternal", () => {
    expect(canAccessTmsLive(["all"], "external")).toBe(false);
    expect(canAccessTmsLive(["tms"], "external")).toBe(false);
  });
});

describe("canViewTmsEpod", () => {
  it("memberi lihat untuk all/tms/tms.view/tms.input", () => {
    expect(canViewTmsEpod(["all"])).toBe(true);
    expect(canViewTmsEpod(["tms"])).toBe(true);
    expect(canViewTmsEpod(["tms.view"])).toBe(true);
    expect(canViewTmsEpod(["tms.input"])).toBe(true);
  });

  it("memberi lihat untuk permission e-POD eksplisit", () => {
    expect(canViewTmsEpod(["tms.epod.view"])).toBe(true);
    expect(canViewTmsEpod(["tms.epod.manage"])).toBe(true);
  });

  it("tidak memberi lihat tanpa permission TMS", () => {
    expect(canViewTmsEpod(["dashboard"])).toBe(false);
    expect(canViewTmsEpod([])).toBe(false);
  });

  it("selalu menolak akun eksternal", () => {
    expect(canViewTmsEpod(["all"], "external")).toBe(false);
    expect(canViewTmsEpod(["tms.view"], "external")).toBe(false);
  });
});

describe("canManageTmsEpod", () => {
  it("memberi kelola untuk all/tms/tms.input", () => {
    expect(canManageTmsEpod(["all"])).toBe(true);
    expect(canManageTmsEpod(["tms"])).toBe(true);
    expect(canManageTmsEpod(["tms.input"])).toBe(true);
  });

  it("tidak memberi kelola untuk tms.view", () => {
    expect(canManageTmsEpod(["tms.view"])).toBe(false);
  });

  it("memberi kelola untuk permission e-POD kelola", () => {
    expect(canManageTmsEpod(["tms.epod.manage"])).toBe(true);
    expect(canManageTmsEpod(["tms.epod"])).toBe(true);
  });

  it("tidak memberi kelola untuk lihat saja", () => {
    expect(canManageTmsEpod(["tms.epod.view"])).toBe(false);
  });

  it("selalu menolak akun eksternal", () => {
    expect(canManageTmsEpod(["all"], "external")).toBe(false);
    expect(canManageTmsEpod(["tms.input"], "external")).toBe(false);
  });
});

describe("permissionMatches", () => {
  it("mencocokkan permission internal", () => {
    expect(permissionMatches(["tms"], "tms")).toBe(true);
    expect(permissionMatches(["tms.epod.view"], "tms.epod")).toBe(true);
    expect(permissionMatches(["dashboard"], "tms")).toBe(false);
  });

  it("membatasi akun eksternal ke operasional kendaraan", () => {
    expect(permissionMatches(["all"], "vehicle-odometer", "external")).toBe(true);
    expect(permissionMatches(["all"], "tms.epod", "external")).toBe(false);
    expect(permissionMatches(["tms.view"], "tms.epod", "external")).toBe(false);
  });
});
