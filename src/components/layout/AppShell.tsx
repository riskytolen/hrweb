"use client";

import { useState, useEffect, useCallback } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { cn } from "@/lib/utils";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={closeMobileSidebar}
      />
      <div
        className={cn(
          "transition-[margin-left] duration-300 ease-in-out",
          sidebarCollapsed ? "lg:ml-[64px]" : "lg:ml-[240px]"
        )}
      >
        <Header
          onMenuToggle={() => setMobileSidebarOpen((v) => !v)}
        />
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
