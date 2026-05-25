"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
  type LucideIcon,
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface SubItem {
  name: string;
  href: string;
  icon: LucideIcon;
  comingSoon?: boolean;
  permission?: string;
}

interface MenuGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  basePath: string;
  permission?: string;
  items: SubItem[];
}

interface MenuSection {
  label: string;
  groups: MenuGroup[];
}

const allSections: MenuSection[] = [
  {
    label: "Menu",
    groups: [
      {
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
          { name: "Kinerja", href: "/employees/performance", icon: Award, permission: "performance" },
          { name: "Legal & Administrasi", href: "/employees/legal", icon: Scale, permission: "legal" },
          { name: "Pengumuman", href: "/employees/announcements", icon: Megaphone, permission: "employees" },
          { name: "Rekrutmen", href: "/employees/recruitment", icon: UserPlus, permission: "recruitment" },
        ],
      },
    ],
  },
  {
    label: "Sistem",
    groups: [
      {
        key: "settings",
        label: "Pengaturan",
        icon: Settings,
        basePath: "/settings",
        items: [
          { name: "Data Master", href: "/settings/master-data", icon: Database, permission: "settings" },
          { name: "Keamanan", href: "/settings/security", icon: Shield, permission: "settings" },
          { name: "Riwayat Aksi", href: "/settings/audit-logs", icon: ShieldCheck },
          { name: "Manajemen Akun", href: "/settings/accounts", icon: UserCog },
        ],
      },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { isSuperAdmin, hasPermission, isLoading, profile } = useAuth();

  // Filter section/group/items berdasarkan permission user
  const sections: MenuSection[] = allSections
    .map((section) => {
      const filteredGroups = section.groups
        .map((group) => {
          const filteredItems = group.items.filter((item) => {
            if (isLoading || !profile) return true;
            if (item.href === "/settings/accounts") return isSuperAdmin;
            if (item.href === "/settings/audit-logs") return isSuperAdmin;
            if (!item.permission) return true;
            return hasPermission(item.permission) || hasPermission(item.permission + ".view");
          });
          return { ...group, items: filteredItems };
        })
        .filter((g) => g.items.length > 0);
      return { ...section, groups: filteredGroups };
    })
    .filter((s) => s.groups.length > 0);

  // Auto-open group yang punya sub item aktif
  const computeOpenGroups = () => {
    const open: Record<string, boolean> = {};
    sections.forEach((s) => {
      s.groups.forEach((g) => {
        open[g.key] = g.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
      });
    });
    return open;
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(computeOpenGroups);

  useEffect(() => {
    setOpenGroups(computeOpenGroups());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, pathname]);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const roleLabel = profile?.roles?.nama ?? (isSuperAdmin ? "Super Admin" : "User");

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen flex flex-col",
        "transition-[width] duration-300 ease-in-out",
        "border-r border-white/[0.05]",
        collapsed ? "w-[64px]" : "w-[240px]",
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
          <Link
            href="/employees"
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
          </Link>

          {!collapsed && (
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
              aria-label="Tutup sidebar"
              title="Tutup sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden py-3 sidebar-scrollbar",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {sections.map((section, sIdx) => (
            <div key={section.label} className={cn(sIdx > 0 && (collapsed ? "mt-3 pt-3 border-t border-white/[0.05]" : "mt-4"))}>
              {/* Section label */}
              {!collapsed && (
                <p className="px-2 mb-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-[0.12em]">
                  {section.label}
                </p>
              )}

              <div className={cn(collapsed ? "space-y-1" : "space-y-0.5")}>
                {section.groups.map((group) => {
                  const isOpen = openGroups[group.key];
                  const isGroupActive = group.items.some(
                    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
                  );
                  const GroupIcon = group.icon;

                  return (
                    <div key={group.key}>
                      {/* Group trigger */}
                      <div className="relative group/trigger">
                        <button
                          onClick={() => {
                            if (collapsed) {
                              window.location.href = group.items[0].href;
                            } else {
                              toggleGroup(group.key);
                            }
                          }}
                          className={cn(
                            "w-full flex items-center rounded-lg transition-colors group/btn",
                            collapsed
                              ? "justify-center h-10 w-10 mx-auto"
                              : "gap-2.5 px-2 py-1.5",
                            isGroupActive
                              ? "text-white bg-white/[0.05]"
                              : "text-slate-400 hover:text-white hover:bg-white/[0.04]",
                          )}
                        >
                          {/* Icon */}
                          <div
                            className={cn(
                              "flex items-center justify-center flex-shrink-0 rounded-md transition-colors",
                              collapsed ? "w-7 h-7" : "w-7 h-7",
                              isGroupActive
                                ? "bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/20"
                                : "bg-white/[0.04] text-slate-400 group-hover/btn:bg-white/[0.07] group-hover/btn:text-slate-200",
                            )}
                          >
                            <GroupIcon className="w-[15px] h-[15px]" strokeWidth={2} />
                          </div>

                          {!collapsed && (
                            <>
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
                            </>
                          )}
                        </button>

                        {/* Tooltip saat collapsed */}
                        {collapsed && (
                          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-slate-900 text-white text-[11px] font-medium rounded-md shadow-xl ring-1 ring-white/10 opacity-0 invisible group-hover/trigger:opacity-100 group-hover/trigger:visible whitespace-nowrap z-50 transition-opacity">
                            {group.label}
                          </div>
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
                              const isActive =
                                pathname === item.href || pathname.startsWith(item.href + "/");
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
                                  <Link
                                    href={item.href}
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
                                  </Link>
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
  );
}
