"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Users,
  ChevronLeft,
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
}

interface MenuGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  basePath: string;
  items: SubItem[];
}

const menuGroups: MenuGroup[] = [
  {
    key: "hrm",
    label: "HRM",
    icon: UsersRound,
    color: "from-blue-500 to-cyan-400",
    basePath: "/employees",
    items: [
      { name: "Data Pegawai", href: "/employees", icon: Users },
      { name: "Absensi", href: "/employees/attendance", icon: ClipboardCheck },
      { name: "Cuti & Izin", href: "/employees/leave", icon: CalendarDays },
      { name: "Rekap Titik", href: "/employees/income", icon: Wallet },
      { name: "Penggajian", href: "/employees/payroll", icon: CreditCard, comingSoon: true },
      { name: "Kinerja", href: "/employees/performance", icon: Award, comingSoon: true },
      { name: "Legal & Administrasi", href: "/employees/legal", icon: Scale, comingSoon: true },
      { name: "Rekrutmen", href: "/employees/recruitment", icon: UserPlus },
    ],
  },
  {
    key: "settings",
    label: "Pengaturan",
    icon: Settings,
    color: "from-teal-500 to-cyan-400",
    basePath: "/settings",
    items: [
      { name: "Data Master", href: "/settings/master-data", icon: Database },
      { name: "Keamanan", href: "/settings/security", icon: Shield },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  // Auto-open group yang memiliki sub item aktif
  const getInitialOpen = () => {
    const open: Record<string, boolean> = {};
    menuGroups.forEach((g) => {
      open[g.key] = g.items.some((item) =>
        pathname === item.href || pathname.startsWith(item.href + "/")
      );
    });
    return open;
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(getInitialOpen);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen flex flex-col",
        "transition-all duration-300 ease-in-out",
        collapsed ? "w-[60px]" : "w-[230px]"
      )}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c1222] via-[#0f1729] to-[#0c1222]" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-100" />
      <div className="absolute top-0 left-0 w-32 h-32 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-20 right-0 w-24 h-24 bg-violet-600/8 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col h-full">
        {/* Logo */}
        <div className={cn("flex items-center h-14 border-b border-white/[0.06]", collapsed ? "px-3 justify-center" : "px-4")}>
          <Link href="/employees" className="flex items-center gap-2.5 min-w-0">
            {!collapsed ? (
              <div className="animate-fade-in min-w-0">
                <h1 className="text-[13px] font-bold bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent leading-tight truncate">
                  ERP System
                </h1>
                <p className="text-[9px] font-medium text-blue-400/50 uppercase tracking-[0.15em]">
                  Jamslogistic
                </p>
              </div>
            ) : (
              <span className="text-xs font-bold text-white/70">ERP</span>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto py-2", collapsed ? "px-1.5" : "px-2")}>
          <div className="space-y-1">
            {menuGroups.map((group) => {
              const isOpen = openGroups[group.key];
              const isGroupActive = group.items.some((item) =>
                pathname === item.href || pathname.startsWith(item.href + "/")
              );
              const GroupIcon = group.icon;

              return (
                <div key={group.key}>
                  {/* Group Header (clickable accordion) */}
                  <button
                    onClick={() => {
                      if (collapsed) {
                        // saat collapsed, langsung navigate ke item pertama
                        window.location.href = group.items[0].href;
                      } else {
                        toggleGroup(group.key);
                      }
                    }}
                    className={cn(
                      "w-full flex items-center gap-2.5 rounded-lg relative overflow-hidden",
                      collapsed ? "px-0 py-2.5 justify-center" : "px-2.5 py-2",
                      isGroupActive ? "text-white" : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {/* Active bg */}
                    {isGroupActive && (
                      <div className={cn("absolute inset-0 rounded-lg bg-gradient-to-r opacity-[0.1]", group.color)} />
                    )}
                    {!isGroupActive && (
                      <div className="absolute inset-0 rounded-lg bg-white/0 hover:bg-white/[0.04]" />
                    )}

                    {/* Icon */}
                    <div className={cn(
                      "relative flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center",
                      isGroupActive
                        ? cn("bg-gradient-to-br shadow-md", group.color)
                        : "bg-white/[0.04]"
                    )}>
                      <GroupIcon className={cn("w-[14px] h-[14px]", isGroupActive ? "text-white" : "text-slate-400")} />
                    </div>

                    {/* Label + Chevron */}
                    {!collapsed && (
                      <>
                        <span className={cn("text-[12px] font-semibold truncate flex-1 text-left", isGroupActive ? "text-white" : "")}>
                          {group.label}
                        </span>
                        <ChevronDown className={cn(
                          "w-3.5 h-3.5 text-slate-500 transition-transform duration-200",
                          isOpen && "rotate-180"
                        )} />
                      </>
                    )}
                  </button>

                  {/* Tooltip saat collapsed */}
                  {collapsed && (
                    <div className="relative group/tip">
                      <div className="absolute left-full bottom-full mb-0 ml-2.5 px-2.5 py-1 bg-slate-800 text-white text-[11px] font-medium rounded-md shadow-xl opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible whitespace-nowrap z-50 border border-white/10">
                        {group.label}
                      </div>
                    </div>
                  )}

                  {/* Sub Items (accordion content) */}
                  {!collapsed && (
                    <div className={cn(
                      "overflow-hidden transition-all duration-200 ease-in-out",
                      isOpen ? "max-h-[500px] opacity-100 mt-0.5" : "max-h-0 opacity-0"
                    )}>
                      <ul className="ml-[18px] border-l border-white/[0.06] pl-2.5 space-y-0.5 py-0.5">
                        {group.items.map((item) => {
                          const isActive = !item.comingSoon && (pathname === item.href ||
                            (item.href !== "/employees" && item.href !== "/settings" && pathname.startsWith(item.href + "/")));
                          const ItemIcon = item.icon;

                          if (item.comingSoon) {
                            return (
                              <li key={item.href}>
                                <div className="flex items-center gap-2 px-2.5 py-[7px] rounded-md text-[11.5px] font-medium text-slate-600 cursor-not-allowed">
                                  <ItemIcon className="w-[13px] h-[13px] flex-shrink-0 text-slate-700" />
                                  <span className="truncate">{item.name}</span>
                                  <span className="ml-auto text-[8px] font-bold text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded flex-shrink-0">SOON</span>
                                </div>
                              </li>
                            );
                          }

                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                className={cn(
                                  "flex items-center gap-2 px-2.5 py-[7px] rounded-md relative text-[11.5px] font-medium",
                                  isActive
                                    ? "text-white bg-white/[0.08]"
                                    : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
                                )}
                              >
                                {isActive && (
                                  <div className="absolute -left-[13px] top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full bg-gradient-to-r from-blue-400 to-cyan-400 shadow-sm shadow-blue-400/50" />
                                )}
                                <ItemIcon className={cn("w-[13px] h-[13px] flex-shrink-0", isActive ? "text-blue-400" : "text-slate-600")} />
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
        </nav>

        {/* Collapse Toggle */}
        <div className={cn("pb-2.5", collapsed ? "px-1.5" : "px-2")}>
          <button
            onClick={onToggle}
            className={cn(
              "flex items-center justify-center w-full py-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]",
              collapsed ? "" : "gap-1.5"
            )}
          >
            <ChevronLeft className={cn("w-3.5 h-3.5 transition-transform duration-300", collapsed && "rotate-180")} />
            {!collapsed && <span className="text-[10px] font-medium">Tutup</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
