import type { CSSProperties } from "react";
import {
  FlowBox,
  FlowChip,
  FlowStage,
  type FlowToken,
} from "../../primitives/FlowStage.js";
import { edgePath } from "../../lib/flow-geometry.js";
import { sourceAccent } from "../badges/index.js";
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
} from "./flow-model.js";

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

const headRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-xs)",
  minWidth: 0,
};

const titleStyle: CSSProperties = {
  fontWeight: "var(--weight-semibold)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const captionStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--font-micro)",
};

const dotStyle: CSSProperties = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  flex: "0 0 auto",
};

const PULSE =
  "flow-pulse var(--motion-flow-pulse) var(--easing-enter) infinite";

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
          <span style={headRowStyle}>
            <span style={titleStyle}>{s.label}</span>
            <FlowChip color={sourceAccent(s.id)}>{s.count}</FlowChip>
          </span>
          <span style={captionStyle}>{s.lit ? "Enabled" : "Off"}</span>
        </FlowBox>
      ),
    })),
    {
      id: "poller",
      ...POLLER_RECT,
      children: (
        <FlowBox ariaLabel={`Poller, ${lastSync}`}>
          <span style={{ ...headRowStyle, justifyContent: "flex-start" }}>
            <span
              data-poller-dot=""
              data-pulsing={pulsing ? "" : undefined}
              style={{
                ...dotStyle,
                background: POLLER_TONE_COLOR[tone],
                animation: pulsing ? PULSE : undefined,
              }}
            />
            <span style={titleStyle}>Poller</span>
          </span>
          <span style={captionStyle}>{lastSync}</span>
        </FlowBox>
      ),
    },
    {
      id: "triage",
      ...TRIAGE_RECT,
      children: (
        <FlowBox dim ariaLabel="AI triage, off">
          <span style={titleStyle}>AI triage</span>
          <span style={captionStyle}>Off</span>
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
          <span style={headRowStyle}>
            <span style={titleStyle}>{t.label}</span>
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
    <FlowStage
      width={STAGE_WIDTH}
      height={STAGE_HEIGHT}
      nodes={nodes}
      edges={edges}
      tokens={tokens}
      onTokenEnd={onTokenEnd}
      ariaLabel="Flow of work from sources through the poller into urgency trays"
    />
  );
}
