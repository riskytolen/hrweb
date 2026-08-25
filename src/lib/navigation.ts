export const ROUTE_BY_PERMISSION: { permission: string; href: string }[] = [
  { permission: "dashboard", href: "/dashboard" },
  { permission: "vehicle-odometer", href: "/operasional-kendaraan/dashboard" },
  { permission: "employees", href: "/employees" },
  { permission: "attendance", href: "/employees/attendance" },
  { permission: "leave", href: "/employees/leave" },
  { permission: "overtime", href: "/employees/overtime" },
  { permission: "income", href: "/employees/income" },
  { permission: "payroll", href: "/employees/payroll" },
  { permission: "performance", href: "/employees/performance" },
  { permission: "legal", href: "/employees/legal" },
  { permission: "announcements", href: "/employees/announcements" },
  { permission: "recruitment", href: "/employees/recruitment" },
  { permission: "petty-cash", href: "/general-affair/petty-cash" },
  { permission: "data-mobil", href: "/general-affair/data-mobil" },
  { permission: "inventory-aset", href: "/general-affair/inventory-aset" },
  { permission: "finance", href: "/finance" },
  { permission: "legalitas", href: "/legalitas" },
  { permission: "settings", href: "/settings/master-data" },
];

type AccountType = "internal" | "external";

function externalPermissionMatches(permissions: string[], permission: string): boolean {
  if (permission !== "vehicle-odometer") return false;
  return permissions.some(
    (p) =>
      p === "all" ||
      p === "vehicle-odometer" ||
      p === "vehicle-odometer.view" ||
      p === "vehicle-odometer.input" ||
      p === "vehicle-odometer.manage",
  );
}

export function permissionMatches(permissions: string[], permission: string, accountType: AccountType = "internal"): boolean {
  if (accountType === "external") return externalPermissionMatches(permissions, permission);
  if (permissions.includes("all")) return true;
  return permissions.some(
    (p) =>
      p === permission ||
      p === `${permission}.view` ||
      p === `${permission}.input` ||
      permission.startsWith(`${p}.`),
  );
}

export function getDefaultRouteForPermissions(
  permissions: string[] | null | undefined,
  accountType: AccountType = "internal",
): string {
  const safePermissions = permissions ?? [];
  const match = ROUTE_BY_PERMISSION.find((route) => permissionMatches(safePermissions, route.permission, accountType));
  return match?.href ?? "/dashboard";
}
