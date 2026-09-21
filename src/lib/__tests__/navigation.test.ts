import { describe, expect, it } from "vitest";
import { getDefaultRouteForPermissions, getTmsDefaultRoute, permissionMatches } from "@/lib/navigation";

describe("navigation permissions", () => {
  it("keeps external accounts scoped to vehicle odometer", () => {
    expect(permissionMatches(["all"], "dashboard", "external")).toBe(false);
    expect(permissionMatches(["all"], "vehicle-odometer", "external")).toBe(true);
    expect(permissionMatches(["vehicle-odometer.view"], "vehicle-odometer", "external")).toBe(true);
  });

  it("redirects external vehicle users to vehicle dashboard", () => {
    expect(getDefaultRouteForPermissions(["all"], "external")).toBe("/operasional-kendaraan/dashboard");
    expect(getDefaultRouteForPermissions(["vehicle-odometer.view"], "external")).toBe("/operasional-kendaraan/dashboard");
  });

  it("routes internal tms users to the tms control tower", () => {
    expect(permissionMatches(["tms"], "tms", "internal")).toBe(true);
    expect(permissionMatches(["tms.view"], "tms", "internal")).toBe(true);
    expect(permissionMatches(["dashboard"], "tms", "internal")).toBe(false);
    expect(getDefaultRouteForPermissions(["tms"], "internal")).toBe("/tms/live-view");
  });

  it("keeps legacy tms roles on live view", () => {
    expect(getTmsDefaultRoute(["tms"], "internal")).toBe("/tms/live-view");
    expect(getTmsDefaultRoute(["tms.view"], "internal")).toBe("/tms/live-view");
    expect(getTmsDefaultRoute(["tms.input"], "internal")).toBe("/tms/live-view");
  });

  it("sends epod-only roles to the epod monitoring page", () => {
    expect(permissionMatches(["tms.epod.view"], "tms", "internal")).toBe(false);
    expect(permissionMatches(["tms.epod.view"], "tms.epod", "internal")).toBe(true);
    expect(permissionMatches(["tms.epod.manage"], "tms.epod", "internal")).toBe(true);
    expect(getTmsDefaultRoute(["tms.epod.view"], "internal")).toBe("/tms/epod");
    expect(getTmsDefaultRoute(["tms.epod.manage"], "internal")).toBe("/tms/epod");
    expect(getDefaultRouteForPermissions(["tms.epod.view"], "internal")).toBe("/tms/epod");
  });

  it("does not let external accounts reach epod", () => {
    expect(permissionMatches(["tms.view"], "tms.epod", "external")).toBe(false);
    expect(getTmsDefaultRoute(["tms.view"], "external")).toBe("/dashboard");
  });
});
