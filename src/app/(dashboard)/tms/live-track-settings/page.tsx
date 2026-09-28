import { Suspense } from "react";
import LiveTrackSettings from "../_components/LiveTrackSettings";

export default function TmsLiveTrackSettingsPage() {
  return (
    <Suspense>
      <LiveTrackSettings />
    </Suspense>
  );
}
