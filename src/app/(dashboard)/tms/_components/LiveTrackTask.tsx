"use client";

import { useState } from "react";
import RouteGuard from "@/components/RouteGuard";
import type { FleetTaskInstantItem } from "@/lib/fleet-task-track";
import TaskInstantBoard from "./TaskInstantBoard";
import TaskInstantSidePanel from "./TaskInstantSidePanel";

export default function LiveTrackTask() {
  const [selectedTask, setSelectedTask] = useState<FleetTaskInstantItem | null>(null);

  return (
    <RouteGuard permission="tms">
      <div className="space-y-5">
        {/* Board + side panel ala FleetPro */}
        <div className="grid items-start gap-5 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <TaskInstantBoard selectedId={selectedTask?.id ?? null} onSelect={setSelectedTask} />
          </div>
          <aside className="min-w-0 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
            <TaskInstantSidePanel
              item={selectedTask}
              onBack={() => setSelectedTask(null)}
            />
          </aside>
        </div>
      </div>
    </RouteGuard>
  );
}
