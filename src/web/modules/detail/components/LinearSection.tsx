import { useState } from "react";
import { ExternalLink, Send, UserPlus } from "lucide-react";
import type {
  Card as CardModel,
  LinearComment,
  LinearWorkflow,
} from "../../../../shared/types.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import { formatAge, nowMs } from "../../../../shared/format-age.js";
import { GroupCollapsible } from "@/components/GroupCollapsible";
import { Markdown } from "@/components/markdown/Markdown";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { moveErrorCopy } from "@/modules/detail/domain/move-error-copy";
import { PanelAlert } from "./PanelNotice";

type LinearResult =
  { ok: true } | { ok: false; status: number; error: string | null };

interface LinearSectionProps {
  card: CardModel;
  comments: LinearComment[];
  workflow: LinearWorkflow | undefined;
  assignToMe: (id: string) => Promise<LinearResult>;
  setLinearState: (id: string, stateId: string) => Promise<LinearResult>;
  postComment: (id: string, body: string) => Promise<LinearResult>;
}

export function LinearSection({
  card,
  comments,
  workflow,
  assignToMe,
  setLinearState,
  postComment,
}: LinearSectionProps) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const viewerId = workflow?.viewerId;
  const assignedToMe = viewerId !== undefined && card.assignee?.id === viewerId;
  const teamStates =
    workflow !== undefined && card.team
      ? [
          ...(workflow.teams.find((t) => t.id === card.team?.id)?.states ?? []),
        ].sort((a, b) => a.position - b.position)
      : [];
  const count = comments.length;
  const rows = Math.min(6, Math.max(2, draft.split("\n").length));

  const handleAssign = async () => {
    setAssigning(true);
    setAssignError(null);
    const result = await assignToMe(card.id);
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
    const result = await setLinearState(card.id, stateId);
    setMoving(false);
    if (result.ok || result.status === 502) return;
    setMoveError(moveErrorCopy(result.status, result.error));
  };

  const handleSend = async () => {
    setPosting(true);
    setPostError(null);
    const result = await postComment(card.id, draft);
    setPosting(false);
    if (result.ok) {
      setDraft("");
    } else if (result.status !== 502) {
      setPostError(result.error ?? "Could not reach Dispatch. Try again.");
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-(--space-sm)">
      {card.linearError != null && (
        <PanelAlert icon>{card.linearError}</PanelAlert>
      )}
      <div className="flex min-w-0 flex-col gap-(--space-sm) rounded-md border border-border bg-(--surface-column) p-(--space-sm)">
        <div className="flex min-w-0 flex-wrap gap-(--space-xs)">
          {teamStates.length > 0 && (
            <Select
              value=""
              disabled={moving}
              onValueChange={(stateId) => void handleMove(stateId)}
            >
              <SelectTrigger
                size="sm"
                variant="surface"
                aria-label="Move to a Linear state"
                className="min-w-0 px-(--space-sm) data-[placeholder]:text-foreground"
              >
                <SelectValue
                  placeholder={`Move to... (now: ${card.linearState?.name ?? "unknown"})`}
                />
              </SelectTrigger>
              <SelectContent position="popper">
                {teamStates.map((state) => (
                  <SelectItem
                    key={state.id}
                    value={state.id}
                    disabled={state.id === card.linearState?.id}
                  >
                    {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!assignedToMe && (
            <Button
              variant="outline"
              size="sm"
              disabled={assigning}
              onClick={() => void handleAssign()}
            >
              <UserPlus className="size-3" aria-hidden="true" />
              Assign to me
            </Button>
          )}
          {isWebUrl(card.url) && (
            <Button asChild variant="outline" size="sm">
              <a href={card.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3" aria-hidden="true" />
                Open in Linear
              </a>
            </Button>
          )}
        </div>
        {assignError != null && <PanelAlert icon>{assignError}</PanelAlert>}
        {moveError != null && <PanelAlert icon>{moveError}</PanelAlert>}
        <div className="flex min-w-0 items-end gap-(--space-xs)">
          <Textarea
            variant="surface"
            value={draft}
            rows={rows}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Add a comment"
            placeholder="Add a comment (markdown)..."
            className="[field-sizing:fixed] min-h-0 min-w-0 flex-auto resize-none p-(--space-sm) font-sans text-base leading-(--line-body) text-foreground shadow-none md:text-base"
          />
          <Button
            variant="ghost"
            size="icon-md"
            className="text-muted-foreground hover:text-muted-foreground"
            aria-label="Send comment"
            disabled={posting || draft.trim() === ""}
            onClick={() => void handleSend()}
          >
            <Send className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        {postError != null && <PanelAlert icon>{postError}</PanelAlert>}
      </div>
      {count > 0 && (
        <GroupCollapsible
          label="Comments"
          count={count}
          defaultOpen={count <= 2}
        >
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="flex min-w-0 flex-col gap-(--space-xs) py-(--space-xs) wrap-anywhere"
            >
              <div className="flex items-baseline gap-(--space-xs) text-sm">
                <span className="font-semibold text-foreground">
                  {comment.author}
                </span>
                <span className="text-muted-foreground">
                  {formatAge(comment.createdAt, nowMs())}
                </span>
              </div>
              <Markdown source={comment.body} />
            </div>
          ))}
        </GroupCollapsible>
      )}
    </div>
  );
}
