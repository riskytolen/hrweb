"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { cn } from "@/lib/utils";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div
        className={cn(
          "transition-[margin-left] duration-300 ease-in-out",
          sidebarCollapsed ? "lg:ml-[64px]" : "lg:ml-[240px]"
        )}
      >
        <Header onMenuToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
