import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAsk, type AskErrorKind } from "../../hooks/useAsk.js";
import { Button } from "../../primitives/Button.js";
import { Notice } from "../../primitives/Notice.js";
import { PageBody, pageColumnStyle } from "../../primitives/PageBody.js";
import { Spinner } from "../../primitives/Spinner.js";
import { AskComposer } from "./AskComposer.js";
import { AskMessage } from "./AskMessage.js";

const SUGGESTIONS = [
  "What needs me right now",
  "What did the agents finish this week",
];

const PRIVACY_NOTICE =
  "Titles and snippets from your board are sent to the Claude CLI to answer.";

const ERROR_TEXT: Record<AskErrorKind, string> = {
  busy: "Another question is still being answered. Try again in a moment.",
  timeout: "Claude took longer than 3 minutes, so the question was stopped.",
  failed: "Claude could not answer. Check that the Claude CLI is signed in.",
  invalid: "That question is too long to send.",
};

const pageStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  minHeight: 0,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
};

const suggestionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
};

const statusRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  color: "var(--text-muted)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
};

const footerStyle: CSSProperties = {
  flex: "0 0 auto",
  borderTop: "1px solid var(--border)",
};

const footerColumnStyle: CSSProperties = {
  ...pageColumnStyle,
  padding: "var(--space-sm) var(--space-lg) var(--space-lg)",
  gap: "var(--space-sm)",
};

interface AskPageProps {
  prefill?: string;
  onPrefillConsumed: () => void;
}

export function AskPage({ prefill, onPrefillConsumed }: AskPageProps) {
  const ask = useAsk();
  const [draft, setDraft] = useState(prefill ?? "");
  const [lastPrefill, setLastPrefill] = useState(prefill);
  const endRef = useRef<HTMLDivElement>(null);
  if (prefill !== lastPrefill) {
    setLastPrefill(prefill);
    if (prefill !== undefined) setDraft(prefill);
  }

  useEffect(() => {
    if (prefill !== undefined) onPrefillConsumed();
  }, [prefill, onPrefillConsumed]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [ask.turns.length, ask.pending, ask.error]);

  const handleSubmit = (question: string) => {
    ask.send(question);
    setDraft("");
  };

  const empty = ask.turns.length === 0 && ask.pending === null;

  return (
    <div style={pageStyle}>
      <PageBody>
        {empty ? (
          <div style={suggestionsStyle}>
            {SUGGESTIONS.map((question) => (
              <Button key={question} onClick={() => ask.send(question)}>
                {question}
              </Button>
            ))}
          </div>
        ) : (
          <div style={listStyle} aria-live="polite">
            {ask.turns.map((turn, i) => (
              <AskMessage key={i} turn={turn} />
            ))}
            {ask.pending !== null ? (
              <div style={statusRowStyle}>
                <Spinner />
                <span>Claude is answering</span>
                <Button onClick={ask.cancel}>Cancel</Button>
              </div>
            ) : null}
            {ask.error !== null ? (
              <div style={statusRowStyle}>
                <Notice tone="destructive" label={ERROR_TEXT[ask.error]} />
                {ask.error !== "invalid" ? (
                  <Button onClick={ask.retry}>Retry</Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        <div ref={endRef} />
      </PageBody>
      <div style={footerStyle}>
        <div style={footerColumnStyle}>
          <Notice tone="muted" label="Privacy">
            {PRIVACY_NOTICE}
          </Notice>
          <AskComposer
            value={draft}
            onChange={setDraft}
            onSend={() => handleSubmit(draft)}
            pending={ask.pending !== null}
          />
        </div>
      </div>
    </div>
  );
}
