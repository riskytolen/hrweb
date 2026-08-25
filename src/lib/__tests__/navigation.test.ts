import { describe, expect, it } from "vitest";
import { getDefaultRouteForPermissions, permissionMatches } from "@/lib/navigation";

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
});
