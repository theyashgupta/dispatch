import type { CSSProperties } from "react";
import {
  DEFAULT_GRANOLA_WINDOW_HOURS,
  type GRANOLA_WINDOW_HOURS,
} from "../../../shared/types.js";
import { SourceIcon } from "../badges/index.js";
import { useGranolaRound } from "../../hooks/useGranolaRound.js";
import { MEETING_CONNECTION } from "../../lib/connection-meta.js";
import {
  GRANOLA_ERROR_COPY,
  granolaCardStatus,
  granolaRunLine,
} from "../../lib/connection-status.js";
import { nowMs } from "../../lib/format-age.js";
import { Button } from "../../primitives/Button.js";
import { ConnectionCard } from "../../primitives/ConnectionCard.js";
import { Field } from "../../primitives/Field.js";
import { Select } from "../../primitives/Select.js";
import { Spinner } from "../../primitives/Spinner.js";

type WindowKey = `${(typeof GRANOLA_WINDOW_HOURS)[number]}`;

const WINDOW_LABELS: Record<WindowKey, string> = {
  "24": "Last 24 hours",
  "48": "Last 48 hours",
  "72": "Last 3 days",
  "168": "Last 7 days",
  "336": "Last 14 days",
};

const controlsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
};

const lineStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};

export function GranolaConnectionCard() {
  const granola = useGranolaRound();
  const status = granola.status;
  const enabled = status?.enabled === true;
  const running = status?.running === true;
  const check = granola.check;
  const checkLine =
    check === null
      ? null
      : check.state === "connected"
        ? `Connected: ${check.server}`
        : GRANOLA_ERROR_COPY[check.state];
  return (
    <ConnectionCard
      badge={<SourceIcon source={MEETING_CONNECTION.source} />}
      name={MEETING_CONNECTION.name}
      status={granolaCardStatus(status, check, granola.loadFailed)}
      credentialLabel={MEETING_CONNECTION.credentialLabel}
      steps={MEETING_CONNECTION.steps}
      footer={MEETING_CONNECTION.footer}
      toggle={{
        label: "Enabled",
        checked: enabled,
        disabled: status === null || granola.saving,
        onChange: (next) => void granola.setEnabled(next),
      }}
    >
      <div style={controlsStyle}>
        <div style={rowStyle}>
          <Field>Review window</Field>
          <Select
            label="Review window"
            value={
              String(
                status?.windowHours ?? DEFAULT_GRANOLA_WINDOW_HOURS,
              ) as WindowKey
            }
            labels={WINDOW_LABELS}
            onChange={(key) => void granola.setWindow(Number(key))}
          />
        </div>
        <div style={rowStyle}>
          <Button
            onClick={() => void granola.checkConnection()}
            loading={granola.checking}
            disabled={granola.checking}
          >
            Check connection
          </Button>
          <Button
            onClick={() => void granola.analyzeNow()}
            disabled={!enabled || running || granola.saving}
          >
            Analyze now
          </Button>
        </div>
        {checkLine !== null && (
          <span role="status" style={lineStyle}>
            {checkLine}
          </span>
        )}
        {status !== null && (
          <span style={lineStyle}>
            {running && <Spinner />}
            {granolaRunLine(status, nowMs())}
          </span>
        )}
      </div>
    </ConnectionCard>
  );
}
