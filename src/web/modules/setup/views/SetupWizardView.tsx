import type { ReactNode } from "react";
import { SetupWizardRequestContainer } from "@/modules/setup/containers/SetupWizardContainer";

export function SetupWizardView({ connections }: { connections: ReactNode }) {
  return <SetupWizardRequestContainer connections={connections} />;
}
