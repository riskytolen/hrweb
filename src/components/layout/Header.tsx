"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Search,
  Menu,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";

interface HeaderProps {
  onMenuToggle: () => void;
}

const notifications = [
  {
    id: 1,
    title: "Pengajuan cuti baru",
    desc: "Ahmad Fauzi mengajukan cuti 3 hari",
    time: "5 menit lalu",
    unread: true,
  },
  {
    id: 2,
    title: "Pegawai baru bergabung",
    desc: "Siti Nurhaliza - Divisi Marketing",
    time: "1 jam lalu",
    unread: true,
  },
  {
    id: 3,
    title: "Penggajian diproses",
    desc: "Gaji bulan Maret - 248 pegawai",
    time: "3 jam lalu",
    unread: false,
  },
];

export default function Header({ onMenuToggle }: HeaderProps) {
  const router = useRouter();
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const unreadCount = notifications.filter((n) => n.unread).length;
  const { theme, toggleTheme } = useTheme();
  const { profile, signOut } = useAuth();

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Tutup dropdown saat klik di luar
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (showNotif && notifRef.current && !notifRef.current.contains(target)) {
        setShowNotif(false);
      }
      if (showProfile && profileRef.current && !profileRef.current.contains(target)) {
        setShowProfile(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNotif, showProfile]);

  const displayName = profile?.nama || "User";
  const displayEmail = profile?.email || "";
  const displayRole = profile?.roles?.nama || "User";

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setShowProfile(false);
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 h-16 bg-card/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-4 lg:px-6">
      {/* Left side */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-lg hover:bg-muted text-muted-foreground"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search */}
        <div className="hidden sm:flex items-center gap-2 bg-muted rounded-xl px-4 py-2.5 w-80">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari pegawai, jabatan, posisi..."
            className="bg-transparent text-sm outline-none w-full placeholder:text-muted-foreground/60 text-foreground"
          />
          <kbd className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-muted-foreground bg-card rounded-md border border-border">
            Ctrl+K
          </kbd>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1.5">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="relative p-2.5 rounded-xl hover:bg-muted text-muted-foreground"
          title={theme === "light" ? "Mode Gelap" : "Mode Terang"}
        >
          <Sun className={cn(
            "w-5 h-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300",
            theme === "light" ? "opacity-100 rotate-0 scale-100" : "opacity-0 rotate-90 scale-0"
          )} />
          <Moon className={cn(
            "w-5 h-5 transition-all duration-300",
            theme === "dark" ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-0"
          )} />
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => {
              setShowNotif(!showNotif);
              setShowProfile(false);
            }}
            className="relative p-2.5 rounded-xl hover:bg-muted text-muted-foreground"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse-soft">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotif && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-card rounded-2xl shadow-lg border border-border overflow-hidden animate-scale-in">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-sm text-foreground">Notifikasi</h3>
                <span className="text-xs text-primary font-medium cursor-pointer hover:underline">
                  Tandai semua dibaca
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={cn(
                      "px-4 py-3 hover:bg-muted/50 cursor-pointer border-b border-border/50 last:border-0",
                      notif.unread && "bg-primary-light/30"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {notif.unread && (
                        <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate text-foreground">
                          {notif.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {notif.desc}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {notif.time}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 border-t border-border text-center">
                <span className="text-xs text-primary font-medium cursor-pointer hover:underline">
                  Lihat semua notifikasi
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-border mx-1" />

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => {
              setShowProfile(!showProfile);
              setShowNotif(false);
            }}
            className="flex items-center gap-3 p-1.5 pr-3 rounded-xl hover:bg-muted"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold">
              {getInitials(displayName)}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-semibold leading-tight text-foreground">{displayName}</p>
              <p className="text-[10px] text-muted-foreground">
                {displayRole}
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground hidden md:block" />
          </button>

          {showProfile && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-card rounded-2xl shadow-lg border border-border overflow-hidden animate-scale-in">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-sm font-semibold text-foreground">{displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {displayEmail}
                </p>
                <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-primary/10 text-primary">
                  {displayRole}
                </span>
              </div>
              <div className="py-1">
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-danger hover:bg-danger-light/50 w-full disabled:opacity-50"
                >
                  {isLoggingOut ? (
                    <div className="w-4 h-4 border-2 border-danger/30 border-t-danger rounded-full animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4" />
                  )}
                  {isLoggingOut ? "Keluar..." : "Keluar"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
