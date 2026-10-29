import type { ReactNode } from "react";
import type { Card } from "../../../../shared/types.js";
import { edgePath } from "../../../../shared/flow-geometry.js";
import { FlowBox, FlowStage, type FlowToken } from "@/components/FlowStage";
import { cn } from "@/lib/utils";
import {
  flowStageLayout,
  sessionFlowStage,
  type SessionFlowStageId,
  type SessionFlowState,
} from "@/modules/detail/domain/session-flow";

const STAGES: { id: SessionFlowStageId; label: string }[] = [
  { id: "item", label: "Item" },
  { id: "agent", label: "Agent" },
  { id: "terminal", label: "Terminal" },
  { id: "result", label: "Result" },
];

const STATE_COLOR: Record<SessionFlowState, string> = {
  idle: "var(--text-muted)",
  working: "var(--col-in-progress)",
  waiting: "var(--col-needs-input)",
  done: "var(--col-agent-done)",
  lost: "var(--destructive)",
  failed: "var(--destructive)",
};

const LOOP_MS = 1600;

interface SessionFlowRowProps {
  card: Card;
  children?: ReactNode;
}

export function SessionFlowRow({ card, children }: SessionFlowRowProps) {
  const { stage, state } = sessionFlowStage(card);
  const active = STAGES.findIndex((s) => s.id === stage);
  const color = STATE_COLOR[state];
  const failed = state === "lost" || state === "failed";
  const { rects, width, height } = flowStageLayout(active);
  const edgePaths = rects.slice(1).map((rect, i) => edgePath(rects[i], rect));

  const nodes = STAGES.map((s, i) => ({
    id: s.id,
    ...rects[i],
    children: (
      <FlowBox
        accent={i === active ? color : undefined}
        dim={i > active}
        tone={i === active ? color : undefined}
      >
        <span className="flex items-center gap-(--space-xs) whitespace-nowrap">
          <span className="font-semibold">{s.label}</span>
          {i === active && (
            <span
              className={cn(
                "capitalize",
                failed ? "text-destructive-text" : "text-muted-foreground",
              )}
            >
              {state}
            </span>
          )}
        </span>
      </FlowBox>
    ),
  }));

  const edges = edgePaths.map((path, i) => ({
    id: `edge-${i}`,
    path,
    tone: i + 1 === active ? color : undefined,
    dim: i + 1 > active,
  }));

  const tokens: FlowToken[] =
    state === "working" && active > 0
      ? [
          {
            id: `${stage}-${state}`,
            path: edgePaths[active - 1],
            color,
            durationMs: LOOP_MS,
            loop: true,
          },
        ]
      : [];

  return (
    <div className="flex flex-wrap items-center gap-x-(--space-lg) gap-y-(--space-xs) border-b border-border py-(--space-xs) pr-(--space-lg) pl-(--space-xl)">
      <div className="min-w-0 flex-1 basis-80">
        <FlowStage
          width={width}
          height={height}
          nodes={nodes}
          edges={edges}
          tokens={tokens}
          ariaLabel={`Session flow: ${STAGES[active].label} ${state}`}
        />
      </div>
      {children != null && (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-(--space-sm)">
          {children}
        </div>
      )}
    </div>
  );
}
