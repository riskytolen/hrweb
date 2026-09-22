import { Suspense } from "react";
import TripLoggerPage from "../_components/TripLoggerPage";

export default function TmsLoggerTripsPage() {
  return (
    <Suspense>
      <TripLoggerPage />
    </Suspense>
  );
}
