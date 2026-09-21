import {
  permissionMatches,
  type AccountType,
} from "@/lib/permissions";

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
  // Entri `tms` harus tetap lebih dulu agar role TMS lama mendarat di Live View.
  { permission: "tms", href: "/tms/live-view" },
  { permission: "tms.epod", href: "/tms/epod" },
  { permission: "settings", href: "/settings/master-data" },
];

export { permissionMatches };
export type { AccountType };

export function getDefaultRouteForPermissions(
  permissions: string[] | null | undefined,
  accountType: AccountType = "internal",
): string {
  const safePermissions = permissions ?? [];
  const match = ROUTE_BY_PERMISSION.find((route) => permissionMatches(safePermissions, route.permission, accountType));
  return match?.href ?? "/dashboard";
}

/**
 * Route default khusus area TMS. Dipakai oleh redirect `/tms` agar user
 * yang hanya punya akses e-POD tidak mendarat di Live View.
 */
export function getTmsDefaultRoute(
  permissions: string[] | null | undefined,
  accountType: AccountType = "internal",
): string {
  const safePermissions = permissions ?? [];
  if (permissionMatches(safePermissions, "tms", accountType)) return "/tms/live-view";
  if (permissionMatches(safePermissions, "tms.epod", accountType)) return "/tms/epod";
  return "/dashboard";
}
