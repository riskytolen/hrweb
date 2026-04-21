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
} from "lucide-react";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navigation = [
  { name: "Data Pegawai", href: "/employees", icon: Users, color: "from-blue-500 to-cyan-400" },
  { name: "Absensi", href: "/employees/attendance", icon: ClipboardCheck, color: "from-emerald-500 to-teal-400" },
  { name: "Cuti & Izin", href: "/employees/leave", icon: CalendarDays, color: "from-amber-500 to-yellow-400" },
  { name: "Penggajian", href: "/employees/payroll", icon: CreditCard, color: "from-violet-500 to-purple-400" },
  { name: "Kinerja", href: "/employees/performance", icon: Award, color: "from-rose-500 to-pink-400" },
  { name: "Legal & Administrasi", href: "/employees/legal", icon: Scale, color: "from-slate-500 to-gray-400" },
  { name: "Rekrutmen", href: "/employees/recruitment", icon: UserPlus, color: "from-indigo-500 to-blue-400" },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen flex flex-col",
        "transition-all duration-300 ease-in-out",
        collapsed ? "w-[78px]" : "w-[270px]"
      )}
    >
      {/* Background layers */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c1222] via-[#0f1729] to-[#0c1222]" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-100" />
      {/* Glow orbs */}
      <div className="absolute top-0 left-0 w-40 h-40 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-20 right-0 w-32 h-32 bg-violet-600/8 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col h-full">
        {/* Logo */}
        <div className={cn("flex items-center h-[68px] border-b border-white/[0.06]", collapsed ? "px-4 justify-center" : "px-5")}>
          <Link href="/employees" className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#0f1729]" />
            </div>
            {!collapsed && (
              <div className="animate-fade-in min-w-0">
                <h1 className="text-[15px] font-bold bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent leading-tight truncate">
                  HRM System
                </h1>
                <p className="text-[10px] font-medium text-blue-400/50 uppercase tracking-[0.15em]">
                  Human Resource
                </p>
              </div>
            )}
          </Link>
        </div>

        {/* Section label */}
        {!collapsed && (
          <div className="px-5 pt-5 pb-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400/30">
              HRM
            </p>
          </div>
        )}

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2.5" : "px-3")}>
          <ul className="space-y-1">
            {navigation.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/employees" && pathname.startsWith(item.href));
              return (
                <li key={item.name} className="relative group">
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl relative overflow-hidden",
                      collapsed ? "px-0 py-3 justify-center" : "px-3 py-2.5",
                      isActive
                        ? "text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {/* Active background */}
                    {isActive && (
                      <div className={cn(
                        "absolute inset-0 rounded-xl bg-gradient-to-r opacity-[0.15]",
                        item.color
                      )} />
                    )}
                    {/* Hover background */}
                    {!isActive && (
                      <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/[0.04]" />
                    )}
                    {/* Active left accent */}
                    {isActive && (
                      <div className={cn(
                        "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b",
                        item.color
                      )} />
                    )}

                    {/* Icon */}
                    <div className={cn(
                      "relative flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
                      isActive
                        ? cn("bg-gradient-to-br shadow-lg", item.color)
                        : "bg-white/[0.04] group-hover:bg-white/[0.08]"
                    )}>
                      <item.icon className={cn(
                        "w-[16px] h-[16px]",
                        isActive ? "text-white" : "text-slate-400 group-hover:text-slate-300"
                      )} />
                    </div>

                    {/* Label */}
                    {!collapsed && (
                      <span className={cn(
                        "text-[13px] font-medium truncate",
                        isActive ? "text-white" : ""
                      )}>
                        {item.name}
                      </span>
                    )}

                    {/* Active dot indicator (collapsed) */}
                    {isActive && collapsed && (
                      <div className={cn(
                        "absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gradient-to-r",
                        item.color
                      )} />
                    )}
                  </Link>

                  {/* Tooltip (collapsed mode) */}
                  {collapsed && (
                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible whitespace-nowrap z-50 border border-white/10">
                      {item.name}
                      <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-slate-800" />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User Profile Section */}
        <div className={cn("border-t border-white/[0.06]", collapsed ? "p-2.5" : "p-3")}>
          {!collapsed ? (
            <div className="rounded-xl bg-gradient-to-r from-white/[0.04] to-white/[0.02] border border-white/[0.06] p-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-blue-500/15">
                    {getInitials("Admin User")}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-[#0f1729]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-white truncate">Admin User</p>
                  <p className="text-[10px] text-slate-500 truncate">Super Administrator</p>
                </div>
                <button className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/[0.05]">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="relative group">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold cursor-pointer shadow-lg shadow-blue-500/15">
                  {getInitials("Admin User")}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-[#0f1729]" />
                {/* Tooltip */}
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible whitespace-nowrap z-50 border border-white/10">
                  Admin User
                  <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-slate-800" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Collapse Toggle */}
        <div className={cn("pb-3", collapsed ? "px-2.5" : "px-3")}>
          <button
            onClick={onToggle}
            className={cn(
              "flex items-center justify-center w-full py-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] group",
              collapsed ? "" : "gap-2"
            )}
          >
            <ChevronLeft
              className={cn(
                "w-4 h-4 transition-transform duration-300",
                collapsed && "rotate-180"
              )}
            />
            {!collapsed && (
              <span className="text-[11px] font-medium">Tutup Sidebar</span>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
