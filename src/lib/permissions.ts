/**
 * Helper permission bersama (client-safe).
 *
 * Modul ini sengaja tidak mengimpor apa pun dari server agar bisa dipakai
 * AuthProvider, Sidebar, RouteGuard, navigation, dan Route Handler.
 *
 * Aturan umum:
 * - "all" = akses penuh.
 * - Permission induk memberi akses ke turunannya ("tms" memberi "tms.epod.view").
 * - Permission anak tidak memberi akses ke induknya.
 * - Suffix ".manage" mengimplikasi base dan ".view" pada modul yang sama.
 */

export const TMS_PERMISSION = "tms";
export const TMS_VIEW_PERMISSION = "tms.view";
export const TMS_INPUT_PERMISSION = "tms.input";
export const TMS_EPOD_PERMISSION = "tms.epod";
export const TMS_EPOD_VIEW_PERMISSION = "tms.epod.view";
export const TMS_EPOD_MANAGE_PERMISSION = "tms.epod.manage";

export type AccountType = "internal" | "external";

/** Normalisasi nilai `roles.permissions` yang bisa berupa array atau JSON string. */
export function parsePermissions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Cek permission generik untuk akun internal.
 * `required` boleh berupa base ("employees") maupun turunan ("employees.view").
 */
export function permissionGranted(permissions: string[], required: string): boolean {
  if (!required) return false;
  if (permissions.includes("all")) return true;
  return permissions.some((granted) => {
    if (!granted) return false;
    if (granted === required) return true;
    // Base yang diminta dianggap terpenuhi oleh turunan langsungnya.
    if (
      granted === `${required}.view` ||
      granted === `${required}.input` ||
      granted === `${required}.manage`
    ) {
      return true;
    }
    // Permission induk memberi turunannya.
    if (required.startsWith(`${granted}.`)) return true;
    // ".manage" mengimplikasi base dan ".view" modul yang sama.
    if (granted.endsWith(".manage")) {
      const base = granted.slice(0, -".manage".length);
      if (required === base || required === `${base}.view`) return true;
    }
    return false;
  });
}

/** Akun eksternal hanya boleh mengakses Operasional Kendaraan. */
export function externalCanViewVehicleOdometer(permissions: string[], permission: string): boolean {
  if (permission !== "vehicle-odometer" && permission !== "vehicle-odometer.view") return false;
  return permissions.some(
    (p) =>
      p === "all" ||
      p === "vehicle-odometer" ||
      p === "vehicle-odometer.view" ||
      p === "vehicle-odometer.input" ||
      p === "vehicle-odometer.manage",
  );
}

/** Pencocokan permission untuk penentuan route default. */
export function permissionMatches(
  permissions: string[],
  permission: string,
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return externalCanViewVehicleOdometer(permissions, permission);
  return permissionGranted(permissions, permission);
}

/** Akses Live View / Live Track Task. */
export function canAccessTmsLive(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return false;
  return permissions.some((p) =>
    ["all", TMS_PERMISSION, TMS_VIEW_PERMISSION, TMS_INPUT_PERMISSION].includes(p),
  );
}

/**
 * Hak lihat Monitoring e-POD.
 *
 * `tms.view` dan `tms.input` sengaja ikut diberi akses lihat agar role
 * monitoring yang sudah ada tetap bisa memantau bukti pengiriman.
 */
export function canViewTmsEpod(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return false;
  return permissions.some((p) =>
    [
      "all",
      TMS_PERMISSION,
      TMS_VIEW_PERMISSION,
      TMS_INPUT_PERMISSION,
      TMS_EPOD_PERMISSION,
      TMS_EPOD_VIEW_PERMISSION,
      TMS_EPOD_MANAGE_PERMISSION,
    ].includes(p),
  );
}

/**
 * Hak kelola e-POD (input bukti, roster, koreksi, override).
 *
 * `tms.view` hanya boleh melihat. `tms` dan `tms.input` boleh mengelola
 * karena keduanya sudah berarti boleh menulis data TMS.
 */
export function canManageTmsEpod(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return false;
  return permissions.some((p) =>
    ["all", TMS_PERMISSION, TMS_INPUT_PERMISSION, TMS_EPOD_PERMISSION, TMS_EPOD_MANAGE_PERMISSION].includes(p),
  );
}
