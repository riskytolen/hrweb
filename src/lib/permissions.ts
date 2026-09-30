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
/** Cakupan data: role internal dengan permission ini melihat semua client. Diabaikan untuk external. */
export const TMS_CLIENTS_ALL_PERMISSION = "tms.clients.all";
export const TMS_LIVE_VIEW_PERMISSION = "tms.live-view";
export const TMS_LIVE_VIEW_VIEW_PERMISSION = "tms.live-view.view";
export const TMS_LIVE_VIEW_INPUT_PERMISSION = "tms.live-view.input";
export const TMS_LIVE_TRACK_TASK_PERMISSION = "tms.live-track-task";
export const TMS_LIVE_TRACK_TASK_VIEW_PERMISSION = "tms.live-track-task.view";
export const TMS_LIVE_TRACK_TASK_INPUT_PERMISSION = "tms.live-track-task.input";
export const TMS_LOGGER_TRIPS_PERMISSION = "tms.logger-trips";
export const TMS_LOGGER_TRIPS_VIEW_PERMISSION = "tms.logger-trips.view";
export const TMS_LOGGER_TRIPS_INPUT_PERMISSION = "tms.logger-trips.input";
export const TMS_SLA_CONFIG_PERMISSION = "tms.sla-config";
export const TMS_SLA_CONFIG_VIEW_PERMISSION = "tms.sla-config.view";
export const TMS_SLA_CONFIG_MANAGE_PERMISSION = "tms.sla-config.manage";
export const TMS_EPOD_PERMISSION = "tms.epod";
export const TMS_EPOD_VIEW_PERMISSION = "tms.epod.view";
export const TMS_EPOD_MANAGE_PERMISSION = "tms.epod.manage";
export const TMS_LIVE_TRACK_CONFIG_PERMISSION = "tms.live-track-config";
export const TMS_LIVE_TRACK_CONFIG_VIEW_PERMISSION = "tms.live-track-config.view";
export const TMS_LIVE_TRACK_CONFIG_MANAGE_PERMISSION = "tms.live-track-config.manage";
export const VEHICLE_ODOMETER_PERMISSION = "vehicle-odometer";
export const VEHICLE_ODOMETER_VIEW_PERMISSION = "vehicle-odometer.view";
export const VEHICLE_ODOMETER_INPUT_PERMISSION = "vehicle-odometer.input";
export const VEHICLE_ODOMETER_MANAGE_PERMISSION = "vehicle-odometer.manage";
export const VEHICLE_ODOMETER_DASHBOARD_PERMISSION = "vehicle-odometer.dashboard";
export const VEHICLE_ODOMETER_DASHBOARD_VIEW_PERMISSION = "vehicle-odometer.dashboard.view";
export const VEHICLE_ODOMETER_DASHBOARD_INPUT_PERMISSION = "vehicle-odometer.dashboard.input";
export const VEHICLE_ODOMETER_REPORT_PERMISSION = "vehicle-odometer.report";
export const VEHICLE_ODOMETER_REPORT_VIEW_PERMISSION = "vehicle-odometer.report.view";
export const VEHICLE_ODOMETER_REPORT_INPUT_PERMISSION = "vehicle-odometer.report.input";
/** Kelola mapping unit operasional yang terlihat oleh masing-masing client. */
export const VEHICLE_ODOMETER_CLIENT_UNIT_CONFIG_PERMISSION = "vehicle-odometer.client-unit-config";
export const VEHICLE_ODOMETER_CLIENT_UNIT_CONFIG_MANAGE_PERMISSION =
  "vehicle-odometer.client-unit-config.manage";

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

/**
 * Akun eksternal hanya boleh mengakses Operasional Kendaraan dan submenu TMS
 * yang aman untuk client (view-only). Semua akses eksternal bersifat lihat;
 * hak kelola tetap ditolak oleh helper manage dan Route Handler server-side.
 *
 * Untuk Operasional Kendaraan: submenu Dashboard/Laporan memakai key
 * turunannya, jadi normalisasi dulu ke key induk agar role eksternal lama
 * tetap jalan.
 */
export function externalCanViewTms(permissions: string[], permission: string): boolean {
  const liveViewKeys = [TMS_LIVE_VIEW_PERMISSION, TMS_LIVE_VIEW_VIEW_PERMISSION, TMS_LIVE_VIEW_INPUT_PERMISSION];
  const liveTaskKeys = [
    TMS_LIVE_TRACK_TASK_PERMISSION,
    TMS_LIVE_TRACK_TASK_VIEW_PERMISSION,
    TMS_LIVE_TRACK_TASK_INPUT_PERMISSION,
  ];
  const loggerKeys = [TMS_LOGGER_TRIPS_PERMISSION, TMS_LOGGER_TRIPS_VIEW_PERMISSION, TMS_LOGGER_TRIPS_INPUT_PERMISSION];
  const epodKeys = [TMS_EPOD_PERMISSION, TMS_EPOD_VIEW_PERMISSION, TMS_EPOD_MANAGE_PERMISSION];
  const sharedKeys = ["all", TMS_PERMISSION, TMS_VIEW_PERMISSION, TMS_INPUT_PERMISSION];
  const hasAny = (keys: string[]): boolean =>
    permissions.some((p) => sharedKeys.includes(p) || keys.includes(p));

  if (permission === TMS_PERMISSION || permission === TMS_VIEW_PERMISSION) {
    // Samakan dengan internal: anak tidak memberi akses ke induk.
    // "tms" hanya lolos bila memegang shared key (all/tms/tms.view/tms.input).
    return permissions.some((p) => sharedKeys.includes(p));
  }
  if (liveViewKeys.includes(permission)) return hasAny(liveViewKeys);
  if (liveTaskKeys.includes(permission)) return hasAny(liveTaskKeys);
  if (loggerKeys.includes(permission)) return hasAny(loggerKeys);
  if (epodKeys.includes(permission)) return hasAny(epodKeys);
  return false;
}

export function externalCanViewVehicleOdometer(permissions: string[], permission: string): boolean {
  const dashboardKeys = [
    VEHICLE_ODOMETER_DASHBOARD_PERMISSION,
    VEHICLE_ODOMETER_DASHBOARD_VIEW_PERMISSION,
    VEHICLE_ODOMETER_DASHBOARD_INPUT_PERMISSION,
  ];
  const reportKeys = [
    VEHICLE_ODOMETER_REPORT_PERMISSION,
    VEHICLE_ODOMETER_REPORT_VIEW_PERMISSION,
    VEHICLE_ODOMETER_REPORT_INPUT_PERMISSION,
  ];
  // Key induk lama tetap memberi akses ke kedua submenu.
  const sharedKeys = [
    "all",
    VEHICLE_ODOMETER_PERMISSION,
    VEHICLE_ODOMETER_VIEW_PERMISSION,
    VEHICLE_ODOMETER_INPUT_PERMISSION,
    VEHICLE_ODOMETER_MANAGE_PERMISSION,
  ];
  const hasAny = (keys: string[]): boolean =>
    permissions.some((p) => sharedKeys.includes(p) || keys.includes(p));

  // Samakan dengan internal: turunan memberi akses ke induknya, jadi base
  // lolos bila memegang key induk lama maupun salah satu submenu granular.
  if (permission === VEHICLE_ODOMETER_PERMISSION || permission === VEHICLE_ODOMETER_VIEW_PERMISSION) {
    return hasAny([...dashboardKeys, ...reportKeys]);
  }
  if (dashboardKeys.includes(permission)) return hasAny(dashboardKeys);
  if (reportKeys.includes(permission)) return hasAny(reportKeys);
  return false;
}

/** Pencocokan permission untuk penentuan route default. */
export function permissionMatches(
  permissions: string[],
  permission: string,
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") {
    return externalCanViewTms(permissions, permission) || externalCanViewVehicleOdometer(permissions, permission);
  }
  return permissionGranted(permissions, permission);
}

/**
 * Akses Live View / Live Track Task / Logger Trips.
 * Mencakup permission induk lama (`tms`/`tms.view`/`tms.input`) dan
 * permission submenu granular (`tms.live-view`, `tms.live-track-task`,
 * `tms.logger-trips` beserta varian `.view`/`.input`-nya).
 */
export function canAccessTmsLive(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") {
    return (
      externalCanViewTms(permissions, TMS_LIVE_VIEW_PERMISSION) ||
      externalCanViewTms(permissions, TMS_LIVE_TRACK_TASK_PERMISSION) ||
      externalCanViewTms(permissions, TMS_LOGGER_TRIPS_PERMISSION)
    );
  }
  return permissions.some((p) =>
    [
      "all",
      TMS_PERMISSION,
      TMS_VIEW_PERMISSION,
      TMS_INPUT_PERMISSION,
      TMS_LIVE_VIEW_PERMISSION,
      TMS_LIVE_VIEW_VIEW_PERMISSION,
      TMS_LIVE_VIEW_INPUT_PERMISSION,
      TMS_LIVE_TRACK_TASK_PERMISSION,
      TMS_LIVE_TRACK_TASK_VIEW_PERMISSION,
      TMS_LIVE_TRACK_TASK_INPUT_PERMISSION,
      TMS_LOGGER_TRIPS_PERMISSION,
      TMS_LOGGER_TRIPS_VIEW_PERMISSION,
      TMS_LOGGER_TRIPS_INPUT_PERMISSION,
    ].includes(p),
  );
}

/**
 * Akses data TMS untuk Route Handler (board, fleet-task-instant,
 * vehicle-statuses, logger-trips, trip detail). Role lama (`tms` dkk)
 * tetap lolos; role granular baru lolos via key submenu live-nya.
 * Role e-POD saja atau konfigurasi saja sengaja TIDAK diberi akses data
 * live agar batas antar submenu tetap terjaga.
 */
export function canAccessTmsData(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  return canAccessTmsLive(permissions, accountType);
}

/** Akses submenu Live View (menu + halaman + data turunannya). */
export function canViewTmsLiveView(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return externalCanViewTms(permissions, TMS_LIVE_VIEW_PERMISSION);
  return (
    permissionGranted(permissions, TMS_LIVE_VIEW_PERMISSION) ||
    permissionGranted(permissions, TMS_PERMISSION)
  );
}

/** Akses submenu Live Track Task (menu + halaman + data turunannya). */
export function canViewTmsLiveTask(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return externalCanViewTms(permissions, TMS_LIVE_TRACK_TASK_PERMISSION);
  return (
    permissionGranted(permissions, TMS_LIVE_TRACK_TASK_PERMISSION) ||
    permissionGranted(permissions, TMS_PERMISSION)
  );
}

/** Akses submenu Logger Trips (menu + halaman + data turunannya). */
export function canViewTmsLoggerTrips(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return externalCanViewTms(permissions, TMS_LOGGER_TRIPS_PERMISSION);
  return (
    permissionGranted(permissions, TMS_LOGGER_TRIPS_PERMISSION) ||
    permissionGranted(permissions, TMS_PERMISSION)
  );
}

/**
 * Akses submenu Dashboard Kendaraan. Role lama (`vehicle-odometer` dan
 * variannya) tetap lolos; role granular baru lolos via key dashboard.
 */
export function canViewOdometerDashboard(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") {
    return externalCanViewVehicleOdometer(permissions, VEHICLE_ODOMETER_DASHBOARD_PERMISSION);
  }
  return (
    permissionGranted(permissions, VEHICLE_ODOMETER_DASHBOARD_PERMISSION) ||
    permissionGranted(permissions, VEHICLE_ODOMETER_PERMISSION)
  );
}

/**
 * Akses submenu Laporan Kendaraan. Role lama (`vehicle-odometer` dan
 * variannya) tetap lolos; role granular baru lolos via key laporan.
 */
export function canViewOdometerReport(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") {
    return externalCanViewVehicleOdometer(permissions, VEHICLE_ODOMETER_REPORT_PERMISSION);
  }
  return (
    permissionGranted(permissions, VEHICLE_ODOMETER_REPORT_PERMISSION) ||
    permissionGranted(permissions, VEHICLE_ODOMETER_PERMISSION)
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
  if (accountType === "external") return externalCanViewTms(permissions, TMS_EPOD_PERMISSION);
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
 * Hak lihat Pengaturan Live Track.
 *
 * Pemegang `tms`/`tms.view`/`tms.input` boleh melihat konfigurasi agar
 * operasional memahami cakupan Live Track. Mengubah konfigurasi butuh
 * permission manage eksplisit.
 */
export function canViewLiveTrackConfig(
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
      TMS_LIVE_TRACK_CONFIG_PERMISSION,
      TMS_LIVE_TRACK_CONFIG_VIEW_PERMISSION,
      TMS_LIVE_TRACK_CONFIG_MANAGE_PERMISSION,
    ].includes(p),
  );
}

/**
 * Hak kelola Pengaturan Live Track (grup, unit, jadwal).
 *
 * Sengaja TIDAK mengimplikasi dari `tms`/`tms.input` agar perubahan
 * konfigurasi kontrak customer hanya dilakukan role yang diberi wewenang
 * eksplisit (`tms.live-track-config.manage`).
 */
export function canManageLiveTrackConfig(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return false;
  return permissions.some((p) =>
    ["all", TMS_LIVE_TRACK_CONFIG_PERMISSION, TMS_LIVE_TRACK_CONFIG_MANAGE_PERMISSION].includes(p),
  );
}

/**
 * Hak lihat Pengaturan SLA (profil rute + jadwal kedatangan per client).
 *
 * Pemegang `tms`/`tms.view`/`tms.input` boleh melihat agar operasional
 * memahami standar SLA. Mengubah konfigurasi butuh permission manage
 * eksplisit. Akun external selalu ditolak (konfigurasi internal).
 */
export function canViewTmsSlaConfig(
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
      TMS_SLA_CONFIG_PERMISSION,
      TMS_SLA_CONFIG_VIEW_PERMISSION,
      TMS_SLA_CONFIG_MANAGE_PERMISSION,
    ].includes(p),
  );
}

/**
 * Hak kelola Pengaturan SLA.
 *
 * Sengaja TIDAK mengimplikasi dari `tms`/`tms.input` agar standar
 * kedatangan milik client hanya diubah role yang diberi wewenang eksplisit
 * (`tms.sla-config.manage`).
 */
export function canManageTmsSlaConfig(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return false;
  return permissions.some((p) =>
    ["all", TMS_SLA_CONFIG_PERMISSION, TMS_SLA_CONFIG_MANAGE_PERMISSION].includes(p),
  );
}
/**
 * Hak kelola Pengaturan Unit Client (mapping unit operasional -> client).
 *
 * Sengaja TIDAK mengimplikasi dari `vehicle-odometer`/`vehicle-odometer.manage`
 * agar konfigurasi cakupan data client hanya dilakukan role yang diberi
 * wewenang eksplisit. Akun external selalu ditolak.
 */
export function canManageOdometerClientUnits(
  permissions: string[],
  accountType: AccountType = "internal",
): boolean {
  if (accountType === "external") return false;
  return permissions.some((p) =>
    [
      "all",
      VEHICLE_ODOMETER_CLIENT_UNIT_CONFIG_PERMISSION,
      VEHICLE_ODOMETER_CLIENT_UNIT_CONFIG_MANAGE_PERMISSION,
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
