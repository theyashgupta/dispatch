import type { CSSProperties } from "react";
import { Button } from "../../primitives/Button.js";

const SPEEDS = [0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

interface FlowToolbarProps {
  speed: Speed;
  canReplay: boolean;
  syncing: boolean;
  notice: string | null;
  onSpeedChange: (speed: Speed) => void;
  onReplay: () => void;
  onSync: () => void;
}

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "var(--space-sm)",
};

const speedGroupStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-xs)",
};

const activeSpeedStyle: CSSProperties = {
  background: "var(--pressed-card)",
  borderColor: "var(--text-muted)",
};

const idleSpeedStyle: CSSProperties = { borderColor: "var(--border)" };

const noticeStyle: CSSProperties = {
  margin: 0,
  textAlign: "right",
  color: "var(--text-muted)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
};

export function FlowToolbar({
  speed,
  canReplay,
  syncing,
  notice,
  onSpeedChange,
  onReplay,
  onSync,
}: FlowToolbarProps) {
  return (
    <>
      <div style={toolbarStyle}>
        <div role="group" aria-label="Animation speed" style={speedGroupStyle}>
          {SPEEDS.map((value) => (
            <Button
              key={value}
              aria-pressed={speed === value}
              style={speed === value ? activeSpeedStyle : idleSpeedStyle}
              onClick={() => onSpeedChange(value)}
            >
              {`${value}x`}
            </Button>
          ))}
        </div>
        <Button disabled={!canReplay} onClick={onReplay}>
          Replay latest
        </Button>
        <Button disabled={syncing} onClick={onSync}>
          Sync now
        </Button>
      </div>
      <p role="status" style={noticeStyle}>
        {notice}
      </p>
    </>
  );
}
