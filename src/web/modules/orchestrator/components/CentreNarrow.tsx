import type { KeyboardEventHandler, ReactNode, Ref } from "react";
import { CentreNode } from "@/modules/orchestrator/components/CentreNode";
import type { CentreNode as CentreNodeModel } from "@/modules/orchestrator/domain/centre-graph";

interface CentreNarrowProps {
  controls: ReactNode;
  centre: CentreNodeModel | null;
  nodeRef: Ref<HTMLElement>;
  onNodeKeyDown: KeyboardEventHandler<HTMLElement>;
  reason: ReactNode;
  branches: ReactNode;
}

export function CentreNarrow({
  controls,
  centre,
  nodeRef,
  onNodeKeyDown,
  reason,
  branches,
}: CentreNarrowProps) {
  return (
    <div className="flex flex-col gap-(--space-md) p-(--space-lg)">
      {controls}
      {centre !== null && (
        <CentreNode
          node={centre}
          compact
          nodeRef={nodeRef}
          onKeyDown={onNodeKeyDown}
        />
      )}
      {reason}
      {branches}
    </div>
  );
}
