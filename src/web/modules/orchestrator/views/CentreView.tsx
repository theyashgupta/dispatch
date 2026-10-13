import { CentreContainer } from "@/modules/orchestrator/containers/CentreContainer";
import { CentrePaneContainer } from "@/modules/orchestrator/containers/CentrePaneContainer";

export function CentreView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section
          aria-label="Canvas"
          className="min-h-0 min-w-0 flex-1 overflow-auto"
        >
          <CentreContainer />
        </section>
        <aside
          aria-label="Conversation"
          className="hidden w-full shrink-0 flex-col border-t border-border md:flex md:w-90 md:border-t-0 md:border-l xl:w-105"
        >
          <CentrePaneContainer />
        </aside>
      </div>
    </div>
  );
}
