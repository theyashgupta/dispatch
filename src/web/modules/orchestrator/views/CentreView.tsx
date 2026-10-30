import { CentreContainer } from "@/modules/orchestrator/containers/CentreContainer";
import { CentrePaneContainer } from "@/modules/orchestrator/containers/CentrePaneContainer";
import { SettingsSheetContainer } from "@/modules/orchestrator/containers/SettingsSheetContainer";

export function CentreView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CentrePaneContainer
        canvas={
          <section
            aria-label="Canvas"
            className="h-full min-h-0 min-w-0 overflow-auto"
          >
            <CentreContainer />
          </section>
        }
      />
      <SettingsSheetContainer />
    </div>
  );
}
