import type { Card } from "../../../../shared/types.js";
import { edgePath, type Rect } from "../../../../shared/flow-geometry.js";
import { FlowBox, FlowStage, type FlowToken } from "@/components/FlowStage";
import { cn } from "@/lib/utils";
import {
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

const WIDTH = 364;
const HEIGHT = 64;
const LOOP_MS = 1600;
const RECTS: Rect[] = STAGES.map((_, i) => ({
  x: i * 96,
  y: 8,
  w: 76,
  h: 48,
}));
const EDGE_PATHS = RECTS.slice(1).map((rect, i) => edgePath(RECTS[i], rect));

export function SessionFlowRow({ card }: { card: Card }) {
  const { stage, state } = sessionFlowStage(card);
  const active = STAGES.findIndex((s) => s.id === stage);
  const color = STATE_COLOR[state];
  const failed = state === "lost" || state === "failed";

  const nodes = STAGES.map((s, i) => ({
    id: s.id,
    ...RECTS[i],
    children: (
      <FlowBox
        accent={i === active ? color : undefined}
        dim={i > active}
        tone={i === active ? color : undefined}
      >
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
      </FlowBox>
    ),
  }));

  const edges = EDGE_PATHS.map((path, i) => ({
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
            path: EDGE_PATHS[active - 1],
            color,
            durationMs: LOOP_MS,
            loop: true,
          },
        ]
      : [];

  return (
    <div className="border-b border-border py-(--space-sm) pr-(--space-lg) pl-(--space-xl)">
      <FlowStage
        width={WIDTH}
        height={HEIGHT}
        nodes={nodes}
        edges={edges}
        tokens={tokens}
        ariaLabel={`Session flow: ${STAGES[active].label} ${state}`}
      />
    </div>
  );
}
