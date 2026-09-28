import type { CSSProperties } from "react";
import { useSlackThread } from "../../hooks/useSlackThread.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";

interface SlackThreadProps {
  itemId: string;
  replyCount?: string;
}

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "var(--space-sm)",
  paddingTop: "var(--space-xs)",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  margin: 0,
  padding: 0,
  listStyle: "none",
  width: "100%",
};

const headStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-xs)",
  alignItems: "baseline",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
};

const authorStyle: CSSProperties = { fontWeight: "var(--weight-semibold)" };

const timeStyle: CSSProperties = { color: "var(--text-muted)" };

const textStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const noteStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

export function SlackThread({ itemId, replyCount }: SlackThreadProps) {
  const { state, load } = useSlackThread(itemId);
  const now = nowMs();
  return (
    <Collapsible
      title="Thread"
      badge={Number(replyCount) > 0 ? <Chip>{replyCount}</Chip> : undefined}
    >
      <div style={bodyStyle}>
        <Button
          variant="secondary"
          loading={state.status === "loading"}
          onClick={load}
        >
          Load thread
        </Button>
        {state.status === "loaded" ? (
          <>
            <ul style={listStyle}>
              {state.thread.messages.map((message, i) => (
                <li key={`${message.time}-${i}`}>
                  <div style={headStyle}>
                    <span style={authorStyle}>{message.author}</span>
                    <span style={timeStyle}>
                      {formatAge(message.time, now)}
                    </span>
                  </div>
                  <div style={textStyle}>{message.text}</div>
                </li>
              ))}
            </ul>
            {state.thread.truncated ? (
              <div style={noteStyle}>Showing the first 40 messages.</div>
            ) : null}
          </>
        ) : null}
        {state.status === "error" ? (
          <div role="alert" style={noteStyle}>
            {state.reason === "rejected" && state.providerError
              ? `Slack refused: ${state.providerError}.`
              : "Couldn't load the thread. Try again."}
          </div>
        ) : null}
      </div>
    </Collapsible>
  );
}
