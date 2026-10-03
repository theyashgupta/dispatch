import { useState, type CSSProperties } from "react";
import { ExternalLink, Send, UserPlus } from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import { useCardComments } from "../../hooks/useCardComments.js";
import { useLinearWorkflow } from "../../hooks/useLinearWorkflow.js";
import {
  assignCardToMe,
  postCardComment,
  setCardLinearState,
} from "../../lib/api.js";
import { isWebUrl } from "../../../shared/web-url.js";
import { moveErrorCopy } from "./move-error-copy.js";
import { formatAge, nowMs } from "../../../shared/format-age.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { IconButton } from "../../primitives/IconButton.js";
import { LinkButton } from "../../primitives/LinkButton.js";
import { Markdown } from "../../primitives/Markdown.js";
import { Notice } from "../../primitives/Notice.js";
import { Select } from "../../primitives/Select.js";
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

const actionPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  padding: "var(--space-sm)",
  background: "var(--surface-column)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  minWidth: 0,
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-xs)",
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
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const workflow = useLinearWorkflow();
  const viewerId =
    workflow.status === "ready" ? workflow.workflow.viewerId : undefined;
  const assignedToMe = viewerId !== undefined && card.assignee?.id === viewerId;
  const teamStates =
    workflow.status === "ready" && card.team
      ? [
          ...(workflow.workflow.teams.find((t) => t.id === card.team?.id)
            ?.states ?? []),
        ].sort((a, b) => a.position - b.position)
      : [];
  const [focused, setFocused] = useState(false);
  const count = comments.length;
  const rows = Math.min(6, Math.max(2, draft.split("\n").length));

  const handleAssign = async () => {
    setAssigning(true);
    setAssignError(null);
    const result = await assignCardToMe(card.id);
    setAssigning(false);
    if (result.ok || result.status === 502) return;
    setAssignError(
      result.status === 409
        ? "Linear is not connected."
        : (result.error ?? "Could not reach Dispatch. Try again."),
    );
  };

  const handleMove = async (stateId: string) => {
    if (stateId === "") return;
    setMoving(true);
    setMoveError(null);
    const result = await setCardLinearState(card.id, stateId);
    setMoving(false);
    if (result.ok || result.status === 502) return;
    setMoveError(moveErrorCopy(result.status, result.error));
  };

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
      <div style={actionPanelStyle}>
        <div style={actionRowStyle}>
          {teamStates.length > 0 && (
            <Select
              label="Move to a Linear state"
              value=""
              disabled={moving}
              onChange={(stateId) => void handleMove(stateId)}
            >
              <option value="">
                {`Move to... (now: ${card.linearState?.name ?? "unknown"})`}
              </option>
              {teamStates.map((state) => (
                <option
                  key={state.id}
                  value={state.id}
                  disabled={state.id === card.linearState?.id}
                >
                  {state.name}
                </option>
              ))}
            </Select>
          )}
          {!assignedToMe && (
            <Button
              variant="secondary"
              disabled={assigning}
              onClick={() => void handleAssign()}
            >
              <UserPlus size={12} strokeWidth={2} aria-hidden="true" />
              Assign to me
            </Button>
          )}
          {isWebUrl(card.url) && (
            <LinkButton href={card.url}>
              <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
              Open in Linear
            </LinkButton>
          )}
        </div>
        {assignError != null && (
          <Notice
            tone="destructive"
            icon={<WarningIcon />}
            label={assignError}
          />
        )}
        {moveError != null && (
          <Notice tone="destructive" icon={<WarningIcon />} label={moveError} />
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
      </div>
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
