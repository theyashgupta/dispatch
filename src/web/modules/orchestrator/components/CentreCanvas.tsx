import type { KeyboardEventHandler, Ref } from "react";
import { BranchList } from "@/modules/orchestrator/components/BranchList";
import type { TileBehaviour } from "@/modules/orchestrator/components/BranchTile";
import { CentreEdges } from "@/modules/orchestrator/components/CentreEdges";
import { CentreNode } from "@/modules/orchestrator/components/CentreNode";
import type { CentreGraph } from "@/modules/orchestrator/domain/centre-graph";
import type { EdgePath } from "@/modules/orchestrator/hooks/use-edge-paths";

interface CentreCanvasProps {
  graph: CentreGraph;
  paths: readonly EdgePath[];
  containerRef: Ref<HTMLDivElement>;
  nodeRef: Ref<HTMLElement>;
  onNodeKeyDown: KeyboardEventHandler<HTMLElement>;
  tile: TileBehaviour;
}

export function CentreCanvas({
  graph,
  paths,
  containerRef,
  nodeRef,
  onNodeKeyDown,
  tile,
}: CentreCanvasProps) {
  const { centre } = graph;
  if (centre === null) return null;
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
          <BranchList bands={graph.bands} tile={tile} />
        </div>
      </div>
    </div>
  );
}
