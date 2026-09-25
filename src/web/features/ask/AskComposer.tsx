import { useState, type CSSProperties } from "react";
import { Send } from "lucide-react";
import { ASK_LIMITS } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { focusRing } from "../../primitives/focus-ring.js";

interface AskComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  pending: boolean;
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: "var(--space-sm)",
};

const textareaStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: "64px",
  maxHeight: "200px",
  resize: "vertical",
  padding: "var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
};

export function AskComposer({
  value,
  onChange,
  onSend,
  pending,
}: AskComposerProps) {
  const [focused, setFocused] = useState(false);
  const canSend = !pending && value.trim() !== "";
  return (
    <div style={rowStyle}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) {
            return;
          }
          if (!canSend) return;
          e.preventDefault();
          onSend();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="Ask a question about your board"
        placeholder="Ask about your tickets, inbox and agents"
        rows={2}
        maxLength={ASK_LIMITS.question}
        style={{ ...textareaStyle, ...focusRing(focused) }}
      />
      <Button variant="primary" disabled={!canSend} onClick={onSend}>
        <Send size={14} aria-hidden={true} />
        Send
      </Button>
    </div>
  );
}
