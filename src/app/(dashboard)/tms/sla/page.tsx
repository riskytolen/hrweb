import { Suspense } from "react";
import SlaConfigPage from "../_components/SlaConfigPage";

export default function TmsSlaPage() {
  return (
    <Suspense>
      <SlaConfigPage />
    </Suspense>
  );
}
