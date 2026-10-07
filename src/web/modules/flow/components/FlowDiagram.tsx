import { sourceAccent } from "@/components/badges";
import {
  FlowBox,
  FlowChip,
  FlowStage,
  type FlowToken,
} from "@/components/FlowStage";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { edgePath } from "../../../../shared/flow-geometry.js";
import { FlowSourceMark } from "./FlowSourceMark";
import {
  POLLER_RECT,
  POLLER_TONE_COLOR,
  SOURCE_RECTS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  TRAY_RECTS,
  TRAYS,
  TRIAGE_RECT,
  type PollerTone,
  type SourceNode,
  type TrayId,
} from "@/modules/flow/domain/flow-model";

interface FlowDiagramProps {
  sources: readonly SourceNode[];
  counts: Record<TrayId, number>;
  tone: PollerTone;
  pulsing: boolean;
  lastSync: string;
  tokens: readonly FlowToken[];
  onTokenEnd: (id: string) => void;
  onOpenList: () => void;
}

const HEAD_ROW = "flex min-w-0 items-center justify-between gap-(--space-xs)";
const TITLE = "overflow-hidden font-semibold text-ellipsis whitespace-nowrap";
const CAPTION = "text-xs text-muted-foreground";

export function FlowDiagram({
  sources,
  counts,
  tone,
  pulsing,
  lastSync,
  tokens,
  onTokenEnd,
  onOpenList,
}: FlowDiagramProps) {
  const nodes = [
    ...sources.map((s) => ({
      id: `source-${s.id}`,
      ...SOURCE_RECTS[s.id],
      children: (
        <FlowBox
          accent={sourceAccent(s.id)}
          dim={!s.lit}
          onClick={onOpenList}
          ariaLabel={`${s.label}, ${s.count} items`}
        >
          <span className={HEAD_ROW}>
            <span className="flex min-w-0 items-center gap-(--space-xs)">
              <FlowSourceMark source={s.id} size={16} />
              <span className={TITLE}>{s.label}</span>
            </span>
            <FlowChip color={sourceAccent(s.id)}>{s.count}</FlowChip>
          </span>
          <span className={CAPTION}>{s.lit ? "Enabled" : "Off"}</span>
        </FlowBox>
      ),
    })),
    {
      id: "poller",
      ...POLLER_RECT,
      children: (
        <FlowBox ariaLabel={`Poller, ${lastSync}`}>
          <span className={cn(HEAD_ROW, "justify-start")}>
            <Badge
              variant="ghost"
              data-poller-dot=""
              data-pulsing={pulsing ? "" : undefined}
              stateColor={POLLER_TONE_COLOR[tone]}
              className={cn(
                "size-2 min-w-0 flex-none rounded-full border-0 bg-(color:--badge-state) p-0",
                pulsing &&
                  "animate-[flow-pulse_var(--motion-flow-pulse)_var(--easing-enter)_infinite]",
              )}
            />
            <span className={TITLE}>Poller</span>
          </span>
          <span className={CAPTION}>{lastSync}</span>
        </FlowBox>
      ),
    },
    {
      id: "triage",
      ...TRIAGE_RECT,
      children: (
        <FlowBox dim ariaLabel="AI triage, off">
          <span className={TITLE}>AI triage</span>
          <span className={CAPTION}>Off</span>
        </FlowBox>
      ),
    },
    ...TRAYS.map((t) => ({
      id: `tray-${t.id}`,
      ...TRAY_RECTS[t.id],
      children: (
        <FlowBox
          accent={t.color}
          onClick={onOpenList}
          ariaLabel={`${t.label}, ${counts[t.id]} items`}
        >
          <span className={HEAD_ROW}>
            <span className={TITLE}>{t.label}</span>
            <FlowChip color={t.color}>{counts[t.id]}</FlowChip>
          </span>
        </FlowBox>
      ),
    })),
  ];

  const edges = [
    ...sources.map((s) => ({
      id: `edge-source-${s.id}`,
      path: edgePath(SOURCE_RECTS[s.id], POLLER_RECT),
      tone: s.lit ? sourceAccent(s.id) : undefined,
      dim: !s.lit,
    })),
    {
      id: "edge-poller-triage",
      path: edgePath(POLLER_RECT, TRIAGE_RECT),
      dim: true,
    },
    ...TRAYS.map((t) => ({
      id: `edge-tray-${t.id}`,
      path: edgePath(TRIAGE_RECT, TRAY_RECTS[t.id]),
      tone: t.color,
    })),
  ];

  return (
    <Card className="gap-0 border-0 bg-transparent py-0 shadow-none">
      <CardContent className="px-0">
        <FlowStage
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          nodes={nodes}
          edges={edges}
          tokens={tokens}
          onTokenEnd={onTokenEnd}
          ariaLabel="Flow of work from sources through the poller into urgency trays"
        />
      </CardContent>
    </Card>
  );
}
