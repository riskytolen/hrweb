import { Suspense } from "react";
import LiveTrackTask from "../_components/LiveTrackTask";

export default function TmsLiveTrackTaskPage() {
  return (
    <Suspense>
      <LiveTrackTask />
    </Suspense>
  );
}
