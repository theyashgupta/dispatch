import { useState, type CSSProperties } from "react";
import { Send } from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import { useCardComments } from "../../hooks/useCardComments.js";
import { postCardComment } from "../../lib/api.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Markdown } from "../../primitives/Markdown.js";
import { Notice } from "../../primitives/Notice.js";
import { WarningIcon } from "../../primitives/WarningIcon.js";

interface LinearSectionProps {
  card: CardModel;
}

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  minWidth: 0,
};

const composerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: "var(--space-xs)",
  minWidth: 0,
};

const textareaStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  resize: "none",
  padding: "var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  outline: "none",
};

const commentStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  padding: "var(--space-xs) 0",
  minWidth: 0,
  overflowWrap: "anywhere",
};

const metaStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-xs)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
};

const authorStyle: CSSProperties = {
  fontWeight: "var(--weight-semibold)",
  color: "var(--text)",
};

const timeStyle: CSSProperties = { color: "var(--text-muted)" };

export function LinearSection({ card }: LinearSectionProps) {
  const comments = useCardComments(
    card.id,
    card.commentCount,
    card.lastCommentId,
  );
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const count = comments.length;
  const rows = Math.min(6, Math.max(2, draft.split("\n").length));

  const handleSend = async () => {
    setPosting(true);
    setPostError(null);
    const result = await postCardComment(card.id, draft);
    setPosting(false);
    if (result.ok) {
      setDraft("");
    } else if (result.status !== 502) {
      setPostError(result.error ?? "Could not reach Dispatch. Try again.");
    }
  };

  return (
    <div style={sectionStyle}>
      {card.linearError != null && (
        <Notice
          tone="destructive"
          icon={<WarningIcon />}
          label={card.linearError}
        />
      )}
      <div style={composerStyle}>
        <textarea
          value={draft}
          rows={rows}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Add a comment"
          placeholder="Add a comment (markdown)..."
          style={{ ...textareaStyle, ...focusRing(focused) }}
        />
        <IconButton
          aria-label="Send comment"
          disabled={posting || draft.trim() === ""}
          onClick={() => void handleSend()}
        >
          <Send size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </div>
      {postError != null && (
        <Notice tone="destructive" icon={<WarningIcon />} label={postError} />
      )}
      {count > 0 && (
        <Collapsible
          title="Comments"
          badge={<Chip>{count}</Chip>}
          defaultOpen={count <= 2}
        >
          {comments.map((c) => (
            <div key={c.id} style={commentStyle}>
              <div style={metaStyle}>
                <span style={authorStyle}>{c.author}</span>
                <span style={timeStyle}>{formatAge(c.createdAt, nowMs())}</span>
              </div>
              <Markdown source={c.body} />
            </div>
          ))}
        </Collapsible>
      )}
    </div>
  );
}
