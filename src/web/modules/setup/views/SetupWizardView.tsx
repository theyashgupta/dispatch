import type { ComponentProps } from "react";
import { SetupWizardContainer } from "@/modules/setup/containers/SetupWizardContainer";

export function SetupWizardView(
  props: ComponentProps<typeof SetupWizardContainer>,
) {
  return <SetupWizardContainer {...props} />;
}
