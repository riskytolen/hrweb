import { describe, expect, it } from "vitest";
import {
  canAccessTmsData,
  canAccessTmsLive,
  canManageLiveTrackConfig,
  canManageOdometerClientUnits,
  canManageTmsEpod,
  canViewLiveTrackConfig,
  canViewOdometerDashboard,
  canViewOdometerReport,
  canViewTmsEpod,
  canViewTmsLiveTask,
  canViewTmsLiveView,
  canViewTmsLoggerTrips,
  externalCanViewTms,
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

  it("memberi akses view-only untuk eksternal pemegang submenu live", () => {
    expect(canAccessTmsLive(["tms.live-view"], "external")).toBe(true);
    expect(canAccessTmsLive(["tms.live-track-task.view"], "external")).toBe(true);
    expect(canAccessTmsLive(["tms.logger-trips"], "external")).toBe(true);
    expect(canAccessTmsLive(["tms"], "external")).toBe(true);
  });

  it("tetap menolak eksternal tanpa permission live", () => {
    expect(canAccessTmsLive(["tms.epod.view"], "external")).toBe(false);
    expect(canAccessTmsLive(["dashboard"], "external")).toBe(false);
    expect(canAccessTmsLive([], "external")).toBe(false);
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

  it("memberi akses view-only e-POD untuk eksternal", () => {
    expect(canViewTmsEpod(["tms.epod.view"], "external")).toBe(true);
    expect(canViewTmsEpod(["tms.view"], "external")).toBe(true);
    expect(canViewTmsEpod(["all"], "external")).toBe(true);
  });

  it("tetap menolak eksternal tanpa permission e-POD", () => {
    expect(canViewTmsEpod(["tms.live-view"], "external")).toBe(false);
    expect(canViewTmsEpod(["dashboard"], "external")).toBe(false);
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

describe("canViewLiveTrackConfig", () => {
  it("memberi lihat untuk all/tms/tms.view/tms.input", () => {
    expect(canViewLiveTrackConfig(["all"])).toBe(true);
    expect(canViewLiveTrackConfig(["tms"])).toBe(true);
    expect(canViewLiveTrackConfig(["tms.view"])).toBe(true);
    expect(canViewLiveTrackConfig(["tms.input"])).toBe(true);
  });

  it("memberi lihat untuk permission konfigurasi", () => {
    expect(canViewLiveTrackConfig(["tms.live-track-config"])).toBe(true);
    expect(canViewLiveTrackConfig(["tms.live-track-config.view"])).toBe(true);
    expect(canViewLiveTrackConfig(["tms.live-track-config.manage"])).toBe(true);
  });

  it("selalu menolak akun eksternal", () => {
    expect(canViewLiveTrackConfig(["all"], "external")).toBe(false);
    expect(canViewLiveTrackConfig(["tms.live-track-config.manage"], "external")).toBe(false);
  });
});

describe("canManageLiveTrackConfig", () => {
  it("memberi kelola untuk all dan permission konfigurasi", () => {
    expect(canManageLiveTrackConfig(["all"])).toBe(true);
    expect(canManageLiveTrackConfig(["tms.live-track-config"])).toBe(true);
    expect(canManageLiveTrackConfig(["tms.live-track-config.manage"])).toBe(true);
  });

  it("tidak memberi kelola untuk tms/tms.input/tms.view", () => {
    expect(canManageLiveTrackConfig(["tms"])).toBe(false);
    expect(canManageLiveTrackConfig(["tms.input"])).toBe(false);
    expect(canManageLiveTrackConfig(["tms.view"])).toBe(false);
    expect(canManageLiveTrackConfig(["tms.live-track-config.view"])).toBe(false);
  });

  it("selalu menolak akun eksternal", () => {
    expect(canManageLiveTrackConfig(["all"], "external")).toBe(false);
  });
});

describe("canViewTmsLiveView", () => {
  it("memberi akses untuk permission induk lama dan submenu live-view", () => {
    expect(canViewTmsLiveView(["all"])).toBe(true);
    expect(canViewTmsLiveView(["tms"])).toBe(true);
    expect(canViewTmsLiveView(["tms.view"])).toBe(true);
    expect(canViewTmsLiveView(["tms.input"])).toBe(true);
    expect(canViewTmsLiveView(["tms.live-view"])).toBe(true);
    expect(canViewTmsLiveView(["tms.live-view.view"])).toBe(true);
  });

  it("tidak memberi akses untuk submenu TMS lain saja", () => {
    expect(canViewTmsLiveView(["tms.epod.view"])).toBe(false);
    expect(canViewTmsLiveView(["tms.live-track-task"])).toBe(false);
    expect(canViewTmsLiveView(["tms.logger-trips"])).toBe(false);
    expect(canViewTmsLiveView([])).toBe(false);
  });

  it("memberi akses view-only live-view untuk eksternal", () => {
    expect(canViewTmsLiveView(["all"], "external")).toBe(true);
    expect(canViewTmsLiveView(["tms.live-view"], "external")).toBe(true);
    expect(canViewTmsLiveView(["tms.view"], "external")).toBe(true);
  });

  it("tetap menolak eksternal lintas submenu", () => {
    expect(canViewTmsLiveView(["tms.epod.view"], "external")).toBe(false);
    expect(canViewTmsLiveView(["dashboard"], "external")).toBe(false);
  });
});

describe("canViewTmsLiveTask", () => {
  it("memberi akses untuk permission induk lama dan submenu task", () => {
    expect(canViewTmsLiveTask(["tms"])).toBe(true);
    expect(canViewTmsLiveTask(["tms.view"])).toBe(true);
    expect(canViewTmsLiveTask(["tms.live-track-task"])).toBe(true);
    expect(canViewTmsLiveTask(["tms.live-track-task.view"])).toBe(true);
  });

  it("tidak memberi akses untuk submenu TMS lain saja", () => {
    expect(canViewTmsLiveTask(["tms.live-view"])).toBe(false);
    expect(canViewTmsLiveTask(["tms.epod.manage"])).toBe(false);
  });

  it("memberi akses view-only task untuk eksternal", () => {
    expect(canViewTmsLiveTask(["tms.live-track-task"], "external")).toBe(true);
    expect(canViewTmsLiveTask(["tms.view"], "external")).toBe(true);
    expect(canViewTmsLiveTask(["all"], "external")).toBe(true);
  });

  it("tetap menolak eksternal lintas submenu", () => {
    expect(canViewTmsLiveTask(["tms.live-view"], "external")).toBe(false);
    expect(canViewTmsLiveTask(["dashboard"], "external")).toBe(false);
  });
});

describe("canViewTmsLoggerTrips", () => {
  it("memberi akses untuk permission induk lama dan submenu logger", () => {
    expect(canViewTmsLoggerTrips(["tms"])).toBe(true);
    expect(canViewTmsLoggerTrips(["tms.input"])).toBe(true);
    expect(canViewTmsLoggerTrips(["tms.logger-trips"])).toBe(true);
  });

  it("tidak memberi akses untuk submenu TMS lain saja", () => {
    expect(canViewTmsLoggerTrips(["tms.live-view"])).toBe(false);
    expect(canViewTmsLoggerTrips(["tms.live-track-config.view"])).toBe(false);
  });

  it("memberi akses view-only logger untuk eksternal", () => {
    expect(canViewTmsLoggerTrips(["tms.logger-trips"], "external")).toBe(true);
    expect(canViewTmsLoggerTrips(["tms.view"], "external")).toBe(true);
    expect(canViewTmsLoggerTrips(["all"], "external")).toBe(true);
  });

  it("tetap menolak eksternal lintas submenu", () => {
    expect(canViewTmsLoggerTrips(["tms.live-view"], "external")).toBe(false);
    expect(canViewTmsLoggerTrips(["dashboard"], "external")).toBe(false);
  });
});

describe("canAccessTmsData", () => {
  it("memberi akses untuk permission induk lama dan submenu live", () => {
    expect(canAccessTmsData(["all"])).toBe(true);
    expect(canAccessTmsData(["tms"])).toBe(true);
    expect(canAccessTmsData(["tms.view"])).toBe(true);
    expect(canAccessTmsData(["tms.live-view"])).toBe(true);
    expect(canAccessTmsData(["tms.live-track-task.view"])).toBe(true);
    expect(canAccessTmsData(["tms.logger-trips.input"])).toBe(true);
  });

  it("tidak memberi akses untuk e-POD atau konfigurasi saja", () => {
    expect(canAccessTmsData(["tms.epod.view"])).toBe(false);
    expect(canAccessTmsData(["tms.epod.manage"])).toBe(false);
    expect(canAccessTmsData(["tms.live-track-config.manage"])).toBe(false);
    expect(canAccessTmsData([])).toBe(false);
  });

  it("memberi akses data live untuk eksternal view-only", () => {
    expect(canAccessTmsData(["tms.live-view"], "external")).toBe(true);
    expect(canAccessTmsData(["tms"], "external")).toBe(true);
  });

  it("tetap menolak eksternal untuk e-POD/konfigurasi saja", () => {
    expect(canAccessTmsData(["tms.epod.view"], "external")).toBe(false);
    expect(canAccessTmsData(["tms.live-track-config.manage"], "external")).toBe(false);
    expect(canAccessTmsData([], "external")).toBe(false);
  });
});

describe("canViewOdometerDashboard", () => {
  it("memberi akses untuk permission induk lama dan submenu dashboard", () => {
    expect(canViewOdometerDashboard(["all"])).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer"])).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer.view"])).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer.manage"])).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer.dashboard"])).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer.dashboard.view"])).toBe(true);
  });

  it("tidak memberi akses untuk submenu laporan saja", () => {
    expect(canViewOdometerDashboard(["vehicle-odometer.report"])).toBe(false);
    expect(canViewOdometerDashboard([])).toBe(false);
  });

  it("tetap melayani akun eksternal pemegang operasional kendaraan", () => {
    expect(canViewOdometerDashboard(["vehicle-odometer"], "external")).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer.dashboard"], "external")).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer.dashboard.view"], "external")).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer.dashboard.input"], "external")).toBe(true);
    expect(canViewOdometerDashboard(["vehicle-odometer.report.view"], "external")).toBe(false);
    expect(canViewOdometerDashboard(["tms"], "external")).toBe(false);
  });
});

describe("canViewOdometerReport", () => {
  it("memberi akses untuk permission induk lama dan submenu laporan", () => {
    expect(canViewOdometerReport(["vehicle-odometer"])).toBe(true);
    expect(canViewOdometerReport(["vehicle-odometer.view"])).toBe(true);
    expect(canViewOdometerReport(["vehicle-odometer.report"])).toBe(true);
  });

  it("tidak memberi akses untuk submenu dashboard saja", () => {
    expect(canViewOdometerReport(["vehicle-odometer.dashboard"])).toBe(false);
  });

  it("tetap melayani akun eksternal pemegang operasional kendaraan", () => {
    expect(canViewOdometerReport(["vehicle-odometer"], "external")).toBe(true);
    expect(canViewOdometerReport(["vehicle-odometer.report"], "external")).toBe(true);
    expect(canViewOdometerReport(["vehicle-odometer.report.view"], "external")).toBe(true);
    expect(canViewOdometerReport(["vehicle-odometer.report.input"], "external")).toBe(true);
    expect(canViewOdometerReport(["vehicle-odometer.dashboard.view"], "external")).toBe(false);
    expect(canViewOdometerReport(["tms"], "external")).toBe(false);
  });
});

describe("canManageOdometerClientUnits", () => {
  it("memberi akses untuk permission eksplisit dan all", () => {
    expect(canManageOdometerClientUnits(["vehicle-odometer.client-unit-config.manage"])).toBe(true);
    expect(canManageOdometerClientUnits(["vehicle-odometer.client-unit-config"])).toBe(true);
    expect(canManageOdometerClientUnits(["all"])).toBe(true);
  });

  it("menolak permission induk odometer tanpa wewenang eksplisit", () => {
    expect(canManageOdometerClientUnits(["vehicle-odometer"])).toBe(false);
    expect(canManageOdometerClientUnits(["vehicle-odometer.manage"])).toBe(false);
    expect(canManageOdometerClientUnits(["vehicle-odometer.dashboard"])).toBe(false);
    expect(canManageOdometerClientUnits([])).toBe(false);
  });

  it("selalu menolak akun external", () => {
    expect(canManageOdometerClientUnits(["all"], "external")).toBe(false);
    expect(canManageOdometerClientUnits(["vehicle-odometer.client-unit-config.manage"], "external")).toBe(false);
  });
});

describe("permissionMatches", () => {
  it("mencocokkan permission internal", () => {
    expect(permissionMatches(["tms"], "tms")).toBe(true);
    expect(permissionMatches(["tms.epod.view"], "tms.epod")).toBe(true);
    expect(permissionMatches(["dashboard"], "tms")).toBe(false);
  });

  it("membatasi akun eksternal ke operasional kendaraan + TMS view-only", () => {
    expect(permissionMatches(["all"], "vehicle-odometer", "external")).toBe(true);
    expect(permissionMatches(["vehicle-odometer.dashboard.view"], "vehicle-odometer.dashboard", "external")).toBe(true);
    expect(permissionMatches(["vehicle-odometer.report.view"], "vehicle-odometer.report", "external")).toBe(true);
    expect(permissionMatches(["vehicle-odometer.report.view"], "vehicle-odometer.dashboard", "external")).toBe(false);
    expect(permissionMatches(["tms.live-view"], "tms.live-view", "external")).toBe(true);
    expect(permissionMatches(["tms.view"], "tms.epod", "external")).toBe(true);
    expect(permissionMatches(["tms.live-view"], "tms.epod", "external")).toBe(false);
    expect(permissionMatches(["dashboard"], "tms.live-view", "external")).toBe(false);
  });

  it("externalCanViewTms tidak memberi akses silang submenu", () => {
    expect(externalCanViewTms(["tms.live-view"], "tms.live-view")).toBe(true);
    expect(externalCanViewTms(["tms.live-view"], "tms.epod")).toBe(false);
    expect(externalCanViewTms(["tms.epod.view"], "tms.epod.view")).toBe(true);
    expect(externalCanViewTms(["dashboard"], "tms.live-view")).toBe(false);
    expect(externalCanViewTms(["tms.live-track-config.manage"], "tms.live-view")).toBe(false);
  });
});
