import type { CSSProperties } from "react";
import type { AskTurn } from "../../../shared/types.js";
import { Markdown } from "../../primitives/Markdown.js";

interface AskMessageProps {
  turn: AskTurn;
}

const userStyle: CSSProperties = {
  alignSelf: "flex-end",
  maxWidth: "85%",
  padding: "var(--space-sm) var(--space-lg)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const assistantStyle: CSSProperties = {
  alignSelf: "stretch",
  minWidth: 0,
  overflowWrap: "anywhere",
};

export function AskMessage({ turn }: AskMessageProps) {
  if (turn.role === "user") {
    return <div style={userStyle}>{turn.text}</div>;
  }
  return (
    <div style={assistantStyle}>
      <Markdown source={turn.text} />
    </div>
  );
}
