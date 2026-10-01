import { createElement, type CSSProperties } from "react";
import { Notice } from "../../primitives/Notice.js";
import { PageBody } from "../../primitives/PageBody.js";
import {
  markSlotStyle,
  sourceAccent,
  sourceMark,
} from "../../components/badges/index.js";
import { TRAYS, type SourceNode, type TrayId } from "./flow-model.js";

interface FlowNarrowProps {
  sources: readonly SourceNode[];
  counts: Record<TrayId, number>;
  lastSync: string;
}

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-sm)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

const sourceLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-xs)",
};

const mutedStyle: CSSProperties = { color: "var(--text-muted)" };

export function FlowNarrow({ sources, counts, lastSync }: FlowNarrowProps) {
  return (
    <PageBody>
      <Notice tone="muted">Flow is best on a wider screen.</Notice>
      <h2 style={headingStyle}>Sources</h2>
      <ul style={sectionStyle} aria-label="Sources">
        {sources.map((s) => (
          <li key={s.id} style={rowStyle}>
            <span style={sourceLabelStyle}>
              <span style={{ ...markSlotStyle, color: sourceAccent(s.id) }}>
                {createElement(sourceMark(s.id), { size: 12 })}
              </span>
              {s.label}{" "}
              <span style={mutedStyle}>{s.lit ? "Enabled" : "Off"}</span>
            </span>
            <span>{s.count}</span>
          </li>
        ))}
      </ul>
      <h2 style={headingStyle}>Poller</h2>
      <p style={{ ...rowStyle, margin: 0 }}>{lastSync}</p>
      <h2 style={headingStyle}>Trays</h2>
      <ul style={sectionStyle} aria-label="Trays">
        {TRAYS.map((t) => (
          <li key={t.id} style={rowStyle}>
            <span>{t.label}</span>
            <span>{counts[t.id]}</span>
          </li>
        ))}
      </ul>
    </PageBody>
  );
}
