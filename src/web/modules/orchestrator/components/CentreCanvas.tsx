import type { KeyboardEventHandler, Ref } from "react";
import { BranchList } from "@/modules/orchestrator/components/BranchList";
import type { TileBehaviour } from "@/modules/orchestrator/components/BranchTile";
import { CentreEdges } from "@/modules/orchestrator/components/CentreEdges";
import { CentreNode } from "@/modules/orchestrator/components/CentreNode";
import type { CentreGraph } from "@/modules/orchestrator/domain/centre-graph";
import { NO_BRANCHES_TEXT } from "@/modules/orchestrator/domain/centre-page-state";
import type { EdgePath } from "@/modules/orchestrator/hooks/use-edge-paths";

interface CentreCanvasProps {
  graph: CentreGraph;
  paths: readonly EdgePath[];
  containerRef: Ref<HTMLDivElement>;
  nodeRef: Ref<HTMLElement>;
  onNodeKeyDown: KeyboardEventHandler<HTMLElement>;
  showOlderShipped: boolean;
  onToggleShipped: () => void;
  tile: TileBehaviour;
}

export function CentreCanvas({
  graph,
  paths,
  containerRef,
  nodeRef,
  onNodeKeyDown,
  showOlderShipped,
  onToggleShipped,
  tile,
}: CentreCanvasProps) {
  const { centre } = graph;
  if (centre === null) return null;
  const empty = graph.branches.length === 0 && graph.hiddenShipped === 0;
  return (
    <div className="canvas-dots min-h-full">
      <div
        ref={containerRef}
        className="relative flex items-start gap-(--space-3xl) p-(--space-xl)"
      >
        <CentreEdges edges={graph.edges} paths={paths} />
        <div className="relative w-60 shrink-0">
          <CentreNode
            node={centre}
            compact={false}
            nodeRef={nodeRef}
            onKeyDown={onNodeKeyDown}
          />
        </div>
        <div className="relative min-w-0 flex-1">
          {empty ? (
            <p className="m-0 text-sm text-muted-foreground">
              {NO_BRANCHES_TEXT}
            </p>
          ) : (
            <BranchList
              bands={graph.bands}
              hiddenShipped={graph.hiddenShipped}
              showOlderShipped={showOlderShipped}
              onToggleShipped={onToggleShipped}
              tile={tile}
            />
          )}
        </div>
      </div>
    </div>
  );
}
