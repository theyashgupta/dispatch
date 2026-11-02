import type { Ref } from "react";
import { CentreEdges } from "@/modules/orchestrator/components/CentreEdges";
import {
  type Focusable,
  TreeGroupTile,
  TreeOrchestratorNode,
} from "@/modules/orchestrator/components/TreeTile";
import type { CentreTree as CentreTreeModel } from "@/modules/orchestrator/domain/centre-tree";
import type { EdgePath } from "@/modules/orchestrator/hooks/use-edge-paths";

interface CentreTreeProps extends Focusable {
  tree: CentreTreeModel;
  paths: readonly EdgePath[];
  containerRef: Ref<HTMLDivElement>;
  onOpenGroup: (id: string) => void;
  onSelectOrchestrator: (id: string) => void;
}

export function CentreTree({
  tree,
  paths,
  containerRef,
  register,
  onKeyDown,
  onOpenGroup,
  onSelectOrchestrator,
}: CentreTreeProps) {
  return (
    <div className="canvas-dots min-h-full">
      <div
        ref={containerRef}
        className="relative flex flex-col gap-(--space-3xl) p-(--space-xl)"
      >
        <CentreEdges edges={tree.edges} paths={paths} />
        {tree.orchestrators.map((node) => (
          <section
            key={node.id}
            aria-label={node.name}
            className="relative flex items-start gap-(--space-3xl)"
          >
            <div className="relative w-60 shrink-0">
              <TreeOrchestratorNode
                node={node}
                register={register}
                onKeyDown={onKeyDown}
                onSelect={() => onSelectOrchestrator(node.id)}
              />
            </div>
            <div className="relative min-w-0 flex-1">
              {node.groups.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-(--space-sm) p-0">
                  {node.groups.map((group) => (
                    <TreeGroupTile
                      key={group.id}
                      group={group}
                      from={node.id}
                      register={register}
                      onKeyDown={onKeyDown}
                      onOpen={() => onOpenGroup(group.id)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">No groups</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
