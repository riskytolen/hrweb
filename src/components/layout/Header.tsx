"use client";

import { useState, useEffect, useRef } from "react";

import {
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

export default function Header({ onMenuToggle }: HeaderProps) {
  const [showProfile, setShowProfile] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { profile, signOut } = useAuth();

  const profileRef = useRef<HTMLDivElement>(null);

  // Tutup dropdown saat klik di luar
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (showProfile && profileRef.current && !profileRef.current.contains(target)) {
        setShowProfile(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProfile]);

  const displayName = profile?.nama || "User";
  const displayEmail = profile?.email || "";
  const displayRole = profile?.roles?.nama || "User";

  const handleLogout = async () => {
    setIsLoggingOut(true);
    setShowProfile(false);
    await signOut();
    window.location.assign("/login");
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

        {/* Divider */}
        <div className="w-px h-8 bg-border mx-1" />

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => {
              setShowProfile(!showProfile);
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
