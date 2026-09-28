import type { CSSProperties } from "react";

export const settingsInputStyle: CSSProperties = {
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  outline: "none",
};

export const settingsTabStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--space-xs)",
};

export const settingsRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
};

export const settingsTextStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
  overflowWrap: "anywhere",
};

export const settingsMutedTextStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

export const settingsSectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  flex: "1 1 auto",
  minHeight: 0,
};

export const settingsBodyTextStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};
