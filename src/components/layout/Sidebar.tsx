"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, getInitials } from "@/lib/utils";
import {
  Users,
  ChevronLeft,
  CreditCard,
  ClipboardCheck,
  Award,
  Scale,
  CalendarDays,
  UserPlus,
  LogOut,
  Sparkles,
  Database,
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navigationGroups = [
  {
    label: "HRM",
    items: [
      { name: "Data Pegawai", href: "/employees", icon: Users, color: "from-blue-500 to-cyan-400" },
      { name: "Absensi", href: "/employees/attendance", icon: ClipboardCheck, color: "from-emerald-500 to-teal-400" },
      { name: "Cuti & Izin", href: "/employees/leave", icon: CalendarDays, color: "from-amber-500 to-yellow-400" },
      { name: "Penggajian", href: "/employees/payroll", icon: CreditCard, color: "from-violet-500 to-purple-400" },
      { name: "Kinerja", href: "/employees/performance", icon: Award, color: "from-rose-500 to-pink-400" },
      { name: "Legal & Administrasi", href: "/employees/legal", icon: Scale, color: "from-slate-500 to-gray-400" },
      { name: "Rekrutmen", href: "/employees/recruitment", icon: UserPlus, color: "from-indigo-500 to-blue-400" },
    ],
  },
  {
    label: "PENGATURAN",
    items: [
      { name: "Data Master", href: "/settings/master-data", icon: Database, color: "from-teal-500 to-cyan-400" },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen flex flex-col",
        "transition-all duration-300 ease-in-out",
        collapsed ? "w-[60px]" : "w-[220px]"
      )}
    >
      {/* Background layers */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c1222] via-[#0f1729] to-[#0c1222]" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-100" />
      <div className="absolute top-0 left-0 w-32 h-32 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-20 right-0 w-24 h-24 bg-violet-600/8 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col h-full">
        {/* Logo */}
        <div className={cn("flex items-center h-14 border-b border-white/[0.06]", collapsed ? "px-3 justify-center" : "px-4")}>
          <Link href="/employees" className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-[1.5px] border-[#0f1729]" />
            </div>
            {!collapsed && (
              <div className="animate-fade-in min-w-0">
                <h1 className="text-[13px] font-bold bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent leading-tight truncate">
                  HRM System
                </h1>
                <p className="text-[9px] font-medium text-blue-400/50 uppercase tracking-[0.15em]">
                  Human Resource
                </p>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto py-2", collapsed ? "px-1.5" : "px-2")}>
          {navigationGroups.map((group, groupIdx) => (
            <div key={group.label} className={groupIdx > 0 ? "mt-4" : ""}>
              {!collapsed && (
                <div className={cn("px-2.5 pb-1", groupIdx === 0 ? "pt-2" : "pt-0")}>
                  <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-blue-400/30">
                    {group.label}
                  </p>
                </div>
              )}
              {collapsed && groupIdx > 0 && (
                <div className="mx-2 mb-2 border-t border-white/[0.06]" />
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/employees" && pathname.startsWith(item.href));
                  return (
                    <li key={item.name} className="relative group/item">
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg relative overflow-hidden",
                          collapsed ? "px-0 py-2.5 justify-center" : "px-2.5 py-2",
                          isActive ? "text-white" : "text-slate-400 hover:text-slate-200"
                        )}
                      >
                        {isActive && (
                          <div className={cn("absolute inset-0 rounded-lg bg-gradient-to-r opacity-[0.15]", item.color)} />
                        )}
                        {!isActive && (
                          <div className="absolute inset-0 rounded-lg bg-white/0 group-hover/item:bg-white/[0.04]" />
                        )}
                        {isActive && (
                          <div className={cn("absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-4 rounded-r-full bg-gradient-to-b", item.color)} />
                        )}
                        <div className={cn(
                          "relative flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center",
                          isActive ? cn("bg-gradient-to-br shadow-md", item.color) : "bg-white/[0.04] group-hover/item:bg-white/[0.08]"
                        )}>
                          <item.icon className={cn("w-[14px] h-[14px]", isActive ? "text-white" : "text-slate-400 group-hover/item:text-slate-300")} />
                        </div>
                        {!collapsed && (
                          <span className={cn("text-[12px] font-medium truncate", isActive ? "text-white" : "")}>
                            {item.name}
                          </span>
                        )}
                        {isActive && collapsed && (
                          <div className={cn("absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gradient-to-r", item.color)} />
                        )}
                      </Link>
                      {collapsed && (
                        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1 bg-slate-800 text-white text-[11px] font-medium rounded-md shadow-xl opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible whitespace-nowrap z-50 border border-white/10">
                          {item.name}
                          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-800" />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* User Profile Section */}
        <div className={cn("border-t border-white/[0.06]", collapsed ? "p-1.5" : "p-2")}>
          {!collapsed ? (
            <div className="rounded-lg bg-gradient-to-r from-white/[0.04] to-white/[0.02] border border-white/[0.06] p-2.5">
              <div className="flex items-center gap-2.5">
                <div className="relative flex-shrink-0">
                  <div className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-bold shadow-md shadow-blue-500/15">
                    {getInitials("Admin User")}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full border-[1.5px] border-[#0f1729]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-white truncate">Admin User</p>
                  <p className="text-[9px] text-slate-500 truncate">Super Admin</p>
                </div>
                <button className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-white/[0.05]">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="relative group/user">
                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-[10px] font-bold cursor-pointer shadow-md shadow-blue-500/15">
                  {getInitials("Admin User")}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full border-[1.5px] border-[#0f1729]" />
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1 bg-slate-800 text-white text-[11px] font-medium rounded-md shadow-xl opacity-0 invisible group-hover/user:opacity-100 group-hover/user:visible whitespace-nowrap z-50 border border-white/10">
                  Admin User
                  <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-800" />
                </div>
              </div>
            </div>
          )}
        </div>

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
