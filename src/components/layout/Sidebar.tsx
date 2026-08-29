"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import {
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  CreditCard,
  ClipboardCheck,
  Award,
  Scale,
  CalendarDays,
  ClipboardList,
  UserPlus,
  Wallet,
  Database,
  Settings,
  UsersRound,
  Shield,
  UserCog,
  Megaphone,
  Clock,
  ShieldCheck,
  LayoutDashboard,
  Gauge,
  Briefcase,
  Truck,
  Package,
  HardDrive,
  X,
  LineChart,
  ReceiptText,
  PiggyBank,
  Landmark,
  TrendingUpDown,
  PieChart,
  SlidersHorizontal,
  FileText,
  FileSpreadsheet,
  TrendingUp,
  Banknote,
  type LucideIcon,
} from "lucide-react";
import { getDefaultRouteForPermissions } from "@/lib/navigation";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

interface SubItem {
  name: string;
  href: string;
  icon: LucideIcon;
  comingSoon?: boolean;
  permission?: string;
}

interface MenuLink {
  kind: "link";
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
  /** Bila true, item dianggap visible untuk semua user authenticated. */
  alwaysVisible?: boolean;
}

interface MenuGroup {
  kind: "group";
  key: string;
  label: string;
  icon: LucideIcon;
  basePath: string;
  items: SubItem[];
}

type MenuEntry = MenuLink | MenuGroup;

interface MenuSection {
  label: string;
  entries: MenuEntry[];
}

const allSections: MenuSection[] = [
  {
    label: "Menu",
    entries: [
      {
        kind: "link",
        key: "dashboard",
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        permission: "dashboard",
      },
      {
        kind: "group",
        key: "operasional-kendaraan",
        label: "Operasional Kendaraan",
        icon: Gauge,
        basePath: "/operasional-kendaraan",
        items: [
          { name: "Dashboard", href: "/operasional-kendaraan/dashboard", icon: Gauge, permission: "vehicle-odometer" },
          { name: "Input Odometer", href: "/operasional-kendaraan/input", icon: ClipboardList, permission: "vehicle-odometer.manage" },
          { name: "Laporan", href: "/operasional-kendaraan/laporan", icon: FileSpreadsheet, permission: "vehicle-odometer" },
        ],
      },
      {
        kind: "group",
        key: "hrm",
        label: "HRM",
        icon: UsersRound,
        basePath: "/employees",
        items: [
          { name: "Data Pegawai", href: "/employees", icon: Users, permission: "employees" },
          { name: "Absensi", href: "/employees/attendance", icon: ClipboardCheck, permission: "attendance" },
          { name: "Cuti & Izin", href: "/employees/leave", icon: CalendarDays, permission: "leave" },
          { name: "Lembur", href: "/employees/overtime", icon: Clock, permission: "overtime" },
          { name: "Rekap Titik", href: "/employees/income", icon: Wallet, permission: "income" },
          { name: "Penggajian", href: "/employees/payroll", icon: CreditCard, permission: "payroll" },
          { name: "Kenaikan Gapok", href: "/employees/gapok-increments", icon: TrendingUp, permission: "payroll" },
          { name: "Kinerja", href: "/employees/performance", icon: Award, permission: "performance" },
          { name: "Legal & Administrasi", href: "/employees/legal", icon: Scale, permission: "legal" },
          { name: "Pengumuman", href: "/employees/announcements", icon: Megaphone, permission: "announcements" },
          { name: "Rekrutmen", href: "/employees/recruitment", icon: UserPlus, permission: "recruitment" },
        ],
      },
      {
        kind: "group",
        key: "general-affair",
        label: "General Affair",
        icon: Briefcase,
        basePath: "/general-affair",
        items: [
          { name: "Petty Cash", href: "/general-affair/petty-cash", icon: Wallet, permission: "petty-cash" },
          { name: "Data Mobil", href: "/general-affair/data-mobil", icon: Truck, permission: "data-mobil" },
          { name: "Aset", href: "/general-affair/inventory-aset", icon: Package, permission: "inventory-aset" },
        ],
      },
      {
        kind: "group",
        key: "finance",
        label: "Finance",
        icon: PiggyBank,
        basePath: "/finance",
        items: [
          { name: "Dashboard", href: "/finance", icon: LineChart, permission: "finance" },
          { name: "Pendapatan", href: "/finance/pendapatan", icon: ReceiptText, permission: "finance" },
          { name: "Pengeluaran", href: "/finance/pengeluaran", icon: TrendingUpDown, permission: "finance" },
          { name: "Arus Kas", href: "/finance/arus-kas", icon: Landmark, permission: "finance" },
          { name: "Laba Rugi", href: "/finance/laba-rugi", icon: PieChart, permission: "finance" },
          { name: "Pajak", href: "/finance/pajak", icon: ReceiptText, permission: "finance" },
          { name: "Pengaturan", href: "/finance/pengaturan", icon: SlidersHorizontal, permission: "finance" },
        ],
      },
      {
        kind: "link",
        key: "legalitas",
        label: "Legalitas",
        href: "/legalitas",
        icon: FileText,
        permission: "legalitas",
      },
    ],
  },
  {
    label: "Sistem",
    entries: [
      {
        kind: "group",
        key: "settings",
        label: "Pengaturan",
        icon: Settings,
        basePath: "/settings",
        items: [
          { name: "Data Master", href: "/settings/master-data", icon: Database, permission: "settings" },
          { name: "Penyimpanan", href: "/settings/storage-usage", icon: HardDrive },
          { name: "Keamanan", href: "/settings/security", icon: Shield, permission: "settings" },
          { name: "Riwayat Aksi", href: "/settings/audit-logs", icon: ShieldCheck },
          { name: "Manajemen Akun", href: "/settings/accounts", icon: UserCog },
        ],
      },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { isSuperAdmin, hasPermission, isLoading, profile } = useAuth();

  // Filter section/entries berdasarkan permission user
  const sections: MenuSection[] = allSections
    .map((section) => {
      const filteredEntries = section.entries
        .map((entry): MenuEntry | null => {
          if (entry.kind === "link") {
            // Standalone link
            if (isLoading || !profile) return null;
            if (entry.alwaysVisible) return entry;
            if (entry.href === "/settings/accounts") return isSuperAdmin ? entry : null;
            if (entry.href === "/settings/audit-logs") return isSuperAdmin ? entry : null;
            if (!entry.permission) return entry;
            return hasPermission(entry.permission) || hasPermission(entry.permission + ".view") || hasPermission(entry.permission + ".input") ? entry : null;
          }
          // Group: filter sub items
          const filteredItems = entry.items.filter((item) => {
            if (isLoading || !profile) return false;
            if (item.href === "/settings/accounts") return isSuperAdmin;
            if (item.href === "/settings/audit-logs") return isSuperAdmin;
            if (item.href === "/settings/storage-usage") return isSuperAdmin;
            if (!item.permission) return true;
            return hasPermission(item.permission) || hasPermission(item.permission + ".view") || hasPermission(item.permission + ".input");
          });
          if (filteredItems.length === 0) return null;
          return { ...entry, items: filteredItems };
        })
        .filter((e): e is MenuEntry => e !== null);
      return { ...section, entries: filteredEntries };
    })
    .filter((s) => s.entries.length > 0);

  /**
   * Active href = href terpanjang yang match dengan pathname (exact atau prefix).
   * Mencegah parent route "/employees" selalu aktif saat user di "/employees/attendance".
   */
  const activeHref: string | null = (() => {
    let best: string | null = null;
    const consider = (href: string) => {
      const isMatch = pathname === href || pathname.startsWith(href + "/");
      if (isMatch && (best === null || href.length > best.length)) {
        best = href;
      }
    };
    sections.forEach((s) => {
      s.entries.forEach((entry) => {
        if (entry.kind === "link") {
          consider(entry.href);
        } else {
          entry.items.forEach((item) => {
            if (item.comingSoon) return;
            consider(item.href);
          });
        }
      });
    });
    return best;
  })();

  // Auto-open group yang punya sub item aktif
  const computeOpenGroups = () => {
    const open: Record<string, boolean> = {};
    sections.forEach((s) => {
      s.entries.forEach((entry) => {
        if (entry.kind === "group") {
          open[entry.key] = entry.items.some((item) => item.href === activeHref);
        }
      });
    });
    return open;
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(computeOpenGroups);

  useEffect(() => {
    const timer = window.setTimeout(() => setOpenGroups(computeOpenGroups()), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, pathname]);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const roleLabel = profile?.roles?.nama ?? (isSuperAdmin ? "Super Admin" : "User");
  const homeHref = getDefaultRouteForPermissions(profile?.roles?.permissions ?? [], profile?.account_type ?? "internal");

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen flex flex-col",
          "transition-[width,transform] duration-300 ease-in-out",
          "border-r border-white/[0.05]",
          collapsed ? "w-[64px]" : "w-[240px]",
          // Mobile: drawer slides from left
          "max-lg:fixed max-lg:top-0 max-lg:left-0 max-lg:h-screen max-lg:z-40",
          mobileOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
        )}
      >
      {/* Background: solid dark + subtle vertical gradient highlight, tanpa grid/blob */}
      <div className="absolute inset-0 bg-[#0b1120]" />
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-blue-500/[0.04] to-transparent pointer-events-none" />

      <div className="relative z-10 flex flex-col h-full">
        {/* Header: Logo + collapse toggle */}
        <div
          className={cn(
            "flex items-center h-14 border-b border-white/[0.05] flex-shrink-0",
            collapsed ? "justify-center px-2" : "px-3 gap-2",
          )}
        >
          <a
            href={homeHref}
            className={cn(
              "flex items-center gap-2.5 min-w-0",
              collapsed ? "" : "flex-1",
            )}
            aria-label="Beranda"
          >
            <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06]">
              <Image src="/logo.png" alt="Logo" width={22} height={22} className="object-contain" />
            </div>
            {!collapsed && (
              <div className="min-w-0 animate-fade-in">
                <h1 className="text-[13px] font-semibold text-white leading-tight truncate">Jamslogistic</h1>
                <p className="text-[9px] font-medium text-blue-300/60 uppercase tracking-[0.18em]">HRM System</p>
              </div>
            )}
          </a>

          {/* Desktop collapse toggle */}
          {!collapsed && (
            <button
              onClick={onToggle}
              className="hidden lg:inline-flex p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
              aria-label="Tutup sidebar"
              title="Tutup sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
          {/* Mobile close button */}
          <button
            onClick={onMobileClose}
            className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
            aria-label="Tutup menu"
            title="Tutup menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden py-3 sidebar-scrollbar",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {isLoading ? (
            <div className={cn(collapsed ? "px-1 space-y-2" : "px-2 space-y-2")}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg bg-white/[0.04] animate-pulse",
                    collapsed ? "h-10 w-10 mx-auto" : "h-[38px]",
                  )}
                />
              ))}
            </div>
          ) : sections.map((section, sIdx) => (
            <div key={section.label} className={cn(sIdx > 0 && (collapsed ? "mt-3 pt-3 border-t border-white/[0.05]" : "mt-4"))}>
              {/* Section label */}
              {!collapsed && (
                <p className="px-2 mb-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-[0.12em]">
                  {section.label}
                </p>
              )}

              <div className={cn(collapsed ? "space-y-1" : "space-y-0.5")}>
                {section.entries.map((entry) => {
                  // ─── Standalone link entry ───
                  if (entry.kind === "link") {
                    const isActive = entry.href === activeHref;
                    const LinkIcon = entry.icon;
                    return (
                      <div key={entry.key} className="relative group/trigger">
                        <a
                          href={entry.href}
                          onClick={onMobileClose}
                          className={cn(
                            "w-full flex items-center rounded-lg transition-colors",
                            collapsed
                              ? "justify-center h-10 w-10 mx-auto"
                              : "gap-2.5 px-2 py-1.5",
                            isActive
                              ? "text-white bg-white/[0.05]"
                              : "text-slate-400 hover:text-white hover:bg-white/[0.04]",
                          )}
                        >
                          <div
                            className={cn(
                              "flex items-center justify-center flex-shrink-0 w-7 h-7 rounded-md transition-colors",
                              isActive
                                ? "bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/20"
                                : "bg-white/[0.04] text-slate-400",
                            )}
                          >
                            <LinkIcon className="w-[15px] h-[15px]" strokeWidth={2} />
                          </div>

                          {!collapsed && (
                            <span
                              className={cn(
                                "flex-1 left text-[12.5px] truncate",
                                isActive ? "font-semibold text-white" : "font-medium",
                              )}
                            >
                              {entry.label}
                            </span>
                          )}

                          {/* Active indicator dot kecil saat expanded */}
                          {!collapsed && isActive && (
                            <span className="w-1 h-1 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 flex-shrink-0" />
                          )}
                        </a>

                        {collapsed && (
                          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md shadow-xl ring-1 ring-white/10 opacity-0 invisible group-hover/trigger:opacity-100 group-hover/trigger:visible whitespace-nowrap z-50 transition-opacity">
                            {entry.label}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // ─── Group entry ───
                  const group = entry;
                  const isOpen = openGroups[group.key];
                  const isGroupActive = group.items.some((item) => item.href === activeHref);
                  const GroupIcon = group.icon;

                  return (
                    <div key={group.key}>
                      {/* Group trigger */}
                      <div className="relative group/trigger">
                        {collapsed ? (
                          <>
                            <a
                              href={group.items[0].href}
                              onClick={onMobileClose}
                              className={cn(
                                "w-full flex items-center rounded-lg transition-colors group/btn",
                                "justify-center h-10 w-10 mx-auto",
                                isGroupActive
                                  ? "text-white bg-white/[0.05]"
                                  : "text-slate-400 hover:text-white hover:bg-white/[0.04]",
                              )}
                            >
                              <div
                                className={cn(
                                  "flex items-center justify-center flex-shrink-0 w-7 h-7 rounded-md transition-colors",
                                  isGroupActive
                                    ? "bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/20"
                                    : "bg-white/[0.04] text-slate-400 group-hover/btn:bg-white/[0.07] group-hover/btn:text-slate-200",
                                )}
                              >
                                <GroupIcon className="w-[15px] h-[15px]" strokeWidth={2} />
                              </div>
                            </a>
                            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md shadow-xl ring-1 ring-white/10 opacity-0 invisible group-hover/trigger:opacity-100 group-hover/trigger:visible whitespace-nowrap z-50 transition-opacity">
                              {group.label}
                            </div>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => toggleGroup(group.key)}
                              className={cn(
                                "w-full flex items-center rounded-lg transition-colors group/btn",
                                "gap-2.5 px-2 py-1.5",
                                isGroupActive
                                  ? "text-white bg-white/[0.05]"
                                  : "text-slate-400 hover:text-white hover:bg-white/[0.04]",
                              )}
                            >
                              <div
                                className={cn(
                                  "flex items-center justify-center flex-shrink-0 w-7 h-7 rounded-md transition-colors",
                                  isGroupActive
                                    ? "bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/20"
                                    : "bg-white/[0.04] text-slate-400 group-hover/btn:bg-white/[0.07] group-hover/btn:text-slate-200",
                                )}
                              >
                                <GroupIcon className="w-[15px] h-[15px]" strokeWidth={2} />
                              </div>
                              <span
                                className={cn(
                                  "flex-1 text-left text-[12.5px] truncate",
                                  isGroupActive ? "font-semibold text-white" : "font-medium",
                                )}
                              >
                                {group.label}
                              </span>
                              <ChevronDown
                                className={cn(
                                  "w-3.5 h-3.5 text-slate-500 transition-transform duration-200",
                                  isOpen && "rotate-180",
                                )}
                              />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Sub items (accordion) */}
                      {!collapsed && (
                        <div
                          className={cn(
                            "overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out",
                            isOpen ? "max-h-[640px] opacity-100" : "max-h-0 opacity-0",
                          )}
                        >
                          <ul className="mt-0.5 mb-1 ml-[18px] pl-[14px] border-l border-white/[0.06] space-y-px">
                            {group.items.map((item) => {
                              const isActive = item.href === activeHref;
                              const ItemIcon = item.icon;

                              if (item.comingSoon) {
                                return (
                                  <li key={item.href}>
                                    <div className="flex items-center gap-2 px-2 py-[7px] rounded-md text-[12px] font-medium text-slate-600 cursor-not-allowed">
                                      <ItemIcon className="w-[13px] h-[13px] flex-shrink-0" />
                                      <span className="truncate">{item.name}</span>
                                      <span className="ml-auto text-[8px] font-bold text-amber-400/70 bg-amber-500/10 px-1.5 py-0.5 rounded flex-shrink-0">
                                        SOON
                                      </span>
                                    </div>
                                  </li>
                                );
                              }

                              return (
                                <li key={item.href} className="relative">
                                  {isActive && (
                                    <span className="absolute -left-[15px] top-1/2 -translate-y-1/2 h-[18px] w-[2px] rounded-r-full bg-gradient-to-b from-blue-400 to-cyan-400" />
                                  )}
                                  <a
                                    href={item.href}
                                    onClick={onMobileClose}
                                    className={cn(
                                      "flex items-center gap-2 px-2 py-[7px] rounded-md text-[12px] transition-colors",
                                      isActive
                                        ? "text-white bg-white/[0.05] font-semibold"
                                        : "text-slate-400 hover:text-white hover:bg-white/[0.03] font-medium",
                                    )}
                                  >
                                    <ItemIcon
                                      className={cn(
                                        "w-[13px] h-[13px] flex-shrink-0",
                                        isActive ? "text-blue-300" : "text-slate-500",
                                      )}
                                      strokeWidth={2}
                                    />
                                    <span className="truncate">{item.name}</span>
                                  </a>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[0.05] flex-shrink-0">
          {collapsed ? (
            <div className="px-2 py-2.5 flex flex-col items-center gap-1.5">
              <button
                onClick={onToggle}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                aria-label="Buka sidebar"
                title="Buka sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-slate-500 truncate">Login sebagai</p>
                <p className="text-[11px] font-semibold text-slate-300 truncate" title={roleLabel}>
                  {roleLabel}
                </p>
              </div>
              <span className="text-[9px] font-medium text-slate-600 bg-white/[0.04] px-1.5 py-0.5 rounded ring-1 ring-white/[0.04] flex-shrink-0">
                v0.1
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Custom scrollbar styling */}
      <style jsx>{`
        :global(.sidebar-scrollbar) {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
        }
        :global(.sidebar-scrollbar::-webkit-scrollbar) {
          width: 4px;
        }
        :global(.sidebar-scrollbar::-webkit-scrollbar-track) {
          background: transparent;
        }
        :global(.sidebar-scrollbar::-webkit-scrollbar-thumb) {
          background: rgba(255, 255, 255, 0.06);
          border-radius: 9999px;
        }
        :global(.sidebar-scrollbar::-webkit-scrollbar-thumb:hover) {
          background: rgba(255, 255, 255, 0.12);
        }
      `}</style>
    </aside>
    </>
  );
}
