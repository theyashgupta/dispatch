import { createLazyFileRoute } from "@tanstack/react-router";
import { SidePanelLayout } from "@/components/SidePanelLayout";
import { BoardView } from "@/modules/board";
import { OrchestratorPanelView } from "@/modules/orchestrator";

export const Route = createLazyFileRoute("/board/{-$id}")({
  component: BoardRoute,
});

function BoardRoute() {
  const { panel } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SidePanelLayout
      main={<BoardView />}
      panel={<OrchestratorPanelView />}
      open={panel === "orchestrator"}
      onClose={() =>
        void navigate({ search: (prev) => ({ ...prev, panel: undefined }) })
      }
      title="Orchestrator"
      handleLabel="Resize orchestrator panel"
    />
  );
}
