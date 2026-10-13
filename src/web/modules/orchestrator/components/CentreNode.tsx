import type { Ref, KeyboardEventHandler } from "react";
import { CircleCheck, Pause, Play, TriangleAlert } from "lucide-react";
import { ToneBadge } from "@/components/badges/ToneBadge";
import { Eyebrow } from "@/modules/orchestrator/components/Eyebrow";
import type {
  BranchTone,
  CentreNode as CentreNodeModel,
} from "@/modules/orchestrator/domain/centre-graph";
import {
  contextText,
  costText,
  countsText,
} from "@/modules/orchestrator/domain/centre-page-state";

const GLYPHS = {
  neutral: Play,
  muted: Pause,
  attention: TriangleAlert,
  success: CircleCheck,
  error: TriangleAlert,
} satisfies Record<BranchTone, unknown>;

interface CentreNodeProps {
  node: CentreNodeModel;
  compact: boolean;
  nodeRef: Ref<HTMLElement>;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
}

export function CentreNode({
  node,
  compact,
  nodeRef,
  onKeyDown,
}: CentreNodeProps) {
  return (
    <section
      ref={nodeRef}
      aria-label="Orchestrator"
      tabIndex={0}
      data-edge-node=""
      onKeyDown={onKeyDown}
      className="flex flex-col gap-(--space-sm) rounded-md border border-border bg-card p-(--space-lg) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {!compact && <Eyebrow as="p">Orchestrator</Eyebrow>}
      <div className="flex flex-wrap items-center gap-(--space-sm)">
        <h2 className="m-0 min-w-0 text-base font-semibold wrap-anywhere">
          {node.name}
        </h2>
        <ToneBadge
          label={node.label}
          tone={node.tone}
          glyph={GLYPHS[node.tone]}
        />
      </div>
      <p className="m-0 flex flex-wrap gap-x-(--space-md) text-sm text-muted-foreground">
        {node.contextPercent !== null && (
          <span>{contextText(node.contextPercent)}</span>
        )}
        {node.cost !== null && <span>{costText(node.cost)}</span>}
        <span>{countsText(node.branchCount, node.needYouCount)}</span>
      </p>
    </section>
  );
}
