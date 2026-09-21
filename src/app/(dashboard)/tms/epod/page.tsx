import { Suspense } from "react";
import EpodMonitoring from "../_components/EpodMonitoring";

export default function TmsEpodPage() {
  return (
    <Suspense>
      <EpodMonitoring />
    </Suspense>
  );
}
