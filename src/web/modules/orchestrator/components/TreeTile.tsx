import { SessionStateBadge } from "@/components/badges/SessionStateBadge";
import { ToneBadge } from "@/components/badges/ToneBadge";
import {
  BODY_CLASS,
  BRANCH_GLYPHS,
  type TileBehaviour,
} from "@/modules/orchestrator/components/BranchTile";
import { TONE_GLYPHS } from "@/modules/orchestrator/components/CentreNode";
import { Eyebrow } from "@/modules/orchestrator/components/Eyebrow";
import type {
  TreeGroup,
  TreeOrchestrator,
  TreeStatus,
} from "@/modules/orchestrator/domain/centre-tree";

export type Focusable = Pick<TileBehaviour, "register" | "onKeyDown">;

function TreeStatusBadge({ status }: { status: TreeStatus }) {
  return status.sessionState !== null ? (
    <SessionStateBadge state={status.sessionState} />
  ) : (
    <ToneBadge
      label={status.label}
      tone={status.tone}
      glyph={
        status.state === null
          ? TONE_GLYPHS[status.tone]
          : BRANCH_GLYPHS[status.state]
      }
    />
  );
}

interface TreeGroupTileProps extends Focusable {
  group: TreeGroup;
  from: string;
  onOpen: () => void;
}

export function TreeGroupTile({
  group,
  from,
  register,
  onKeyDown,
  onOpen,
}: TreeGroupTileProps) {
  return (
    <li data-edge-tile={group.id} data-edge-from={from}>
      <button
        type="button"
        ref={register(group.id)}
        onKeyDown={onKeyDown(group.id)}
        onClick={onOpen}
        className={`${BODY_CLASS} border border-border bg-card`}
      >
        <span className="flex flex-wrap items-center gap-(--space-sm)">
          <span className="font-mono text-mono text-muted-foreground">
            {group.identifier}
          </span>
          <TreeStatusBadge status={group.status} />
        </span>
        <span className="text-sm font-semibold wrap-anywhere">
          {group.title}
        </span>
        {group.unitCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {group.unitCount === 1 ? "1 unit" : `${group.unitCount} units`}
          </span>
        )}
      </button>
    </li>
  );
}

interface TreeOrchestratorNodeProps extends Focusable {
  node: TreeOrchestrator;
  onSelect: () => void;
}

export function TreeOrchestratorNode({
  node,
  register,
  onKeyDown,
  onSelect,
}: TreeOrchestratorNodeProps) {
  return (
    <button
      type="button"
      data-edge-node={node.id}
      ref={register(node.focusId)}
      onKeyDown={onKeyDown(node.focusId)}
      onClick={onSelect}
      className="flex w-full flex-col items-start gap-(--space-sm) rounded-md border border-border bg-card p-(--space-lg) text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Eyebrow>
        {node.role === "main" ? "Orchestrator" : "Extra orchestrator"}
      </Eyebrow>
      <span className="flex flex-wrap items-center gap-(--space-sm)">
        <span className="min-w-0 text-base font-semibold wrap-anywhere">
          {node.name}
        </span>
        <TreeStatusBadge status={node.status} />
        <span className="sr-only">, open in Bands</span>
      </span>
    </button>
  );
}
